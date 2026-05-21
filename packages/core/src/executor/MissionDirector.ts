import type { TaskItem, FeatureResult, DirectorVerdict, DirectorDecision, Message } from '../models/types.js';
import type { LlmClient } from '../contracts/ILlmClient.js';
import type { MissionPlan } from '../models/types.js';
import type { ILogger } from '../contracts/ILogger.js';

// ── Director system prompt ────────────────────────────────────────────

const DIRECTOR_SYSTEM_PROMPT = `You are a mission director. Your job is to review the results of all features implemented by workers and determine whether the mission is complete.

You receive:
1. The original task description
2. The mission plan (all features with their descriptions and dependencies)
3. The results of each feature (success/failure, generated files, diffs, validation errors)
4. Any dependency relationships between features

Your job: evaluate whether all features were implemented correctly, work together coherently, and satisfy the original task.

Output a JSON verdict with this exact structure:

{
  "decision": "APPROVED" | "NEEDS_REVISION" | "REJECTED",
  "feedback": [
    {
      "featureId": "feature-id",
      "actionItems": ["specific instruction 1", "specific instruction 2"]
    }
  ]
}

RULES:
- Use APPROVED when all features pass validation and the mission is complete.
- Use NEEDS_REVISION when some features need fixes but the overall approach is sound.
  - Include specific, actionable feedback for each feature that needs work.
  - Only include feedback entries for features that actually need changes.
  - Action items must be concrete instructions the worker can follow.
- Use REJECTED when the entire approach is wrong and a different strategy is needed.
  - This is rare; only use when the fundamental plan was flawed.
- If all features succeeded but have no validation errors, the verdict should be APPROVED.
- If any feature has validation errors, the verdict should be NEEDS_REVISION with action items targeting those errors.
- If a feature dependency failed, mark the dependent feature as needing revision too.
- Be specific in action items: "Fix the type error in app/login/page.tsx line 42: expected string but got number"

Output ONLY the JSON object. No markdown, no explanations, no code fences.`;

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Extract a JSON object from text that may be wrapped in markdown code fences,
 * contain leading/trailing prose, or have other noise.
 */
function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  // Try extracting from ```json ... ``` or ``` ... ``` code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    const inner = fenceMatch[1]!.trim();
    if (inner.length > 0) return inner;
  }

  // Try to find the first { and last } as a JSON object
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

const VALID_DECISIONS: Set<string> = new Set(['APPROVED', 'NEEDS_REVISION', 'REJECTED']);

/**
 * Validate and normalize a raw verdict object from the LLM.
 * Falls back to NEEDS_REVISION for malformed responses (conservative fail-safe).
 */
function parseVerdict(raw: unknown, logger?: ILogger): DirectorVerdict {
  if (typeof raw !== 'object' || raw === null) {
    logger?.warn('Director: malformed verdict (not an object), treating as NEEDS_REVISION', {
      receivedType: typeof raw,
    });
    return {
      decision: 'NEEDS_REVISION',
      feedback: [{ featureId: 'all', actionItems: ['Director response was not a valid JSON object'] }],
    };
  }

  const obj = raw as Record<string, unknown>;

  // Validate decision
  if (typeof obj.decision !== 'string' || !VALID_DECISIONS.has(obj.decision)) {
    logger?.warn('Director: unrecognized or missing decision value, treating as NEEDS_REVISION', {
      receivedDecision: obj.decision,
    });
    return {
      decision: 'NEEDS_REVISION',
      feedback: [
        {
          featureId: 'all',
          actionItems: [`Director returned unrecognized decision: "${String(obj.decision)}". Full response requires review.`],
        },
      ],
    };
  }

  const decision = obj.decision as DirectorDecision;

  // Validate feedback
  const feedback: Array<{ featureId: string; actionItems: string[] }> = [];

  if (Array.isArray(obj.feedback)) {
    for (let i = 0; i < obj.feedback.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const item = obj.feedback[i];

      if (typeof item !== 'object' || item === null) {
        logger?.warn(`Director: feedback item at index ${i} is not an object, skipping`);
        continue;
      }

      const fb = item as unknown as Record<string, unknown>;

      if (typeof fb.featureId !== 'string' || fb.featureId.trim().length === 0) {
        logger?.warn(`Director: feedback item at index ${i} missing featureId, using "unknown"`);
        fb.featureId = 'unknown';
      }

      const actionItems: string[] = [];
      if (Array.isArray(fb.actionItems)) {
        for (let j = 0; j < fb.actionItems.length; j++) {
          if (typeof fb.actionItems[j] === 'string') {
            actionItems.push(fb.actionItems[j] as string);
          }
        }
      }

      // If no action items but decision is NEEDS_REVISION, add a generic one
      if (actionItems.length === 0 && decision === 'NEEDS_REVISION') {
        actionItems.push(`Review and fix the implementation of feature "${String(fb.featureId)}"`);
      }

      feedback.push({
        featureId: fb.featureId as string,
        actionItems,
      });
    }
  }

  // If NEEDS_REVISION with empty feedback, add a catch-all
  if (decision === 'NEEDS_REVISION' && feedback.length === 0) {
    feedback.push({
      featureId: 'all',
      actionItems: ['Review all features for correctness and completeness'],
    });
  }

  return { decision, feedback };
}

