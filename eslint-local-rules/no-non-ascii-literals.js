/**
 * ESLint rule: no-non-ascii-literals
 *
 * Bans string literals containing non-ASCII characters,
 * forcing all user-visible strings into designated strings modules.
 */
export const noNonAsciiLiterals = {
  meta: {
    type: /** @type {const} */ ('problem'),
    docs: {
      description: 'Disallow non-ASCII characters in string literals',
    },
    schema: [],
    messages: {
      nonAscii:
        'Non-ASCII character found in string literal. Extract user-visible strings into a designated strings module (packages/overlay/src/ui/strings.ts or packages/cli/src/strings.ts).',
    },
  },

  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === 'string' && /[^\x00-\x7F]/.test(node.value)) {
          context.report({ node, messageId: 'nonAscii' });
        }
      },
      TemplateLiteral(node) {
        // Check quasi values in template literals
        for (const quasi of node.quasis) {
          if (/[^\x00-\x7F]/.test(quasi.value.raw)) {
            context.report({ node: quasi, messageId: 'nonAscii' });
            return; // one report per template literal is enough
          }
        }
      },
    };
  },
};
