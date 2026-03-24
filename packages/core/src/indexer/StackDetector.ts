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
  // Specific frameworks first — order matters for first-match semantics
  { dep: 'next', framework: 'next.js' },
  { dep: 'nuxt', framework: 'nuxt' },
  { dep: '@sveltejs/kit', framework: 'sveltekit' },
  { dep: '@angular/core', framework: 'angular' },
  { dep: 'gatsby', framework: 'gatsby' },
  { dep: '@remix-run/node', framework: 'remix' },
  { dep: 'remix', framework: 'remix' },
  { dep: 'astro', framework: 'astro' },
  { dep: 'vite', framework: 'vite' },
  { dep: 'react-scripts', framework: 'cra' },
  { dep: 'solid-js', framework: 'solid' },
  { dep: 'svelte', framework: 'svelte' },
  { dep: 'vue', framework: 'vue' },
  { dep: 'react', framework: 'react' },
  { dep: 'electron', framework: 'electron' },
  { dep: 'express', framework: 'express' },
  { dep: '@nestjs/core', framework: 'nest' },
  { dep: 'fastify', framework: 'fastify' },
  { dep: 'koa', framework: 'koa' },
  { dep: '@hapi/hapi', framework: 'hapi' },
  { dep: 'socket.io', framework: 'socketio' },
  { dep: '@trpc/server', framework: 'trpc' },
];

const PYTHON_FRAMEWORKS: ReadonlyArray<{ dep: string; framework: string }> = [
  { dep: 'django', framework: 'django' },
  { dep: 'fastapi', framework: 'fastapi' },
  { dep: 'flask', framework: 'flask' },
  { dep: 'starlette', framework: 'starlette' },
  { dep: 'streamlit', framework: 'streamlit' },
  { dep: 'gradio', framework: 'gradio' },
  { dep: 'tornado', framework: 'tornado' },
  { dep: 'sanic', framework: 'sanic' },
  { dep: 'aiohttp', framework: 'aiohttp' },
  { dep: 'litestar', framework: 'litestar' },
  { dep: 'uvicorn', framework: 'uvicorn' },
];

const DEFAULT_PORTS: Record<string, number> = {
  'next.js': 3000,
  'cra': 3000,
  'nuxt': 3000,
  'sveltekit': 5173,
  'astro': 4321,
  'vite': 5173,
  'express': 3000,
  'nest': 3000,
  'fastify': 3000,
  'koa': 3000,
  'hapi': 3000,
  'node': 3000,
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
  'angular': 4200,
  'gatsby': 8000,
  'remix': 3000,
  'solid': 3000,
  'svelte': 5173,
  'vue': 5173,
  'react': 3000,
  'electron': 3000,
  'socketio': 3000,
  'trpc': 3000,
  'gin': 8080,
  'echo': 8080,
  'fiber': 3000,
  'gorilla': 8080,
  'beego': 8080,
  'go': 8080,
  'actix': 8080,
  'axum': 3000,
  'rocket': 8000,
  'warp': 3030,
  'tauri': 1420,
  'rust': 8080,
  'phoenix': 4000,
  'elixir': 4000,
  'deno': 8000,
  'starlette': 8000,
  'streamlit': 8501,
  'gradio': 7860,
  'tornado': 8888,
  'sanic': 8000,
  'aiohttp': 8080,
  'litestar': 8000,
  'uvicorn': 8000,
  'scala': 9000,
  'play': 9000,
  'akka': 8080,
  'kotlin': 8080,
  'ktor': 8080,
  'swift': 8080,
  'vapor': 8080,
  'flutter': 3000,
  'dart': 8080,
  'zig': 8080,
  'haskell': 3000,
  'clojure': 3000,
  'cpp': 8080,
  'c': 8080,
  'nim': 8080,
  'perl': 3000,
  'mojolicious': 3000,
  'r': 3838,
  'shiny': 3838,
  'plumber': 8000,
  'julia': 8000,
  'genie': 8000,
  'ocaml': 8080,
  'erlang': 8080,
};

