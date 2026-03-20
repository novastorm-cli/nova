import { readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Recipe } from '../models/types.js';
import type { IRecipeStore } from '../contracts/IStorage.js';

export class RecipeStore implements IRecipeStore {
  private readonly recipesPath: string;
  private initialized = false;

  constructor(recipesPath: string) {
    this.recipesPath = recipesPath;
  }

  async save(recipe: Recipe): Promise<void> {
    await mkdir(this.recipesPath, { recursive: true });
    const saved: Recipe = { ...recipe, updatedAt: Date.now() };
    await writeFile(
      join(this.recipesPath, `${saved.id}.json`),
      JSON.stringify(saved, null, 2),
      'utf-8',
    );
  }

  async load(id: string): Promise<Recipe | null> {
    try {
      const raw = await readFile(join(this.recipesPath, `${id}.json`), 'utf-8');
      return JSON.parse(raw) as Recipe;
    } catch {
      return null;
    }
  }

  async getAll(): Promise<Recipe[]> {
    await this.ensureBuiltins();
    const files = await this.listJsonFiles();
    const recipes: Recipe[] = [];

    for (const file of files) {
      try {
        const raw = await readFile(join(this.recipesPath, file), 'utf-8');
        recipes.push(JSON.parse(raw) as Recipe);
      } catch {
        // skip corrupt files
      }
    }

    return recipes;
  }

  async findByCategory(category: Recipe['category']): Promise<Recipe[]> {
    const all = await this.getAll();
    return all.filter((r) => r.category === category);
  }

  async findByTags(tags: string[]): Promise<Recipe[]> {
    const all = await this.getAll();
    const tagSet = new Set(tags.map((t) => t.toLowerCase()));
    return all.filter((r) =>
      r.tags.some((t) => tagSet.has(t.toLowerCase())),
    );
  }

