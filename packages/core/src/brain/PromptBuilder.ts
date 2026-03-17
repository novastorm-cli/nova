import type { IPromptBuilder } from '../contracts/IBrain.js';
import type { Message, Observation, ProjectMap, TaskItem } from '../models/types.js';

export class PromptBuilder implements IPromptBuilder {
  buildAnalysisPrompt(observation: Observation, projectMap: ProjectMap): Message[] {
    const systemContent = [
      'You are a JSON-only task decomposition API. You MUST respond with ONLY a raw JSON array.',
      'Do NOT write any text, explanations, questions, or markdown. ONLY output valid JSON.',
      'Do NOT ask clarifying questions. Just produce tasks based on what the user wants.',
      '',
      'Your output format (STRICT — no other output allowed):',
      '[{"description":"what to do","files":["path/to/file"],"type":"single_file"}]',
      '',
      'Valid "type" values: "css", "single_file", "multi_file", "refactor"',
      '',
      'Rules:',
      '- Produce 1-6 tasks that accomplish the user request.',
      '- Each task should be independently executable.',
      '- Use real file paths from the project context below.',
      '- Only text-based files (tsx, ts, js, css, json). No binary files (images, fonts).',
      '- For images, use placeholder URLs like https://picsum.photos/800/600.',
      '- CRITICAL: Your entire response must be parseable by JSON.parse(). No text before or after the JSON array.',
    ].join('\n');

    const userParts: string[] = [];

    if (observation.transcript) {
      userParts.push(`Voice transcript: "${observation.transcript}"`);
    }

    if (observation.clickCoords) {
      userParts.push(
        `Click coordinates: x=${observation.clickCoords.x}, y=${observation.clickCoords.y}`,
      );
    }

    if (observation.domSnapshot) {
      userParts.push(`DOM snapshot:\n${observation.domSnapshot}`);
    }

    userParts.push(`Current URL: ${observation.currentUrl}`);
    userParts.push(`Project context:\n${projectMap.compressedContext}`);

    // Combine into single user message for Claude CLI compatibility
    const combined = `${systemContent}\n\n---\n\n${userParts.join('\n\n')}\n\nRespond with ONLY a JSON array. Start with [`;

    return [
      { role: 'user', content: combined },
    ];
  }

  buildDecomposePrompt(task: TaskItem, projectMap: ProjectMap): Message[] {
    const systemContent = [
      'You are a task decomposer for a code generation pipeline.',
      'Break the given task into smaller, independently executable subtasks.',
      '',
      'Each subtask object must have:',
      '- "description": what to do',
      '- "files": array of file paths affected',
      '- "type": one of "css", "single_file", "multi_file", "refactor"',
      '',
      'Rules:',
      '- Each subtask should ideally touch 1 file (Lane 1 or Lane 2 complexity).',
      '- Preserve the overall intent of the original task.',
      '- Respond ONLY with a valid JSON array. No markdown, no explanation.',
    ].join('\n');

    const fileList = task.files.length > 0
      ? `Affected files:\n${task.files.map((f) => `- ${f}`).join('\n')}`
      : 'No specific files identified yet.';

    const userContent = [
      `Task to decompose: "${task.description}"`,
      fileList,
      `Project context:\n${projectMap.compressedContext}`,
    ].join('\n\n');

    const combined = `${systemContent}\n\n---\n\n${userContent}\n\nRespond with ONLY a JSON array. Start with [`;
    return [
      { role: 'user', content: combined },
    ];
  }
}
