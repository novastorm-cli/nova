export interface IPathGuard {
  check(absPath: string): Promise<void>;
  validate(absPath: string): void;
  allow(dirPath: string): void;
  loadBoundaries(boundaries: {
    writable?: string[] | undefined;
    readonly?: string[] | undefined;
    ignored?: string[] | undefined;
  }): void;
  isReadonly(absPath: string): boolean;
  isIgnored(absPath: string): boolean;
}

export class PathDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathDeniedError';
  }
}

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathTraversalError';
  }
}
