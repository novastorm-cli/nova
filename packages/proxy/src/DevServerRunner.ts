import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { parse } from 'shell-quote';
import type { IDevServerRunner } from '@novastorm-ai/core';
import { InvalidCommandError } from '@novastorm-ai/core';

const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 120_000;

const INVALID_COMMAND_MESSAGE =
  'Dev command must be a single executable with arguments; ' +
  'shell features ($, `, &&, |, >) are not supported. ' +
  'Wrap such commands in a shell script and reference the script.';

/**
 * Validates a dev server command string.
 *
 * Uses shell-quote to tokenize the command respecting shell quoting rules,
 * then checks for shell metacharacters (operators, variables, command substitution).
 * Returns the parsed tokens if valid, or throws InvalidCommandError.
 */
function validateCommand(command: string): string[] {
  if (!command || !command.trim()) {
    throw new InvalidCommandError('Dev command must be a non-empty executable with arguments.');
  }

  // Parse the command with shell-quote to get properly tokenized arguments.
  // We pass no env so variables are not expanded.
  const tokens = parse(command);

  if (tokens.length === 0) {
    throw new InvalidCommandError('Dev command must be a non-empty executable with arguments.');
  }

  // Check 1: shell-quote returns objects for shell operators (&&, |, >, ;, etc.)
  // and glob patterns. Reject any non-string token.
  for (const token of tokens) {
    if (typeof token !== 'string') {
      throw new InvalidCommandError(INVALID_COMMAND_MESSAGE);
    }
  }

  // Check 2: Detect $ variable expansion and backtick command substitution.
  // shell-quote silently drops unexpanded $VAR (returns empty string) or expands
  // when env is provided. We scan the raw command for these patterns, respecting
  // single-quote boundaries (inside single quotes, $ and ` are literal).
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const c = command[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (c === '\\') {
      escaped = true;
      continue;
    }

    // Single quotes: everything inside is literal
    if (c === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    // Double quotes: $ and ` inside double quotes ARE shell metacharacters
    if (c === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    // $ outside single quotes is variable expansion
    if (c === '$' && !inSingleQuote) {
      throw new InvalidCommandError(INVALID_COMMAND_MESSAGE);
    }

    // Backtick outside single quotes is command substitution
    if (c === '`' && !inSingleQuote) {
      throw new InvalidCommandError(INVALID_COMMAND_MESSAGE);
    }
  }

  return tokens as string[];
}

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
const PORT_REDIRECT_PATTERN =
  /(?:using (?:available )?port|listening on|Local:\s+http:\/\/\S+:)(\d+)/i;

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
    const tokens = validateCommand(command);
    const cmd = tokens[0]!;
    const args = tokens.slice(1);

    const proc = spawn(cmd, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(port) },
    });
    this.process = proc;

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
        this.detectedPort = parseInt(portMatch[1]!, 10);
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

    proc.stdout?.on('data', handleOutput);
    proc.stderr?.on('data', handleOutput);

    proc.on('exit', (code, signal) => {
      this.running = false;
      if (code !== 0 && code !== null) {
        this.errorHandler?.(`Dev server exited with code ${code}${signal ? ` (${signal})` : ''}`);
      } else if (signal) {
        this.errorHandler?.(`Dev server killed by signal ${signal}`);
      }
    });

    proc.on('error', (err) => {
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
    const pid = proc.pid!;

    // Kill child processes to prevent orphans.
    const killChildren = (signal: string) => {
      try {
        spawnSync('pkill', [`-${signal}`, '-P', String(pid)], { timeout: 2000 });
      } catch {
        // pkill may fail if there are no children — ignore
      }
    };

    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        killChildren('KILL');
        proc.kill('SIGKILL');
      }, 5000);

      proc.on('exit', () => {
        clearTimeout(killTimer);
        this.running = false;
        this.process = null;
        resolve();
      });

      killChildren('TERM');
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
            new Error(`Dev server process exited before becoming ready.\n\n${this.getLogs()}`),
          );
          return;
        }

        // Check if a startup error was detected in output
        if (this.startupError) {
          reject(new Error(`Dev server error:\n\n${this.startupError}`));
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

            const req = http.get(`http://${host}:${tryPort}`, (res) => {
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
            });

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
