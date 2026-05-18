import { describe, it, expect, vi } from 'vitest';
import type { Option } from 'commander';

vi.mock('@novastorm-ai/core', async () => {
  const actual = await vi.importActual('@novastorm-ai/core');
  return {
    ...actual,
    StructuredLogger: vi.fn().mockImplementation(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    })),
  };
});

import { createCli } from '../index.js';

describe('createCli', () => {
  it('returns a Command instance', () => {
    const program = createCli();
    expect(program).toBeDefined();
    expect(program.name()).toBe('nova');
  });

  it('has correct program name and description', () => {
    const program = createCli();
    expect(program.name()).toBe('nova');
    expect(program.description()).toContain('Novastorm');
  });

  it('registers --no-open option', () => {
    const program = createCli();
    // --no-open creates 'open' option (default true, can be set false)
    expect(program.options.some((o: Option) => o.long === '--no-open')).toBe(true);
  });

  it('registers --yes option', () => {
    const program = createCli();
    expect(program.options.some((o: Option) => o.long === '--yes')).toBe(true);
  });

  it('registers --port option', () => {
    const program = createCli();
    expect(program.options.some((o: Option) => o.long === '--port')).toBe(true);
  });

  it('registers --proxy-port option', () => {
    const program = createCli();
    expect(program.options.some((o: Option) => o.long === '--proxy-port')).toBe(true);
  });

  it('registers --host option', () => {
    const program = createCli();
    expect(program.options.some((o: Option) => o.long === '--host')).toBe(true);
  });

  it('registers --no-telemetry option', () => {
    const program = createCli();
    expect(
      program.options.some((o: Option) => o.long === '--no-telemetry'),
    ).toBe(true);
  });

  it('registers --debug option', () => {
    const program = createCli();
    expect(program.options.some((o: Option) => o.long === '--debug')).toBe(true);
  });

  it('registers start subcommand', () => {
    const program = createCli();
    const startCmd = program.commands.find((c: { name: () => string }) => c.name() === 'start');
    expect(startCmd).toBeDefined();
  });

  it('registers setup subcommand', () => {
    const program = createCli();
    const setupCmd = program.commands.find((c: { name: () => string }) => c.name() === 'setup');
    expect(setupCmd).toBeDefined();
  });

  it('registers doctor subcommand', () => {
    const program = createCli();
    const doctorCmd = program.commands.find((c: { name: () => string }) => c.name() === 'doctor');
    expect(doctorCmd).toBeDefined();
  });

  it('registers init subcommand', () => {
    const program = createCli();
    const initCmd = program.commands.find((c: { name: () => string }) => c.name() === 'init');
    expect(initCmd).toBeDefined();
  });

  it('registers status subcommand', () => {
    const program = createCli();
    const statusCmd = program.commands.find((c: { name: () => string }) => c.name() === 'status');
    expect(statusCmd).toBeDefined();
  });

  it('registers bible subcommand', () => {
    const program = createCli();
    const bibleCmd = program.commands.find((c: { name: () => string }) => c.name() === 'bible');
    expect(bibleCmd).toBeDefined();
  });

  it('registers update subcommand', () => {
    const program = createCli();
    const updateCmd = program.commands.find((c: { name: () => string }) => c.name() === 'update');
    expect(updateCmd).toBeDefined();
  });

  it('registers uninstall subcommand', () => {
    const program = createCli();
    const uninstallCmd = program.commands.find(
      (c: { name: () => string }) => c.name() === 'uninstall',
    );
    expect(uninstallCmd).toBeDefined();
  });

  it('registers license subcommand', () => {
    const program = createCli();
    const licenseCmd = program.commands.find(
      (c: { name: () => string }) => c.name() === 'license',
    );
    expect(licenseCmd).toBeDefined();
  });

  it('registers entity subcommand', () => {
    const program = createCli();
    const entityCmd = program.commands.find(
      (c: { name: () => string }) => c.name() === 'entity',
    );
    expect(entityCmd).toBeDefined();
  });

  it('registers all expected commands and options', () => {
    const program = createCli();
    const commandNames = program.commands.map((c: { name: () => string }) => c.name());
    expect(commandNames).toContain('start');
    expect(commandNames).toContain('setup');
    expect(commandNames).toContain('doctor');
    expect(commandNames).toContain('bible');
    expect(commandNames).toContain('init');
    expect(commandNames).toContain('status');
    expect(commandNames).toContain('update');
    expect(commandNames).toContain('uninstall');
    expect(commandNames).toContain('license');
    expect(commandNames).toContain('entity');
  });
});