// ── Build review prompt ───────────────────────────────────────────────

function buildReviewPrompt(
  task: TaskItem,
  plan: MissionPlan,
  featureResults: Record<string, FeatureResult>,
): string {
  const parts: string[] = [];

  // Original task
  parts.push(`## Original Task\n${task.description}\n`);

  // Mission plan summary
  parts.push('## Mission Plan');
  parts.push(`Total features: ${plan.features.length}`);
  for (const feature of plan.features) {
    parts.push(`- ${feature.id}: "${feature.description}"`);
    if (feature.dependencies.length > 0) {
      parts.push(`  Dependencies: ${feature.dependencies.join(', ')}`);
    }
    parts.push(`  Target files: ${feature.files.join(', ')}`);
  }
  parts.push('');

  // Feature results
  parts.push('## Feature Results');
  const featureIds = Object.keys(featureResults);
  if (featureIds.length === 0) {
    parts.push('(No feature results available)');
  } else {
    for (const featureId of featureIds) {
      const result = featureResults[featureId];
      if (!result) continue;

      parts.push(`\n### ${featureId}: ${result.success ? 'SUCCESS' : 'FAILED'}`);

      if (result.error) {
        parts.push(`Error: ${result.error}`);
      }

      if (result.diff) {
        parts.push(`Diff:\n\`\`\`diff\n${result.diff}\n\`\`\``);
      }

      if (result.generatedFiles && result.generatedFiles.length > 0) {
        parts.push(`Files generated (${result.generatedFiles.length}):`);
        for (const file of result.generatedFiles) {
          parts.push(`- ${file.path}`);
        }
      }

      if (result.deletedFiles && result.deletedFiles.length > 0) {
        parts.push(`Files deleted (${result.deletedFiles.length}):`);
        for (const file of result.deletedFiles) {
          parts.push(`- ${file}`);
        }
      }

      if (result.validationErrors && result.validationErrors.length > 0) {
        parts.push(`Validation errors (${result.validationErrors.length}):`);
        for (const err of result.validationErrors) {
          parts.push(`- ${err.file}${err.line !== undefined ? `:${err.line}` : ''}: ${err.message}`);
        }
      }

      if (result.fixIterations !== undefined && result.fixIterations > 0) {
        parts.push(`Auto-fix iterations: ${result.fixIterations}`);
      }
    }
  }

  // Dependency check section
  parts.push('\n## Dependency Analysis');
  for (const feature of plan.features) {
    if (feature.dependencies.length > 0) {
      const depStatuses = feature.dependencies.map((depId) => {
        const depResult = featureResults[depId];
        if (!depResult) return `${depId}: NOT_EXECUTED`;
        return `${depId}: ${depResult.success ? 'SUCCESS' : 'FAILED'}`;
      });
      parts.push(`- ${feature.id} depends on: ${depStatuses.join(', ')}`);
    }
  }
  parts.push('');

  // Output format instructions
  parts.push('## Instructions');
  parts.push('Review all results. Output ONLY a JSON verdict as specified. No other text.');
  parts.push('```json');
  parts.push('{');
  parts.push('  "decision": "APPROVED" | "NEEDS_REVISION" | "REJECTED",');
  parts.push('  "feedback": [');
  parts.push('    { "featureId": "string", "actionItems": ["string"] }');
  parts.push('  ]');
  parts.push('}');
  parts.push('```');

  return parts.join('\n');
}

