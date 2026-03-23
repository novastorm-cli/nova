import chalk from 'chalk';
import ora from 'ora';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { select, input } from '@inquirer/prompts';
import { Separator } from '@inquirer/prompts';
import { ProjectScaffolder, SCAFFOLD_PRESETS } from '@novastorm-ai/core';

export interface ScaffoldInfo {
  scaffolded: boolean;
  frontend?: string;
  backends?: string[];
}

/**
 * Prompt the user to select a project template and scaffold it.
 * Returns scaffold info including frontend/backends directories for multi-stack projects.
 */
export async function promptAndScaffold(projectPath: string): Promise<ScaffoldInfo> {
  console.log(
    chalk.yellow('\nNo project detected.') +
    ' What would you like to create?\n',
  );

  let selection: string;
  try {
    selection = await select({
      message: 'Select a project template:',
      choices: [
        ...SCAFFOLD_PRESETS.map((p) => ({ name: p.label, value: p.label })),
        new Separator(),
        { name: 'Other (type your own command)', value: '__other__' },
        { name: 'Empty (I\'ll set up manually)', value: '__empty__' },
      ],
    });
  } catch {
    console.log('\nCancelled.');
    process.exit(0);
  }

  // Empty — just create nova.toml
  if (selection === '__empty__') {
    const scaffolder = new ProjectScaffolder();
    await scaffolder.scaffoldEmpty(projectPath);
    console.log(
      chalk.green('\nCreated nova.toml.') +
      ' Configure your project and run ' +
      chalk.cyan('nova') +
      ' again.',
    );
    return { scaffolded: false };
  }

  let command: string;
  let needsInstall = false;
  let label: string;
  let frontend: string | undefined;
  let backends: string[] | undefined;

  if (selection === '__other__') {
    let description: string;
    try {
      description = await input({
        message: 'Describe the project (e.g. "React + Tailwind", "Django REST API", "Go fiber server"):',
      });
    } catch {
      console.log('\nCancelled.');
      process.exit(0);
    }

    if (!description.trim()) {
      console.log(chalk.red('No description provided. Exiting.'));
      return { scaffolded: false };
    }

    const mapped = mapDescriptionToCommand(description.trim());
    command = mapped.command;
    needsInstall = mapped.needsInstall;
    frontend = mapped.frontend;
    backends = mapped.backends;
    label = description.trim();
  } else {
    // Preset selected
    const preset = SCAFFOLD_PRESETS.find((p) => p.label === selection);
    if (!preset) {
      console.log(chalk.red('Unknown template. Exiting.'));
      return { scaffolded: false };
    }
    command = preset.command;
    needsInstall = preset.needsInstall;
    label = preset.label;
  }

  const spinner = ora(`Scaffolding ${label}...`).start();

  try {
    const scaffolder = new ProjectScaffolder();
    await scaffolder.scaffold(projectPath, command, needsInstall);
    spinner.succeed(`Project scaffolded: ${label}`);

    // Write frontend/backends to nova.toml for multi-stack projects
    if (frontend || backends) {
      const tomlPath = join(projectPath, 'nova.toml');
      let toml = '';
      try { toml = await readFile(tomlPath, 'utf-8'); } catch { /* file may not exist yet */ }

      const lines: string[] = [];
      if (frontend && !toml.includes('frontend =')) {
        lines.push(`frontend = "${frontend}"`);
      }
      if (backends && backends.length > 0 && !toml.includes('backends =')) {
        lines.push(`backends = [${backends.map(b => `"${b}"`).join(', ')}]`);
      }

      if (lines.length > 0) {
        if (toml.includes('[project]')) {
          // Append under [project] section
          toml = toml.replace('[project]', `[project]\n${lines.join('\n')}`);
        } else {
          toml += `\n[project]\n${lines.join('\n')}\n`;
        }
        await writeFile(tomlPath, toml, 'utf-8');
      }
    }

    return { scaffolded: true, frontend, backends };
  } catch (err) {
    spinner.fail('Failed to scaffold project.');
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`\nError: ${message}`));
    console.error(
      chalk.dim('Make sure npx/npm is available and you have an internet connection.'),
    );
    process.exit(1);
  }
}

/**
 * Known tech stacks with their scaffold commands.
 * Frontend techs create in root, backend techs create in backend/ subfolder (if frontend exists).
 */
interface TechEntry {
  keywords: string[];
  command: (dir: string) => string;
  needsInstall: boolean;
  type: 'frontend' | 'backend' | 'fullstack';
}

