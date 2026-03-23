import { execFile } from 'node:child_process';
import type { ITeamDetector } from '@novastorm-ai/core';
import type { TeamInfo, TeamDetectOptions } from '@novastorm-ai/core';

const DEFAULT_WINDOW_DAYS = 90;

const BOT_PATTERNS = [
  /\[bot\]@/i,
  /^dependabot/i,
  /^renovate/i,
  /^github-actions/i,
  /noreply\.github\.com$/i,
];

function normalizeEmail(email: string): string {
  let normalized = email.toLowerCase().trim();
  // Strip +tags from Gmail-style addresses
  const atIndex = normalized.indexOf('@');
  if (atIndex > 0) {
    const local = normalized.slice(0, atIndex);
    const domain = normalized.slice(atIndex);
    const plusIndex = local.indexOf('+');
    if (plusIndex > 0) {
      normalized = local.slice(0, plusIndex) + domain;
    }
  }
  return normalized;
}

function isBot(email: string): boolean {
  return BOT_PATTERNS.some((pattern) => pattern.test(email));
}

export class TeamDetector implements ITeamDetector {
  detect(projectPath: string, options?: TeamDetectOptions): Promise<TeamInfo> {
    const windowDays = options?.windowDays ?? DEFAULT_WINDOW_DAYS;

    return new Promise((resolve) => {
      execFile(
        'git',
        ['log', '--format=%ae', `--since=${windowDays} days ago`],
        { cwd: projectPath },
        (error, stdout) => {
          if (error) {
            resolve({ devCount: 1, windowDays, botsFiltered: 0 });
            return;
          }

          const rawEmails = stdout.trim().split('\n').filter((line) => line.length > 0);
          const normalizedEmails = rawEmails.map(normalizeEmail);

          const humanEmails = new Set<string>();
          const botEmails = new Set<string>();

          for (const email of normalizedEmails) {
            if (isBot(email)) {
              botEmails.add(email);
            } else {
              humanEmails.add(email);
            }
          }

          resolve({
            devCount: humanEmails.size === 0 ? 1 : humanEmails.size,
            windowDays,
            botsFiltered: botEmails.size,
          });
        },
      );
    });
  }
}
