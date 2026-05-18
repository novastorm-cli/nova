import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { NovaChat } from '../chat.js';
import type { ChatCommand } from '../chat.js';

describe('NovaChat', () => {
  describe('command parsing (via parse)', () => {
    let chat: NovaChat;

    // Access private parse method for testing
    function parse(input: string): ChatCommand {
       
      return (chat as any).parse(input);
    }

    beforeEach(() => {
      chat = new NovaChat();
    });

    it('parses /settings as settings command', () => {
      const cmd = parse('/settings');
      expect(cmd.type).toBe('settings');
    });

    it('parses /help as help command', () => {
      const cmd = parse('/help');
      expect(cmd.type).toBe('help');
    });

    it('parses /status as status command', () => {
      const cmd = parse('/status');
      expect(cmd.type).toBe('status');
    });

    it('parses /map as map command', () => {
      const cmd = parse('/map');
      expect(cmd.type).toBe('map');
    });

    it('parses /yes as confirm command', () => {
      const cmd = parse('/yes');
      expect(cmd.type).toBe('confirm');
    });

    it('parses /y as confirm command', () => {
      const cmd = parse('/y');
      expect(cmd.type).toBe('confirm');
    });

    it('parses /no as cancel command', () => {
      const cmd = parse('/no');
      expect(cmd.type).toBe('cancel');
    });

    it('parses /n as cancel command', () => {
      const cmd = parse('/n');
      expect(cmd.type).toBe('cancel');
    });

    it('parses slash command with arguments', () => {
      const cmd = parse('/settings apiKeys.provider ollama');
      expect(cmd.type).toBe('settings');
      expect(cmd.args).toBe('apiKeys.provider ollama');
    });

    it('parses "y" as confirm shortcut', () => {
      const cmd = parse('y');
      expect(cmd.type).toBe('confirm');
    });

    it('parses "yes" as confirm shortcut', () => {
      const cmd = parse('yes');
      expect(cmd.type).toBe('confirm');
    });

    it('parses "execute" as confirm shortcut', () => {
      const cmd = parse('execute');
      expect(cmd.type).toBe('confirm');
    });

    it('parses "n" as cancel shortcut', () => {
      const cmd = parse('n');
      expect(cmd.type).toBe('cancel');
    });

    it('parses "no" as cancel shortcut', () => {
      const cmd = parse('no');
      expect(cmd.type).toBe('cancel');
    });

    it('parses "cancel" as cancel shortcut', () => {
      const cmd = parse('cancel');
      expect(cmd.type).toBe('cancel');
    });

    it('parses random text as text command', () => {
      const cmd = parse('Add a button to the page');
      expect(cmd.type).toBe('text');
      expect(cmd.args).toBe('Add a button to the page');
    });

    it('parses empty string as text command', () => {
      const cmd = parse('');
      expect(cmd.type).toBe('text');
    });

    it('is case-insensitive for shortcuts', () => {
      expect(parse('YES').type).toBe('confirm');
      expect(parse('No').type).toBe('cancel');
      expect(parse('ExEcUtE').type).toBe('confirm');
    });

    it('slash command with trailing space', () => {
      const cmd = parse('/help ');
      expect(cmd.type).toBe('help');
      expect(cmd.args).toBe('');
    });
  });

  describe('onCommand', () => {
    it('registers a command handler', () => {
      const chat = new NovaChat();
      const handler = vi.fn();
      chat.onCommand(handler);
      // Handler is registered (no-op test verifies no throw)
      expect(handler).toBeDefined();
    });
  });
});
