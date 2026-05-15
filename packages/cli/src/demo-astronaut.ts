/**
 * Cute minimal astronaut greeting for Nova CLI.
 * Run:  npx tsx packages/cli/src/demo-astronaut.ts
 */

const ESC = "\x1b";
const reset = `${ESC}[0m`;
const cyan = (s: string) => `${ESC}[96m${s}${reset}`;
const dim = (s: string) => `${ESC}[2m${s}${reset}`;

const frames = [
  // Frame 0: hands down
  [
    `  ┌─────┐`,
    `  │ ${cyan("●")} ${cyan("●")} │`,
    `  │  ◡  │`,
    `  └──┬──┘`,
    `  ┌──┴──┐`,
    `  │  ◦  │`,
    `  └┬───┬┘`,
    `   │   │`,
  ],
  // Frame 1: hand out
  [
    `  ┌─────┐`,
    `  │ ${cyan("●")} ${cyan("●")} │`,
    `  │  ◡  │`,
    `  └──┬──┘`,
    `──┤  ┴  ├`,
    `  │  ◦  │`,
    `  └┬───┬┘`,
    `   │   │`,
  ],
  // Frame 2: hand up
  [
    `╷ ┌─────┐`,
    `│ │ ${cyan("●")} ${cyan("●")} │`,
    `╵ │  ◡  │`,
    `  └──┬──┘`,
    `  ┌──┴──┐`,
    `  │  ◦  │`,
    `  └┬───┬┘`,
    `   │   │`,
  ],
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function run(): Promise<void> {
  const greeting = `  ${cyan("Привет! Я Nova")} 🚀\n`;
  const sequence = [0, 1, 2, 1, 2, 1, 0];
  const hide = `${ESC}[?25l`;
  const show = `${ESC}[?25h`;
  const up = (n: number) => `${ESC}[${n}A`;
  const cl = `${ESC}[2K`;

  const h = frames[0]!.length;

  process.stdout.write(hide);
  process.on("SIGINT", () => { process.stdout.write(show); process.exit(0); });

  process.stdout.write("\n" + greeting);
  for (const line of frames[0]!) process.stdout.write(line + "\n");
  process.stdout.write("\n");

  await sleep(400);

  for (const fi of sequence) {
    process.stdout.write(up(h + 1));
    for (const line of frames[fi]!) process.stdout.write(cl + line + "\n");
    process.stdout.write(cl);
    await sleep(250);
  }

  process.stdout.write(show + "\n");
}

run().catch(() => { process.stdout.write(`${ESC}[?25h`); });
