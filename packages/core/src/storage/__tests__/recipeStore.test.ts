import { describe, it, expect, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { RecipeStore } from '../RecipeStore.js';
import type { Recipe } from '../../models/types.js';

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  const now = Date.now();
  return {
    id: randomUUID(),
    name: 'Test Recipe',
    description: 'A test recipe',
    category: 'custom',
    template: {
      files: [
        {
          pathPattern: 'src/{{name}}.ts',
          content: 'export const {{name}} = {};',
          action: 'create',
        },
      ],
      variables: [
        { name: 'name', description: 'Name', required: true },
      ],
    },
    tags: ['test'],
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('RecipeStore', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function createStore(): Promise<RecipeStore> {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'recipestore-test-'));
    return new RecipeStore(tmpDir);
  }

  // --- save + load ---

  it('save() + load() roundtrip preserves recipe', async () => {
    const store = await createStore();
    const recipe = makeRecipe();

    await store.save(recipe);
    const loaded = await store.load(recipe.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(recipe.id);
    expect(loaded!.name).toBe(recipe.name);
  });

  it('load() returns null for nonexistent id', async () => {
    const store = await createStore();
    const loaded = await store.load('nonexistent');
    expect(loaded).toBeNull();
  });

  it('save() updates updatedAt timestamp', async () => {
    const store = await createStore();
    const recipe = makeRecipe({ updatedAt: 1000 });

    await store.save(recipe);
    const loaded = await store.load(recipe.id);

    expect(loaded!.updatedAt).toBeGreaterThan(1000);
  });

  // --- getAll + built-in recipes ---

  it('getAll() creates built-in recipes when directory is empty', async () => {
    const store = await createStore();
    const all = await store.getAll();

    expect(all.length).toBe(5);
    const categories = all.map((r) => r.category);
    expect(categories).toContain('crud_endpoint');
    expect(categories).toContain('form_field');
    expect(categories).toContain('new_page');
    expect(categories).toContain('component');
    expect(categories).toContain('api_route');
  });

  it('getAll() does not re-create built-ins if recipes exist', async () => {
    const store = await createStore();
    const custom = makeRecipe({ name: 'Custom' });
    await store.save(custom);

    const all = await store.getAll();
    // Should only have the one custom recipe, no built-ins
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Custom');
  });

  // --- findByCategory ---

  it('findByCategory() filters correctly', async () => {
    const store = await createStore();
    await store.save(makeRecipe({ category: 'component' }));
    await store.save(makeRecipe({ category: 'custom' }));
    await store.save(makeRecipe({ category: 'component' }));

    const components = await store.findByCategory('component');
    expect(components).toHaveLength(2);
    expect(components.every((r) => r.category === 'component')).toBe(true);
  });

  // --- findByTags ---

  it('findByTags() returns recipes with any matching tag', async () => {
    const store = await createStore();
    await store.save(makeRecipe({ tags: ['react', 'form'] }));
    await store.save(makeRecipe({ tags: ['api', 'rest'] }));
    await store.save(makeRecipe({ tags: ['react', 'component'] }));

    const results = await store.findByTags(['react']);
    expect(results).toHaveLength(2);
  });

  it('findByTags() is case-insensitive', async () => {
    const store = await createStore();
    await store.save(makeRecipe({ tags: ['React'] }));

    const results = await store.findByTags(['react']);
    expect(results).toHaveLength(1);
  });

  // --- search ---

  it('search() matches in name', async () => {
    const store = await createStore();
    await store.save(makeRecipe({ name: 'User Form' }));
    await store.save(makeRecipe({ name: 'Dashboard Page' }));

    const results = await store.search('form');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('User Form');
  });

  it('search() matches in description', async () => {
    const store = await createStore();
    await store.save(makeRecipe({ description: 'Creates authentication flow' }));

    const results = await store.search('authentication');
    expect(results).toHaveLength(1);
  });

  it('search() matches in tags', async () => {
    const store = await createStore();
    await store.save(makeRecipe({ tags: ['nextjs', 'api'] }));

    const results = await store.search('nextjs');
    expect(results).toHaveLength(1);
  });

  it('search() is case-insensitive', async () => {
    const store = await createStore();
    await store.save(makeRecipe({ name: 'UserTable' }));

    const results = await store.search('USERTABLE');
    expect(results).toHaveLength(1);
  });

  // --- incrementUsage ---

  it('incrementUsage() increments the counter', async () => {
    const store = await createStore();
    const recipe = makeRecipe({ usageCount: 5 });
    await store.save(recipe);

    await store.incrementUsage(recipe.id);
    const loaded = await store.load(recipe.id);

    expect(loaded!.usageCount).toBe(6);
  });

  it('incrementUsage() on nonexistent id is a no-op', async () => {
    const store = await createStore();
    await expect(store.incrementUsage('nonexistent')).resolves.toBeUndefined();
  });

  // --- remove ---

  it('remove() deletes a recipe', async () => {
    const store = await createStore();
    const recipe = makeRecipe();
    await store.save(recipe);

    await store.remove(recipe.id);
    const loaded = await store.load(recipe.id);

    expect(loaded).toBeNull();
  });

  it('remove() on nonexistent id is a no-op', async () => {
    const store = await createStore();
    await expect(store.remove('nonexistent')).resolves.toBeUndefined();
  });
});
