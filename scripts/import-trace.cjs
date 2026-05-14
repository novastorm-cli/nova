/**
 * Import trace shim — logs every Module._load call to stderr.
 *
 * Usage:
 *   NODE_OPTIONS='--require ./scripts/import-trace.cjs' node packages/cli/dist/bin/nova.js --version
 *
 * Or directly:
 *   node --require ./scripts/import-trace.cjs packages/cli/dist/bin/nova.js --version
 *
 * The tracer does NOT follow dynamic import() calls (those are handled by V8's
 * async module loader, not Module._load).  This is intentional — we only want to
 * trace the synchronous / eagerly-loaded modules.
 */
const Module = require('node:module');

const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  // Log to stderr so we don't pollute stdout (which may carry the version string).
  process.stderr.write(`[import-trace] ${request}\n`);
  return originalLoad.apply(this, arguments);
};
