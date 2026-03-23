import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import type { IDevServerRunner } from '@novastorm-ai/core';

const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 30_000;

export class DevServerRunner implements IDevServerRunner {
  private process: ChildProcess | null = null;
  private logs: string[] = [];
  private running = false;
  private readyHandler: (() => void) | null = null;
  private errorHandler: ((error: string) => void) | null = null;
  private outputHandlers: Array<(output: string) => void> = [];

  async spawn(command: string, cwd: string, port: number): Promise<void> {
    const [cmd, ...args] = command.split(' ');

    this.process = spawn(cmd, args, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this.running = true;
    this.logs = [];

    this.process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.logs.push(text);
      for (const handler of this.outputHandlers) {
        handler(text);
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.logs.push(text);
      for (const handler of this.outputHandlers) {
        handler(text);
      }
    });

    this.process.on('exit', (code, signal) => {
      this.running = false;
      if (code !== 0 && code !== null) {
        this.errorHandler?.(
          `Dev server exited with code ${code}${signal ? ` (${signal})` : ''}`,
        );
      } else if (signal) {
        this.errorHandler?.(`Dev server killed by signal ${signal}`);
      }
    });

    this.process.on('error', (err) => {
      this.running = false;
      this.errorHandler?.(err.message);
    });

    // Wait for server to become ready
    await this.pollUntilReady(port);
  }

  onReady(handler: () => void): void {
    this.readyHandler = handler;
  }

  onError(handler: (error: string) => void): void {
    this.errorHandler = handler;
  }

  onOutput(handler: (output: string) => void): void {
    this.outputHandlers.push(handler);
  }

  getLogs(): string {
    return this.logs.join('');
  }

  async kill(): Promise<void> {
    if (!this.process || !this.running) {
      return;
    }

    const proc = this.process;

    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        proc.kill('SIGKILL');
      }, 5000);

      proc.on('exit', () => {
        clearTimeout(killTimer);
        this.running = false;
        this.process = null;
        resolve();
      });

      proc.kill('SIGTERM');
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  private pollUntilReady(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const startTime = Date.now();

      const check = (): void => {
        if (!this.running) {
          reject(
            new Error(
              `Dev server process exited before becoming ready. Logs:\n${this.getLogs()}`,
            ),
          );
          return;
        }

        // Try IPv4 first, then IPv6 — dev servers may listen on either
        const tryConnect = (host: string, fallback?: string): void => {
          const req = http.get(
            `http://${host}:${port}`,
            (res) => {
              res.resume();
              this.readyHandler?.();
              resolve();
            },
          );

          req.on('error', () => {
            if (fallback) {
              tryConnect(fallback);
              return;
            }
            if (Date.now() - startTime >= MAX_WAIT_MS) {
              reject(
                new Error(
                  `Dev server did not become ready within ${MAX_WAIT_MS / 1000}s. Logs:\n${this.getLogs()}`,
                ),
              );
              return;
            }
            setTimeout(check, POLL_INTERVAL_MS);
          });

          req.end();
        };

        tryConnect('127.0.0.1', '[::1]');
      };

      check();
    });
  }
}
