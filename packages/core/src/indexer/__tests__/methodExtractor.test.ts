import { describe, it, expect } from 'vitest';
import { MethodExtractor } from '../MethodExtractor.js';

describe('MethodExtractor', () => {
  const extractor = new MethodExtractor();

  it('extracts standalone functions', () => {
    const code = `export function fetchUsers(ids: string[]): Promise<User[]> {
  return db.query(ids);
}`;
    const methods = extractor.extract(code, 'src/api.ts');
    expect(methods).toHaveLength(1);
    expect(methods[0]!.name).toBe('fetchUsers');
    expect(methods[0]!.isAsync).toBe(false);
    expect(methods[0]!.visibility).toBe('public');
    expect(methods[0]!.filePath).toBe('src/api.ts');
  });

  it('extracts async functions', () => {
    const code = `export async function loadData() {
  return await fetch('/api');
}`;
    const methods = extractor.extract(code, 'src/loader.ts');
    expect(methods).toHaveLength(1);
    expect(methods[0]!.isAsync).toBe(true);
    expect(methods[0]!.signature).toContain('async');
  });

  it('extracts arrow function consts', () => {
    const code = `export const handleClick = async (e: MouseEvent) => {
  console.log(e);
};`;
    const methods = extractor.extract(code, 'src/handler.ts');
    expect(methods).toHaveLength(1);
    expect(methods[0]!.name).toBe('handleClick');
    expect(methods[0]!.isAsync).toBe(true);
  });

  it('extracts class methods with visibility', () => {
    const code = `export class UserService {
  private readonly db: Database;

  public async findById(id: string): Promise<User> {
    return this.db.find(id);
  }

  private validate(user: User): boolean {
    return !!user.name;
  }
}`;
    const methods = extractor.extract(code, 'src/service.ts');
    expect(methods.length).toBeGreaterThanOrEqual(2);

    const findById = methods.find((m) => m.name === 'findById');
    expect(findById).toBeDefined();
    expect(findById!.visibility).toBe('public');
    expect(findById!.isAsync).toBe(true);
    expect(findById!.className).toBe('UserService');

    const validate = methods.find((m) => m.name === 'validate');
    expect(validate).toBeDefined();
    expect(validate!.visibility).toBe('private');
  });

  it('extracts JSDoc as purpose', () => {
    const code = `/** Fetches all active users from the database. */
export function getActiveUsers() {
  return [];
}`;
    const methods = extractor.extract(code, 'src/users.ts');
    expect(methods).toHaveLength(1);
    expect(methods[0]!.purpose).toBe('Fetches all active users from the database');
  });

  it('generates purpose from camelCase name when no JSDoc', () => {
    const code = `export function calculateTotalPrice() {
  return 0;
}`;
    const methods = extractor.extract(code, 'src/calc.ts');
    expect(methods).toHaveLength(1);
    expect(methods[0]!.purpose).toBe('calculate total price');
  });

  it('handles files with no methods', () => {
    const code = `export const MAX_SIZE = 100;\nexport type Config = { key: string };`;
    const methods = extractor.extract(code, 'src/constants.ts');
    expect(methods).toHaveLength(0);
  });
});
