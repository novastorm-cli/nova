import type { IPromptBuilder } from '../contracts/IBrain.js';
import type { Message, Observation, ProjectMap, TaskItem } from '../models/types.js';

export class PromptBuilder implements IPromptBuilder {
  buildAnalysisPrompt(observation: Observation, projectMap: ProjectMap): Message[] {
    const systemContent = [
      'You are a senior frontend developer analyzing a UI observation.',
      'You will receive a screenshot (via vision), DOM snapshot, voice transcript, and project context.',
      'Your job is to produce a JSON array of tasks that address the user\'s intent.',
      '',
      'Each task object must have:',
      '- "description": a concise description of what to do',
      '- "files": an array of file paths that need to be modified',
      '- "type": one of "css", "single_file", "multi_file", "refactor"',
      '',
      'Rules:',
      '- If the transcript is empty or absent, infer intent from the click coordinates and screenshot.',
      '- Keep tasks small and focused — one concern per task.',
      '- Reference real file paths from the project context.',
      '- Respond ONLY with a valid JSON array. No markdown, no explanation.',
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

    return [
      { role: 'system', content: systemContent },
      { role: 'user', content: userParts.join('\n\n') },
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

    return [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ];
  }
}
