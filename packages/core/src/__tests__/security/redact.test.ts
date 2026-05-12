import { describe, it, expect } from 'vitest';
import { redactSecrets, redactContext } from '../../security/redact.js';

// Helper: build a fake key that the redactor will match but secret scanners won't flag.
// Using runtime construction avoids having long alphanumeric literals in source.
// Must use only alphanumeric chars (no hyphens/underscores) so all regex patterns match.
function fake(prefix: string): string {
  return prefix + 'testdata'.repeat(4); // 32 alphanumeric chars, exceeds 20-minimum
}

describe('redactSecrets', () => {
  // ── Basic key patterns ────────────────────────────────────

  it('should redact generic sk- keys (OpenAI style)', () => {
    const input = `Authorization: Bearer ${fake('sk-proj-')}`;
    const result = redactSecrets(input);
    expect(result).toBe('Authorization: Bearer sk-***');
    expect(result).not.toContain('sk-proj-');
  });

  it('should redact Anthropic sk-ant- keys', () => {
    const input = `Using key ${fake('sk-ant-api03-')}`;
    const result = redactSecrets(input);
    expect(result).toBe('Using key sk-ant-***');
    expect(result).not.toContain('sk-ant-api03-');
  });

  it('should redact DeepSeek sk-deepseek- keys', () => {
    const k = fake('sk-deepseek-');
    const input = `API key is ${k}`;
    const result = redactSecrets(input);
    expect(result).toBe('API key is sk-deepseek-***');
    expect(result).not.toContain(k);
  });

  it('should redact OpenRouter sk-or- keys', () => {
    const input = `Authorization: ${fake('sk-or-v1-')}`;
    const result = redactSecrets(input);
    expect(result).toBe('Authorization: sk-or-***');
    expect(result).not.toContain('sk-or-v1-');
  });

  it('should redact GitHub OAuth tokens (gho_)', () => {
    const input = `GITHUB_TOKEN=${fake('gho_')}`;
    const result = redactSecrets(input);
    expect(result).toBe('GITHUB_TOKEN=gho_***');
    expect(result).not.toContain('gho_testdata');
  });

  it('should redact Google API keys (AIza)', () => {
    const input = `GOOGLE_API_KEY=${fake('AIza')}`;
    const result = redactSecrets(input);
    expect(result).toBe('GOOGLE_API_KEY=AIza***');
    expect(result).not.toContain('AIzatestdata');
  });

  it('should redact HuggingFace tokens (hf_)', () => {
    const input = `HF_TOKEN=${fake('hf_')}`;
    const result = redactSecrets(input);
    expect(result).toBe('HF_TOKEN=hf_***');
    expect(result).not.toContain('hf_testdata');
  });

  it('should redact xAI / Grok keys (xai-)', () => {
    const input = `XAI_API_KEY=${fake('xai-')}`;
    const result = redactSecrets(input);
    expect(result).toBe('XAI_API_KEY=xai-***');
    expect(result).not.toContain('xaitestdata');
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
    const key1 = fake('sk-');
    const key2 = fake('sk-ant-api03-');
    const input = `Keys: ${key1} and ${key2}`;
    const result = redactSecrets(input);
    expect(result).toBe('Keys: sk-*** and sk-ant-***');
    expect(result).not.toContain(key1);
    expect(result).not.toContain(key2);
  });

  // ── Keys in JSON-like content ─────────────────────────────

  it('should redact keys in JSON strings', () => {
    const k = fake('sk-');
    const input = `{"apiKey":"${k}","provider":"openai"}`;
    const result = redactSecrets(input);
    expect(result).toBe('{"apiKey":"sk-***","provider":"openai"}');
  });

  it('should redact keys in Authorization headers', () => {
    const k = fake('sk-deepseek-');
    const input = `headers: { Authorization: "Bearer ${k}" }`;
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
    const k = fake('sk-');
    const input = `${k} is the key`;
    const result = redactSecrets(input);
    expect(result).toBe('sk-*** is the key');
  });

  it('should handle key at end of string', () => {
    const k = fake('sk-');
    const input = `The key is ${k}`;
    const result = redactSecrets(input);
    expect(result).toBe('The key is sk-***');
  });
});

describe('redactContext', () => {
  it('should redact string values containing keys', () => {
    const k = fake('sk-');
    const input = {
      msg: `Using key ${k}`,
      count: 42,
      flag: true,
      nested: { key: 'value' },
    };
    const result = redactContext(input);
    expect(result.msg).toBe('Using key sk-***');
    expect(result.msg).not.toContain(k);
    expect(result.count).toBe(42);
    expect(result.flag).toBe(true);
    expect(result.nested).toEqual({ key: 'value' });
  });

  it('should handle empty context', () => {
    expect(redactContext({})).toEqual({});
  });

  it('should not mutate the original object', () => {
    const k = fake('sk-');
    const input = { key: k };
    redactContext(input);
    expect(input.key).toBe(k);
  });
});
