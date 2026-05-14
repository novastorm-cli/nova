import { describe, it, expect } from 'vitest';
import {
  generateNonce,
  parseCsp,
  parseCspValues,
  serializeCsp,
  modifyEnforcementCsp,
} from '../csp.js';

describe('generateNonce', () => {
  it('generates a non-empty base64url string', () => {
    const nonce = generateNonce();
    expect(nonce).toBeTruthy();
    expect(typeof nonce).toBe('string');
    // base64url: only [A-Za-z0-9_-]
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates unique nonces on each call', () => {
    const a = generateNonce();
    const b = generateNonce();
    const c = generateNonce();
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it('has sufficient entropy (>= 16 bytes base64url → >= 22 chars)', () => {
    const nonce = generateNonce();
    expect(nonce.length).toBeGreaterThanOrEqual(22);
  });
});

describe('parseCspValues', () => {
  it('parses simple space-separated values', () => {
    expect(parseCspValues("'self' 'unsafe-inline'")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('parses quoted tokens with hyphens and special chars', () => {
    expect(parseCspValues("'nonce-abc123' 'sha256-deadbeef=='")).toEqual([
      "'nonce-abc123'",
      "'sha256-deadbeef=='",
    ]);
  });

  it('parses unquoted origins', () => {
    expect(parseCspValues('https://example.com http://127.0.0.1:3501')).toEqual([
      'https://example.com',
      'http://127.0.0.1:3501',
    ]);
  });

  it('parses mixed quoted and unquoted values', () => {
    expect(parseCspValues("'self' https://cdn.example.com 'nonce-xyz'")).toEqual([
      "'self'",
      'https://cdn.example.com',
      "'nonce-xyz'",
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(parseCspValues('')).toEqual([]);
  });

  it('returns empty array for whitespace-only', () => {
    expect(parseCspValues('   ')).toEqual([]);
  });
});

describe('parseCsp', () => {
  it('parses a simple CSP with one directive', () => {
    const result = parseCsp("default-src 'self'");
    expect(result.get('default-src')).toEqual(["'self'"]);
  });

  it('parses multiple directives separated by semicolons', () => {
    const result = parseCsp(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
    );
    expect(result.get('default-src')).toEqual(["'self'"]);
    expect(result.get('script-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(result.get('connect-src')).toEqual(["'self'"]);
  });

  it('handles directive names case-insensitively', () => {
    const result = parseCsp("Default-Src 'self'; SCRIPT-SRC 'unsafe-inline'");
    expect(result.get('default-src')).toEqual(["'self'"]);
    expect(result.get('script-src')).toEqual(["'unsafe-inline'"]);
  });

  it('handles directive with no values', () => {
    const result = parseCsp("default-src 'self'; upgrade-insecure-requests");
    expect(result.get('upgrade-insecure-requests')).toEqual([]);
  });

  it('handles trailing semicolons and extra whitespace', () => {
    const result = parseCsp("  default-src  'self' ;  script-src 'unsafe-inline' ; ");
    expect(result.get('default-src')).toEqual(["'self'"]);
    expect(result.get('script-src')).toEqual(["'unsafe-inline'"]);
    expect(result.size).toBe(2);
  });

  it('handles empty string', () => {
    const result = parseCsp('');
    expect(result.size).toBe(0);
  });

  it('preserves nonce values', () => {
    const result = parseCsp("script-src 'self' 'nonce-existing123'");
    expect(result.get('script-src')).toEqual(["'self'", "'nonce-existing123'"]);
  });
});

describe('serializeCsp', () => {
  it('serializes a single directive', () => {
    const directives = new Map([['default-src', ["'self'"]]]);
    expect(serializeCsp(directives)).toBe("default-src 'self'");
  });

  it('serializes multiple directives', () => {
    const directives = new Map([
      ['default-src', ["'self'"]],
      ['script-src', ["'self'", "'unsafe-inline'"]],
    ]);
    expect(serializeCsp(directives)).toBe("default-src 'self'; script-src 'self' 'unsafe-inline'");
  });

  it('serializes directive with no values', () => {
    const directives = new Map([
      ['default-src', ["'self'"]],
      ['upgrade-insecure-requests', []],
    ]);
    expect(serializeCsp(directives)).toBe("default-src 'self'; upgrade-insecure-requests");
  });

  it('round-trips through parse + serialize', () => {
    const original =
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'nonce-abc'; connect-src 'self' https://api.example.com";
    const parsed = parseCsp(original);
    const serialized = serializeCsp(parsed);
    const reparsed = parseCsp(serialized);

    expect(reparsed.get('default-src')).toEqual(["'self'"]);
    expect(reparsed.get('script-src')).toEqual(["'self'", "'unsafe-inline'", "'nonce-abc'"]);
    expect(reparsed.get('connect-src')).toEqual(["'self'", 'https://api.example.com']);
  });
});

describe('modifyEnforcementCsp', () => {
  const nonce = 'testNonce123';
  const proxyOrigin = 'http://127.0.0.1:3501';
  const nonceToken = `'nonce-${nonce}'`;

  it('returns null for undefined/null input', () => {
    expect(modifyEnforcementCsp(undefined, nonce, proxyOrigin)).toBeNull();
    expect(modifyEnforcementCsp(null, nonce, proxyOrigin)).toBeNull();
  });

  it('adds nonce to existing script-src', () => {
    const result = modifyEnforcementCsp(
      "default-src 'self'; script-src 'self' 'unsafe-inline'",
      nonce,
      proxyOrigin,
    );
    const parsed = parseCsp(result!);
    expect(parsed.get('script-src')).toContain(nonceToken);
    expect(parsed.get('connect-src')).toContain(proxyOrigin);
  });

  it('creates script-src and connect-src when only default-src exists', () => {
    const result = modifyEnforcementCsp("default-src 'self'", nonce, proxyOrigin);
    const parsed = parseCsp(result!);
    expect(parsed.get('script-src')).toContain(nonceToken);
    expect(parsed.get('connect-src')).toContain(proxyOrigin);
    // default-src should remain unchanged
    expect(parsed.get('default-src')).toEqual(["'self'"]);
  });

  it('creates script-src and connect-src when neither exists', () => {
    const result = modifyEnforcementCsp('upgrade-insecure-requests', nonce, proxyOrigin);
    const parsed = parseCsp(result!);
    expect(parsed.get('script-src')).toContain(nonceToken);
    expect(parsed.get('script-src')).toContain("'self'");
    expect(parsed.get('connect-src')).toContain(proxyOrigin);
    expect(parsed.get('connect-src')).toContain("'self'");
  });

  it('adds proxy origin to existing connect-src', () => {
    const result = modifyEnforcementCsp(
      "default-src 'self'; connect-src 'self' https://api.example.com",
      nonce,
      proxyOrigin,
    );
    const parsed = parseCsp(result!);
    expect(parsed.get('connect-src')).toContain('https://api.example.com');
    expect(parsed.get('connect-src')).toContain(proxyOrigin);
  });

  it('does not duplicate nonce if already present', () => {
    const input = `default-src 'self'; script-src 'self' ${nonceToken}`;
    const result = modifyEnforcementCsp(input, nonce, proxyOrigin);
    const parsed = parseCsp(result!);
    const counts = parsed.get('script-src')!.filter((v) => v === nonceToken);
    expect(counts).toHaveLength(1);
  });

  it('does not duplicate proxy origin if already present', () => {
    const input = `default-src 'self'; connect-src 'self' ${proxyOrigin}`;
    const result = modifyEnforcementCsp(input, nonce, proxyOrigin);
    const parsed = parseCsp(result!);
    const counts = parsed.get('connect-src')!.filter((v) => v === proxyOrigin);
    expect(counts).toHaveLength(1);
  });

  it('preserves other directives like img-src, style-src, etc.', () => {
    const result = modifyEnforcementCsp(
      "default-src 'self'; img-src 'self' https://images.example.com; style-src 'self' 'unsafe-inline'",
      nonce,
      proxyOrigin,
    );
    const parsed = parseCsp(result!);
    expect(parsed.get('img-src')).toEqual(["'self'", 'https://images.example.com']);
    expect(parsed.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(parsed.get('script-src')).toContain(nonceToken);
  });

  it('VAL-SEC-029: CSP enforcement header is rewritten, not stripped', () => {
    const input = "default-src 'self'";
    const result = modifyEnforcementCsp(input, nonce, proxyOrigin);
    expect(result).toBeTruthy();
    // The result must contain the nonce token
    expect(result).toContain(nonceToken);
    // The result must contain the proxy origin
    expect(result).toContain(proxyOrigin);
    // It must NOT be empty or a stripped version
    expect(result!.length).toBeGreaterThan(10);
  });
});
