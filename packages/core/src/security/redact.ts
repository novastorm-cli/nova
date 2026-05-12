/**
 * Redacts API keys and other known secret patterns from text.
 * Used by the logger to prevent secrets from leaking into logs,
 * stdout, stderr, and debug output.
 *
 * Patterns handled:
 * - sk-ant- (Anthropic-specific prefix, allows hyphens/underscores)
 * - sk-deepseek- (DeepSeek-specific prefix)
 * - sk-or- (OpenRouter keys, allows hyphens in suffix)
 * - sk- (Generic: OpenAI sk-proj-/sk-admin-/sk-svcacct- etc., allows hyphens)
 * - gho_ (GitHub OAuth tokens)
 * - AIza (Google API keys)
 * - hf_ (HuggingFace tokens)
 * - xai- (xAI/Grok keys)
 *
 * Patterns are ordered from most-specific to least-specific to ensure
 * vendor-specific prefixes match before the generic sk- catch-all.
 * The minimum suffix length of 20+ chars avoids false positives on
 * short identifiers like "sk-length".
 */

// Ordered from most-specific to least-specific to avoid partial matches.
// Each pattern captures the full key so it can be replaced wholesale.
const SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // Anthropic: sk-ant-api03-XXXX...  (allows hyphens and underscores)
  { regex: /sk-ant-[A-Za-z0-9_-]{20,}/g, replacement: 'sk-ant-***' },
  // DeepSeek: sk-deepseek-XXXX...
  { regex: /sk-deepseek-[A-Za-z0-9]{20,}/g, replacement: 'sk-deepseek-***' },
  // OpenRouter: sk-or-v1-XXXX...  (allows hyphens in suffix)
  { regex: /sk-or-[A-Za-z0-9-]{20,}/g, replacement: 'sk-or-***' },
  // Generic sk- keys (OpenAI sk-proj-..., sk-admin-..., sk-svcacct-..., etc.)
  // Allows hyphens after the sk- prefix to handle sk-proj-, sk-admin-, etc.
  { regex: /sk-[A-Za-z0-9-]{20,}/g, replacement: 'sk-***' },
  // GitHub OAuth: gho_XXXX...
  { regex: /gho_[A-Za-z0-9]{20,}/g, replacement: 'gho_***' },
  // Google API: AIzaXXXX...
  { regex: /AIza[0-9A-Za-z\-_]{20,}/g, replacement: 'AIza***' },
  // HuggingFace: hf_XXXX...
  { regex: /hf_[A-Za-z0-9]{20,}/g, replacement: 'hf_***' },
  // xAI / Grok: xai-XXXX...
  { regex: /xai-[A-Za-z0-9]{20,}/g, replacement: 'xai-***' },
];

/**
 * Redacts known API key patterns from the given text.
 * Each recognized key is replaced with a redacted placeholder like `sk-***`.
 *
 * @param text - The text to scan and redact
 * @returns The text with all known key patterns replaced
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const { regex, replacement } of SECRET_PATTERNS) {
    result = result.replace(regex, replacement);
  }
  return result;
}

/**
 * Deep-redacts a context object, replacing secrets in all string values.
 * Returns a new object; does not mutate the input.
 *
 * @param context - Object whose string values should be redacted
 * @returns A new object with any secret-bearing values redacted
 */
export function redactContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === 'string') {
      result[key] = redactSecrets(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
