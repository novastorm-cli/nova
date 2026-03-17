import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LlmClient, LlmOptions, Message } from '../models/types.js';
import { ProviderError } from '../contracts/ILlmClient.js';

const TIMEOUT_MS = 300_000; // 5 minutes

export class ClaudeCliProvider implements LlmClient {

  async chat(messages: Message[], options?: LlmOptions): Promise<string> {
    const chunks: string[] = [];
    for await (const chunk of this.stream(messages, options)) {
      chunks.push(chunk);
    }
    return chunks.join('');
  }

  async chatWithVision(
    messages: Message[],
    images: Buffer[],
    options?: LlmOptions,
  ): Promise<string> {
    const prompt = this.messagesToPrompt(messages);
    const withImageNote = `${prompt}\n\n[Note: ${images.length} screenshot(s) were captured but cannot be sent via CLI. Analyze based on the text context above.]`;
    return this.chat([{ role: 'user', content: withImageNote }], options);
  }

  async *stream(messages: Message[], options?: LlmOptions): AsyncIterable<string> {
    const prompt = this.messagesToPrompt(messages);

    let finalPrompt = prompt;
    if (options?.responseFormat === 'json') {
      finalPrompt += '\n\nIMPORTANT: Respond with ONLY valid JSON. No text, no markdown. Start with [ or {.';
    }

    console.log(`[Nova] Claude CLI: streaming with ${finalPrompt.length} char prompt...`);

    const tmpDir = mkdtempSync(join(tmpdir(), 'nova-'));
    const promptFile = join(tmpDir, 'prompt.txt');
    writeFileSync(promptFile, finalPrompt, 'utf-8');

    try {
      const proc = spawn('sh', ['-c', `cat "${promptFile}" | claude -p --disallowedTools "Edit Write Bash NotebookEdit"`], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => { proc.kill('SIGTERM'); }, TIMEOUT_MS);

      const textDecoder = new TextDecoder();

      for await (const chunk of proc.stdout) {
        const text = typeof chunk === 'string' ? chunk : textDecoder.decode(chunk as Buffer, { stream: true });
        if (text) {
          // Print to terminal in real-time (dim color)
          process.stdout.write(`\x1b[2m${text}\x1b[0m`);
          yield text;
        }
      }

      clearTimeout(timer);

      // Wait for process to close
      await new Promise<void>((resolve, reject) => {
        proc.on('close', (code) => {
          if (code !== 0 && code !== null) {
            reject(new ProviderError(
              `Claude CLI exited with code ${code}: ${stderr.slice(0, 300)}`,
              undefined,
              'claude-cli',
            ));
          } else {
            resolve();
          }
        });
      });

      // Newline after streamed output
      process.stdout.write('\n');

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
    } finally {
      try { unlinkSync(promptFile); } catch { /* ignore */ }
      try { rmdirSync(tmpDir); } catch { /* ignore */ }
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
