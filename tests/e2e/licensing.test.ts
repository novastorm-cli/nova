import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TeamDetector } from '../../packages/licensing/src/TeamDetector.js';
import { LicenseChecker } from '../../packages/licensing/src/LicenseChecker.js';
import { Telemetry } from '../../packages/licensing/src/Telemetry.js';
import { NudgeRenderer } from '../../packages/licensing/src/NudgeRenderer.js';
import { DEFAULT_CONFIG } from '../../packages/core/src/models/config.js';
import type { NovaConfig, NudgeLevel, NudgeContext } from '../../packages/core/src/models/types.js';

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

// ── E2E Tests ──────────────────────────────────────────────

describe('E2E: Licensing full flow', () => {
  let tmpDir: string;
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-licensing-'));
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

  // ── Scenario A: 1 author → free tier, no nudge ────────

  it('1 author → free tier, telemetry nudge 0, no nudge rendered', async () => {
    initRepoWithAuthors(tmpDir, 1);

    const detector = new TeamDetector();
    const checker = new LicenseChecker();
    const telemetry = new Telemetry();
    const renderer = new NudgeRenderer();

    // Step 1: Detect team
    const teamInfo = await detector.detect(tmpDir);
    expect(teamInfo.devCount).toBe(1);

    // Step 2: Check license
    const license = await checker.check(tmpDir, makeConfig());
    expect(license).toEqual({ valid: true, tier: 'free', devCount: 1 });

    // Step 3: Send telemetry
    const telemetryResult = await telemetry.send({
      machineId: 'test-machine',
      gitAuthors90d: license.devCount,
      projectHash: 'test-hash',
      cliVersion: '0.0.1',
      os: 'darwin',
      timestamp: new Date().toISOString(),
      licenseKey: null,
    });
    expect(telemetryResult).toEqual({ nudgeLevel: 0 });

    // Step 4: Render nudge
    const nudgeContext: NudgeContext = {
      level: telemetryResult!.nudgeLevel,
      devCount: license.devCount,
      tier: license.tier,
      hasLicense: license.valid,
    };
    const nudgeOutput = renderer.render(nudgeContext);
    expect(nudgeOutput).toBeNull();
  });

  // ── Scenario B: 3 authors → free tier boundary ────────

  it('3 authors → free tier boundary, still free', async () => {
    initRepoWithAuthors(tmpDir, 3);

    const checker = new LicenseChecker();
    const license = await checker.check(tmpDir, makeConfig());

    expect(license).toEqual({ valid: true, tier: 'free', devCount: 3 });

    const renderer = new NudgeRenderer();
    const nudgeOutput = renderer.render({
      level: 0,
      devCount: license.devCount,
      tier: license.tier,
      hasLicense: license.valid,
    });
    expect(nudgeOutput).toBeNull();
  });

  // ── Scenario C: 4 authors, no license key → company tier, nudge from server ──

  it('4 authors, no license key → company tier, invalid, nudge level from server', async () => {
    initRepoWithAuthors(tmpDir, 4);

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ nudge_level: 2 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const checker = new LicenseChecker();
    const license = await checker.check(tmpDir, makeConfig());

    expect(license.valid).toBe(false);
    expect(license.tier).toBe('company');
    expect(license.devCount).toBe(4);
    expect(license.message).toBeDefined();

    const telemetry = new Telemetry();
    const telemetryResult = await telemetry.send({
      machineId: 'test-machine',
      gitAuthors90d: license.devCount,
      projectHash: 'test-hash',
      cliVersion: '0.0.1',
      os: 'darwin',
      timestamp: new Date().toISOString(),
      licenseKey: null,
    });
    expect(telemetryResult).toEqual({ nudgeLevel: 2 });

    const renderer = new NudgeRenderer();
    const nudgeOutput = renderer.render({
      level: telemetryResult!.nudgeLevel,
      devCount: license.devCount,
      tier: license.tier,
      hasLicense: false,
    });
    expect(nudgeOutput).toContain('4 developers');
    expect(nudgeOutput).toContain('https://nova-architect.dev/pricing');
  });

  // ── Scenario D: 4 authors, valid license key → company tier, valid ──

  it('4 authors, valid license key in config → company tier, valid', async () => {
    initRepoWithAuthors(tmpDir, 4);

    const body = 'ABCDEFGHIJKLMNOP';
    const validKey = makeValidKey(body);
    const config = makeConfig({ license: { key: validKey } });

    const checker = new LicenseChecker();
    const license = await checker.check(tmpDir, config);

    expect(license.valid).toBe(true);
    expect(license.tier).toBe('company');
    expect(license.devCount).toBe(4);
  });

  // ── Scenario E: 10 authors, no license → higher nudge level ──

  it('10 authors, no license → higher nudge level', async () => {
    initRepoWithAuthors(tmpDir, 10);

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ nudge_level: 3 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const checker = new LicenseChecker();
    const license = await checker.check(tmpDir, makeConfig());

    expect(license.valid).toBe(false);
    expect(license.tier).toBe('company');
    expect(license.devCount).toBe(10);

    const telemetry = new Telemetry();
    const telemetryResult = await telemetry.send({
      machineId: 'test-machine',
      gitAuthors90d: license.devCount,
      projectHash: 'test-hash',
      cliVersion: '0.0.1',
      os: 'darwin',
      timestamp: new Date().toISOString(),
      licenseKey: null,
    });
    expect(telemetryResult).toEqual({ nudgeLevel: 3 });

    const renderer = new NudgeRenderer();
    const nudgeOutput = renderer.render({
      level: telemetryResult!.nudgeLevel,
      devCount: license.devCount,
      tier: license.tier,
      hasLicense: false,
    });
    expect(nudgeOutput).toContain('License Required');
    expect(nudgeOutput).toContain('10');
  });

  // ── Scenario F: Authors include bots → bots filtered ──

  it('authors include bots → bots filtered, correct devCount', async () => {
    git(tmpDir, 'init');
    git(tmpDir, 'config user.email "dev1@example.com"');
    git(tmpDir, 'config user.name "Dev One"');
    writeFile(tmpDir, 'init.txt', 'init');
    git(tmpDir, 'add .');
    git(tmpDir, 'commit -m "initial"');

    addAuthor(tmpDir, 'dev2@example.com', 'Dev Two', 'file2.txt');
    addAuthor(tmpDir, 'dependabot[bot]@users.noreply.github.com', 'Dependabot', 'bot1.txt');
    addAuthor(tmpDir, 'renovate[bot]@users.noreply.github.com', 'Renovate', 'bot2.txt');
    addAuthor(tmpDir, 'github-actions[bot]@users.noreply.github.com', 'GH Actions', 'bot3.txt');

    const detector = new TeamDetector();
    const teamInfo = await detector.detect(tmpDir);

    expect(teamInfo.devCount).toBe(2);
    expect(teamInfo.botsFiltered).toBe(3);

    // License check should also see 2 devs (free tier)
    const checker = new LicenseChecker();
    const license = await checker.check(tmpDir, makeConfig());

    expect(license.valid).toBe(true);
    expect(license.tier).toBe('free');
    expect(license.devCount).toBe(2);
  });
});
