import { execSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface ScaffoldOption {
  label: string;
  command: string;
  needsInstall: boolean;
}

export const SCAFFOLD_PRESETS: ScaffoldOption[] = [
  {
    label: 'Next.js + TypeScript',
    command: 'npx create-next-app@latest . --typescript --tailwind --eslint --app --use-npm --no-git --no-src-dir --yes',
    needsInstall: false,
  },
  {
    label: 'Vite + React + TypeScript',
    command: 'npm create vite@latest . -- --template react-ts',
    needsInstall: true,
  },
  {
    label: 'Vite + Vue + TypeScript',
    command: 'npm create vite@latest . -- --template vue-ts',
    needsInstall: true,
  },
  {
    label: 'Astro',
    command: 'npm create astro@latest . -- --template basics --install --no-git --typescript strict --yes',
    needsInstall: false,
  },
  {
    label: 'SvelteKit',
    command: 'npx sv create . --template minimal --types ts --no-install --no-add-ons',
    needsInstall: true,
  },
  {
    label: 'Nuxt 3',
    command: 'npx nuxi@latest init . --no-install --gitInit false',
    needsInstall: true,
  },
  {
    label: 'Express + TypeScript',
    command: 'npm init -y && npm install express && npm install -D typescript @types/express @types/node tsx',
    needsInstall: false,
  },
];

export class ProjectScaffolder {
  /**
   * Run a scaffold command in the given directory.
   * @param projectPath - directory to scaffold in
   * @param command - shell command to execute
   * @param needsInstall - whether to run `npm install` after
   */
  async scaffold(projectPath: string, command: string, needsInstall: boolean = false): Promise<void> {
    await mkdir(projectPath, { recursive: true });

    execSync(command, {
      cwd: projectPath,
      stdio: 'inherit',
      timeout: 300_000,
    });

    if (needsInstall) {
      execSync('npm install', {
        cwd: projectPath,
        stdio: 'inherit',
        timeout: 300_000,
      });
    }
  }

  /**
   * Create a minimal nova.toml only (for manual setup).
   */
  async scaffoldEmpty(projectPath: string): Promise<void> {
    await mkdir(projectPath, { recursive: true });
    await writeFile(
      join(projectPath, 'nova.toml'),
      `# Nova Architect configuration\n\n[project]\ndevCommand = ""\nport = 3000\n`,
      'utf-8',
    );
  }
}