const KNOWN_TECHS: TechEntry[] = [
  // Frontend
  { keywords: ['next'], command: (d) => `npx create-next-app@latest ${d} --typescript --tailwind --eslint --app --use-npm --no-git --no-src-dir --yes`, needsInstall: false, type: 'frontend' },
  { keywords: ['remix'], command: (d) => `npx create-remix@latest ${d} --no-git-init --no-install`, needsInstall: true, type: 'frontend' },
  { keywords: ['react', 'vite'], command: (d) => `npm create vite@latest ${d} -- --template react-ts`, needsInstall: true, type: 'frontend' },
  { keywords: ['nuxt'], command: (d) => `npx nuxi@latest init ${d} --no-install --gitInit false`, needsInstall: true, type: 'frontend' },
  { keywords: ['vue'], command: (d) => `npm create vite@latest ${d} -- --template vue-ts`, needsInstall: true, type: 'frontend' },
  { keywords: ['svelte'], command: (d) => `npx sv create ${d} --template minimal --types ts --no-install --no-add-ons`, needsInstall: true, type: 'frontend' },
  { keywords: ['astro'], command: (d) => `npm create astro@latest ${d} -- --template basics --install --no-git --typescript strict --yes`, needsInstall: false, type: 'frontend' },
  { keywords: ['solid'], command: (d) => `npx degit solidjs/templates/ts ${d}`, needsInstall: true, type: 'frontend' },
  // Backend
  { keywords: ['.net', 'dotnet', 'c#', 'csharp'], command: (d) => `dotnet new webapi -o ${d}`, needsInstall: false, type: 'backend' },
  { keywords: ['express'], command: (d) => `mkdir -p ${d} && cd ${d} && npm init -y && npm install express && npm install -D typescript @types/express @types/node tsx`, needsInstall: false, type: 'backend' },
  { keywords: ['fastify'], command: (d) => `mkdir -p ${d} && cd ${d} && npm init -y && npm install fastify && npm install -D typescript @types/node tsx`, needsInstall: false, type: 'backend' },
  { keywords: ['hono'], command: (d) => `npm create hono@latest ${d} -- --template nodejs`, needsInstall: true, type: 'backend' },
  { keywords: ['django'], command: (d) => `pip install django && django-admin startproject app ${d}`, needsInstall: false, type: 'backend' },
  { keywords: ['fastapi', 'fast api'], command: (d) => `mkdir -p ${d}/app && pip install fastapi uvicorn && echo "from fastapi import FastAPI\\napp = FastAPI()" > ${d}/app/main.py`, needsInstall: false, type: 'backend' },
  { keywords: ['flask'], command: (d) => `mkdir -p ${d} && pip install flask && echo "from flask import Flask\\napp = Flask(__name__)" > ${d}/app.py`, needsInstall: false, type: 'backend' },
  { keywords: ['go', 'fiber'], command: (d) => `mkdir -p ${d} && cd ${d} && go mod init app && go get github.com/gofiber/fiber/v2`, needsInstall: false, type: 'backend' },
  { keywords: ['go', 'gin'], command: (d) => `mkdir -p ${d} && cd ${d} && go mod init app && go get github.com/gin-gonic/gin`, needsInstall: false, type: 'backend' },
  { keywords: ['go'], command: (d) => `mkdir -p ${d} && cd ${d} && go mod init app`, needsInstall: false, type: 'backend' },
];

/**
 * Maps a free-text project description to scaffold commands.
 * Supports multi-tech combos like "Next.js + C#" → frontend in ./ + backend in ./backend/
 */
export interface ScaffoldResult {
  command: string;
  needsInstall: boolean;
  frontend?: string;
  backends?: string[];
}

function mapDescriptionToCommand(desc: string): ScaffoldResult {
  const d = desc.toLowerCase();

  // Find all matching techs
  const matched: TechEntry[] = [];
  for (const tech of KNOWN_TECHS) {
    if (tech.keywords.some(kw => d.includes(kw))) {
      // Don't double-match (e.g. "react" + "vite" both matched by one entry)
      const alreadyHasType = matched.some(m => m.type === tech.type && m.keywords.some(k => tech.keywords.includes(k)));
      if (!alreadyHasType) {
        matched.push(tech);
      }
    }
  }

  if (matched.length === 0) {
    return { command: 'npm init -y', needsInstall: false };
  }

  // Single tech
  if (matched.length === 1) {
    const result: ScaffoldResult = { command: matched[0].command('.'), needsInstall: matched[0].needsInstall };
    if (matched[0].type === 'backend') {
      result.backends = ['.'];
    }
    return result;
  }

  // Multi-tech: frontend in root, backend in backend/
  const frontend = matched.find(m => m.type === 'frontend');
  const backend = matched.find(m => m.type === 'backend');

  const commands: string[] = [];
  let needsInstall = false;

  if (frontend) {
    commands.push(frontend.command('.'));
    if (frontend.needsInstall) needsInstall = true;
  }

  if (backend) {
    commands.push(backend.command('backend'));
    if (backend.needsInstall) needsInstall = true;
  }

  // If both are same type (e.g. two backends), just run both
  if (!frontend && !backend) {
    for (const m of matched) {
      commands.push(m.command('.'));
      if (m.needsInstall) needsInstall = true;
    }
  }

  const result: ScaffoldResult = { command: commands.join(' && '), needsInstall };
  if (frontend) result.frontend = '.';
  if (backend) result.backends = ['backend'];
  return result;
}