// ── MissionDirector ────────────────────────────────────────────────────

export class MissionDirector {
  constructor(
    private readonly llmClient: LlmClient,
    private readonly directorModel: string,
    private readonly logger?: ILogger,
  ) {}

  /**
   * Reviews all feature results and returns a structured verdict.
   *
   * Process:
   * 1. Builds a review prompt with original task, plan, and all feature results
   * 2. Calls the director LLM (strong model, same as orchestrator)
   * 3. Parses the response into { decision, feedback }
   * 4. Falls back to NEEDS_REVISION for malformed responses (conservative fail-safe)
   *
   * @returns DirectorVerdict with APPROVED, NEEDS_REVISION, or REJECTED
   */
  async review(
    task: TaskItem,
    plan: MissionPlan,
    featureResults: Record<string, FeatureResult>,
  ): Promise<DirectorVerdict> {
    const taskLog = this.logger?.child({ taskId: task.id });

    taskLog?.info('MissionDirector: starting review', {
      taskId: task.id,
      featureCount: plan.features.length,
      resultCount: Object.keys(featureResults).length,
      model: this.directorModel,
    });

    // Build the review prompt
    const prompt = buildReviewPrompt(task, plan, featureResults);

    // Combine system + user into a single message
    const fullPrompt = `${DIRECTOR_SYSTEM_PROMPT}\n\n---\n\n${prompt}`;

    // Call the director LLM
    const messages: Message[] = [{ role: 'user', content: fullPrompt }];

    let responseText: string;
    try {
      const response = await this.llmClient.chat(messages, {
        model: this.directorModel,
        temperature: 0,
        responseFormat: 'json',
      });
      responseText = response.content;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      taskLog?.error('MissionDirector: LLM call failed', {
        taskId: task.id,
        error: errorMsg,
      });
      // Fail-safe: return NEEDS_REVISION on LLM failure
      return {
        decision: 'NEEDS_REVISION',
        feedback: [
          {
            featureId: 'all',
            actionItems: [`Director LLM call failed: ${errorMsg}. Manual review required.`],
          },
        ],
      };
    }

    taskLog?.info('MissionDirector: LLM responded', {
      taskId: task.id,
      responseLength: responseText.length,
    });

    // Handle empty response
    const trimmed = responseText.trim();
    if (trimmed.length === 0) {
      taskLog?.warn('MissionDirector: empty LLM response, treating as NEEDS_REVISION', {
        taskId: task.id,
      });
      return {
        decision: 'NEEDS_REVISION',
        feedback: [
          {
            featureId: 'all',
            actionItems: ['Director returned empty response. Review all features manually.'],
          },
        ],
      };
    }

    // Extract JSON from response
    const jsonStr = extractJsonObject(responseText);
    if (!jsonStr) {
      taskLog?.warn('MissionDirector: no JSON found in response, treating as NEEDS_REVISION', {
        taskId: task.id,
        responsePreview: responseText.slice(0, 300),
      });
      return {
        decision: 'NEEDS_REVISION',
        feedback: [
          {
            featureId: 'all',
            actionItems: ['Director response did not contain valid JSON. Review all features.'],
          },
        ],
      };
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      taskLog?.warn('MissionDirector: invalid JSON in response, treating as NEEDS_REVISION', {
        taskId: task.id,
        jsonPreview: jsonStr.slice(0, 300),
      });
      return {
        decision: 'NEEDS_REVISION',
        feedback: [
          {
            featureId: 'all',
            actionItems: ['Director response contained invalid JSON. Review all features.'],
          },
        ],
      };
    }

    // Parse and validate verdict
    const verdict = parseVerdict(parsed, this.logger);

    taskLog?.info('MissionDirector: review complete', {
      taskId: task.id,
      decision: verdict.decision,
      feedbackCount: verdict.feedback.length,
    });

    return verdict;
  }
}
