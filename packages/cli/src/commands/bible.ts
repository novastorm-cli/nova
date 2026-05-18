import { StructuredLogger } from '@novastorm-ai/core';

const logger = new StructuredLogger({ isTTY: process.stderr?.isTTY ?? false });

const BIBLE_TEXT = `
╔══════════════════════════════════════════════════════════════╗
║  [DOCUMENT_CLASS: MANIFESTO]  [STATUS: DECLASSIFIED]     ║
╚══════════════════════════════════════════════════════════════╝

Ambient Development
A manifesto for a new approach to building software
──────────────────────────────────────────────────────────────

PART I -- The problem everyone is solving from the wrong end

We live in an era where AI can write code. GPT, Claude, Gemini, dozens
of models -- all generating functions, components, entire applications.
Every month a new tool appears. Each one promises a revolution. Each
one does the same thing -- helps turn text into code faster.

And here's the paradox: code was never the real bottleneck.

  [RESEARCH] Bain 2025 -- Where time actually goes
  Writing & testing code ....... 25-35%
  Everything else ............. 65-75%
  (Understanding, formulation, review, integration, deploy)

By speeding up code generation 10x, we only sped up the entire
process by 20-30%.

  Traditional  → write code
  Vibe coding  → write prompt
  Spec-driven  → write spec
  Visual-first → click in special editor
  Ambient      → just use your app

──────────────────────────────────────────────────────────────

PART II -- What is Ambient Development

Ambient Development -- an approach to building software where the
system continuously observes the application in use and builds it
out across every level of the stack based on user behavior, voice
commands, and visual cues.

  ♪  Ambient Music     -- Creates atmosphere. Doesn't demand attention.
  ◐  Ambient Lighting  -- Creates space. You don't think about bulbs.
  ◈  Ambient Computing -- Smart home, sensors. You live, it adapts.
  ⌘  Ambient Dev       -- You use the product. Development happens around you.

You stop switching between the role of user and the role of developer.
You are always the user. Development is ambient.

──────────────────────────────────────────────────────────────

PART III -- Five principles

01 Usage as specification
   The best specification is not one written in a document. The best
   specification is a person's behavior inside the product.

   [behavior] click on empty space → expects something there
   [behavior] repeat action 5x → needs automation
   [behavior] open page, leave in 1s → page doesn't deliver
   [ambient]  behavior never lies. behavior is the spec.

02 Full stack vertical
   When you say "add a customers table with search," you don't mean
   "create a React component." You mean: I want to see my customers,
   and I want it to work.

   UI Component ↕ API Endpoint ↕ Database Query ↕ Migration

03 Three simultaneous modes
   PASSIVE 👁  -- Silently observes. Suggests improvements.
   VOICE   🎤 -- Say what you need without switching context.
   VISUAL  👆 -- Click, circle, drag. Point and speak.
   All three work simultaneously. Not switches -- layers.

04 Speed lanes
   LANE 1 <2s    -- CSS, texts, configs. No AI. Pattern matching.
   LANE 2 10-30s -- Single-file changes. Fast model.
   LANE 3 1-5min -- Multi-file features. Strong model.
   LANE 4 min-hrs -- Background refactoring. Async.

05 Stack-agnostic
   [scan] package.json → Next.js + TypeScript
   [scan] .csproj → C# backend
   [scan] docker-compose.yml → PostgreSQL
   [ready] Stack detected. Ambient mode activated.

──────────────────────────────────────────────────────────────

PART IV -- What it looks like in practice

  MORNING
  [you]     open SaaS. check dashboard. "this table is slow."
  [ambient] found: SELECT * without pagination
  [lane 3] generating optimized query + pagination
  [done]    hot reload. table loads instantly. 2 minutes.

  DAY
  [you]     "Save button too small on mobile"
  [lane 1] CSS injection. done. instant.
  [you]     "Add timezone picker to project form"
  [lane 2] component + API field. 20 seconds.

  EVENING
  [summary] 4 instant fixes | 2 fast changes | 1 feature
  [result]  zero IDE. zero prompts. zero context switches.

  NIGHT
  [you]     "Refactor auth module -- split into services"
  [lane 4] background. agent running...
  [morning] PR ready. all tests green.

──────────────────────────────────────────────────────────────

PART V -- Who is this for

  ✓ Solo developer building a SaaS
  ✓ Startup team of 2-5 shipping daily
  ✓ Agency creating 10+ projects a year
  ✓ CTO prototyping ideas before allocating the team
  ✓ Enterprise teams looking for a multiplier

──────────────────────────────────────────────────────────────

PART VI -- The future

What happens when you remove the formulation step entirely?

  Total time per task  ↓ 60-70%
  Context switches     → 0
  Time-to-feedback     seconds, not hours

Code generation was step one. Ambient development is step two.
Not "write code faster." Stop writing altogether.

══════════════════════════════════════════════════════════════
  Read the full version with infographics:
  https://cli.novastorm.ai/bible/

  GitHub:  https://github.com/novastorm-cli/nova
  npm:     npm install -g @novastorm-ai/cli
  X:       https://x.com/upranevich
  TG:      https://t.me/novastormcli
══════════════════════════════════════════════════════════════
`;

// eslint-disable-next-line @typescript-eslint/require-await
export async function bibleCommand(subcommand?: string): Promise<void> {
  if (subcommand === '--read' || subcommand === 'read' || !subcommand) {
    logger.info(BIBLE_TEXT);
  } else {
    logger.warn(`Unknown subcommand: ${subcommand}`);
    logger.info('Usage: nova bible [--read]');
  }
}
