import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import type { IDevServerRunner } from '@novastorm-ai/core';

const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 120_000;

// Patterns that indicate the dev server failed to start
const ERROR_PATTERNS = [
  /port \d+ is in use/i,
  /EADDRINUSE/i,
  /already running/i,
  /address already in use/i,
  /failed to start/i,
  /error:/i,
];

// Patterns that indicate the dev server started on a different port
const PORT_REDIRECT_PATTERN = /(?:using (?:available )?port|listening on|Local:\s+http:\/\/\S+:)(\d+)/i;

export class DevServerRunner implements IDevServerRunner {
  private process: ChildProcess | null = null;
  private logs: string[] = [];
  private running = false;
  private readyHandler: (() => void) | null = null;
  private errorHandler: ((error: string) => void) | null = null;
  private outputHandlers: Array<(output: string) => void> = [];
  private detectedPort: number | null = null;
  private startupError: string | null = null;

  async spawn(command: string, cwd: string, port: number): Promise<void> {
    const [cmd, ...args] = command.split(' ');

    this.process = spawn(cmd, args, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(port) },
    });

    this.running = true;
    this.logs = [];
    this.detectedPort = null;
    this.startupError = null;

    const handleOutput = (data: Buffer) => {
      const text = data.toString();
      this.logs.push(text);

      // Check for port redirect
      const portMatch = PORT_REDIRECT_PATTERN.exec(text);
      if (portMatch) {
        this.detectedPort = parseInt(portMatch[1], 10);
      }

      // Check for startup errors
      for (const pattern of ERROR_PATTERNS) {
        if (pattern.test(text)) {
          this.startupError = text.trim();
          break;
        }
      }

      for (const handler of this.outputHandlers) {
        handler(text);
      }
    };

    this.process.stdout?.on('data', handleOutput);
    this.process.stderr?.on('data', handleOutput);

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

  getActualPort(): number | null {
    return this.detectedPort;
  }

  getStartupError(): string | null {
    return this.startupError;
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
        // Check if process died
        if (!this.running) {
          reject(
            new Error(
              `Dev server process exited before becoming ready.\n\n${this.getLogs()}`,
            ),
          );
          return;
        }

        // Check if a startup error was detected in output
        if (this.startupError) {
          reject(
            new Error(
              `Dev server error:\n\n${this.startupError}`,
            ),
          );
          return;
        }

        // Try the expected port, and also the detected port if different
        const portsToTry = [port];
        if (this.detectedPort && this.detectedPort !== port) {
          portsToTry.push(this.detectedPort);
        }

        let remaining = portsToTry.length;
        let resolved = false;

        for (const tryPort of portsToTry) {
          const tryConnect = (host: string, fallback?: string): void => {
            if (resolved) return;

            const req = http.get(
              `http://${host}:${tryPort}`,
              (res) => {
                res.resume();
                if (!resolved) {
                  resolved = true;
                  // Update detected port if we connected on a different one
                  if (tryPort !== port) {
                    this.detectedPort = tryPort;
                  }
                  this.readyHandler?.();
                  resolve();
                }
              },
            );

            req.on('error', () => {
              if (resolved) return;
              if (fallback) {
                tryConnect(fallback);
                return;
              }
              remaining--;
              if (remaining <= 0) {
                if (Date.now() - startTime >= MAX_WAIT_MS) {
                  reject(
                    new Error(
                      `Dev server did not become ready within ${MAX_WAIT_MS / 1000}s.\n\nServer output:\n${this.getLogs()}`,
                    ),
                  );
                  return;
                }
                setTimeout(check, POLL_INTERVAL_MS);
              }
            });

            req.end();
          };

          tryConnect('127.0.0.1', '[::1]');
        }
      };

      check();
    });
  }
}
