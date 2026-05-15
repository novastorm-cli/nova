import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TeamDetector } from '../TeamDetector.js';

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

function addAuthorWithDate(
  cwd: string,
  email: string,
  name: string,
  file: string,
  daysAgo: number,
): void {
  writeFile(cwd, file, `authored by ${email}`);
  git(cwd, `add ${file}`);
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  // Set both GIT_AUTHOR_DATE and GIT_COMMITTER_DATE so --since filtering works correctly
  execSync(
    `git -c user.email="${email}" -c user.name="${name}" commit -m "commit by ${name}" --date="${date}"`,
    { cwd, encoding: 'utf-8', env: { ...process.env, GIT_COMMITTER_DATE: date } },
  );
}

// ── Tests ──────────────────────────────────────────────────

describe('TeamDetector', () => {
  let tmpDir: string;
  let detector: TeamDetector;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-detector-test-'));
    detector = new TeamDetector();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Basic counting ─────────────────────────────────────

  it('should return devCount 1 for a single author', async () => {
    git(tmpDir, 'init');
    git(tmpDir, 'config user.email "dev1@example.com"');
    git(tmpDir, 'config user.name "Dev One"');
    writeFile(tmpDir, 'file.txt', 'hello');
    git(tmpDir, 'add .');
    git(tmpDir, 'commit -m "initial"');

    const info = await detector.detect(tmpDir);

    expect(info.devCount).toBe(1);
    expect(info.windowDays).toBe(90);
    expect(info.botsFiltered).toBe(0);
  });

  it('should count multiple unique authors', async () => {
    git(tmpDir, 'init');
    git(tmpDir, 'config user.email "dev1@example.com"');
    git(tmpDir, 'config user.name "Dev One"');
    writeFile(tmpDir, 'init.txt', 'init');
    git(tmpDir, 'add .');
    git(tmpDir, 'commit -m "initial"');

    addAuthor(tmpDir, 'dev2@example.com', 'Dev Two', 'file2.txt');
    addAuthor(tmpDir, 'dev3@example.com', 'Dev Three', 'file3.txt');

    const info = await detector.detect(tmpDir);

    expect(info.devCount).toBe(3);
  });

  // ── Bot filtering ──────────────────────────────────────

  it('should filter dependabot emails', async () => {
    git(tmpDir, 'init');
    git(tmpDir, 'config user.email "dev1@example.com"');
    git(tmpDir, 'config user.name "Dev One"');
    writeFile(tmpDir, 'init.txt', 'init');
    git(tmpDir, 'add .');
    git(tmpDir, 'commit -m "initial"');

    addAuthor(tmpDir, 'dependabot[bot]@users.noreply.github.com', 'Dependabot', 'bot1.txt');

    const info = await detector.detect(tmpDir);

    expect(info.devCount).toBe(1);
    expect(info.botsFiltered).toBe(1);
  });

  it('should filter renovate bot emails', async () => {
    git(tmpDir, 'init');
    git(tmpDir, 'config user.email "dev1@example.com"');
    git(tmpDir, 'config user.name "Dev One"');
    writeFile(tmpDir, 'init.txt', 'init');
    git(tmpDir, 'add .');
    git(tmpDir, 'commit -m "initial"');

    addAuthor(tmpDir, 'renovate[bot]@users.noreply.github.com', 'Renovate', 'bot2.txt');

    const info = await detector.detect(tmpDir);

    expect(info.devCount).toBe(1);
    expect(info.botsFiltered).toBe(1);
  });

  it('should filter github-actions bot emails', async () => {
    git(tmpDir, 'init');
    git(tmpDir, 'config user.email "dev1@example.com"');
    git(tmpDir, 'config user.name "Dev One"');
    writeFile(tmpDir, 'init.txt', 'init');
    git(tmpDir, 'add .');
    git(tmpDir, 'commit -m "initial"');

    addAuthor(tmpDir, 'github-actions[bot]@users.noreply.github.com', 'GH Actions', 'bot3.txt');

    const info = await detector.detect(tmpDir);

    expect(info.devCount).toBe(1);
    expect(info.botsFiltered).toBe(1);
  });

  it('should filter noreply.github.com emails', async () => {
    git(tmpDir, 'init');
    git(tmpDir, 'config user.email "dev1@example.com"');
    git(tmpDir, 'config user.name "Dev One"');
    writeFile(tmpDir, 'init.txt', 'init');
    git(tmpDir, 'add .');
    git(tmpDir, 'commit -m "initial"');

    addAuthor(tmpDir, '12345+user@users.noreply.github.com', 'Web User', 'web.txt');

    const info = await detector.detect(tmpDir);

    expect(info.devCount).toBe(1);
    expect(info.botsFiltered).toBe(1);
  });

  // ── Email normalization ────────────────────────────────

  it('should normalize email casing', async () => {
    git(tmpDir, 'init');
    git(tmpDir, 'config user.email "Dev1@Example.COM"');
    git(tmpDir, 'config user.name "Dev One"');
    writeFile(tmpDir, 'init.txt', 'init');
    git(tmpDir, 'add .');
    git(tmpDir, 'commit -m "initial"');

    addAuthor(tmpDir, 'dev1@example.com', 'Dev One Again', 'file2.txt');

    const info = await detector.detect(tmpDir);

    expect(info.devCount).toBe(1);
  });

  it('should strip +tags from email addresses', async () => {
    git(tmpDir, 'init');
    git(tmpDir, 'config user.email "dev1+work@example.com"');
    git(tmpDir, 'config user.name "Dev One"');
    writeFile(tmpDir, 'init.txt', 'init');
    git(tmpDir, 'add .');
    git(tmpDir, 'commit -m "initial"');

    addAuthor(tmpDir, 'dev1@example.com', 'Dev One Plain', 'file2.txt');

    const info = await detector.detect(tmpDir);

    expect(info.devCount).toBe(1);
  });

  // ── Window days ────────────────────────────────────────

  it('should respect 90-day window and exclude old commits', async () => {
    git(tmpDir, 'init');
    git(tmpDir, 'config user.email "dev1@example.com"');
    git(tmpDir, 'config user.name "Dev One"');

    // Add an old commit (100 days ago)
    addAuthorWithDate(tmpDir, 'old-dev@example.com', 'Old Dev', 'old.txt', 100);

    // Add a recent commit
    addAuthor(tmpDir, 'dev1@example.com', 'Dev One', 'recent.txt');

    const info = await detector.detect(tmpDir);

    expect(info.devCount).toBe(1);
  });

  it('should accept custom windowDays option', async () => {
    git(tmpDir, 'init');
    git(tmpDir, 'config user.email "dev1@example.com"');
    git(tmpDir, 'config user.name "Dev One"');

    // Add commit 50 days ago (within 90 but outside 30)
    addAuthorWithDate(tmpDir, 'dev2@example.com', 'Dev Two', 'old.txt', 50);

    // Add recent commit
    addAuthor(tmpDir, 'dev1@example.com', 'Dev One', 'recent.txt');

    const info30 = await detector.detect(tmpDir, { windowDays: 30 });
    expect(info30.devCount).toBe(1);
    expect(info30.windowDays).toBe(30);

    const info90 = await detector.detect(tmpDir, { windowDays: 90 });
    expect(info90.devCount).toBe(2);
    expect(info90.windowDays).toBe(90);
  });

  // ── Non-git directory ──────────────────────────────────

  it('should return devCount 1 for non-git directory', async () => {
    const info = await detector.detect(tmpDir);

    expect(info.devCount).toBe(1);
    expect(info.botsFiltered).toBe(0);
  });
});