export class StackDetector implements IStackDetector {
  async detectStack(projectPath: string): Promise<StackInfo> {
    const detected: StackInfo[] = [];

    // Check all sources in parallel
    const [
      pkgResult, hasDotnet, pythonFw, rubyFw, phpFw, javaFw, goFw, rustFw, elixirFw, hasDeno,
      scalaFw, kotlinFw, swiftFw, dartFw, zigFw, haskellFw, clojureFw, cppFw, nimFw, perlFw,
      rFw, juliaFw, ocamlFw, erlangFw,
    ] = await Promise.all([
      this.detectFromPackageJson(projectPath),
      this.hasDotnet(projectPath),
      this.detectPython(projectPath),
      this.detectRuby(projectPath),
      this.detectPhp(projectPath),
      this.detectJava(projectPath),
      this.detectGo(projectPath),
      this.detectRust(projectPath),
      this.detectElixir(projectPath),
      this.detectDeno(projectPath),
      this.detectScala(projectPath),
      this.detectKotlin(projectPath),
      this.detectSwift(projectPath),
      this.detectDart(projectPath),
      this.detectZig(projectPath),
      this.detectHaskell(projectPath),
      this.detectClojure(projectPath),
      this.detectCpp(projectPath),
      this.detectNim(projectPath),
      this.detectPerl(projectPath),
      this.detectR(projectPath),
      this.detectJulia(projectPath),
      this.detectOcaml(projectPath),
      this.detectErlang(projectPath),
    ]);

    if (pkgResult) detected.push(pkgResult);
    if (hasDotnet) {
      const typescript = await this.hasTypescript(projectPath);
      detected.push({ framework: 'dotnet', language: 'csharp', typescript });
    }
    if (pythonFw) detected.push({ framework: pythonFw, language: 'python', typescript: false });
    if (rubyFw) detected.push({ framework: rubyFw, language: 'ruby', typescript: false });
    if (phpFw) detected.push({ framework: phpFw, language: 'php', typescript: false });
    if (javaFw) detected.push({ framework: javaFw, language: 'java', typescript: false });
    if (goFw) detected.push({ framework: goFw, language: 'go', typescript: false });
    if (rustFw) detected.push({ framework: rustFw, language: 'rust', typescript: false });
    if (elixirFw) detected.push({ framework: elixirFw, language: 'elixir', typescript: false });
    if (hasDeno) detected.push({ framework: 'deno', language: 'typescript', typescript: true });
    if (scalaFw) detected.push({ framework: scalaFw, language: 'scala', typescript: false });
    if (kotlinFw) detected.push({ framework: kotlinFw, language: 'kotlin', typescript: false });
    if (swiftFw) detected.push({ framework: swiftFw, language: 'swift', typescript: false });
    if (dartFw) detected.push({ framework: dartFw, language: 'dart', typescript: false });
    if (zigFw) detected.push({ framework: 'zig', language: 'zig', typescript: false });
    if (haskellFw) detected.push({ framework: 'haskell', language: 'haskell', typescript: false });
    if (clojureFw) detected.push({ framework: clojureFw, language: 'clojure', typescript: false });
    if (cppFw) detected.push({ framework: cppFw, language: cppFw === 'c' ? 'c' : 'cpp', typescript: false });
    if (nimFw) detected.push({ framework: 'nim', language: 'nim', typescript: false });
    if (perlFw) detected.push({ framework: perlFw, language: 'perl', typescript: false });
    if (rFw) detected.push({ framework: rFw, language: 'r', typescript: false });
    if (juliaFw) detected.push({ framework: juliaFw, language: 'julia', typescript: false });
    if (ocamlFw) detected.push({ framework: 'ocaml', language: 'ocaml', typescript: false });
    if (erlangFw) detected.push({ framework: 'erlang', language: 'erlang', typescript: false });

    if (detected.length === 0) {
      return { framework: 'unknown', language: 'unknown', typescript: false };
    }

    // Priority: frontend frameworks > backend frameworks > generic
    const PRIORITY = [
      // Frontend frameworks
      'next.js', 'nuxt', 'sveltekit', 'angular', 'gatsby', 'remix',
      'astro', 'vite', 'cra', 'solid', 'svelte', 'vue', 'react',
      'electron', 'tauri',
      // Backend frameworks
      'dotnet', 'django', 'fastapi', 'flask', 'starlette', 'streamlit',
      'gradio', 'tornado', 'sanic', 'aiohttp', 'litestar', 'uvicorn',
      'rails', 'sinatra', 'laravel', 'symfony', 'spring-boot',
      'phoenix', 'gin', 'echo', 'fiber', 'gorilla', 'beego',
      'actix', 'axum', 'rocket', 'warp',
      'express', 'nest', 'fastify', 'koa', 'hapi', 'socketio', 'trpc',
      'deno',
      'play', 'akka', 'ktor', 'vapor',
      'flutter', 'mojolicious', 'shiny', 'plumber', 'genie',
      // Generic language fallbacks
      'node', 'python', 'ruby', 'php', 'java', 'go', 'rust', 'elixir',
      'scala', 'kotlin', 'swift', 'dart', 'zig', 'haskell', 'clojure',
      'cpp', 'c', 'nim', 'perl', 'r', 'julia', 'ocaml', 'erlang',
    ];

    detected.sort((a, b) => {
      const ai = PRIORITY.indexOf(a.framework);
      const bi = PRIORITY.indexOf(b.framework);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    const primary = detected[0];
    if (detected.length > 1) {
      primary.additionalStacks = detected.slice(1).map((s) => s.framework);
    }

    return primary;
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

    // Go frameworks
    if (framework === 'go' || framework === 'gin' || framework === 'echo' || framework === 'fiber' || framework === 'gorilla' || framework === 'beego') {
      return 'go run .';
    }

    // Rust frameworks
    if (framework === 'tauri') return 'cargo tauri dev';
    if (framework === 'rust' || framework === 'actix' || framework === 'axum' || framework === 'rocket' || framework === 'warp') {
      return 'cargo run';
    }

    // Elixir
    if (framework === 'phoenix') return 'mix phx.server';
    if (framework === 'elixir') return 'mix run';

    // Deno
    if (framework === 'deno') return 'deno task dev';

    // Python frameworks with specific commands
    if (framework === 'streamlit') return 'streamlit run app.py';
    if (framework === 'gradio') return 'python app.py';

    // Generic python fallback
    if (framework === 'python' || framework === 'starlette' || framework === 'tornado' || framework === 'sanic' || framework === 'aiohttp' || framework === 'litestar' || framework === 'uvicorn') {
      return 'python main.py';
    }

    // Scala
    if (framework === 'scala' || framework === 'play' || framework === 'akka') return 'sbt run';

    // Kotlin (non-Spring)
    if (framework === 'ktor' || framework === 'kotlin') return './gradlew run';

    // Swift
    if (framework === 'swift' || framework === 'vapor') return 'swift run';

    // Dart / Flutter
    if (framework === 'flutter') return 'flutter run -d web-server --web-port 3000';
    if (framework === 'dart') return 'dart run';

    // Zig
    if (framework === 'zig') return 'zig build run';

    // Haskell
    if (framework === 'haskell') return 'stack run';

    // Clojure
    if (framework === 'clojure') return 'clj -M:dev';

    // C/C++
    if (framework === 'cpp' || framework === 'c') return 'make && ./build/main';

    // Nim
    if (framework === 'nim') return 'nimble run';

    // Perl
    if (framework === 'perl' || framework === 'mojolicious') return 'perl app.pl daemon';

    // R
    if (framework === 'shiny') return 'Rscript -e "shiny::runApp()"';
    if (framework === 'plumber') return 'Rscript -e "plumber::plumb()$run()"';
    if (framework === 'r') return 'Rscript -e "shiny::runApp()"';

    // Julia
    if (framework === 'julia' || framework === 'genie') return 'julia --project=. -e "using Genie; up()"';

    // OCaml
    if (framework === 'ocaml') return 'dune exec';

    // Erlang
    if (framework === 'erlang') return 'rebar3 shell';

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
    const content = await this.readFileSafe(join(projectPath, 'package.json'));
    if (!content) return null;

    // package.json exists — this is a Node.js project even if JSON is broken
    const typescript = await this.hasTypescript(projectPath);
    const packageManager = await this.detectPackageManager(projectPath);

    let pkg: PackageJson | null = null;
    try {
      pkg = JSON.parse(content) as PackageJson;
    } catch {
      console.warn('[Nova] Warning: package.json contains invalid JSON. Detecting framework from directory structure.');
    }

    let frameworkName: string | undefined;

    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      frameworkName = FRAMEWORK_DEPS.find((f) => f.dep in allDeps)?.framework;
    }

    // Fallback: detect framework from directory structure if package.json broken or no deps match
    if (!frameworkName) {
      frameworkName = await this.detectFrameworkFromDirs(projectPath);
    }

    return {
      framework: frameworkName ?? 'node',
      language: typescript ? 'typescript' : 'javascript',
      packageManager,
      typescript,
    };
  }

  /**
   * Detect framework by checking for characteristic directories/files.
   * Used as fallback when package.json is broken or has no known deps.
   */
  private async detectFrameworkFromDirs(projectPath: string): Promise<string | undefined> {
    try {
      const entries = await readdir(projectPath);
      const entrySet = new Set(entries);

      // Next.js: .next/ or next.config.* or app/ with layout/page files
      if (entrySet.has('.next') || entries.some(e => e.startsWith('next.config'))) return 'next.js';

      // Nuxt: .nuxt/ or nuxt.config.*
      if (entrySet.has('.nuxt') || entries.some(e => e.startsWith('nuxt.config'))) return 'nuxt';

      // SvelteKit: svelte.config.*
      if (entries.some(e => e.startsWith('svelte.config'))) return 'sveltekit';

      // Astro: astro.config.*
      if (entries.some(e => e.startsWith('astro.config'))) return 'astro';

      // Vite: vite.config.*
      if (entries.some(e => e.startsWith('vite.config'))) return 'vite';

      // Angular: angular.json
      if (entrySet.has('angular.json')) return 'angular';
    } catch {
      // ignore
    }
    return undefined;
  }

  private async hasDotnet(projectPath: string): Promise<boolean> {
    try {
      const entries = await readdir(projectPath);
      return entries.some((e) => e.endsWith('.csproj') || e.endsWith('.sln'));
    } catch {
      return false;
    }
  }

  private async detectPython(projectPath: string): Promise<string | null> {
    const files = ['requirements.txt', 'pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile'];
    const contents: string[] = [];

    for (const f of files) {
      const c = await this.readFileSafe(join(projectPath, f));
      if (c) contents.push(c);
    }

    // Also check uv.lock as indicator
    if (await this.fileExists(join(projectPath, 'uv.lock'))) {
      contents.push('uv'); // just to trigger detection
    }

    if (contents.length === 0) return null;

    const combined = contents.join('\n').toLowerCase();

    for (const { dep, framework } of PYTHON_FRAMEWORKS) {
      if (combined.includes(dep)) return framework;
    }

    // Has Python config files but no known framework
    return 'python';
  }

  private async detectGo(projectPath: string): Promise<string | null> {
    const content = await this.readFileSafe(join(projectPath, 'go.mod'));
    if (!content) return null;

    if (content.includes('github.com/gin-gonic/gin')) return 'gin';
    if (content.includes('github.com/labstack/echo')) return 'echo';
    if (content.includes('github.com/gofiber/fiber')) return 'fiber';
    if (content.includes('github.com/gorilla/mux')) return 'gorilla';
    if (content.includes('github.com/beego/beego')) return 'beego';

    return 'go';
  }

  private async detectRust(projectPath: string): Promise<string | null> {
    const content = await this.readFileSafe(join(projectPath, 'Cargo.toml'));
    if (!content) return null;

    if (content.includes('actix-web')) return 'actix';
    if (content.includes('axum')) return 'axum';
    if (content.includes('rocket')) return 'rocket';
    if (content.includes('warp')) return 'warp';
    if (content.includes('tauri')) return 'tauri';

    return 'rust';
  }

  private async detectElixir(projectPath: string): Promise<string | null> {
    const content = await this.readFileSafe(join(projectPath, 'mix.exs'));
    if (!content) return null;

    if (content.includes(':phoenix')) return 'phoenix';
    return 'elixir';
  }

  private async detectDeno(projectPath: string): Promise<boolean> {
    if (await this.fileExists(join(projectPath, 'deno.json'))) return true;
    if (await this.fileExists(join(projectPath, 'deno.jsonc'))) return true;
    return false;
  }

  private async detectScala(projectPath: string): Promise<string | null> {
    const content = await this.readFileSafe(join(projectPath, 'build.sbt'));
    if (!content) return null;

    if (/addSbtPlugin.*play/.test(content) || content.includes('com.typesafe.play')) return 'play';
    if (content.includes('akka-http')) return 'akka';
    return 'scala';
  }

  private async detectKotlin(projectPath: string): Promise<string | null> {
    const content = await this.readFileSafe(join(projectPath, 'build.gradle.kts'));
    if (!content) return null;

    // Skip if Spring Boot is detected (handled by detectJava)
    if (content.includes('spring-boot') || content.includes('org.springframework.boot')) return null;

    // Must have Kotlin indicators
    if (!content.includes('kotlin')) return null;

    if (content.includes('io.ktor')) return 'ktor';
    return 'kotlin';
  }

  private async detectSwift(projectPath: string): Promise<string | null> {
    const content = await this.readFileSafe(join(projectPath, 'Package.swift'));
    if (!content) return null;

    if (content.includes('vapor')) return 'vapor';
    return 'swift';
  }

  private async detectDart(projectPath: string): Promise<string | null> {
    const content = await this.readFileSafe(join(projectPath, 'pubspec.yaml'));
    if (!content) return null;

    if (content.includes('flutter:')) return 'flutter';
    return 'dart';
  }

  private async detectZig(projectPath: string): Promise<boolean> {
    return this.fileExists(join(projectPath, 'build.zig'));
  }

  private async detectHaskell(projectPath: string): Promise<boolean> {
    if (await this.fileExists(join(projectPath, 'stack.yaml'))) return true;
    if (await this.fileExists(join(projectPath, 'cabal.project'))) return true;

    try {
      const entries = await readdir(projectPath);
      return entries.some((e) => e.endsWith('.cabal'));
    } catch {
      return false;
    }
  }

  private async detectClojure(projectPath: string): Promise<string | null> {
    const clj = await this.readFileSafe(join(projectPath, 'project.clj'));
    if (clj) {
      if (clj.includes('luminus') || clj.includes('ring')) return 'clojure';
      return 'clojure';
    }

    if (await this.fileExists(join(projectPath, 'deps.edn'))) return 'clojure';
    return null;
  }

  private async detectCpp(projectPath: string): Promise<string | null> {
    if (await this.fileExists(join(projectPath, 'CMakeLists.txt'))) return 'cpp';
    if (await this.fileExists(join(projectPath, 'meson.build'))) return 'cpp';

    const makefile = await this.readFileSafe(join(projectPath, 'Makefile'));
    if (makefile) {
      // Only detect as C/C++ if Makefile contains compilation patterns
      if (/\b(gcc|g\+\+|clang|clang\+\+|cc|c\+\+)\b/.test(makefile)) {
        if (/\bg\+\+\b/.test(makefile) || /\bclang\+\+\b/.test(makefile) || /\bc\+\+\b/.test(makefile)) {
          return 'cpp';
        }
        return 'c';
      }
    }

    return null;
  }

  private async detectNim(projectPath: string): Promise<boolean> {
    try {
      const entries = await readdir(projectPath);
      return entries.some((e) => e.endsWith('.nimble'));
    } catch {
      return false;
    }
  }

  private async detectPerl(projectPath: string): Promise<string | null> {
    if (await this.fileExists(join(projectPath, 'cpanfile'))) {
      const content = await this.readFileSafe(join(projectPath, 'cpanfile'));
      if (content && content.includes('Mojolicious')) return 'mojolicious';
      return 'perl';
    }

    if (await this.fileExists(join(projectPath, 'Makefile.PL'))) return 'perl';
    return null;
  }

  private async detectR(projectPath: string): Promise<string | null> {
    const content = await this.readFileSafe(join(projectPath, 'DESCRIPTION'));
    if (!content) return null;

    // Must look like an R package DESCRIPTION
    if (!/Type:\s*(Package|Shiny)/i.test(content)) return null;

    if (/shiny/i.test(content)) return 'shiny';
    if (/plumber/i.test(content)) return 'plumber';
    return 'r';
  }

  private async detectJulia(projectPath: string): Promise<string | null> {
    const content = await this.readFileSafe(join(projectPath, 'Project.toml'));
    if (!content) return null;

    // Must have [deps] section to distinguish from other TOML files
    if (!content.includes('[deps]')) return null;

    if (content.includes('Genie')) return 'genie';
    return 'julia';
  }

  private async detectOcaml(projectPath: string): Promise<boolean> {
    return this.fileExists(join(projectPath, 'dune-project'));
  }

  private async detectErlang(projectPath: string): Promise<boolean> {
    return this.fileExists(join(projectPath, 'rebar.config'));
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
        // Skip pure Kotlin projects (handled by detectKotlin)
        if (name === 'build.gradle.kts' && gradleContent.includes('kotlin') && !gradleContent.includes('java')) {
          return null;
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
