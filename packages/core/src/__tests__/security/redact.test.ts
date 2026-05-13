import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
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

  it('should redact keys in nested objects (one level deep)', () => {
    const k = fake('sk-ant-');
    const input = { outer: { inner: `key: ${k}` } };
    const result = redactContext(input);
    expect(result).toEqual({ outer: { inner: 'key: sk-ant-***' } });
  });

  it('should redact keys in deeply nested objects', () => {
    const k = fake('sk-deepseek-');
    const input = { a: { b: { c: { d: `secret=${k}` } } } };
    const result = redactContext(input);
    expect(result).toEqual({
      a: { b: { c: { d: 'secret=sk-deepseek-***' } } },
    });
  });

  it('should redact keys inside arrays', () => {
    const k = fake('sk-');
    const input = { items: [`first: ${k}`, 'normal text', 42] };
    const result = redactContext(input);
    expect(result).toEqual({
      items: ['first: sk-***', 'normal text', 42],
    });
  });

  it('should redact keys in nested arrays of objects', () => {
    const k = fake('sk-or-v1-');
    const input = {
      entries: [
        { name: 'a', key: k },
        { name: 'b', key: 'safe-value' },
      ],
    };
    const result = redactContext(input);
    expect(result).toEqual({
      entries: [
        { name: 'a', key: 'sk-or-***' },
        { name: 'b', key: 'safe-value' },
      ],
    });
  });

  it('should handle mixed nested structures', () => {
    const k1 = fake('sk-');
    const k2 = fake('sk-ant-api03-');
    const input = {
      config: {
        providers: [{ apiKey: k1 }, { apiKey: k2 }],
        metadata: { version: 1 },
      },
    };
    const result = redactContext(input);
    expect(result).toEqual({
      config: {
        providers: [{ apiKey: 'sk-***' }, { apiKey: 'sk-ant-***' }],
        metadata: { version: 1 },
      },
    });
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

  it('should not mutate nested original objects', () => {
    const k = fake('sk-');
    const input = { outer: { inner: k } };
    redactContext(input);
    expect(input.outer.inner).toBe(k);
  });
});

// ── Repo-wide secret scan ──────────────────────────────────
// Scans all tracked source files for API key patterns to verify
// no secrets have leaked into the repository. Uses git grep
// since it searches only committed/tracked files and is fast.

describe('repo secret scan (git grep)', () => {
  // Each entry: { name, pattern } — the pattern uses git grep -E (POSIX ERE).
  // Minimum 20 chars after the prefix avoids false positives on short identifiers.
  const SECRET_GREP_PATTERNS: Array<{ name: string; pattern: string }> = [
    {
      name: 'generic sk- keys',
      pattern: 'sk-[A-Za-z0-9_-]\\{20,\\}',
    },
    {
      name: 'gho_ GitHub tokens',
      pattern: 'gho_[A-Za-z0-9]\\{20,\\}',
    },
    {
      name: 'AIza Google API keys',
      pattern: 'AIza[A-Za-z0-9_-]\\{20,\\}',
    },
    {
      name: 'hf_ HuggingFace tokens',
      pattern: 'hf_[A-Za-z0-9]\\{20,\\}',
    },
    {
      name: 'xai- Grok keys',
      pattern: 'xai-[A-Za-z0-9]\\{20,\\}',
    },
  ];

  const REPO_ROOT = process.cwd();

  for (const { name, pattern } of SECRET_GREP_PATTERNS) {
    it(`should have no committed ${name}`, () => {
      let output: string;
      try {
        output = execSync(`git grep -E '${pattern}'`, {
          encoding: 'utf-8',
          cwd: REPO_ROOT,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err: unknown) {
        // git grep exits with code 1 when no matches are found.
        const e = err as { status?: number; stderr?: string };
        expect(e.status).toBe(1);
        return;
      }

      // If we reach here, git grep found matches. Filter out files that are
      // expected to contain key patterns (test files that construct fake keys
      // at runtime). The fake() helper joins short string literals, so the
      // source should not have contiguous matches — but if a test file
      // happens to match, flag it clearly rather than silently passing.
      const lines = output
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);

      // Remove lines from this test file itself (contains placeholder references)
      const unexpected = lines.filter(
        (line) =>
          !line.includes('__tests__/security/redact.test.ts') &&
          !line.includes('node_modules/') &&
          !line.includes('.git/') &&
          !line.startsWith('Binary file'),
      );

      if (unexpected.length > 0) {
        // Fail with clear information about what was found and where.
        expect.fail(
          `Found ${unexpected.length} committed file(s) matching "${name}" pattern:\n` +
            unexpected.map((l) => `  ${l}`).join('\n') +
            '\n\nThese look like real API keys. Remove them and rotate the keys immediately.',
        );
      }
    });
  }
});
