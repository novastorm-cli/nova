import { spawn } from 'node:child_process';
import type { LlmClient } from '../contracts/ILlmClient.js';
import type { ChatResponse, LlmOptions, Message, StreamChunk } from '../models/types.js';
import { ProviderError } from '../contracts/ILlmClient.js';

const TIMEOUT_MS = 300_000; // 5 minutes

export class ClaudeCliProvider implements LlmClient {
  async chat(messages: Message[], options?: LlmOptions): Promise<ChatResponse> {
    const chunks: string[] = [];
    for await (const chunk of this.stream(messages, options)) {
      chunks.push(chunk.content);
    }
    return { content: chunks.join('') };
  }

  /* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */
  async chatWithVision(
    _messages: Message[],
    _images: Buffer[],
    _options?: LlmOptions,
  ): Promise<ChatResponse> {
    /* eslint-enable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */
    throw new ProviderError(
      'claude-cli does not support vision in this Nova version; configure a vision-capable provider',
      undefined,
      'claude-cli',
      'NO_VISION_SUPPORT',
    );
  }

  async *stream(messages: Message[], options?: LlmOptions): AsyncIterable<StreamChunk> {
    const prompt = this.messagesToPrompt(messages);

    let finalPrompt = prompt;
    if (options?.responseFormat === 'json') {
      finalPrompt +=
        '\n\nIMPORTANT: Respond with ONLY valid JSON. No text, no markdown. Start with [ or {.';
    }

    try {
      const proc = spawn('claude', ['-p', '--disallowedTools', 'Edit Write Bash NotebookEdit'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      // Write the prompt to stdin then close it
      proc.stdin.write(finalPrompt, 'utf-8');
      proc.stdin.end();

      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
      }, TIMEOUT_MS);

      const textDecoder = new TextDecoder();

      for await (const chunk of proc.stdout) {
        const text =
          typeof chunk === 'string' ? chunk : textDecoder.decode(chunk as Buffer, { stream: true });
        if (text) {
          yield { content: text };
        }
      }

      clearTimeout(timer);

      // Wait for process to close
      await new Promise<void>((resolve, reject) => {
        proc.on('close', (code) => {
          if (code !== 0 && code !== null) {
            reject(
              new ProviderError(
                `Claude CLI exited with code ${code}: ${stderr.slice(0, 300)}`,
                undefined,
                'claude-cli',
              ),
            );
          } else {
            resolve();
          }
        });
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT') || msg.includes('not found')) {
        throw new ProviderError(
          'Claude CLI not found. Install it: npm install -g @anthropic-ai/claude-code',
          undefined,
          'claude-cli',
        );
      }
      if (msg.includes('ETIMEDOUT') || msg.includes('timed out')) {
        throw new ProviderError('Claude CLI timed out after 5 minutes', undefined, 'claude-cli');
      }
      throw new ProviderError(msg, undefined, 'claude-cli');
    }
  }

  private messagesToPrompt(messages: Message[]): string {
    const parts: string[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        parts.push(`<system>\n${msg.content}\n</system>`);
      } else if (msg.role === 'user') {
        parts.push(msg.content);
      } else if (msg.role === 'assistant') {
        parts.push(`Previous response: ${msg.content}`);
      }
    }

    return parts.join('\n\n');
  }
}
