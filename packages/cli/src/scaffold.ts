import chalk from 'chalk';
import ora from 'ora';
import { select, input } from '@inquirer/prompts';
import { Separator } from '@inquirer/prompts';
import { ProjectScaffolder, SCAFFOLD_PRESETS } from '@nova-architect/core';

/**
 * Prompt the user to select a project template and scaffold it.
 * Returns true if a project was scaffolded (caller should re-detect stack),
 * or false if the user chose 'empty' (manual setup, no re-detect needed).
 */
export async function promptAndScaffold(projectPath: string): Promise<boolean> {
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
    return false;
  }

  let command: string;
  let needsInstall = false;
  let label: string;

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
      return false;
    }

    const mapped = mapDescriptionToCommand(description.trim());
    command = mapped.command;
    needsInstall = mapped.needsInstall;
    label = description.trim();
  } else {
    // Preset selected
    const preset = SCAFFOLD_PRESETS.find((p) => p.label === selection);
    if (!preset) {
      console.log(chalk.red('Unknown template. Exiting.'));
      return false;
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
    return true;
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
 * Maps a free-text project description to a scaffold command.
 */
function mapDescriptionToCommand(desc: string): { command: string; needsInstall: boolean } {
  const d = desc.toLowerCase();

  if (d.includes('next')) return { command: 'npx create-next-app@latest . --typescript --tailwind --eslint --app --use-npm --no-git --no-src-dir --yes', needsInstall: false };
  if (d.includes('remix')) return { command: 'npx create-remix@latest . --no-git-init --no-install', needsInstall: true };
  if ((d.includes('react') || d.includes('vite')) && !d.includes('vue') && !d.includes('svelte')) return { command: 'npm create vite@latest . -- --template react-ts', needsInstall: true };
  if (d.includes('vue') && d.includes('nuxt')) return { command: 'npx nuxi@latest init . --no-install --gitInit false', needsInstall: true };
  if (d.includes('vue')) return { command: 'npm create vite@latest . -- --template vue-ts', needsInstall: true };
  if (d.includes('svelte')) return { command: 'npx sv create . --template minimal --types ts --no-install --no-add-ons', needsInstall: true };
  if (d.includes('astro')) return { command: 'npm create astro@latest . -- --template basics --install --no-git --typescript strict --yes', needsInstall: false };
  if (d.includes('solid')) return { command: 'npx degit solidjs/templates/ts .', needsInstall: true };
  if (d.includes('express')) return { command: 'npm init -y && npm install express && npm install -D typescript @types/express @types/node tsx', needsInstall: false };
  if (d.includes('fastify')) return { command: 'npm init -y && npm install fastify && npm install -D typescript @types/node tsx', needsInstall: false };
  if (d.includes('hono')) return { command: 'npm create hono@latest . -- --template nodejs', needsInstall: true };
  if (d.includes('django')) return { command: 'pip install django && django-admin startproject app .', needsInstall: false };
  if (d.includes('fastapi') || d.includes('fast api')) return { command: 'pip install fastapi uvicorn && mkdir app && echo "from fastapi import FastAPI\\napp = FastAPI()" > app/main.py', needsInstall: false };
  if (d.includes('flask')) return { command: 'pip install flask && echo "from flask import Flask\\napp = Flask(__name__)" > app.py', needsInstall: false };
  if (d.includes('.net') || d.includes('dotnet') || d.includes('c#') || d.includes('csharp')) return { command: 'dotnet new web', needsInstall: false };
  if (d.includes('go') && (d.includes('fiber') || d.includes('gin') || d.includes('echo'))) return { command: 'go mod init app && go get github.com/gofiber/fiber/v2', needsInstall: false };
  if (d.includes('go')) return { command: 'go mod init app', needsInstall: false };

  return { command: 'npm init -y', needsInstall: false };
}
