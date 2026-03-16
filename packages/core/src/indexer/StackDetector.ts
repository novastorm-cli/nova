import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { IStackDetector } from '../contracts/IIndexer.js';
import type { StackInfo } from '../models/types.js';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

const FRAMEWORK_DEPS: ReadonlyArray<{ dep: string; framework: string }> = [
  { dep: 'next', framework: 'next.js' },
  { dep: 'nuxt', framework: 'nuxt' },
  { dep: '@sveltejs/kit', framework: 'sveltekit' },
  { dep: 'astro', framework: 'astro' },
  { dep: 'vite', framework: 'vite' },
  { dep: 'react-scripts', framework: 'cra' },
];

const PYTHON_FRAMEWORKS: ReadonlyArray<{ dep: string; framework: string }> = [
  { dep: 'django', framework: 'django' },
  { dep: 'fastapi', framework: 'fastapi' },
  { dep: 'flask', framework: 'flask' },
];

const DEFAULT_PORTS: Record<string, number> = {
  'next.js': 3000,
  'cra': 3000,
  'nuxt': 3000,
  'sveltekit': 5173,
  'astro': 4321,
  'vite': 5173,
  'dotnet': 5000,
  'django': 8000,
  'fastapi': 8000,
  'flask': 5000,
};

export class StackDetector implements IStackDetector {
  async detectStack(projectPath: string): Promise<StackInfo> {
    // 1. Check package.json
    const pkgResult = await this.detectFromPackageJson(projectPath);
    if (pkgResult) {
      return pkgResult;
    }

    // 2. Check *.csproj for .NET
    if (await this.hasCsproj(projectPath)) {
      const typescript = await this.hasTypescript(projectPath);
      return { framework: 'dotnet', language: 'csharp', typescript };
    }

    // 3. Check Python
    const pythonFramework = await this.detectPython(projectPath);
    if (pythonFramework) {
      return { framework: pythonFramework, language: 'python', typescript: false };
    }

    // 4. Check go.mod
    if (await this.fileExists(join(projectPath, 'go.mod'))) {
      return { framework: 'go', language: 'go', typescript: false };
    }

    // 5. Check Cargo.toml
    if (await this.fileExists(join(projectPath, 'Cargo.toml'))) {
      return { framework: 'rust', language: 'rust', typescript: false };
    }

    return { framework: 'unknown', language: 'unknown', typescript: false };
  }

  async detectDevCommand(stack: StackInfo, projectPath: string): Promise<string> {
    const { framework, language, packageManager } = stack;

    // Node.js frameworks
    if (language === 'typescript' || language === 'javascript') {
      const pkg = await this.readPackageJson(projectPath);
      if (!pkg?.scripts) return '';

      const scriptName = pkg.scripts['dev'] ? 'dev' : pkg.scripts['start'] ? 'start' : '';
      if (!scriptName) return '';

      const pm = packageManager ?? 'npm';
      return pm === 'npm' ? `npm run ${scriptName}` : `${pm} ${scriptName}`;
    }

    if (framework === 'dotnet') {
      return 'dotnet run';
    }

    if (framework === 'django') {
      return 'python manage.py runserver';
    }

    if (framework === 'fastapi') {
      return 'uvicorn main:app --reload';
    }

    if (framework === 'flask') {
      return 'flask run';
    }

    return '';
  }

  async detectPort(stack: StackInfo, projectPath: string): Promise<number> {
    // Try reading from config files
    const configPort = await this.readPortFromConfig(stack, projectPath);
    if (configPort) return configPort;

    // Framework defaults
    return DEFAULT_PORTS[stack.framework] ?? 3000;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async detectFromPackageJson(projectPath: string): Promise<StackInfo | null> {
    const pkg = await this.readPackageJson(projectPath);
    if (!pkg) return null;

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const framework = FRAMEWORK_DEPS.find((f) => f.dep in allDeps);
    if (!framework) return null;

    const typescript = await this.hasTypescript(projectPath);
    const packageManager = await this.detectPackageManager(projectPath);

    return {
      framework: framework.framework,
      language: typescript ? 'typescript' : 'javascript',
      packageManager,
      typescript,
    };
  }

  private async hasCsproj(projectPath: string): Promise<boolean> {
    try {
      const entries = await readdir(projectPath);
      return entries.some((e) => e.endsWith('.csproj'));
    } catch {
      return false;
    }
  }

  private async detectPython(projectPath: string): Promise<string | null> {
    const requirementsContent = await this.readFileSafe(join(projectPath, 'requirements.txt'));
    const pyprojectContent = await this.readFileSafe(join(projectPath, 'pyproject.toml'));

    const content = `${requirementsContent}\n${pyprojectContent}`.toLowerCase();
    if (!requirementsContent && !pyprojectContent) return null;

    for (const { dep, framework } of PYTHON_FRAMEWORKS) {
      if (content.includes(dep)) return framework;
    }

    // Has Python config files but no known framework
    return 'python';
  }

  private async detectPackageManager(projectPath: string): Promise<string> {
    if (await this.fileExists(join(projectPath, 'bun.lockb'))) return 'bun';
    if (await this.fileExists(join(projectPath, 'bun.lock'))) return 'bun';
    if (await this.fileExists(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
    if (await this.fileExists(join(projectPath, 'yarn.lock'))) return 'yarn';
    return 'npm';
  }

  private async hasTypescript(projectPath: string): Promise<boolean> {
    if (await this.fileExists(join(projectPath, 'tsconfig.json'))) {
      return true;
    }

    // Also check if typescript is listed as a dependency
    const pkg = await this.readPackageJson(projectPath);
    if (!pkg) return false;

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    return 'typescript' in allDeps;
  }

  private async readPortFromConfig(
    stack: StackInfo,
    projectPath: string,
  ): Promise<number | null> {
    try {
      if (stack.framework === 'next.js') {
        return await this.readPortFromNextConfig(projectPath);
      }

      if (stack.framework === 'vite') {
        return await this.readPortFromViteConfig(projectPath);
      }

      if (stack.framework === 'dotnet') {
        return await this.readPortFromLaunchSettings(projectPath);
      }
    } catch {
      // Fall through to default
    }
    return null;
  }

  private async readPortFromNextConfig(projectPath: string): Promise<number | null> {
    for (const name of ['next.config.js', 'next.config.mjs', 'next.config.ts']) {
      const content = await this.readFileSafe(join(projectPath, name));
      if (!content) continue;

      // Match patterns like port: 4000 or --port 4000
      const match = content.match(/port\s*[:=]\s*(\d+)/);
      if (match) return parseInt(match[1], 10);
    }
    return null;
  }

  private async readPortFromViteConfig(projectPath: string): Promise<number | null> {
    for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']) {
      const content = await this.readFileSafe(join(projectPath, name));
      if (!content) continue;

      const match = content.match(/port\s*[:=]\s*(\d+)/);
      if (match) return parseInt(match[1], 10);
    }
    return null;
  }

  private async readPortFromLaunchSettings(projectPath: string): Promise<number | null> {
    const content = await this.readFileSafe(
      join(projectPath, 'Properties', 'launchSettings.json'),
    );
    if (!content) return null;

    // Extract port from applicationUrl
    const match = content.match(/localhost:(\d+)/);
    if (match) return parseInt(match[1], 10);
    return null;
  }

  private async readPackageJson(projectPath: string): Promise<PackageJson | null> {
    const content = await this.readFileSafe(join(projectPath, 'package.json'));
    if (!content) return null;

    try {
      return JSON.parse(content) as PackageJson;
    } catch {
      return null;
    }
  }

  private async readFileSafe(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
