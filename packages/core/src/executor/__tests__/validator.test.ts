import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IValidator } from '../../contracts/IExecutor.js';

const { Validator } = await import('../Validator.js');

describe('Validator', () => {
  let tmpDir: string;
  let validator: IValidator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-test-'));
    validator = new Validator();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── validate() with TypeScript project ─────────────────────

  describe('validate() with TypeScript project', () => {
    it('returns { valid: true, errors: [] } for a project with no TS errors', async () => {
      // Create a minimal tsconfig.json
      fs.writeFileSync(
        path.join(tmpDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: 'ES2022',
            module: 'Node16',
            moduleResolution: 'Node16',
          },
          include: ['*.ts'],
        }),
        'utf-8',
      );

      // Create a valid TS file
      const tsFile = 'valid.ts';
      fs.writeFileSync(
        path.join(tmpDir, tsFile),
        'const greeting: string = "hello";\nconsole.log(greeting);\n',
        'utf-8',
      );

      const result = await validator.validate(tmpDir, [tsFile]);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // ── validate() without TypeScript ──────────────────────────

  describe('validate() without TypeScript', () => {
    it('skips tsc check when no tsconfig.json exists', async () => {
      // Plain JS project - no tsconfig.json
      const jsFile = 'app.js';
      fs.writeFileSync(
        path.join(tmpDir, jsFile),
        'const x = 1;\nconsole.log(x);\n',
        'utf-8',
      );

      const result = await validator.validate(tmpDir, [jsFile]);

      // Should pass since there's no tsc to run
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});
