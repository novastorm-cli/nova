import { describe, it, expect } from 'vitest';
import { redactSecrets, redactContext } from '../redact.js';

describe('redactSecrets', () => {
  // ── Basic key patterns ────────────────────────────────────

  it('should redact generic sk- keys (OpenAI style)', () => {
    const input = 'Authorization: Bearer sk-proj-abc123def456ghijklmnopqrstuvwxyz';
    const result = redactSecrets(input);
    expect(result).toContain('sk-***');
    expect(result).not.toContain('sk-proj-abc');
  });

  it('should redact Anthropic sk-ant- keys', () => {
    const input = 'Using key sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const result = redactSecrets(input);
    expect(result).toContain('sk-ant-***');
    expect(result).not.toContain('sk-ant-api03');
  });

  it('should redact DeepSeek sk-deepseek- keys', () => {
    const input = 'API key is sk-deepseek-abcdefghijklmnopqrstuvwxyz1234567890ABCDEF';
    const result = redactSecrets(input);
    expect(result).toContain('sk-deepseek-***');
    expect(result).not.toContain('sk-deepseek-abcdef');
  });

  it('should redact OpenRouter sk-or- keys', () => {
    const input = 'Authorization: sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890ABCD';
    const result = redactSecrets(input);
    expect(result).toContain('sk-or-***');
    expect(result).not.toContain('sk-or-v1');
  });

  it('should redact GitHub OAuth tokens (gho_)', () => {
    const input = 'GITHUB_TOKEN=gho_abcdefghijklmnopqrstuvwxyz1234567890ABCD';
    const result = redactSecrets(input);
    expect(result).toContain('gho_***');
    expect(result).not.toContain('gho_abcdef');
  });

  it('should redact Google API keys (AIza)', () => {
    const input = 'GOOGLE_API_KEY=AIzaSyB-abcdefghijklmnopqrstuvwxyz1234567890';
    const result = redactSecrets(input);
    expect(result).toContain('AIza***');
    expect(result).not.toContain('AIzaSy');
  });

  it('should redact HuggingFace tokens (hf_)', () => {
    const input = 'HF_TOKEN=hf_abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH';
    const result = redactSecrets(input);
    expect(result).toContain('hf_***');
    expect(result).not.toContain('hf_abcdef');
  });

  it('should redact xAI / Grok keys (xai-)', () => {
    const input = 'XAI_API_KEY=xai-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH';
    const result = redactSecrets(input);
    expect(result).toContain('xai-***');
    expect(result).not.toContain('xai-abcdef');
  });

  // ── Text without secrets ──────────────────────────────────

  it('should leave normal text unchanged', () => {
    const input = 'Hello, this is a normal log message with no secrets';
    expect(redactSecrets(input)).toBe(input);
  });

  it('should leave short sk- tokens unchanged (false positives)', () => {
    // sk- followed by less than 20 alphanumeric chars should not be redacted
    const input = 'The variable sk-length is 5';
    expect(redactSecrets(input)).toBe(input);
  });

  it('should leave placeholder keys unchanged', () => {
    // Placeholder used in docs/tests — short enough to not match
    const input = 'sk-test-key-here';
    expect(redactSecrets(input)).toBe(input);
  });

  // ── Multiple keys in one string ────────────────────────────

  it('should redact multiple keys in one string', () => {
    const input = 'Keys: sk-abcdefghijklmnopqrstuvwxyz and sk-ant-api03-1234567890abcdefghijklmnopqrstuv';
    const result = redactSecrets(input);
    expect(result).toBe('Keys: sk-*** and sk-ant-***');
    expect(result).not.toContain('abcdef');
  });

  // ── Keys in JSON-like content ─────────────────────────────

  it('should redact keys in JSON strings', () => {
    const input = '{"apiKey":"sk-proj-abcdefghijklmnopqrstuvwxyz1234567890","provider":"openai"}';
    const result = redactSecrets(input);
    expect(result).toBe('{"apiKey":"sk-***","provider":"openai"}');
  });

  it('should redact keys in Authorization headers', () => {
    const input = 'headers: { Authorization: "Bearer sk-deepseek-abcdefghijklmnopqrstuvwxyz1234567890ABCD" }';
    const result = redactSecrets(input);
    expect(result).toContain('sk-deepseek-***');
  });

  // ── Edge cases ────────────────────────────────────────────

  it('should handle empty string', () => {
    expect(redactSecrets('')).toBe('');
  });

  it('should handle string with only whitespace', () => {
    expect(redactSecrets('   \n  ')).toBe('   \n  ');
  });

  it('should handle key at start of string', () => {
    const input = 'sk-abcdefghijklmnopqrstuvwxyz is the key';
    const result = redactSecrets(input);
    expect(result).toBe('sk-*** is the key');
  });

  it('should handle key at end of string', () => {
    const input = 'The key is sk-abcdefghijklmnopqrstuvwxyz';
    const result = redactSecrets(input);
    expect(result).toBe('The key is sk-***');
  });
});

describe('redactContext', () => {
  it('should redact string values containing keys', () => {
    const input = {
      msg: 'Using key sk-abcdefghijklmnopqrstuvwxyz1234567890',
      count: 42,
      flag: true,
      nested: { key: 'value' },
    };
    const result = redactContext(input);
    expect(result.msg).toContain('sk-***');
    expect(result.msg).not.toContain('sk-abcdef');
    expect(result.count).toBe(42);
    expect(result.flag).toBe(true);
    expect(result.nested).toEqual({ key: 'value' });
  });

  it('should handle empty context', () => {
    expect(redactContext({})).toEqual({});
  });

  it('should not mutate the original object', () => {
    const input = { key: 'sk-abcdefghijklmnopqrstuvwxyz1234567890' };
    redactContext(input);
    expect(input.key).toBe('sk-abcdefghijklmnopqrstuvwxyz1234567890');
  });
});
