import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { TeamDetector } from '../TeamDetector.js';
import { LicenseChecker } from '../LicenseChecker.js';
import { Telemetry } from '../Telemetry.js';
import { NudgeRenderer } from '../NudgeRenderer.js';
import { DEFAULT_CONFIG } from '@nova-architect/core';
import type { NovaConfig, NudgeContext, NudgeLevel, TelemetryPayload } from '@nova-architect/core';

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

// ── Integration Tests ──────────────────────────────────────

describe('Integration: TeamDetector + LicenseChecker + Telemetry + NudgeRenderer', () => {
  let tmpDir: string;
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-test-'));
    delete process.env.NOVA_LICENSE_KEY;

    fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ nudge_level: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ── TeamDetector + LicenseChecker consistency ──────────

  describe('devCount consistency between TeamDetector and LicenseChecker', () => {
    it('should report the same devCount for free tier', async () => {
      initRepoWithAuthors(tmpDir, 2);

      const detector = new TeamDetector();
      const checker = new LicenseChecker();

      const teamInfo = await detector.detect(tmpDir);
      const license = await checker.check(tmpDir, makeConfig());

      expect(license.devCount).toBe(teamInfo.devCount);
      expect(license.devCount).toBe(2);
    });

    it('should report the same devCount for company tier', async () => {
      initRepoWithAuthors(tmpDir, 5);

      const detector = new TeamDetector();
      const checker = new LicenseChecker();

      const teamInfo = await detector.detect(tmpDir);
      const license = await checker.check(tmpDir, makeConfig());

      expect(license.devCount).toBe(teamInfo.devCount);
      expect(license.devCount).toBe(5);
    });
  });

  // ── Telemetry payload shape ────────────────────────────

  describe('telemetry payload shape', () => {
    it('should send a payload matching TelemetryPayload interface', async () => {
      initRepoWithAuthors(tmpDir, 2);

      const checker = new LicenseChecker();
      const license = await checker.check(tmpDir, makeConfig());

      const telemetry = new Telemetry();
      const payload: TelemetryPayload = {
        machineId: 'test-machine-id',
        gitAuthors90d: license.devCount,
        projectHash: crypto.createHash('sha256').update(tmpDir).digest('hex'),
        cliVersion: '0.0.1',
        os: 'darwin',
        timestamp: new Date().toISOString(),
        licenseKey: null,
      };

      await telemetry.send(payload);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.nova-architect.dev/v1/telemetry');

      const body = JSON.parse(options.body as string);
      expect(body).toEqual(
        expect.objectContaining({
          machineId: expect.any(String),
          gitAuthors90d: expect.any(Number),
          projectHash: expect.any(String),
          cliVersion: expect.any(String),
          os: expect.any(String),
          timestamp: expect.any(String),
          licenseKey: null,
        }),
      );
      expect(body.gitAuthors90d).toBe(license.devCount);
    });

    it('should include license key in payload when provided', async () => {
      initRepoWithAuthors(tmpDir, 4);

      const body = 'ABCDEFGHIJKLMNOP';
      const validKey = makeValidKey(body);
      const config = makeConfig({ license: { key: validKey } });

      const checker = new LicenseChecker();
      const license = await checker.check(tmpDir, config);

      const telemetry = new Telemetry();
      const payload: TelemetryPayload = {
        machineId: 'test-machine-id',
        gitAuthors90d: license.devCount,
        projectHash: 'test-hash',
        cliVersion: '0.0.1',
        os: 'darwin',
        timestamp: new Date().toISOString(),
        licenseKey: validKey,
      };

      await telemetry.send(payload);

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const sentBody = JSON.parse(options.body as string);
      expect(sentBody.licenseKey).toBe(validKey);
    });
  });

  // ── NudgeRenderer with different contexts ──────────────

  describe('NudgeRenderer with different NudgeContext values', () => {
    const renderer = new NudgeRenderer();

    it('level 0 → returns null (no nudge)', () => {
      const context: NudgeContext = {
        level: 0,
        devCount: 1,
        tier: 'free',
        hasLicense: true,
      };
      expect(renderer.render(context)).toBeNull();
    });

    it('level 1 → informational nudge', () => {
      const context: NudgeContext = {
        level: 1,
        devCount: 4,
        tier: 'company',
        hasLicense: false,
      };
      const output = renderer.render(context);
      expect(output).toContain('free for teams of 3 or fewer');
      expect(output).toContain('https://nova-architect.dev/pricing');
    });

    it('level 2 → recommendation nudge with devCount', () => {
      const context: NudgeContext = {
        level: 2,
        devCount: 6,
        tier: 'company',
        hasLicense: false,
      };
      const output = renderer.render(context);
      expect(output).toContain('6 developers');
      expect(output).toContain('license is recommended');
    });

    it('level 3 → box-style license required nudge', () => {
      const context: NudgeContext = {
        level: 3,
        devCount: 10,
        tier: 'company',
        hasLicense: false,
      };
      const output = renderer.render(context);
      expect(output).toContain('License Required');
      expect(output).toContain('10');
      expect(output).toContain('commercial license');
    });

    it('renders correctly for all valid NudgeLevels', () => {
      const levels: NudgeLevel[] = [0, 1, 2, 3];

      for (const level of levels) {
        const context: NudgeContext = {
          level,
          devCount: 5,
          tier: 'company',
          hasLicense: false,
        };
        const output = renderer.render(context);

        if (level === 0) {
          expect(output).toBeNull();
        } else {
          expect(output).toBeTruthy();
          expect(output).toContain('https://nova-architect.dev/pricing');
        }
      }
    });
  });

  // ── Full flow integration ──────────────────────────────

  describe('full flow: detect → check → send → render', () => {
    it('free tier flow runs without errors', async () => {
      initRepoWithAuthors(tmpDir, 2);

      const detector = new TeamDetector();
      const checker = new LicenseChecker();
      const telemetry = new Telemetry();
      const renderer = new NudgeRenderer();

      const teamInfo = await detector.detect(tmpDir);
      const license = await checker.check(tmpDir, makeConfig());

      expect(license.devCount).toBe(teamInfo.devCount);
      expect(license.valid).toBe(true);

      const result = await telemetry.send({
        machineId: 'test',
        gitAuthors90d: license.devCount,
        projectHash: 'hash',
        cliVersion: '0.0.1',
        os: 'darwin',
        timestamp: new Date().toISOString(),
        licenseKey: null,
      });

      const nudgeOutput = renderer.render({
        level: result?.nudgeLevel ?? 0,
        devCount: license.devCount,
        tier: license.tier,
        hasLicense: license.valid,
      });

      expect(nudgeOutput).toBeNull();
    });

    it('company tier flow with valid license runs without errors', async () => {
      initRepoWithAuthors(tmpDir, 5);

      const bodyStr = 'ABCDEFGHIJKLMNOP';
      const validKey = makeValidKey(bodyStr);
      const config = makeConfig({ license: { key: validKey } });

      const detector = new TeamDetector();
      const checker = new LicenseChecker();
      const telemetry = new Telemetry();
      const renderer = new NudgeRenderer();

      const teamInfo = await detector.detect(tmpDir);
      const license = await checker.check(tmpDir, config);

      expect(license.devCount).toBe(teamInfo.devCount);
      expect(license.valid).toBe(true);
      expect(license.tier).toBe('company');

      const result = await telemetry.send({
        machineId: 'test',
        gitAuthors90d: license.devCount,
        projectHash: 'hash',
        cliVersion: '0.0.1',
        os: 'darwin',
        timestamp: new Date().toISOString(),
        licenseKey: validKey,
      });

      const nudgeOutput = renderer.render({
        level: result?.nudgeLevel ?? 0,
        devCount: license.devCount,
        tier: license.tier,
        hasLicense: license.valid,
      });

      expect(nudgeOutput).toBeNull();
    });

    it('company tier flow without license triggers nudge', async () => {
      initRepoWithAuthors(tmpDir, 5);

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ nudge_level: 2 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const checker = new LicenseChecker();
      const telemetry = new Telemetry();
      const renderer = new NudgeRenderer();

      const license = await checker.check(tmpDir, makeConfig());

      expect(license.valid).toBe(false);
      expect(license.tier).toBe('company');

      const result = await telemetry.send({
        machineId: 'test',
        gitAuthors90d: license.devCount,
        projectHash: 'hash',
        cliVersion: '0.0.1',
        os: 'darwin',
        timestamp: new Date().toISOString(),
        licenseKey: null,
      });

      const nudgeOutput = renderer.render({
        level: result!.nudgeLevel,
        devCount: license.devCount,
        tier: license.tier,
        hasLicense: false,
      });

      expect(nudgeOutput).toBeTruthy();
      expect(nudgeOutput).toContain('5 developers');
    });
  });
});
