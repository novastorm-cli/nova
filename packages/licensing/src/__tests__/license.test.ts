import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LicenseChecker } from '../LicenseChecker.js';
import { DEFAULT_CONFIG } from '@novastorm-ai/core';
import type { NovaConfig } from '@novastorm-ai/core';

// ── Helpers ────────────────────────────────────────────────

function git(cwd: string, command: string): string {
  return execSync(`git ${command}`, { cwd, encoding: 'utf-8' }).trim();
}

function writeFile(dir: string, name: string, content: string): void {
  fs.writeFileSync(path.join(dir, name), content, 'utf-8');
}

function addAuthor(cwd: string, email: string, name: string, file: string): void {
  writeFile(cwd, file, `authored by ${email}`);
  git(cwd, `add ${file}`);
  git(cwd, `-c user.email="${email}" -c user.name="${name}" commit -m "commit by ${name}"`);
}

function makeValidKey(body: string): string {
  const checksum = crypto.createHash('sha256').update(body).digest('hex').slice(0, 4);
  return `NOVA-${body}-${checksum}`;
}

function makeConfig(overrides: Partial<NovaConfig> = {}): NovaConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

// ── Tests ──────────────────────────────────────────────────

describe('LicenseChecker', () => {
  let tmpDir: string;
  let checker: LicenseChecker;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'));
    checker = new LicenseChecker();

    // Clean license-related env vars
    delete process.env.NOVA_LICENSE_KEY;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // Restore env
    process.env = { ...originalEnv };
  });

  // ── Free tier scenarios ──────────────────────────────────

  describe('free tier (devCount <= 3)', () => {
    it('should return valid free tier with devCount 1 for a single author', async () => {
      git(tmpDir, 'init');
      git(tmpDir, 'config user.email "dev1@example.com"');
      git(tmpDir, 'config user.name "Dev One"');
      writeFile(tmpDir, 'file.txt', 'hello');
      git(tmpDir, 'add .');
      git(tmpDir, 'commit -m "initial"');

      const status = await checker.check(tmpDir, makeConfig());

      expect(status).toEqual({
        valid: true,
        tier: 'free',
        devCount: 1,
      });
    });

    it('should return valid free tier with devCount 3 for three authors', async () => {
      git(tmpDir, 'init');
      git(tmpDir, 'config user.email "dev1@example.com"');
      git(tmpDir, 'config user.name "Dev One"');
      writeFile(tmpDir, 'init.txt', 'init');
      git(tmpDir, 'add .');
      git(tmpDir, 'commit -m "initial"');

      addAuthor(tmpDir, 'dev2@example.com', 'Dev Two', 'file2.txt');
      addAuthor(tmpDir, 'dev3@example.com', 'Dev Three', 'file3.txt');

      const status = await checker.check(tmpDir, makeConfig());

      expect(status).toEqual({
        valid: true,
        tier: 'free',
        devCount: 3,
      });
    });
  });

  // ── Company tier scenarios ───────────────────────────────

  describe('company tier (devCount > 3)', () => {
    function initRepoWithAuthors(cwd: string, count: number): void {
      git(cwd, 'init');
      git(cwd, 'config user.email "dev1@example.com"');
      git(cwd, 'config user.name "Dev One"');
      writeFile(cwd, 'init.txt', 'init');
      git(cwd, 'add .');
      git(cwd, 'commit -m "initial"');

      for (let i = 2; i <= count; i++) {
        addAuthor(cwd, `dev${i}@example.com`, `Dev ${i}`, `file${i}.txt`);
      }
    }

    it('should return invalid with company tier when 4 authors and no key', async () => {
      initRepoWithAuthors(tmpDir, 4);

      const status = await checker.check(tmpDir, makeConfig());

      expect(status.valid).toBe(false);
      expect(status.tier).toBe('company');
      expect(status.devCount).toBe(4);
      expect(status.message).toBeDefined();
      expect(status.message).toContain('Company license');
    });

    it('should return valid with company tier when 4 authors and valid key via env', async () => {
      initRepoWithAuthors(tmpDir, 4);

      const body = 'ABCDEFGHIJKLMNOP';
      const validKey = makeValidKey(body);
      process.env.NOVA_LICENSE_KEY = validKey;

      const status = await checker.check(tmpDir, makeConfig());

      expect(status.valid).toBe(true);
      expect(status.tier).toBe('company');
      expect(status.devCount).toBe(4);
    });

    it('should return valid with company tier when key provided via config', async () => {
      initRepoWithAuthors(tmpDir, 4);

      const body = 'ABCDEFGHIJKLMNOP';
      const validKey = makeValidKey(body);
      const config = makeConfig({ license: { key: validKey } });

      const status = await checker.check(tmpDir, config);

      expect(status.valid).toBe(true);
      expect(status.tier).toBe('company');
      expect(status.devCount).toBe(4);
    });

    it('should prefer config key over env key', async () => {
      initRepoWithAuthors(tmpDir, 4);

      // Set invalid env key
      process.env.NOVA_LICENSE_KEY = 'NOVA-INVALID-0000';

      // Set valid config key
      const body = 'ABCDEFGHIJKLMNOP';
      const validKey = makeValidKey(body);
      const config = makeConfig({ license: { key: validKey } });

      const status = await checker.check(tmpDir, config);

      expect(status.valid).toBe(true);
    });

    it('should return invalid when 4 authors and key has bad checksum', async () => {
      initRepoWithAuthors(tmpDir, 4);

      process.env.NOVA_LICENSE_KEY = 'NOVA-ABCDEFGHIJKLMNOP-0000';

      const status = await checker.check(tmpDir, makeConfig());

      expect(status.valid).toBe(false);
    });
  });

  // ── Not a git repo ───────────────────────────────────────

  describe('non-git directory', () => {
    it('should assume devCount 1 and return valid free tier', async () => {
      // tmpDir is NOT initialized as a git repo
      const status = await checker.check(tmpDir, makeConfig());

      expect(status).toEqual({
        valid: true,
        tier: 'free',
        devCount: 1,
      });
    });
  });

  // ── Key format validation ────────────────────────────────

  describe('license key format', () => {
    function initRepoWithFourAuthors(cwd: string): void {
      git(cwd, 'init');
      git(cwd, 'config user.email "dev1@example.com"');
      git(cwd, 'config user.name "Dev One"');
      writeFile(cwd, 'init.txt', 'init');
      git(cwd, 'add .');
      git(cwd, 'commit -m "initial"');

      for (let i = 2; i <= 4; i++) {
        addAuthor(cwd, `dev${i}@example.com`, `Dev ${i}`, `file${i}.txt`);
      }
    }

    it('should accept key with format "NOVA-{base32}-{checksum}" and correct checksum', async () => {
      initRepoWithFourAuthors(tmpDir);

      const body = 'MFRGGZDFMY';
      const checksum = crypto.createHash('sha256').update(body).digest('hex').slice(0, 4);
      process.env.NOVA_LICENSE_KEY = `NOVA-${body}-${checksum}`;

      const status = await checker.check(tmpDir, makeConfig());

      expect(status.valid).toBe(true);
    });

    it('should reject key "invalid-string"', async () => {
      initRepoWithFourAuthors(tmpDir);

      process.env.NOVA_LICENSE_KEY = 'invalid-string';

      const status = await checker.check(tmpDir, makeConfig());

      expect(status.valid).toBe(false);
    });
  });
});
