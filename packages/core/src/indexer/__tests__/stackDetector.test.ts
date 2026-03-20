import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { StackDetector } from '../StackDetector.js';

const fixturesDir = path.resolve(__dirname, '../../../../../tests/fixtures');

function fixturePath(name: string): string {
  return path.join(fixturesDir, name);
}

describe('StackDetector', () => {
  const detector = new StackDetector();

  // ── detectStack ─────────────────────────────────────────────

  describe('detectStack', () => {
    it('should detect Next.js app as next.js framework with typescript', async () => {
      const stack = await detector.detectStack(fixturePath('nextjs-app'));

      expect(stack.framework).toBe('next.js');
      expect(stack.language).toBe('typescript');
      expect(stack.typescript).toBe(true);
    });

    it('should detect Vite app as vite framework', async () => {
      const stack = await detector.detectStack(fixturePath('vite-app'));

      expect(stack.framework).toBe('vite');
      expect(stack.typescript).toBe(true);
    });

    it('should detect .NET app as dotnet framework with csharp language', async () => {
      const stack = await detector.detectStack(fixturePath('dotnet-app'));

      expect(stack.framework).toBe('dotnet');
      expect(stack.language).toBe('csharp');
    });

    it('should return unknown framework and language for empty project', async () => {
      const stack = await detector.detectStack(fixturePath('empty-project'));

      expect(stack.framework).toBe('unknown');
      expect(stack.language).toBe('unknown');
      expect(stack.typescript).toBe(false);
    });

    // ── Ruby / Rails ──

    it('should detect Rails app from Gemfile', async () => {
      const stack = await detector.detectStack(fixturePath('rails-app'));

      expect(stack.framework).toBe('rails');
      expect(stack.language).toBe('ruby');
      expect(stack.typescript).toBe(false);
    });

    it('should detect Sinatra app from Gemfile', async () => {
      const stack = await detector.detectStack(fixturePath('sinatra-app'));

      expect(stack.framework).toBe('sinatra');
      expect(stack.language).toBe('ruby');
      expect(stack.typescript).toBe(false);
    });

    it('should detect generic Ruby app from Gemfile without known framework', async () => {
      const stack = await detector.detectStack(fixturePath('ruby-app'));

      expect(stack.framework).toBe('ruby');
      expect(stack.language).toBe('ruby');
      expect(stack.typescript).toBe(false);
    });

    // ── PHP / Laravel ──

    it('should detect Laravel app from composer.json', async () => {
      const stack = await detector.detectStack(fixturePath('laravel-app'));

      expect(stack.framework).toBe('laravel');
      expect(stack.language).toBe('php');
      expect(stack.typescript).toBe(false);
    });

    it('should detect Symfony app from composer.json', async () => {
      const stack = await detector.detectStack(fixturePath('symfony-app'));

      expect(stack.framework).toBe('symfony');
      expect(stack.language).toBe('php');
      expect(stack.typescript).toBe(false);
    });

    it('should detect generic PHP app from composer.json without known framework', async () => {
      const stack = await detector.detectStack(fixturePath('php-app'));

      expect(stack.framework).toBe('php');
      expect(stack.language).toBe('php');
      expect(stack.typescript).toBe(false);
    });

    // ── Java / Spring ──

    it('should detect Spring Boot app from pom.xml', async () => {
      const stack = await detector.detectStack(fixturePath('spring-boot-app'));

      expect(stack.framework).toBe('spring-boot');
      expect(stack.language).toBe('java');
      expect(stack.typescript).toBe(false);
    });

    it('should detect Spring Boot app from build.gradle', async () => {
      const stack = await detector.detectStack(fixturePath('spring-boot-gradle-app'));

      expect(stack.framework).toBe('spring-boot');
      expect(stack.language).toBe('java');
      expect(stack.typescript).toBe(false);
    });

    it('should detect generic Java app from pom.xml without Spring', async () => {
      const stack = await detector.detectStack(fixturePath('java-app'));

      expect(stack.framework).toBe('java');
      expect(stack.language).toBe('java');
      expect(stack.typescript).toBe(false);
    });
  });

  // ── detectDevCommand ────────────────────────────────────────

  describe('detectDevCommand', () => {
    it('should return a dev command containing "dev" for Next.js', async () => {
      const projectPath = fixturePath('nextjs-app');
      const stack = await detector.detectStack(projectPath);
      const command = await detector.detectDevCommand(stack, projectPath);

      expect(command).toContain('dev');
    });

    it('should return "dotnet run" for .NET projects', async () => {
      const projectPath = fixturePath('dotnet-app');
      const stack = await detector.detectStack(projectPath);
      const command = await detector.detectDevCommand(stack, projectPath);

      expect(command).toBe('dotnet run');
    });

    it('should return empty string for unknown stack', async () => {
      const projectPath = fixturePath('empty-project');
      const stack = await detector.detectStack(projectPath);
      const command = await detector.detectDevCommand(stack, projectPath);

      expect(command).toBe('');
    });

    it('should return "bin/rails server" for Rails', async () => {
      const projectPath = fixturePath('rails-app');
      const stack = await detector.detectStack(projectPath);
      const command = await detector.detectDevCommand(stack, projectPath);

      expect(command).toBe('bin/rails server');
    });

    it('should return "ruby app.rb" for Sinatra', async () => {
      const projectPath = fixturePath('sinatra-app');
      const stack = await detector.detectStack(projectPath);
      const command = await detector.detectDevCommand(stack, projectPath);

      expect(command).toBe('ruby app.rb');
    });

    it('should return "php artisan serve" for Laravel', async () => {
      const projectPath = fixturePath('laravel-app');
      const stack = await detector.detectStack(projectPath);
      const command = await detector.detectDevCommand(stack, projectPath);

      expect(command).toBe('php artisan serve');
    });

    it('should return "symfony server:start" for Symfony', async () => {
      const projectPath = fixturePath('symfony-app');
      const stack = await detector.detectStack(projectPath);
      const command = await detector.detectDevCommand(stack, projectPath);

      expect(command).toBe('symfony server:start');
    });

    it('should return "./mvnw spring-boot:run" for Spring Boot', async () => {
      const projectPath = fixturePath('spring-boot-app');
      const stack = await detector.detectStack(projectPath);
      const command = await detector.detectDevCommand(stack, projectPath);

      expect(command).toBe('./mvnw spring-boot:run');
    });
  });

  // ── detectPort ──────────────────────────────────────────────

  describe('detectPort', () => {
    it('should return 3000 for Next.js (default port)', async () => {
      const projectPath = fixturePath('nextjs-app');
      const stack = await detector.detectStack(projectPath);
      const port = await detector.detectPort(stack, projectPath);

      expect(port).toBe(3000);
    });

    it('should return 5173 for Vite (default port)', async () => {
      const projectPath = fixturePath('vite-app');
      const stack = await detector.detectStack(projectPath);
      const port = await detector.detectPort(stack, projectPath);

      expect(port).toBe(5173);
    });

    it('should return 3000 for unknown stack (fallback)', async () => {
      const projectPath = fixturePath('empty-project');
      const stack = await detector.detectStack(projectPath);
      const port = await detector.detectPort(stack, projectPath);

      expect(port).toBe(3000);
    });

    it('should return 3000 for Rails (default port)', async () => {
      const projectPath = fixturePath('rails-app');
      const stack = await detector.detectStack(projectPath);
      const port = await detector.detectPort(stack, projectPath);

      expect(port).toBe(3000);
    });

    it('should return 8000 for Laravel (default port)', async () => {
      const projectPath = fixturePath('laravel-app');
      const stack = await detector.detectStack(projectPath);
      const port = await detector.detectPort(stack, projectPath);

      expect(port).toBe(8000);
    });

    it('should return 8080 for Spring Boot (default port)', async () => {
      const projectPath = fixturePath('spring-boot-app');
      const stack = await detector.detectStack(projectPath);
      const port = await detector.detectPort(stack, projectPath);

      expect(port).toBe(8080);
    });

    it('should read port 4000 from puma.rb for Rails', async () => {
      const projectPath = fixturePath('rails-port-app');
      const stack = await detector.detectStack(projectPath);
      const port = await detector.detectPort(stack, projectPath);

      expect(port).toBe(4000);
    });

    it('should read port 9000 from .env for Laravel', async () => {
      const projectPath = fixturePath('laravel-port-app');
      const stack = await detector.detectStack(projectPath);
      const port = await detector.detectPort(stack, projectPath);

      expect(port).toBe(9000);
    });

    it('should read port 9090 from application.properties for Spring Boot', async () => {
      const projectPath = fixturePath('spring-boot-port-app');
      const stack = await detector.detectStack(projectPath);
      const port = await detector.detectPort(stack, projectPath);

      expect(port).toBe(9090);
    });
  });

  // ── detectDockerServices ──────────────────────────────────

  describe('detectDockerServices', () => {
    it('should detect services from docker-compose.yml', async () => {
      const projectPath = fixturePath('docker-compose-app');
      const services = await detector.detectDockerServices(projectPath);

      expect(services).toHaveLength(3);

      const web = services.find((s) => s.name === 'web');
      expect(web).toBeDefined();
      expect(web!.buildContext).toBe('./frontend');
      expect(web!.ports).toEqual([{ host: 3000, container: 3000 }]);

      const api = services.find((s) => s.name === 'api');
      expect(api).toBeDefined();
      expect(api!.image).toBe('node:18');
      expect(api!.ports).toEqual([
        { host: 8080, container: 8080 },
        { host: 9229, container: 9229 },
      ]);

      const db = services.find((s) => s.name === 'db');
      expect(db).toBeDefined();
      expect(db!.image).toBe('postgres:15');
      expect(db!.ports).toEqual([{ host: 5432, container: 5432 }]);
    });

    it('should return empty array when no docker-compose file exists', async () => {
      const services = await detector.detectDockerServices(fixturePath('empty-project'));

      expect(services).toEqual([]);
    });
  });
});
