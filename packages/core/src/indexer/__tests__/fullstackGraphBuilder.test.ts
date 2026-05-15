import { describe, it, expect, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { FullstackGraphBuilder } from '../FullstackGraphBuilder.js';
import type {
  ProjectMap,
  StackInfo,
  ComponentInfo,
  EndpointInfo,
  ModelInfo,
  DependencyNode,
} from '../../models/types.js';

const nextjsStack: StackInfo = {
  framework: 'next.js',
  language: 'typescript',
  typescript: true,
};

function makeProjectMap(overrides: Partial<ProjectMap> = {}): ProjectMap {
  return {
    stack: nextjsStack,
    devCommand: 'npm run dev',
    port: 3000,
    routes: [],
    components: [],
    endpoints: [],
    models: [],
    dependencies: new Map(),
    fileContexts: new Map(),
    compressedContext: '',
    ...overrides,
  };
}

describe('FullstackGraphBuilder', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<string> {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fsgraph-test-'));
    return tmpDir;
  }

  it('returns empty graph for empty ProjectMap', async () => {
    const dir = await setup();
    const builder = new FullstackGraphBuilder(dir);
    const graph = await builder.build(makeProjectMap());

    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it('creates frontend nodes from components', async () => {
    const dir = await setup();
    const builder = new FullstackGraphBuilder(dir);
    const components: ComponentInfo[] = [
      {
        name: 'UserTable',
        filePath: 'src/UserTable.tsx',
        type: 'component',
        exports: ['UserTable'],
      },
      { name: 'Dashboard', filePath: 'src/Dashboard.tsx', type: 'page', exports: ['default'] },
    ];

    const graph = await builder.build(makeProjectMap({ components }));

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0]!.layer).toBe('frontend');
    expect(graph.nodes[0]!.type).toBe('component');
    expect(graph.nodes[0]!.id).toBe('src/UserTable.tsx:UserTable');
    expect(graph.nodes[1]!.type).toBe('page');
  });

  it('creates backend nodes from endpoints', async () => {
    const dir = await setup();
    const builder = new FullstackGraphBuilder(dir);
    const endpoints: EndpointInfo[] = [
      { method: 'GET', path: '/api/users', filePath: 'app/api/users/route.ts', handler: 'GET' },
    ];

    const graph = await builder.build(makeProjectMap({ endpoints }));

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.layer).toBe('backend');
    expect(graph.nodes[0]!.type).toBe('api_endpoint');
    expect(graph.nodes[0]!.id).toBe('app/api/users/route.ts:GET');
  });

  it('creates database nodes from models', async () => {
    const dir = await setup();
    const builder = new FullstackGraphBuilder(dir);
    const models: ModelInfo[] = [
      { name: 'User', filePath: 'prisma/schema.prisma', fields: ['id', 'email'] },
    ];

    const graph = await builder.build(makeProjectMap({ models }));

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.layer).toBe('database');
    expect(graph.nodes[0]!.type).toBe('db_model');
    expect(graph.nodes[0]!.id).toBe('prisma/schema.prisma:User');
  });

  it('detects frontend->backend edges from fetch calls', async () => {
    const dir = await setup();
    const compFile = path.join(dir, 'UserList.tsx');
    await fsp.writeFile(
      compFile,
      `
      export function UserList() {
        const res = await fetch('/api/users');
        return <div />;
      }
    `,
    );

    const builder = new FullstackGraphBuilder(dir);
    const graph = await builder.build(
      makeProjectMap({
        components: [
          { name: 'UserList', filePath: compFile, type: 'component', exports: ['UserList'] },
        ],
        endpoints: [
          { method: 'GET', path: '/api/users', filePath: 'app/api/users/route.ts', handler: 'GET' },
        ],
      }),
    );

    const fetchEdges = graph.edges.filter((e) => e.type === 'fetches');
    expect(fetchEdges).toHaveLength(1);
    expect(fetchEdges[0]!.from).toBe(`${compFile}:UserList`);
    expect(fetchEdges[0]!.to).toBe('app/api/users/route.ts:GET');
  });

  it('detects frontend->backend edges from axios calls', async () => {
    const dir = await setup();
    const compFile = path.join(dir, 'CreateUser.tsx');
    await fsp.writeFile(
      compFile,
      `
      export function CreateUser() {
        axios.post('/api/users', data);
      }
    `,
    );

    const builder = new FullstackGraphBuilder(dir);
    const graph = await builder.build(
      makeProjectMap({
        components: [
          { name: 'CreateUser', filePath: compFile, type: 'component', exports: ['CreateUser'] },
        ],
        endpoints: [
          {
            method: 'POST',
            path: '/api/users',
            filePath: 'app/api/users/route.ts',
            handler: 'POST',
          },
        ],
      }),
    );

    const fetchEdges = graph.edges.filter((e) => e.type === 'fetches');
    expect(fetchEdges).toHaveLength(1);
    expect(fetchEdges[0]!.metadata?.method).toBe('POST');
  });

  it('detects frontend->backend edges from useSWR calls', async () => {
    const dir = await setup();
    const compFile = path.join(dir, 'Profile.tsx');
    await fsp.writeFile(
      compFile,
      `
      export function Profile() {
        const { data } = useSWR('/api/profile');
        return <div>{data}</div>;
      }
    `,
    );

    const builder = new FullstackGraphBuilder(dir);
    const graph = await builder.build(
      makeProjectMap({
        components: [
          { name: 'Profile', filePath: compFile, type: 'component', exports: ['Profile'] },
        ],
        endpoints: [
          {
            method: 'GET',
            path: '/api/profile',
            filePath: 'app/api/profile/route.ts',
            handler: 'GET',
          },
        ],
      }),
    );

    const fetchEdges = graph.edges.filter((e) => e.type === 'fetches');
    expect(fetchEdges).toHaveLength(1);
  });

  it('detects backend->database edges from Prisma queries', async () => {
    const dir = await setup();
    const apiFile = path.join(dir, 'route.ts');
    await fsp.writeFile(
      apiFile,
      `
      export async function GET() {
        const users = await prisma.user.findMany();
        return Response.json(users);
      }
    `,
    );

    const builder = new FullstackGraphBuilder(dir);
    const graph = await builder.build(
      makeProjectMap({
        endpoints: [{ method: 'GET', path: '/api/users', filePath: apiFile, handler: 'GET' }],
        models: [{ name: 'User', filePath: 'prisma/schema.prisma', fields: ['id', 'email'] }],
      }),
    );

    const queryEdges = graph.edges.filter((e) => e.type === 'queries');
    expect(queryEdges).toHaveLength(1);
    expect(queryEdges[0]!.to).toBe('prisma/schema.prisma:User');
    expect(queryEdges[0]!.metadata?.operation).toBe('findMany');
  });

  it('detects backend->database edges from Django ORM', async () => {
    const dir = await setup();
    const apiFile = path.join(dir, 'views.py');
    await fsp.writeFile(
      apiFile,
      `
      def get_users(request):
          users = User.objects.filter(active=True)
          return JsonResponse(list(users))
    `,
    );

    const builder = new FullstackGraphBuilder(dir);
    const graph = await builder.build(
      makeProjectMap({
        endpoints: [{ method: 'GET', path: '/api/users', filePath: apiFile, handler: 'get_users' }],
        models: [{ name: 'User', filePath: 'models.py' }],
      }),
    );

    const queryEdges = graph.edges.filter((e) => e.type === 'queries');
    expect(queryEdges).toHaveLength(1);
  });

  it('detects backend->database edges from Entity Framework', async () => {
    const dir = await setup();
    const apiFile = path.join(dir, 'UsersController.cs');
    await fsp.writeFile(
      apiFile,
      `
      public async Task<IActionResult> GetUsers() {
          var users = await _context.Users.ToListAsync();
          return Ok(users);
      }
    `,
    );

    const builder = new FullstackGraphBuilder(dir);
    const graph = await builder.build(
      makeProjectMap({
        endpoints: [{ method: 'GET', path: '/api/users', filePath: apiFile, handler: 'GetUsers' }],
        models: [{ name: 'User', filePath: 'Models/User.cs', fields: ['Id', 'Email'] }],
      }),
    );

    const queryEdges = graph.edges.filter((e) => e.type === 'queries');
    expect(queryEdges).toHaveLength(1);
  });

  it('detects component->component edges from dependencies', async () => {
    const dir = await setup();
    const builder = new FullstackGraphBuilder(dir);

    const deps = new Map<string, DependencyNode>();
    deps.set('src/Dashboard.tsx', {
      filePath: 'src/Dashboard.tsx',
      imports: ['src/UserTable.tsx'],
      exports: ['Dashboard'],
      type: 'page',
      keywords: [],
    });
    deps.set('src/UserTable.tsx', {
      filePath: 'src/UserTable.tsx',
      imports: [],
      exports: ['UserTable'],
      type: 'component',
      keywords: [],
    });

    const graph = await builder.build(
      makeProjectMap({
        components: [
          {
            name: 'Dashboard',
            filePath: 'src/Dashboard.tsx',
            type: 'page',
            exports: ['Dashboard'],
          },
          {
            name: 'UserTable',
            filePath: 'src/UserTable.tsx',
            type: 'component',
            exports: ['UserTable'],
          },
        ],
        dependencies: deps,
      }),
    );

    const renderEdges = graph.edges.filter((e) => e.type === 'renders');
    expect(renderEdges).toHaveLength(1);
    expect(renderEdges[0]!.from).toBe('src/Dashboard.tsx:Dashboard');
    expect(renderEdges[0]!.to).toBe('src/UserTable.tsx:UserTable');
  });

  it('matches URL with path parameters', async () => {
    const dir = await setup();
    const builder = new FullstackGraphBuilder(dir);

    const result = builder.matchUrlToEndpoint('/api/users/123', [
      { method: 'GET', path: '/api/users/:id', filePath: 'route.ts' },
    ]);

    expect(result).not.toBeNull();
    expect(result!.path).toBe('/api/users/:id');
  });

  it('matches URL with bracket-style path parameters', async () => {
    const dir = await setup();
    const builder = new FullstackGraphBuilder(dir);

    const result = builder.matchUrlToEndpoint('/api/users/abc', [
      { method: 'GET', path: '/api/users/[id]', filePath: 'route.ts' },
    ]);

    expect(result).not.toBeNull();
    expect(result!.path).toBe('/api/users/[id]');
  });

  it('model name matching is case-insensitive and handles plurals', async () => {
    const dir = await setup();
    const builder = new FullstackGraphBuilder(dir);
    const models: ModelInfo[] = [{ name: 'User', filePath: 'models/User.ts' }];

    expect(builder.matchModelNameToModel('user', models)?.name).toBe('User');
    expect(builder.matchModelNameToModel('Users', models)?.name).toBe('User');
    expect(builder.matchModelNameToModel('USER', models)?.name).toBe('User');
    expect(builder.matchModelNameToModel('nonexistent', models)).toBeNull();
  });

  it('handles missing files gracefully', async () => {
    const dir = await setup();
    const builder = new FullstackGraphBuilder(dir);

    const graph = await builder.build(
      makeProjectMap({
        components: [
          {
            name: 'Missing',
            filePath: '/nonexistent/path/Missing.tsx',
            type: 'component',
            exports: ['Missing'],
          },
        ],
        endpoints: [
          {
            method: 'GET',
            path: '/api/test',
            filePath: '/nonexistent/path/route.ts',
            handler: 'GET',
          },
        ],
      }),
    );

    // Nodes should still be created even if files can't be read
    expect(graph.nodes).toHaveLength(2);
    // No edges since files can't be read
    expect(graph.edges).toHaveLength(0);
  });

  it('does not create duplicate edges', async () => {
    const dir = await setup();
    const compFile = path.join(dir, 'UserList.tsx');
    // Two fetch calls to the same endpoint
    await fsp.writeFile(
      compFile,
      `
      export function UserList() {
        fetch('/api/users');
        fetch('/api/users');
      }
    `,
    );

    const builder = new FullstackGraphBuilder(dir);
    const graph = await builder.build(
      makeProjectMap({
        components: [
          { name: 'UserList', filePath: compFile, type: 'component', exports: ['UserList'] },
        ],
        endpoints: [{ method: 'GET', path: '/api/users', filePath: 'route.ts', handler: 'GET' }],
      }),
    );

    const fetchEdges = graph.edges.filter((e) => e.type === 'fetches');
    expect(fetchEdges).toHaveLength(1);
  });

  describe('extractApiCalls', () => {
    it('extracts fetch calls with template literals', () => {
      const dir = '/tmp';
      const builder = new FullstackGraphBuilder(dir);
      const content = 'fetch(`/api/users/${id}`)';
      const calls = builder.extractApiCalls(content);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]!.url).toContain('/api/users/');
    });

    it('extracts useQuery calls', () => {
      const dir = '/tmp';
      const builder = new FullstackGraphBuilder(dir);
      const content = "useQuery(['users'], '/api/users')";
      const calls = builder.extractApiCalls(content);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe('/api/users');
    });
  });

  describe('extractOrmQueries', () => {
    it('extracts TypeORM getRepository calls', () => {
      const builder = new FullstackGraphBuilder('/tmp');
      const content = 'const repo = getRepository(User);';
      const queries = builder.extractOrmQueries(content, nextjsStack);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.modelName).toBe('User');
    });

    it('extracts SQLAlchemy session.query calls', () => {
      const builder = new FullstackGraphBuilder('/tmp');
      const content = 'users = session.query(User).all()';
      const queries = builder.extractOrmQueries(content, nextjsStack);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.modelName).toBe('User');
    });

    it('extracts DbSet<Model> patterns', () => {
      const builder = new FullstackGraphBuilder('/tmp');
      const content = 'public DbSet<Product> Products { get; set; }';
      const queries = builder.extractOrmQueries(content, nextjsStack);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.modelName).toBe('Product');
    });
  });
});
