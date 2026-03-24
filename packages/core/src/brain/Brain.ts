import type { IBrain } from '../contracts/IBrain.js';
import { BrainError } from '../contracts/IBrain.js';
import type { LlmClient, Observation, ProjectMap, TaskItem, Lane, TaskType } from '../models/types.js';
import type { EventBus } from '../models/events.js';
import { LaneClassifier } from './LaneClassifier.js';
import { PromptBuilder } from './PromptBuilder.js';

const MAX_ATTEMPTS = 2;

interface RawTask {
  description?: string;
  files?: string[];
  type?: string;
  question?: string;
}

const VALID_TYPES: ReadonlySet<string> = new Set(['css', 'single_file', 'multi_file', 'refactor']);

function isValidTaskType(value: string): value is TaskType {
  return VALID_TYPES.has(value);
}

export class Brain implements IBrain {
  private readonly llm: LlmClient;
  private readonly promptBuilder: PromptBuilder;
  private readonly laneClassifier: LaneClassifier;

  private readonly eventBus?: EventBus;

  private readonly modelName?: string;

  constructor(llm: LlmClient, eventBus?: EventBus, modelName?: string) {
    this.llm = llm;
    this.eventBus = eventBus;
    this.modelName = modelName;
    this.promptBuilder = new PromptBuilder();
    this.laneClassifier = new LaneClassifier();
  }

  private status(message: string): void {
    this.eventBus?.emit({ type: 'status', data: { message } });
  }

  async analyze(observation: Observation, projectMap: ProjectMap): Promise<TaskItem[]> {
    const messages = this.promptBuilder.buildAnalysisPrompt(observation, projectMap);

    const transcript = observation.transcript ?? 'click';
    console.log(`[Nova] Brain: analyzing "${transcript}" at ${observation.currentUrl}`);
    this.status(`Thinking about: "${transcript.slice(0, 60)}${transcript.length > 60 ? '...' : ''}"`);

    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const images = observation.screenshot && observation.screenshot.length > 0
          ? [observation.screenshot]
          : [];

        const attemptLabel = attempt > 0 ? ` (retry ${attempt + 1}/${MAX_ATTEMPTS})` : '';
        console.log(`[Nova] Brain: sending to LLM${attemptLabel}...`);
        this.status(`Sending to AI${attemptLabel}...`);

        const response = images.length > 0
          ? await this.llm.chatWithVision(messages, images, { responseFormat: 'json', model: this.modelName })
          : await this.llm.chat(messages, { responseFormat: 'json', model: this.modelName });

        console.log(`[Nova] Brain: response (${response.length} chars)`);

        // Show LLM reasoning in overlay if it contains text before JSON
        const jsonStart = response.indexOf('[');
        if (jsonStart > 10) {
          const reasoning = response.slice(0, jsonStart).trim();
          if (reasoning.length > 5) {
            console.log(`[Nova] Brain reasoning: ${reasoning.slice(0, 300)}`);
            this.status(`AI thinks: ${reasoning.slice(0, 120)}${reasoning.length > 120 ? '...' : ''}`);
          }
        }

        const raw = this.parseJsonArray(response);

        // Show what tasks were identified
        const taskNames = raw.map((t) => t.description ?? '').filter(Boolean);
        if (taskNames.length > 0) {
          this.status(`Found ${taskNames.length} task(s): ${taskNames[0]?.slice(0, 60)}${taskNames.length > 1 ? ` +${taskNames.length - 1} more` : ''}`);
        }

        return this.toTaskItems(raw);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.log(`[Nova] Brain: attempt ${attempt + 1} failed: ${errMsg.slice(0, 150)}`);
        this.status(`AI response parsing failed, retrying...`);
        lastError = error;
      }
    }

    throw new BrainError(
      `Failed to parse LLM response after ${MAX_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  private parseJsonArray(response: string): RawTask[] {
    let trimmed = response.trim();

    // Strip markdown code fences if present
    if (trimmed.includes('```')) {
      const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
      if (fenceMatch) {
        trimmed = fenceMatch[1].trim();
      }
    }

    // Try direct parse first
    try {
      const direct = JSON.parse(trimmed);
      if (Array.isArray(direct)) return direct as RawTask[];
    } catch { /* try extraction */ }

    // Find all JSON arrays in the response and use the last valid one
    // (Claude CLI sometimes outputs multiple: first attempt + "let me reconsider" + second attempt)
    const jsonCandidates: string[] = [];
    const bracketRegex = /\[[\s\S]*?\]/g;
    let match;
    while ((match = bracketRegex.exec(trimmed)) !== null) {
      jsonCandidates.push(match[0]);
    }

    // Try candidates from last to first (last is usually the final answer)
    for (let i = jsonCandidates.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(jsonCandidates[i]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed as RawTask[];
        }
      } catch { /* try next */ }
    }

    throw new Error('No valid JSON array found in response');
  }

  private toTaskItems(raw: RawTask[]): TaskItem[] {
    // Check if AI is asking a clarifying question
    if (raw.length === 1 && raw[0].question && !raw[0].description) {
      console.log(`[Nova] Brain: AI asks clarifying question: ${raw[0].question}`);
      this.status(`question:${raw[0].question}`);
      return []; // No tasks — question sent via status event
    }

    const BINARY_PATTERN = /\b(image|photo|picture|icon|svg|png|jpg|jpeg|gif|webp|favicon|font|woff|video|mp4|audio|mp3)\b/i;

    return raw
      .map((item) => {
        // Skip question items mixed with tasks
        if (item.question && !item.description) return null;
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
      })
      .filter((task): task is NonNullable<typeof task> => task !== null)
      .filter((task) => {
        // Filter out tasks that try to create/add binary files
        const hasBinaryFiles = task.files.some((f) =>
          /\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot|mp4|mp3|wav)$/i.test(f)
        );
        const descAsksBinary = BINARY_PATTERN.test(task.description) &&
          /\b(add|create|download|upload|place|put)\b/i.test(task.description) &&
          !/\b(component|style|css|layout|section)\b/i.test(task.description);

        if (hasBinaryFiles || descAsksBinary) {
          console.log(`[Nova] Skipped task (binary files not supported): ${task.description}`);
          return false;
        }
        return true;
      });
  }
}
