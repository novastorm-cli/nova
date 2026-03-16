import type { IBrain } from '../contracts/IBrain.js';
import { BrainError } from '../contracts/IBrain.js';
import type { LlmClient, Observation, ProjectMap, TaskItem, Lane, TaskType } from '../models/types.js';
import { LaneClassifier } from './LaneClassifier.js';
import { PromptBuilder } from './PromptBuilder.js';

const MAX_ATTEMPTS = 2;

interface RawTask {
  description?: string;
  files?: string[];
  type?: string;
}

const VALID_TYPES: ReadonlySet<string> = new Set(['css', 'single_file', 'multi_file', 'refactor']);

function isValidTaskType(value: string): value is TaskType {
  return VALID_TYPES.has(value);
}

export class Brain implements IBrain {
  private readonly llm: LlmClient;
  private readonly promptBuilder: PromptBuilder;
  private readonly laneClassifier: LaneClassifier;

  constructor(llm: LlmClient) {
    this.llm = llm;
    this.promptBuilder = new PromptBuilder();
    this.laneClassifier = new LaneClassifier();
  }

  async analyze(observation: Observation, projectMap: ProjectMap): Promise<TaskItem[]> {
    const messages = this.promptBuilder.buildAnalysisPrompt(observation, projectMap);

    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.llm.chatWithVision(
          messages,
          [observation.screenshot],
          { responseFormat: 'json' },
        );

        const raw = this.parseJsonArray(response);
        return this.toTaskItems(raw);
      } catch (error) {
        lastError = error;
      }
    }

    throw new BrainError(
      `Failed to parse LLM response after ${MAX_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  private parseJsonArray(response: string): RawTask[] {
    const trimmed = response.trim();
    const parsed: unknown = JSON.parse(trimmed);

    if (!Array.isArray(parsed)) {
      throw new Error('LLM response is not a JSON array');
    }

    return parsed as RawTask[];
  }

  private toTaskItems(raw: RawTask[]): TaskItem[] {
    return raw.map((item) => {
      const description = item.description ?? '';
      const files = Array.isArray(item.files) ? item.files : [];
      const type: TaskType = (typeof item.type === 'string' && isValidTaskType(item.type))
        ? item.type
        : 'single_file';

      const lane: Lane = this.laneClassifier.classify(description, files);

      return {
        id: crypto.randomUUID(),
        description,
        files,
        type,
        lane,
        status: 'pending' as const,
      };
    });
  }
}
