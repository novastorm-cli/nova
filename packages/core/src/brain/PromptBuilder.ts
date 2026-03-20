import type { IPromptBuilder } from '../contracts/IBrain.js';
import type { Message, Observation, ProjectMap, TaskItem } from '../models/types.js';

export class PromptBuilder implements IPromptBuilder {
  private ragSnippets: string[] = [];

  setRagSnippets(snippets: Array<{ filePath: string; chunkText: string }>): void {
    this.ragSnippets = snippets.map(
      (s) => `--- ${s.filePath} ---\n${s.chunkText}`,
    );
  }

  buildAnalysisPrompt(observation: Observation, projectMap: ProjectMap): Message[] {
    const systemContent = [
      'You are a JSON-only task decomposition API. Respond with ONLY a raw JSON array.',
      '',
      'Output format — choose ONE:',
      '',
      'Option A — tasks (when you understand what to do):',
      '[{"description":"what to do","files":["path/to/file"],"type":"single_file"}]',
      '',
      'Option B — clarifying question (when the request is ambiguous):',
      '[{"question":"Your clarifying question here?"}]',
      '',
      'Valid "type" values: "css", "single_file", "multi_file", "refactor"',
      '',
      'Rules:',
      '- Prefer Option A. Only use Option B if the request is truly ambiguous.',
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

    if (observation.gestureContext?.summary) {
      userParts.push(`Cursor gesture context:\n${observation.gestureContext.summary}`);
    }

    userParts.push(`Current URL: ${observation.currentUrl}`);

    // Include service architecture info if available
    if (projectMap.frontend || (projectMap.backends && projectMap.backends.length > 0)) {
      const archParts: string[] = ['Service architecture:'];
      if (projectMap.frontend) archParts.push(`  Frontend: ${projectMap.frontend}`);
      if (projectMap.backends && projectMap.backends.length > 0) {
        archParts.push(`  Backends: ${projectMap.backends.join(', ')}`);
      }
      userParts.push(archParts.join('\n'));
    }

    // Include manifest info if available
    if (projectMap.manifest) {
      const m = projectMap.manifest;
      const manifestParts: string[] = ['Manifest architecture:'];

      if (m.services.length > 0) {
        for (const s of m.services) {
          manifestParts.push(`  Service: ${s.name} [${s.type}] at ${s.path}${s.framework ? ` (${s.framework})` : ''}`);
        }
      }

      if (m.databases.length > 0) {
        for (const d of m.databases) {
          manifestParts.push(`  Database: ${d.name} [${d.engine}]${d.connection_env ? ` env=${d.connection_env}` : ''}`);
        }
      }

      if (m.entities.length > 0) {
        for (const e of m.entities) {
          manifestParts.push(`  Entity: ${e.name} [${e.type}]${e.description ? ` — ${e.description}` : ''}`);
        }
      }

      if (m.boundaries.writable?.length) {
        manifestParts.push(`  CRITICAL: Only modify files within writable boundaries: ${m.boundaries.writable.join(', ')}`);
      }
      if (m.boundaries.readonly?.length) {
        manifestParts.push(`  Readonly (do NOT modify): ${m.boundaries.readonly.join(', ')}`);
      }

      userParts.push(manifestParts.join('\n'));
    }

    userParts.push(`Project context:\n${projectMap.compressedContext}`);

    if (this.ragSnippets.length > 0) {
      userParts.push(`Relevant code context:\n${this.ragSnippets.join('\n\n')}`);
    }

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
