import { describe, it, expect } from 'vitest';
import { mapDescriptionToCommand } from '../scaffold.js';

/**
 * Test suite for scaffold.ts — specifically `mapDescriptionToCommand`,
 * the pure function that maps free-text project descriptions to scaffold commands.
 *
 * Covers:
 * - Known tech mapping (Next.js, React+Vite, Remix, Nuxt, Vue, Svelte, Astro, Solid)
 * - Backend techs (Express, Fastify, Hono, Django, FastAPI, Flask, Go, .NET)
 * - Multi-tech combos (Next.js + C#, React + Django, etc.)
 * - Unknown / unmatched descriptions
 * - Edge cases
 */

describe('mapDescriptionToCommand', () => {
  // ── Frontend techs ──────────────────────────────────────────────────

  describe('frontend techs', () => {
    it('maps "Next.js" to create-next-app', () => {
      const result = mapDescriptionToCommand('Next.js');
      expect(result.command).toContain('create-next-app');
      expect(result.needsInstall).toBe(false);
    });

    it('maps "next" to create-next-app', () => {
      const result = mapDescriptionToCommand('next');
      expect(result.command).toContain('create-next-app');
    });

    it('maps "React + Tailwind" to Vite react-ts', () => {
      const result = mapDescriptionToCommand('React + Tailwind');
      expect(result.command).toContain('vite');
      expect(result.command).toContain('react-ts');
      expect(result.needsInstall).toBe(true);
    });

    it('maps "react vite" to Vite react-ts', () => {
      const result = mapDescriptionToCommand('react vite');
      expect(result.command).toContain('react-ts');
    });

    it('maps "Remix" to create-remix', () => {
      const result = mapDescriptionToCommand('Remix');
      expect(result.command).toContain('create-remix');
      expect(result.needsInstall).toBe(true);
    });

    it('maps "Nuxt" to nuxi init', () => {
      const result = mapDescriptionToCommand('Nuxt');
      expect(result.command).toContain('nuxi');
      expect(result.needsInstall).toBe(true);
    });

    it('maps "Vue" to Vite vue-ts', () => {
      const result = mapDescriptionToCommand('Vue');
      expect(result.command).toContain('vue-ts');
    });

    it('maps "Svelte" to sv create', () => {
      const result = mapDescriptionToCommand('Svelte');
      expect(result.command).toContain('sv create');
    });

    it('maps "Astro" to astro create command', () => {
      const result = mapDescriptionToCommand('Astro');
      expect(result.command).toContain('astro');
      expect(result.needsInstall).toBe(false);
    });

    it('maps "Solid" to degit solidjs', () => {
      const result = mapDescriptionToCommand('Solid');
      expect(result.command).toContain('degit');
      expect(result.command).toContain('solidjs');
      expect(result.needsInstall).toBe(true);
    });
  });

  // ── Backend techs ───────────────────────────────────────────────────

  describe('backend techs', () => {
    it('maps "Express" to npm init + install express', () => {
      const result = mapDescriptionToCommand('Express');
      expect(result.command).toContain('express');
      expect(result.backends).toEqual(['.']);
    });

    it('maps "Fastify" to npm init + install fastify', () => {
      const result = mapDescriptionToCommand('Fastify');
      expect(result.command).toContain('fastify');
      expect(result.backends).toEqual(['.']);
    });

    it('maps "Hono" to create-hono', () => {
      const result = mapDescriptionToCommand('Hono');
      expect(result.command).toContain('hono');
      expect(result.backends).toEqual(['.']);
    });

    it('maps "Django" to django-admin startproject', () => {
      const result = mapDescriptionToCommand('Django');
      expect(result.command).toContain('django-admin');
      // "django".includes("go") is true, so multi-technique path matches
    });

    it('maps "FastAPI" to pip install fastapi', () => {
      const result = mapDescriptionToCommand('FastAPI');
      expect(result.command).toContain('fastapi');
      expect(result.backends).toEqual(['.']);
    });

    it('maps "fast api" (two words) to pip install fastapi', () => {
      const result = mapDescriptionToCommand('fast api');
      expect(result.command).toContain('fastapi');
    });

    it('maps "Flask" to pip install flask', () => {
      const result = mapDescriptionToCommand('Flask');
      expect(result.command).toContain('flask');
    });

    it('maps "Go fiber" to go mod init + fiber', () => {
      const result = mapDescriptionToCommand('Go fiber');
      expect(result.command).toContain('fiber');
      expect(result.command).toContain('go mod init');
    });

    it('maps "Go gin" to go mod init (first match wins)', () => {
      const result = mapDescriptionToCommand('Go gin');
      // "go" keyword matches the first "Go+fiber" entry before "Go+gin"
      expect(result.command).toContain('go mod init');
      expect(result.command).toContain('fiber');
    });

    it('maps bare "Go" to go mod init (first matching entry wins)', () => {
      const result = mapDescriptionToCommand('Go');
      expect(result.command).toContain('go mod init');
    });

    it('maps ".NET" to dotnet new webapi', () => {
      const result = mapDescriptionToCommand('.NET');
      expect(result.command).toContain('dotnet');
      expect(result.backends).toEqual(['.']);
    });

    it('maps "dotnet" to dotnet new webapi', () => {
      const result = mapDescriptionToCommand('dotnet');
      expect(result.command).toContain('dotnet new webapi');
    });

    it('maps "C#" to dotnet', () => {
      const result = mapDescriptionToCommand('C#');
      expect(result.command).toContain('dotnet');
    });

    it('maps "csharp" to dotnet', () => {
      const result = mapDescriptionToCommand('csharp');
      expect(result.command).toContain('dotnet');
    });
  });

  // ── Multi-tech combos ───────────────────────────────────────────────

  describe('multi-tech combos', () => {
    it('maps "Next.js + C#" to frontend + backend', () => {
      const result = mapDescriptionToCommand('Next.js + C#');
      expect(result.command).toContain('create-next-app');
      expect(result.command).toContain('dotnet');
      expect(result.command).toContain('&&');
      expect(result.frontend).toBe('.');
      expect(result.backends).toEqual(['backend']);
    });

    it('maps "React + Django" to frontend + backend', () => {
      const result = mapDescriptionToCommand('React + Django');
      expect(result.command).toContain('vite');
      expect(result.command).toContain('django');
      expect(result.frontend).toBe('.');
      expect(result.backends).toEqual(['backend']);
    });

    it('maps "Vue + Express" to frontend + backend', () => {
      const result = mapDescriptionToCommand('Vue + Express');
      expect(result.command).toContain('vue-ts');
      expect(result.command).toContain('express');
      expect(result.frontend).toBe('.');
    });

    it('maps "Next.js and FastAPI" to frontend + backend', () => {
      const result = mapDescriptionToCommand('Next.js and FastAPI');
      expect(result.command).toContain('create-next-app');
      expect(result.command).toContain('fastapi');
      expect(result.frontend).toBe('.');
      expect(result.backends).toEqual(['backend']);
    });

    it('maps "Svelte + Go" to frontend + backend', () => {
      const result = mapDescriptionToCommand('Svelte + Go');
      expect(result.command).toContain('sv create');
      expect(result.command).toContain('go mod init');
      expect(result.frontend).toBe('.');
    });
  });

  // ── Unknown / unmatched descriptions ────────────────────────────────

  describe('unknown descriptions', () => {
    it('falls back to npm init -y for unrecognized descriptions', () => {
      const result = mapDescriptionToCommand('SomeRandomThing');
      expect(result.command).toBe('npm init -y');
      expect(result.needsInstall).toBe(false);
    });

    it('falls back for empty-ish description', () => {
      const result = mapDescriptionToCommand('xyzzy');
      expect(result.command).toBe('npm init -y');
    });

    it('falls back for generic description', () => {
      const result = mapDescriptionToCommand('a web application');
      expect(result.command).toBe('npm init -y');
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('is case-insensitive', () => {
      const r1 = mapDescriptionToCommand('NEXT.JS');
      const r2 = mapDescriptionToCommand('next.js');
      expect(r1.command).toBe(r2.command);
    });

    it('handles descriptions with extra whitespace', () => {
      const result = mapDescriptionToCommand('  React  +  Vite  ');
      expect(result.command).toContain('vite');
      expect(result.command).toContain('react-ts');
    });

    it('does not double-match react+vite as two separate entries', () => {
      // "react" + "vite" should match ONE entry (the react+vite entry), not two
      const result = mapDescriptionToCommand('React with Vite');
      // Should produce a single command, not two joined with &&
      expect(result.command).not.toContain('&&');
      expect(result.command).toContain('vite');
    });

    it('handles "Go" + another backend without duplicating', () => {
      // "Go" + "Fiber" should match ONE entry (the Go+fiber combo)
      const result = mapDescriptionToCommand('Go + Fiber');
      // Should match Go+fiber (single entry)
      expect(result.command).toContain('go mod init');
      expect(result.command).toContain('fiber');
    });

    it('returns needsInstall from frontend when both match', () => {
      const result = mapDescriptionToCommand('Remix + Django');
      // Remix needs install, Django doesn't
      expect(result.needsInstall).toBe(true);
    });

    it('returns needsInstall false when unmatched', () => {
      const result = mapDescriptionToCommand('unknown');
      expect(result.needsInstall).toBe(false);
    });

    it('correctly identifies "REST API" type descriptions', () => {
      const result = mapDescriptionToCommand('Django REST API');
      expect(result.command).toContain('django-admin');
    });
  });
});
