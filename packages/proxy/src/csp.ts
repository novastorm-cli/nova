import crypto from 'node:crypto';

/**
 * Generate a unique nonce per response for CSP.
 * Uses 128 bits of entropy encoded as base64url (no padding, URL-safe).
 */
export function generateNonce(): string {
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * Parse a CSP policy header value into a Map of directive → value tokens.
 * Handles quoted values like 'nonce-abc' and 'sha256-...'.
 */
export function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();

  for (const token of policy.split(';')) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    // Split directive name from values
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) {
      // Directive with no values: e.g., "upgrade-insecure-requests"
      directives.set(trimmed.toLowerCase(), []);
      continue;
    }

    const name = trimmed.slice(0, spaceIdx).toLowerCase();
    const valueStr = trimmed.slice(spaceIdx + 1).trim();

    // Parse values, respecting quoted tokens
    const values = parseCspValues(valueStr);
    directives.set(name, values);
  }

  return directives;
}

/**
 * Parse CSP value tokens, respecting quoted values (single quotes).
 * e.g., "'self' 'nonce-abc123' https://example.com 'sha256-...'"
 */
export function parseCspValues(valueStr: string): string[] {
  const values: string[] = [];
  let i = 0;

  while (i < valueStr.length) {
    // Skip whitespace
    while (i < valueStr.length && valueStr[i] === ' ') {
      i++;
    }
    if (i >= valueStr.length) break;

    if (valueStr[i] === "'") {
      // Quoted value — find closing quote
      const end = valueStr.indexOf("'", i + 1);
      if (end === -1) {
        // Unmatched quote — take the rest
        values.push(valueStr.slice(i));
        break;
      }
      values.push(valueStr.slice(i, end + 1));
      i = end + 1;
    } else {
      // Unquoted value — find next space
      const end = valueStr.indexOf(' ', i);
      if (end === -1) {
        values.push(valueStr.slice(i));
        break;
      }
      values.push(valueStr.slice(i, end));
      i = end;
    }
  }

  return values;
}

/**
 * Serialize a Map of directives back to a CSP header value string.
 * Preserves directive ordering.
 */
export function serializeCsp(directives: Map<string, string[]>): string {
  const parts: string[] = [];
  for (const [name, values] of directives) {
    if (values.length === 0) {
      parts.push(name);
    } else {
      parts.push(`${name} ${values.join(' ')}`);
    }
  }
  return parts.join('; ');
}

/**
 * Modify a CSP policy to include the overlay's nonce in script-src
 * and the proxy origin in connect-src for WebSocket connectivity.
 *
 * Returns the modified policy string, or null if the input was empty.
 */
export function modifyEnforcementCsp(
  policy: string | undefined | null,
  nonce: string,
  proxyOrigin: string,
): string | null {
  if (!policy) return null;

  const directives = parseCsp(policy);
  const nonceToken = `'nonce-${nonce}'`;

  // Ensure script-src includes the nonce
  if (directives.has('script-src')) {
    const current = directives.get('script-src')!;
    if (!current.includes(nonceToken)) {
      directives.set('script-src', [...current, nonceToken]);
    }
  } else if (directives.has('default-src')) {
    // default-src covers script-src if no explicit script-src
    const current = directives.get('default-src')!;
    const newValues = [...current, nonceToken];
    directives.set('script-src', newValues);
  } else {
    // No script-src and no default-src: add script-src with 'self' + nonce
    directives.set('script-src', ["'self'", nonceToken]);
  }

  // Ensure connect-src includes the proxy origin for WebSocket
  if (directives.has('connect-src')) {
    const current = directives.get('connect-src')!;
    if (!current.includes(proxyOrigin)) {
      directives.set('connect-src', [...current, proxyOrigin]);
    }
  } else if (directives.has('default-src')) {
    const current = directives.get('default-src')!;
    const newValues = [...current, proxyOrigin];
    directives.set('connect-src', newValues);
  } else {
    directives.set('connect-src', ["'self'", proxyOrigin]);
  }

  return serializeCsp(directives);
}
