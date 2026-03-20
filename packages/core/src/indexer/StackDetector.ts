import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { IStackDetector } from '../contracts/IIndexer.js';
import type { StackInfo, DockerServiceInfo } from '../models/types.js';

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
  'rails': 3000,
  'sinatra': 4567,
  'ruby': 3000,
  'laravel': 8000,
  'symfony': 8000,
  'php': 8000,
  'spring-boot': 8080,
  'java': 8080,
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

    // 3.5. Check Gemfile for Ruby/Rails
    const rubyFramework = await this.detectRuby(projectPath);
    if (rubyFramework) {
      return { framework: rubyFramework, language: 'ruby', typescript: false };
    }

    // 3.6. Check composer.json for PHP/Laravel
    const phpFramework = await this.detectPhp(projectPath);
    if (phpFramework) {
      return { framework: phpFramework, language: 'php', typescript: false };
    }

    // 3.7. Check pom.xml/build.gradle for Java/Spring
    const javaFramework = await this.detectJava(projectPath);
    if (javaFramework) {
      return { framework: javaFramework, language: 'java', typescript: false };
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

    if (framework === 'rails') return 'bin/rails server';
    if (framework === 'sinatra') return 'ruby app.rb';
    if (framework === 'laravel') return 'php artisan serve';
    if (framework === 'symfony') return 'symfony server:start';
    if (framework === 'spring-boot') return './mvnw spring-boot:run';

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

      if (stack.framework === 'rails') {
        return await this.readPortFromPumaConfig(projectPath);
      }

      if (stack.framework === 'laravel') {
        return await this.readPortFromLaravelEnv(projectPath);
      }

      if (stack.framework === 'spring-boot') {
        return await this.readPortFromSpringConfig(projectPath);
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

  // ---------------------------------------------------------------------------
  // Ruby / Rails detection
  // ---------------------------------------------------------------------------

  private async detectRuby(projectPath: string): Promise<string | null> {
    const content = await this.readFileSafe(join(projectPath, 'Gemfile'));
    if (!content) return null;

    if (/gem\s+['"]rails['"]/.test(content)) return 'rails';
    if (/gem\s+['"]sinatra['"]/.test(content)) return 'sinatra';

    return 'ruby';
  }

  // ---------------------------------------------------------------------------
  // PHP / Laravel detection
  // ---------------------------------------------------------------------------

  private async detectPhp(projectPath: string): Promise<string | null> {
    const content = await this.readFileSafe(join(projectPath, 'composer.json'));
    if (!content) return null;

    try {
      const composer = JSON.parse(content) as { require?: Record<string, string> };
      const require = composer.require ?? {};

      if ('laravel/framework' in require) return 'laravel';
      if ('symfony/symfony' in require || 'symfony/framework-bundle' in require) return 'symfony';
    } catch {
      // Malformed JSON — fall through
    }

    return 'php';
  }

  // ---------------------------------------------------------------------------
  // Java / Spring detection
  // ---------------------------------------------------------------------------

  private async detectJava(projectPath: string): Promise<string | null> {
    const pomContent = await this.readFileSafe(join(projectPath, 'pom.xml'));
    if (pomContent) {
      if (pomContent.includes('spring-boot')) return 'spring-boot';
      return 'java';
    }

    for (const name of ['build.gradle', 'build.gradle.kts']) {
      const gradleContent = await this.readFileSafe(join(projectPath, name));
      if (gradleContent) {
        if (gradleContent.includes('spring-boot') || gradleContent.includes('org.springframework.boot')) {
          return 'spring-boot';
        }
        return 'java';
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Docker Compose detection
  // ---------------------------------------------------------------------------

  async detectDockerServices(projectPath: string): Promise<DockerServiceInfo[]> {
    const composeNames = [
      'docker-compose.yml',
      'docker-compose.yaml',
      'compose.yml',
      'compose.yaml',
    ];

    let content: string | null = null;
    for (const name of composeNames) {
      content = await this.readFileSafe(join(projectPath, name));
      if (content) break;
    }

    if (!content) return [];

    return this.parseDockerCompose(content);
  }

  private parseDockerCompose(content: string): DockerServiceInfo[] {
    const services: DockerServiceInfo[] = [];
    const lines = content.split('\n');

    let inServices = false;
    let currentService: string | null = null;
    let inPorts = false;
    let serviceIndent = 0;
    let portsIndent = 0;
    let currentBuild: string | undefined;
    let currentImage: string | undefined;
    let currentPorts: Array<{ host: number; container: number }> = [];

    const getIndent = (line: string): number => {
      const match = line.match(/^(\s*)/);
      return match ? match[1].length : 0;
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const indent = getIndent(line);

      // Detect "services:" top-level key
      if (/^services\s*:/.test(trimmed) && indent === 0) {
        inServices = true;
        continue;
      }

      if (!inServices) continue;

      // If indent is 0, we left the services block
      if (indent === 0) {
        // Flush last service
        if (currentService) {
          services.push({
            name: currentService,
            ports: currentPorts,
            buildContext: currentBuild,
            image: currentImage,
          });
        }
        inServices = false;
        continue;
      }

      // Detect a new service name (indent level 2, ends with ":")
      if (indent <= 2 && trimmed.endsWith(':') && !trimmed.startsWith('-')) {
        // Flush previous service
        if (currentService) {
          services.push({
            name: currentService,
            ports: currentPorts,
            buildContext: currentBuild,
            image: currentImage,
          });
        }

        currentService = trimmed.slice(0, -1).trim();
        serviceIndent = indent;
        inPorts = false;
        currentBuild = undefined;
        currentImage = undefined;
        currentPorts = [];
        continue;
      }

      if (!currentService) continue;

      // Detect "ports:" under a service
      if (trimmed === 'ports:' && indent > serviceIndent) {
        inPorts = true;
        portsIndent = indent;
        continue;
      }

      // If we were reading ports, check if we're still in that block
      if (inPorts) {
        if (indent <= portsIndent) {
          inPorts = false;
        } else if (trimmed.startsWith('-')) {
          const portStr = trimmed.slice(1).trim().replace(/['"]/g, '');
          const portMatch = portStr.match(/^(\d+):(\d+)/);
          if (portMatch) {
            currentPorts.push({
              host: parseInt(portMatch[1], 10),
              container: parseInt(portMatch[2], 10),
            });
          }
          continue;
        }
      }

      // Detect "build:" under a service
      const buildMatch = trimmed.match(/^build\s*:\s*(.+)/);
      if (buildMatch && indent > serviceIndent) {
        currentBuild = buildMatch[1].trim();
        continue;
      }

      // Detect "image:" under a service
      const imageMatch = trimmed.match(/^image\s*:\s*(.+)/);
      if (imageMatch && indent > serviceIndent) {
        currentImage = imageMatch[1].trim();
        continue;
      }
    }

    // Flush last service
    if (currentService) {
      services.push({
        name: currentService,
        ports: currentPorts,
        buildContext: currentBuild,
        image: currentImage,
      });
    }

    return services;
  }

  // ---------------------------------------------------------------------------
  // Port reading helpers for new stacks
  // ---------------------------------------------------------------------------

  private async readPortFromPumaConfig(projectPath: string): Promise<number | null> {
    const content = await this.readFileSafe(join(projectPath, 'config', 'puma.rb'));
    if (!content) return null;

    const match = content.match(/port\s+(\d+)/);
    if (match) return parseInt(match[1], 10);
    return null;
  }

  private async readPortFromLaravelEnv(projectPath: string): Promise<number | null> {
    const content = await this.readFileSafe(join(projectPath, '.env'));
    if (!content) return null;

    const appPortMatch = content.match(/APP_PORT\s*=\s*(\d+)/);
    if (appPortMatch) return parseInt(appPortMatch[1], 10);

    const serverPortMatch = content.match(/SERVER_PORT\s*=\s*(\d+)/);
    if (serverPortMatch) return parseInt(serverPortMatch[1], 10);

    return null;
  }

  private async readPortFromSpringConfig(projectPath: string): Promise<number | null> {
    // Check application.properties
    const propsContent = await this.readFileSafe(
      join(projectPath, 'src', 'main', 'resources', 'application.properties'),
    );
    if (propsContent) {
      const match = propsContent.match(/server\.port\s*=\s*(\d+)/);
      if (match) return parseInt(match[1], 10);
    }

    // Check application.yml
    const ymlContent = await this.readFileSafe(
      join(projectPath, 'src', 'main', 'resources', 'application.yml'),
    );
    if (ymlContent) {
      const match = ymlContent.match(/port\s*:\s*(\d+)/);
      if (match) return parseInt(match[1], 10);
    }

    return null;
  }
}
