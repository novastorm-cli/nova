import * as fs from 'node:fs';
import * as path from 'node:path';

const EXCLUDED_VARS = new Set([
  'NODE_ENV', 'PORT', 'CI', 'HOME', 'PATH', 'PWD', 'SHELL', 'USER', 'LANG',
  'TERM', 'HOSTNAME', 'TMPDIR', 'TZ',
]);

export class EnvDetector {
  /**
   * Extract process.env.VAR references from file contents,
   * excluding common non-secret vars and NEXT_PUBLIC_* vars.
   */
  detectMissing(projectPath: string, fileContents: string[]): string[] {
    const referenced = new Set<string>();

    for (const content of fileContents) {
      const regex = /process\.env\.([A-Z][A-Z0-9_]+)/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const varName = match[1];
        if (!EXCLUDED_VARS.has(varName) && !varName.startsWith('NEXT_PUBLIC_')) {
          referenced.add(varName);
        }
      }
    }

    const existing = this.readEnvLocal(projectPath);
    const existingKeys = new Set(Object.keys(existing));

    return Array.from(referenced).filter(v => !existingKeys.has(v));
  }

  readEnvLocal(projectPath: string): Record<string, string> {
    const envPath = path.join(projectPath, '.env.local');
    const result: Record<string, string> = {};

    if (!fs.existsSync(envPath)) {
      return result;
    }

    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      result[key] = value;
    }

    return result;
  }

  writeEnvLocal(projectPath: string, vars: Record<string, string>): void {
    const envPath = path.join(projectPath, '.env.local');
    const existing = this.readEnvLocal(projectPath);

    const newEntries: string[] = [];
    for (const [key, value] of Object.entries(vars)) {
      if (!(key in existing)) {
        const sanitized = value.replace(/[\r\n]/g, '');
        newEntries.push(`${key}=${sanitized}`);
      }
    }

    if (newEntries.length === 0) return;

    let content = '';
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf-8');
      if (content.length > 0 && !content.endsWith('\n')) {
        content += '\n';
      }
    }
    content += newEntries.join('\n') + '\n';

    fs.writeFileSync(envPath, content, 'utf-8');
  }

  ensureGitignored(projectPath: string): void {
    const gitignorePath = path.join(projectPath, '.gitignore');
    let content = '';

    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
      const lines = content.split('\n').map(l => l.trim());
      if (lines.includes('.env.local')) return;
    }

    if (content.length > 0 && !content.endsWith('\n')) {
      content += '\n';
    }
    content += '.env.local\n';

    fs.writeFileSync(gitignorePath, content, 'utf-8');
  }
}