  async search(query: string): Promise<Recipe[]> {
    const all = await this.getAll();
    const q = query.toLowerCase();
    return all.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  async incrementUsage(id: string): Promise<void> {
    const recipe = await this.load(id);
    if (!recipe) return;
    recipe.usageCount++;
    await this.save(recipe);
  }

  async remove(id: string): Promise<void> {
    try {
      await rm(join(this.recipesPath, `${id}.json`), { force: true });
    } catch {
      // no-op if file doesn't exist
    }
  }

  private async listJsonFiles(): Promise<string[]> {
    try {
      const entries = await readdir(this.recipesPath);
      return entries.filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
  }

  private async ensureBuiltins(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const files = await this.listJsonFiles();
    if (files.length > 0) return;

    await mkdir(this.recipesPath, { recursive: true });
    const now = Date.now();

    for (const recipe of createBuiltinRecipes(now)) {
      await writeFile(
        join(this.recipesPath, `${recipe.id}.json`),
        JSON.stringify(recipe, null, 2),
        'utf-8',
      );
    }
  }
}

function createBuiltinRecipes(now: number): Recipe[] {
  return [
    {
      id: randomUUID(),
      name: 'CRUD API Endpoint',
      description: 'Creates a Next.js API route with GET, POST, PUT, and DELETE handlers',
      category: 'crud_endpoint',
      template: {
        files: [
          {
            pathPattern: 'app/api/{{name}}/route.ts',
            content: [
              'import { NextRequest, NextResponse } from \'next/server\';',
              '',
              'export async function GET(request: NextRequest) {',
              '  // TODO: implement GET handler for {{name}}',
              '  return NextResponse.json({ items: [] });',
              '}',
              '',
              'export async function POST(request: NextRequest) {',
              '  const body = await request.json();',
              '  // TODO: implement POST handler for {{name}}',
              '  return NextResponse.json({ created: body }, { status: 201 });',
              '}',
              '',
              'export async function PUT(request: NextRequest) {',
              '  const body = await request.json();',
              '  // TODO: implement PUT handler for {{name}}',
              '  return NextResponse.json({ updated: body });',
              '}',
              '',
              'export async function DELETE(request: NextRequest) {',
              '  // TODO: implement DELETE handler for {{name}}',
              '  return new NextResponse(null, { status: 204 });',
              '}',
            ].join('\n'),
            action: 'create',
          },
        ],
        variables: [
          { name: 'name', description: 'Resource name (e.g. users, posts)', required: true },
        ],
      },
      tags: ['api', 'crud', 'nextjs', 'rest'],
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      name: 'Form Component',
      description: 'Creates a React form component with state management, validation, and submit handler',
      category: 'form_field',
      template: {
        files: [
          {
            pathPattern: 'components/{{name}}Form.tsx',
            content: [
              '\'use client\';',
              '',
              'import { useState, type FormEvent } from \'react\';',
              '',
              'interface {{name}}FormProps {',
              '  onSubmit: (data: {{name}}Data) => void;',
              '}',
              '',
              'interface {{name}}Data {',
              '  // TODO: define form fields',
              '  value: string;',
              '}',
              '',
              'export function {{name}}Form({ onSubmit }: {{name}}FormProps) {',
              '  const [value, setValue] = useState(\'\');',
              '  const [error, setError] = useState<string | null>(null);',
              '',
              '  function handleSubmit(e: FormEvent) {',
              '    e.preventDefault();',
              '    setError(null);',
              '',
              '    if (!value.trim()) {',
              '      setError(\'Value is required\');',
              '      return;',
              '    }',
              '',
              '    onSubmit({ value });',
              '  }',
              '',
              '  return (',
              '    <form onSubmit={handleSubmit}>',
              '      {error && <p className="text-red-500">{error}</p>}',
              '      <input',
              '        type="text"',
              '        value={value}',
              '        onChange={(e) => setValue(e.target.value)}',
              '        placeholder="Enter value"',
              '      />',
              '      <button type="submit">Submit</button>',
              '    </form>',
              '  );',
              '}',
            ].join('\n'),
            action: 'create',
          },
        ],
        variables: [
          { name: 'name', description: 'Form name in PascalCase (e.g. Login, Register)', required: true },
        ],
      },
      tags: ['form', 'react', 'component', 'validation'],
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      name: 'New Page',
      description: 'Creates a Next.js page with layout and loading state',
      category: 'new_page',
      template: {
        files: [
          {
            pathPattern: 'app/{{path}}/page.tsx',
            content: [
              'import { Suspense } from \'react\';',
              '',
              'export default function {{name}}Page() {',
              '  return (',
              '    <main className="container mx-auto p-4">',
              '      <h1 className="text-2xl font-bold mb-4">{{name}}</h1>',
              '      <Suspense fallback={<div>Loading...</div>}>',
              '        {/* TODO: add page content */}',
              '      </Suspense>',
              '    </main>',
              '  );',
              '}',
            ].join('\n'),
            action: 'create',
          },
          {
            pathPattern: 'app/{{path}}/loading.tsx',
            content: [
              'export default function Loading() {',
              '  return (',
              '    <div className="container mx-auto p-4">',
              '      <div className="animate-pulse space-y-4">',
              '        <div className="h-8 bg-gray-200 rounded w-1/4" />',
              '        <div className="h-4 bg-gray-200 rounded w-3/4" />',
              '        <div className="h-4 bg-gray-200 rounded w-1/2" />',
              '      </div>',
              '    </div>',
              '  );',
              '}',
            ].join('\n'),
            action: 'create',
          },
        ],
        variables: [
          { name: 'name', description: 'Page name in PascalCase (e.g. Dashboard)', required: true },
          { name: 'path', description: 'URL path segment (e.g. dashboard)', required: true },
        ],
      },
      tags: ['page', 'nextjs', 'layout', 'loading'],
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      name: 'React Component',
      description: 'Creates a React component with props interface and styles',
      category: 'component',
      template: {
        files: [
          {
            pathPattern: 'components/{{name}}.tsx',
            content: [
              'interface {{name}}Props {',
              '  className?: string;',
              '  children?: React.ReactNode;',
              '}',
              '',
              'export function {{name}}({ className, children }: {{name}}Props) {',
              '  return (',
              '    <div className={className}>',
              '      {children}',
              '    </div>',
              '  );',
              '}',
            ].join('\n'),
            action: 'create',
          },
        ],
        variables: [
          { name: 'name', description: 'Component name in PascalCase (e.g. UserCard)', required: true },
        ],
      },
      tags: ['component', 'react', 'ui'],
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      name: 'API Route Handler',
      description: 'Creates a single API endpoint with request validation',
      category: 'api_route',
      template: {
        files: [
          {
            pathPattern: 'app/api/{{name}}/route.ts',
            content: [
              'import { NextRequest, NextResponse } from \'next/server\';',
              '',
              'interface {{name}}Request {',
              '  // TODO: define request body',
              '}',
              '',
              'function validate(body: unknown): body is {{name}}Request {',
              '  if (!body || typeof body !== \'object\') return false;',
              '  // TODO: add validation rules',
              '  return true;',
              '}',
              '',
              'export async function {{method}}(request: NextRequest) {',
              '  try {',
              '    const body = await request.json();',
              '',
              '    if (!validate(body)) {',
              '      return NextResponse.json(',
              '        { error: \'Invalid request body\' },',
              '        { status: 400 },',
              '      );',
              '    }',
              '',
              '    // TODO: implement handler',
              '    return NextResponse.json({ success: true });',
              '  } catch {',
              '    return NextResponse.json(',
              '      { error: \'Internal server error\' },',
              '      { status: 500 },',
              '    );',
              '  }',
              '}',
            ].join('\n'),
            action: 'create',
          },
        ],
        variables: [
          { name: 'name', description: 'Endpoint name (e.g. submit, webhook)', required: true },
          { name: 'method', description: 'HTTP method (GET, POST, PUT, DELETE)', defaultValue: 'POST', required: false },
        ],
      },
      tags: ['api', 'endpoint', 'validation', 'nextjs'],
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    },
  ];
}
