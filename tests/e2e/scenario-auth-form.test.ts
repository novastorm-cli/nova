import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { LlmClient, ProjectMap, Observation, TaskItem, MiniContext } from '../../packages/core/src/models/types.js';
import type { NovaEvent, EventBus } from '../../packages/core/src/models/events.js';
import type { IGitManager } from '../../packages/core/src/contracts/IGitManager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpDirsToClean: string[] = [];

function trackTmp(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nova-auth-'));
  tmpDirsToClean.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirsToClean) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function createFile(dir: string, filePath: string, content: string): void {
  const absPath = path.join(dir, filePath);
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, 'utf-8');
}

function makeMockLlm(chatResponse: string, streamResponse?: string): LlmClient {
  return {
    chat: vi.fn(async () => chatResponse),
    chatWithVision: vi.fn(async () => chatResponse),
    stream: vi.fn(async function* () {
      yield streamResponse ?? chatResponse;
    }),
  };
}

function makeMockGit(): IGitManager {
  return {
    commit: vi.fn(async () => 'abc1234'),
    createBranch: vi.fn(async () => 'nova/test'),
    rollback: vi.fn(),
    getDiff: vi.fn(async () => ''),
    getLog: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => 'main'),
    getDevCount: vi.fn(async () => 1),
    hasUncommittedChanges: vi.fn(async () => false),
    stash: vi.fn(),
    unstash: vi.fn(),
  };
}

function makeMockEventBus(): EventBus {
  return { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
}

function makeTask(overrides: Partial<TaskItem> & Pick<TaskItem, 'description' | 'files' | 'type' | 'lane'>): TaskItem {
  return {
    id: crypto.randomUUID(),
    status: 'pending',
    ...overrides,
  };
}

function makeProjectMap(fileContexts: Map<string, MiniContext>, overrides?: Partial<ProjectMap>): ProjectMap {
  return {
    stack: { framework: 'next.js', language: 'typescript', typescript: true },
    devCommand: 'npm run dev',
    port: 3000,
    routes: [],
    components: [],
    endpoints: [],
    models: [],
    dependencies: new Map(),
    fileContexts,
    compressedContext: 'Next.js + ASP.NET Core fullstack app',
    ...overrides,
  };
}

function makeFullstackProjectMap(fileContexts: Map<string, MiniContext>, overrides?: Partial<ProjectMap>): ProjectMap {
  return {
    stack: { framework: 'next.js', language: 'typescript', typescript: true },
    devCommand: 'npm run dev',
    port: 3000,
    routes: [
      { path: '/', filePath: 'app/page.tsx', type: 'page' },
    ],
    components: [
      { name: 'Header', filePath: 'components/Header.tsx', type: 'component', exports: ['Header'] },
    ],
    endpoints: [],
    models: [],
    dependencies: new Map(),
    fileContexts,
    compressedContext: 'Next.js 14 + ASP.NET Core 8 fullstack app with Tailwind CSS',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fullstack project fixture
// ---------------------------------------------------------------------------

function createFullstackProject(dir: string): void {
  createFile(dir, 'package.json', JSON.stringify({
    name: 'my-app',
    dependencies: { next: '14.0.0', react: '18.2.0', 'react-dom': '18.2.0' },
    devDependencies: { typescript: '5.0.0', tailwindcss: '3.4.0', '@types/react': '18.2.0', '@types/node': '20.0.0' },
    scripts: { dev: 'next dev' },
  }, null, 2));
  createFile(dir, 'tsconfig.json', '{"compilerOptions":{"target":"es5","lib":["dom"],"jsx":"preserve"}}');
  createFile(dir, 'app/layout.tsx', `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}`);
  createFile(dir, 'app/page.tsx', `export default function Home() {
  return <main><h1>Welcome to My App</h1><p>Please log in to continue.</p></main>;
}`);
  createFile(dir, 'app/globals.css', `@tailwind base;\n@tailwind components;\n@tailwind utilities;\nbody { font-family: sans-serif; }`);
  createFile(dir, 'components/Header.tsx', `export function Header() {
  return <header className="bg-blue-600 text-white p-4"><h1>My App</h1></header>;
}`);

  // C# backend files
  createFile(dir, 'backend/WebApp.csproj', `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`);
  createFile(dir, 'backend/Program.cs', `var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
var app = builder.Build();
app.MapControllers();
app.Run();`);
  createFile(dir, 'backend/Controllers/UsersController.cs', `using Microsoft.AspNetCore.Mvc;
namespace WebApp.Controllers;
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok(new[] { new { Id = 1, Name = "John" } });
}`);
}

function buildFullstackFileContexts(dir: string): Map<string, MiniContext> {
  const fileContexts = new Map<string, MiniContext>();
  const files: Record<string, string> = {
    'package.json': readFileSync(path.join(dir, 'package.json'), 'utf-8'),
    'app/layout.tsx': readFileSync(path.join(dir, 'app/layout.tsx'), 'utf-8'),
    'app/page.tsx': readFileSync(path.join(dir, 'app/page.tsx'), 'utf-8'),
    'app/globals.css': readFileSync(path.join(dir, 'app/globals.css'), 'utf-8'),
    'components/Header.tsx': readFileSync(path.join(dir, 'components/Header.tsx'), 'utf-8'),
  };
  for (const [relPath, content] of Object.entries(files)) {
    fileContexts.set(relPath, { filePath: relPath, content, importedTypes: '' });
  }
  return fileContexts;
}

// ---------------------------------------------------------------------------
// Mock LLM response content
// ---------------------------------------------------------------------------

const LOGIN_PAGE_CONTENT = `'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Login failed');
      }

      window.location.href = '/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h2 className="text-2xl font-bold mb-6 text-center">Sign In</h2>
        {error && <p className="text-red-500 mb-4">{error}</p>}
        <div className="mb-4">
          <label htmlFor="email" className="block text-sm font-medium mb-1">Email</label>
          <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full border rounded px-3 py-2" />
        </div>
        <div className="mb-6">
          <label htmlFor="password" className="block text-sm font-medium mb-1">Password</label>
          <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full border rounded px-3 py-2" />
        </div>
        <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
        <p className="mt-4 text-center text-sm">Don't have an account? <a href="/register" className="text-blue-600">Sign up</a></p>
      </form>
    </div>
  );
}`;

const REGISTER_PAGE_CONTENT = `'use client';

import { useState } from 'react';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Registration failed');
      }

      window.location.href = '/login';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h2 className="text-2xl font-bold mb-6 text-center">Create Account</h2>
        {error && <p className="text-red-500 mb-4">{error}</p>}
        <div className="mb-4">
          <label htmlFor="name" className="block text-sm font-medium mb-1">Name</label>
          <input id="name" type="text" value={name} onChange={e => setName(e.target.value)} required className="w-full border rounded px-3 py-2" />
        </div>
        <div className="mb-4">
          <label htmlFor="email" className="block text-sm font-medium mb-1">Email</label>
          <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full border rounded px-3 py-2" />
        </div>
        <div className="mb-4">
          <label htmlFor="password" className="block text-sm font-medium mb-1">Password</label>
          <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full border rounded px-3 py-2" />
        </div>
        <div className="mb-6">
          <label htmlFor="confirmPassword" className="block text-sm font-medium mb-1">Confirm Password</label>
          <input id="confirmPassword" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required className="w-full border rounded px-3 py-2" />
        </div>
        <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Creating account...' : 'Sign Up'}
        </button>
        <p className="mt-4 text-center text-sm">Already have an account? <a href="/login" className="text-blue-600">Sign in</a></p>
      </form>
    </div>
  );
}`;

const AUTH_CONTROLLER_CONTENT = `using Microsoft.AspNetCore.Mvc;

namespace WebApp.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    [HttpPost("login")]
    public IActionResult Login([FromBody] LoginRequest request)
    {
        if (request.Email == "admin@test.com" && request.Password == "password")
        {
            return Ok(new { token = "jwt-token-here", user = new { email = request.Email } });
        }
        return Unauthorized(new { message = "Invalid credentials" });
    }

    [HttpPost("register")]
    public IActionResult Register([FromBody] RegisterRequest request)
    {
        return Created("", new { message = "User registered", user = new { email = request.Email, name = request.Name } });
    }
}`;

const LOGIN_REQUEST_CONTENT = `namespace WebApp.Models;

public class LoginRequest
{
    public string Email { get; set; } = "";
    public string Password { get; set; } = "";
}`;

const REGISTER_REQUEST_CONTENT = `namespace WebApp.Models;

public class RegisterRequest
{
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string Password { get; set; } = "";
}`;

const AUTH_MIDDLEWARE_CONTENT = `using Microsoft.AspNetCore.Http;
using System.Threading.Tasks;

namespace WebApp.Middleware;

public class AuthMiddleware
{
    private readonly RequestDelegate _next;

    public AuthMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var token = context.Request.Headers["Authorization"].ToString();
        if (string.IsNullOrEmpty(token) && context.Request.Path.StartsWithSegments("/api/auth"))
        {
            await _next(context);
            return;
        }
        await _next(context);
    }
}`;

const HEADER_UPDATED_CONTENT = `export function Header() {
  return (
    <header className="bg-blue-600 text-white p-4 flex items-center justify-between">
      <h1>My App</h1>
      <nav className="flex gap-4">
        <a href="/login" className="hover:underline">Login</a>
        <a href="/register" className="hover:underline">Register</a>
      </nav>
    </header>
  );
}`;

// ---------------------------------------------------------------------------
// Build LLM stream responses
// ---------------------------------------------------------------------------

function buildLoginPageStreamResponse(): string {
  return [
    '=== FILE: app/login/page.tsx ===',
    LOGIN_PAGE_CONTENT,
    '=== END FILE ===',
  ].join('\n');
}

function buildRegisterPageStreamResponse(): string {
  return [
    '=== FILE: app/register/page.tsx ===',
    REGISTER_PAGE_CONTENT,
    '=== END FILE ===',
  ].join('\n');
}

function buildAuthControllerStreamResponse(): string {
  return [
    '=== FILE: backend/Controllers/AuthController.cs ===',
    AUTH_CONTROLLER_CONTENT,
    '=== END FILE ===',
    '',
    '=== FILE: backend/Models/LoginRequest.cs ===',
    LOGIN_REQUEST_CONTENT,
    '=== END FILE ===',
    '',
    '=== FILE: backend/Models/RegisterRequest.cs ===',
    REGISTER_REQUEST_CONTENT,
    '=== END FILE ===',
  ].join('\n');
}

function buildHeaderDiffStreamResponse(): string {
  return [
    '=== DIFF: components/Header.tsx ===',
    '--- a/components/Header.tsx',
    '+++ b/components/Header.tsx',
    '@@ -1,3 +1,10 @@',
    ' export function Header() {',
    '-  return <header className="bg-blue-600 text-white p-4"><h1>My App</h1></header>;',
    '+  return (',
    '+    <header className="bg-blue-600 text-white p-4 flex items-center justify-between">',
    '+      <h1>My App</h1>',
    '+      <nav className="flex gap-4">',
    '+        <a href="/login" className="hover:underline">Login</a>',
    '+        <a href="/register" className="hover:underline">Register</a>',
    '+      </nav>',
    '+    </header>',
    '+  );',
    ' }',
    '=== END DIFF ===',
  ].join('\n');
}

function buildAuthMiddlewareStreamResponse(): string {
  return [
    '=== FILE: backend/Middleware/AuthMiddleware.cs ===',
    AUTH_MIDDLEWARE_CONTENT,
    '=== END FILE ===',
  ].join('\n');
}

function buildProgramCsDiffStreamResponse(): string {
  return [
    '=== DIFF: backend/Program.cs ===',
    '--- a/backend/Program.cs',
    '+++ b/backend/Program.cs',
    '@@ -1,5 +1,7 @@',
    ' var builder = WebApplication.CreateBuilder(args);',
    ' builder.Services.AddControllers();',
    '+builder.Services.AddAuthentication();',
    ' var app = builder.Build();',
    '+app.UseAuthentication();',
    ' app.MapControllers();',
    ' app.Run();',
    '=== END DIFF ===',
  ].join('\n');
}

// ============================================================================
// 1. Brain Analysis -- "add auth form"
// ============================================================================

describe.concurrent('Brain Analysis -- auth form scenario', () => {

  it.concurrent('a) Brain.analyze with English transcript creates 4 tasks with correct lanes', async () => {
    const { Brain } = await import('../../packages/core/src/brain/Brain.js');

    const llmResponse = JSON.stringify([
      { description: 'Create login page with email and password form', files: ['app/login/page.tsx'], type: 'single_file' },
      { description: 'Create registration page with signup form', files: ['app/register/page.tsx'], type: 'single_file' },
      { description: 'Create AuthController with login and register endpoints', files: ['backend/Controllers/AuthController.cs', 'backend/Models/LoginRequest.cs', 'backend/Models/RegisterRequest.cs'], type: 'multi_file' },
      { description: 'Add auth navigation links to header', files: ['components/Header.tsx'], type: 'single_file' },
    ]);

    const llm = makeMockLlm(llmResponse);
    const brain = new Brain(llm);

    const observation: Observation = {
      screenshot: Buffer.from('fake'),
      currentUrl: 'http://localhost:3000/',
      transcript: 'add authentication form to the site',
      timestamp: Date.now(),
    };

    const projectMap = makeProjectMap(new Map());
    const tasks = await brain.analyze(observation, projectMap);

    expect(tasks).toHaveLength(4);

    // Login page: single file, "Create...page" -> lane 2
    expect(tasks[0].description).toContain('login page');
    expect(tasks[0].files).toContain('app/login/page.tsx');
    expect([2, 3]).toContain(tasks[0].lane);

    // Register page
    expect(tasks[1].description).toContain('registration page');
    expect(tasks[1].files).toContain('app/register/page.tsx');

    // AuthController: multi_file, 3 files -> lane 3
    expect(tasks[2].description).toContain('AuthController');
    expect(tasks[2].files).toHaveLength(3);
    expect(tasks[2].lane).toBe(3);

    // Header update: single file -> lane 2
    expect(tasks[3].description).toContain('header');
    expect(tasks[3].files).toContain('components/Header.tsx');
    expect([2, 3]).toContain(tasks[3].lane);
  });

  it.concurrent('b) Brain.analyze with Russian transcript creates tasks', async () => {
    const { Brain } = await import('../../packages/core/src/brain/Brain.js');

    const llmResponse = JSON.stringify([
      { description: 'Create login page with email and password form', files: ['app/login/page.tsx'], type: 'single_file' },
      { description: 'Create registration page', files: ['app/register/page.tsx'], type: 'single_file' },
      { description: 'Create AuthController with login and register endpoints', files: ['backend/Controllers/AuthController.cs', 'backend/Models/LoginRequest.cs'], type: 'multi_file' },
    ]);

    const llm = makeMockLlm(llmResponse);
    const brain = new Brain(llm);

    const observation: Observation = {
      screenshot: Buffer.from('fake'),
      currentUrl: 'http://localhost:3000/',
      transcript: '\u0434\u043e\u0431\u0430\u0432\u044c \u0444\u043e\u0440\u043c\u0443 \u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446\u0438\u0438',
      timestamp: Date.now(),
    };

    const projectMap = makeProjectMap(new Map());
    const tasks = await brain.analyze(observation, projectMap);

    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].description).toBeDefined();
    expect(tasks[0].files.length).toBeGreaterThan(0);
    expect(tasks[0].status).toBe('pending');
    expect(tasks[0].id).toBeDefined();

    // LLM was called with the Russian transcript (chatWithVision when screenshot is non-empty)
    expect(llm.chatWithVision).toHaveBeenCalledTimes(1);
  });

  it.concurrent('c) LaneClassifier on auth-related tasks assigns correct lanes', async () => {
    const { LaneClassifier } = await import('../../packages/core/src/brain/LaneClassifier.js');
    const classifier = new LaneClassifier();

    // Single file page creation -> lane 2
    const lane1 = classifier.classify(
      'Create login page with email/password form',
      ['app/login/page.tsx'],
    );
    expect(lane1).toBe(2);

    // Multi-file controller -> lane 3
    const lane2 = classifier.classify(
      'Create AuthController with login and register',
      ['backend/Controllers/AuthController.cs', 'backend/Models/LoginRequest.cs'],
    );
    expect(lane2).toBe(3);

    // CSS-only change to single file -> lane 1
    const lane3 = classifier.classify(
      'Change header color to match auth theme',
      ['app/globals.css'],
    );
    expect(lane3).toBe(1);

    // Refactor keyword -> lane 4
    const lane4 = classifier.classify(
      'Refactor entire auth system to use JWT',
      ['backend/Controllers/AuthController.cs'],
    );
    expect(lane4).toBe(4);
  });

  it.concurrent('d) TaskDecomposer decomposes lane 3 task into subtasks', async () => {
    const { TaskDecomposer } = await import('../../packages/core/src/brain/TaskDecomposer.js');

    const subtasksResponse = JSON.stringify([
      { description: 'Create AuthController with login endpoint', files: ['backend/Controllers/AuthController.cs'], type: 'single_file' },
      { description: 'Create LoginRequest model', files: ['backend/Models/LoginRequest.cs'], type: 'single_file' },
      { description: 'Create RegisterRequest model', files: ['backend/Models/RegisterRequest.cs'], type: 'single_file' },
    ]);

    const llm = makeMockLlm(subtasksResponse);
    const decomposer = new TaskDecomposer(llm);

    const task = makeTask({
      description: 'Create AuthController with CRUD',
      files: ['backend/Controllers/AuthController.cs', 'backend/Models/LoginRequest.cs', 'backend/Models/RegisterRequest.cs'],
      type: 'multi_file',
      lane: 3,
    });

    const projectMap = makeProjectMap(new Map());
    const subtasks = await decomposer.decompose(task, projectMap);

    expect(subtasks.length).toBeGreaterThan(0);
    expect(subtasks[0].description).toBeDefined();
    expect(subtasks[0].id).toBeDefined();
    expect(subtasks[0].status).toBe('pending');
    // Each subtask should have a lane assigned
    for (const st of subtasks) {
      expect([1, 2, 3, 4]).toContain(st.lane);
    }
  });
});

// ============================================================================
// 2. Frontend Generation -- Login Page
// ============================================================================

describe.concurrent('Frontend Generation -- login page', () => {

  it.concurrent('a) Lane3Executor generates login page from FILE block', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);
    const eventBus = makeMockEventBus();

    const streamResponse = buildLoginPageStreamResponse();
    const llm = makeMockLlm('', streamResponse);
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const fileContexts = buildFullstackFileContexts(tmp);
    const projectMap = makeFullstackProjectMap(fileContexts);

    const task = makeTask({
      description: 'Create login page with email and password form',
      files: ['app/login/page.tsx'],
      type: 'single_file',
      lane: 3,
    });

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe('abc1234');

    const written = readFileSync(path.join(tmp, 'app', 'login', 'page.tsx'), 'utf-8');
    expect(written).toContain("'use client'");
    expect(written).toContain('useState');
    expect(written).toContain('handleSubmit');
    expect(written).toContain('type="email"');
    expect(written).toContain('type="password"');
    expect(written).toContain('form');
  });

  it.concurrent('b) Lane3Executor generates registration page', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);
    const eventBus = makeMockEventBus();

    const streamResponse = buildRegisterPageStreamResponse();
    const llm = makeMockLlm('', streamResponse);
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const fileContexts = buildFullstackFileContexts(tmp);
    const projectMap = makeFullstackProjectMap(fileContexts);

    const task = makeTask({
      description: 'Create registration page with signup form',
      files: ['app/register/page.tsx'],
      type: 'single_file',
      lane: 3,
    });

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);

    const written = readFileSync(path.join(tmp, 'app', 'register', 'page.tsx'), 'utf-8');
    expect(written).toContain('name');
    expect(written).toContain('email');
    expect(written).toContain('password');
    expect(written).toContain('confirmPassword');
    expect(written).toContain('form');
  });

  it.concurrent('c) Lane2Executor updates Header with auth links via diff', async () => {
    const { Lane2Executor } = await import('../../packages/core/src/executor/Lane2Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);

    const diffResponse = [
      '--- a/components/Header.tsx',
      '+++ b/components/Header.tsx',
      '@@ -1,3 +1,10 @@',
      ' export function Header() {',
      '-  return <header className="bg-blue-600 text-white p-4"><h1>My App</h1></header>;',
      '+  return (',
      '+    <header className="bg-blue-600 text-white p-4 flex items-center justify-between">',
      '+      <h1>My App</h1>',
      '+      <nav className="flex gap-4">',
      '+        <a href="/login" className="hover:underline">Login</a>',
      '+        <a href="/register" className="hover:underline">Register</a>',
      '+      </nav>',
      '+    </header>',
      '+  );',
      ' }',
    ].join('\n');

    const llm = makeMockLlm(diffResponse);
    const git = makeMockGit();

    const executor = new Lane2Executor(tmp, llm, git);

    const headerContent = readFileSync(path.join(tmp, 'components', 'Header.tsx'), 'utf-8');
    const fileContexts = new Map<string, MiniContext>();
    fileContexts.set('components/Header.tsx', {
      filePath: 'components/Header.tsx',
      content: headerContent,
      importedTypes: '',
    });

    const task = makeTask({
      description: 'Add login and register navigation links to header',
      files: ['components/Header.tsx'],
      type: 'single_file',
      lane: 2,
    });

    const projectMap = makeProjectMap(fileContexts);
    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);

    const updated = readFileSync(path.join(tmp, 'components', 'Header.tsx'), 'utf-8');
    expect(updated).toContain('/login');
    expect(updated).toContain('/register');
    expect(updated).toContain('Login');
    expect(updated).toContain('Register');
  });

  it.concurrent('d) parseMixedBlocks parses React + C# code mixed together', async () => {
    const { parseMixedBlocks } = await import('../../packages/core/src/executor/fileBlocks.js');

    const response = [
      '=== FILE: app/login/page.tsx ===',
      `export default function LoginPage() {`,
      `  return <form><input type="email" /><input type="password" /></form>;`,
      `}`,
      '=== END FILE ===',
      '',
      '=== FILE: backend/Controllers/AuthController.cs ===',
      'using Microsoft.AspNetCore.Mvc;',
      'namespace WebApp.Controllers;',
      '[ApiController]',
      'public class AuthController : ControllerBase',
      '{',
      '    [HttpPost("login")]',
      '    public IActionResult Login() => Ok();',
      '}',
      '=== END FILE ===',
      '',
      '=== FILE: backend/Models/LoginRequest.cs ===',
      'namespace WebApp.Models;',
      'public class LoginRequest { public string Email { get; set; } = ""; }',
      '=== END FILE ===',
    ].join('\n');

    const blocks = parseMixedBlocks(response);

    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe('file');
    expect(blocks[0].path).toBe('app/login/page.tsx');
    if (blocks[0].type === 'file') {
      expect(blocks[0].content).toContain('LoginPage');
    }

    expect(blocks[1].type).toBe('file');
    expect(blocks[1].path).toBe('backend/Controllers/AuthController.cs');
    if (blocks[1].type === 'file') {
      expect(blocks[1].content).toContain('AuthController');
      expect(blocks[1].content).toContain('[HttpPost("login")]');
    }

    expect(blocks[2].type).toBe('file');
    expect(blocks[2].path).toBe('backend/Models/LoginRequest.cs');
    if (blocks[2].type === 'file') {
      expect(blocks[2].content).toContain('LoginRequest');
    }
  });
});

// ============================================================================
// 3. Backend Generation -- C# Auth API
// ============================================================================

describe.concurrent('Backend Generation -- C# Auth API', () => {

  it.concurrent('a) Lane3Executor generates AuthController + models (3 files)', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);
    const eventBus = makeMockEventBus();

    const streamResponse = buildAuthControllerStreamResponse();
    const llm = makeMockLlm('', streamResponse);
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const fileContexts = buildFullstackFileContexts(tmp);
    const projectMap = makeFullstackProjectMap(fileContexts);

    const task = makeTask({
      description: 'Create AuthController with login and register endpoints',
      files: ['backend/Controllers/AuthController.cs', 'backend/Models/LoginRequest.cs', 'backend/Models/RegisterRequest.cs'],
      type: 'multi_file',
      lane: 3,
    });

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe('abc1234');

    // Verify AuthController
    const controller = readFileSync(path.join(tmp, 'backend', 'Controllers', 'AuthController.cs'), 'utf-8');
    expect(controller).toContain('[HttpPost("login")]');
    expect(controller).toContain('[HttpPost("register")]');
    expect(controller).toContain('AuthController');

    // Verify LoginRequest model
    const loginModel = readFileSync(path.join(tmp, 'backend', 'Models', 'LoginRequest.cs'), 'utf-8');
    expect(loginModel).toContain('Email');
    expect(loginModel).toContain('Password');

    // Verify RegisterRequest model
    const registerModel = readFileSync(path.join(tmp, 'backend', 'Models', 'RegisterRequest.cs'), 'utf-8');
    expect(registerModel).toContain('Name');
    expect(registerModel).toContain('Email');
    expect(registerModel).toContain('Password');
  });

  it.concurrent('b) Lane3Executor generates auth middleware', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);
    const eventBus = makeMockEventBus();

    const streamResponse = buildAuthMiddlewareStreamResponse();
    const llm = makeMockLlm('', streamResponse);
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const fileContexts = buildFullstackFileContexts(tmp);
    const projectMap = makeFullstackProjectMap(fileContexts);

    const task = makeTask({
      description: 'Create auth middleware for JWT validation',
      files: ['backend/Middleware/AuthMiddleware.cs'],
      type: 'single_file',
      lane: 3,
    });

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);

    const middleware = readFileSync(path.join(tmp, 'backend', 'Middleware', 'AuthMiddleware.cs'), 'utf-8');
    expect(middleware).toContain('AuthMiddleware');
    expect(middleware).toContain('class');
    expect(middleware).toContain('InvokeAsync');
  });

  it.concurrent('c) Lane3 applies DIFF to update Program.cs with auth config', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);
    const eventBus = makeMockEventBus();

    const streamResponse = buildProgramCsDiffStreamResponse();
    const llm = makeMockLlm('', streamResponse);
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    // Include Program.cs in file contexts so Lane3 knows it exists
    const fileContexts = buildFullstackFileContexts(tmp);
    const programContent = readFileSync(path.join(tmp, 'backend', 'Program.cs'), 'utf-8');
    fileContexts.set('backend/Program.cs', {
      filePath: 'backend/Program.cs',
      content: programContent,
      importedTypes: '',
    });

    const projectMap = makeFullstackProjectMap(fileContexts);

    const task = makeTask({
      description: 'Add authentication services to Program.cs',
      files: ['backend/Program.cs'],
      type: 'single_file',
      lane: 3,
    });

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);

    const updated = readFileSync(path.join(tmp, 'backend', 'Program.cs'), 'utf-8');
    expect(updated).toContain('AddAuthentication');
    expect(updated).toContain('UseAuthentication');
    // Original lines should still be there
    expect(updated).toContain('AddControllers');
    expect(updated).toContain('MapControllers');
  });

  it.concurrent('d) EndpointExtractor finds POST endpoints in generated AuthController', async () => {
    const { EndpointExtractor } = await import('../../packages/core/src/indexer/EndpointExtractor.js');

    const tmp = trackTmp();
    // Write the AuthController file
    createFile(tmp, 'Controllers/AuthController.cs', AUTH_CONTROLLER_CONTENT);

    const extractor = new EndpointExtractor();
    const endpoints = await extractor.extract(tmp, {
      framework: 'dotnet',
      language: 'csharp',
      typescript: false,
    });

    // Should find login and register endpoints
    expect(endpoints.length).toBeGreaterThanOrEqual(2);

    const loginEndpoint = endpoints.find(
      (e) => e.method === 'POST' && e.path.includes('login'),
    );
    expect(loginEndpoint).toBeDefined();
    expect(loginEndpoint!.method).toBe('POST');

    const registerEndpoint = endpoints.find(
      (e) => e.method === 'POST' && e.path.includes('register'),
    );
    expect(registerEndpoint).toBeDefined();
    expect(registerEndpoint!.method).toBe('POST');
  });
});

// ============================================================================
// 4. Full E2E -- Complete Auth Feature
// ============================================================================

describe.concurrent('Full E2E -- complete auth feature', () => {

  it.concurrent('a) Complete frontend flow: index -> brain -> lane3 -> login page written', async () => {
    const { ProjectIndexer } = await import('../../packages/core/src/indexer/ProjectIndexer.js');
    const { Brain } = await import('../../packages/core/src/brain/Brain.js');
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);

    const indexer = new ProjectIndexer();
    const projectMap = await indexer.index(tmp);

    // Brain returns login page task
    const brainResponse = JSON.stringify([
      { description: 'Create login page with email and password form', files: ['app/login/page.tsx'], type: 'single_file' },
    ]);

    const loginStreamResponse = buildLoginPageStreamResponse();
    const llm = makeMockLlm(brainResponse, loginStreamResponse);
    const git = makeMockGit();
    const eventBus = makeMockEventBus();

    const brain = new Brain(llm);
    const tasks = await brain.analyze(
      { screenshot: Buffer.from('fake'), currentUrl: 'http://localhost:3000/', transcript: 'add login form', timestamp: Date.now() },
      projectMap,
    );

    expect(tasks.length).toBeGreaterThan(0);

    // Execute the task
    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);
    const result = await executor.execute(tasks[0], projectMap);

    expect(result.success).toBe(true);
    expect(existsSync(path.join(tmp, 'app', 'login', 'page.tsx'))).toBe(true);

    // Re-index and verify new route visible
    const updatedMap = await indexer.index(tmp);
    const loginRoute = updatedMap.routes.find((r) => r.path === '/login');
    expect(loginRoute).toBeDefined();
  }, 30_000);

  it.concurrent('b) Complete backend flow: index -> brain -> lane3 -> AuthController + endpoints found', async () => {
    const { ProjectIndexer } = await import('../../packages/core/src/indexer/ProjectIndexer.js');
    const { Brain } = await import('../../packages/core/src/brain/Brain.js');
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);

    const indexer = new ProjectIndexer();
    const projectMap = await indexer.index(tmp);

    // Brain returns AuthController task
    const brainResponse = JSON.stringify([
      { description: 'Create AuthController with login and register endpoints', files: ['backend/Controllers/AuthController.cs', 'backend/Models/LoginRequest.cs', 'backend/Models/RegisterRequest.cs'], type: 'multi_file' },
    ]);

    const authStreamResponse = buildAuthControllerStreamResponse();
    const llm = makeMockLlm(brainResponse, authStreamResponse);
    const git = makeMockGit();
    const eventBus = makeMockEventBus();

    const brain = new Brain(llm);
    const tasks = await brain.analyze(
      { screenshot: Buffer.from('fake'), currentUrl: 'http://localhost:3000/', transcript: 'add auth API', timestamp: Date.now() },
      projectMap,
    );

    expect(tasks.length).toBeGreaterThan(0);

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);
    const result = await executor.execute(tasks[0], projectMap);

    expect(result.success).toBe(true);

    // Verify files exist
    expect(existsSync(path.join(tmp, 'backend', 'Controllers', 'AuthController.cs'))).toBe(true);
    expect(existsSync(path.join(tmp, 'backend', 'Models', 'LoginRequest.cs'))).toBe(true);
    expect(existsSync(path.join(tmp, 'backend', 'Models', 'RegisterRequest.cs'))).toBe(true);

    // EndpointExtractor should find the new endpoints
    const { EndpointExtractor } = await import('../../packages/core/src/indexer/EndpointExtractor.js');
    const extractor = new EndpointExtractor();
    const endpoints = await extractor.extract(tmp, {
      framework: 'dotnet',
      language: 'csharp',
      typescript: false,
    });

    const loginEndpoint = endpoints.find(
      (e) => e.method === 'POST' && e.path.includes('login'),
    );
    const registerEndpoint = endpoints.find(
      (e) => e.method === 'POST' && e.path.includes('register'),
    );

    expect(loginEndpoint).toBeDefined();
    expect(registerEndpoint).toBeDefined();
  }, 30_000);

  it.concurrent('c) Full stack flow: 4 tasks executed, all files written, re-index sees routes + endpoints', async () => {
    const { ProjectIndexer } = await import('../../packages/core/src/indexer/ProjectIndexer.js');
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);

    const indexer = new ProjectIndexer();
    let projectMap = await indexer.index(tmp);

    const git = makeMockGit();
    const eventBus = makeMockEventBus();

    // Task 1: login page
    const llm1 = makeMockLlm('', buildLoginPageStreamResponse());
    const exec1 = new Lane3Executor(tmp, llm1, git, eventBus, 1);
    const task1 = makeTask({
      description: 'Create login page with email and password form',
      files: ['app/login/page.tsx'],
      type: 'single_file',
      lane: 3,
    });
    const r1 = await exec1.execute(task1, projectMap);
    expect(r1.success).toBe(true);

    // Task 2: register page
    const llm2 = makeMockLlm('', buildRegisterPageStreamResponse());
    const exec2 = new Lane3Executor(tmp, llm2, git, eventBus, 1);
    const task2 = makeTask({
      description: 'Create registration page with signup form',
      files: ['app/register/page.tsx'],
      type: 'single_file',
      lane: 3,
    });
    const r2 = await exec2.execute(task2, projectMap);
    expect(r2.success).toBe(true);

    // Task 3: AuthController + models
    const llm3 = makeMockLlm('', buildAuthControllerStreamResponse());
    const exec3 = new Lane3Executor(tmp, llm3, git, eventBus, 1);
    const task3 = makeTask({
      description: 'Create AuthController with login and register endpoints',
      files: ['backend/Controllers/AuthController.cs', 'backend/Models/LoginRequest.cs', 'backend/Models/RegisterRequest.cs'],
      type: 'multi_file',
      lane: 3,
    });
    const r3 = await exec3.execute(task3, projectMap);
    expect(r3.success).toBe(true);

    // Task 4: Header update (use Lane3 with DIFF)
    const llm4 = makeMockLlm('', buildHeaderDiffStreamResponse());
    const exec4 = new Lane3Executor(tmp, llm4, git, eventBus, 1);
    const task4 = makeTask({
      description: 'Add auth navigation links to header',
      files: ['components/Header.tsx'],
      type: 'single_file',
      lane: 3,
    });
    const r4 = await exec4.execute(task4, projectMap);
    expect(r4.success).toBe(true);

    // Verify all files exist
    expect(existsSync(path.join(tmp, 'app', 'login', 'page.tsx'))).toBe(true);
    expect(existsSync(path.join(tmp, 'app', 'register', 'page.tsx'))).toBe(true);
    expect(existsSync(path.join(tmp, 'backend', 'Controllers', 'AuthController.cs'))).toBe(true);
    expect(existsSync(path.join(tmp, 'backend', 'Models', 'LoginRequest.cs'))).toBe(true);
    expect(existsSync(path.join(tmp, 'backend', 'Models', 'RegisterRequest.cs'))).toBe(true);

    // Re-index and verify routes + endpoints
    projectMap = await indexer.index(tmp);

    const loginRoute = projectMap.routes.find((r) => r.path === '/login');
    const registerRoute = projectMap.routes.find((r) => r.path === '/register');
    expect(loginRoute).toBeDefined();
    expect(registerRoute).toBeDefined();

    // Header should have auth links
    const headerContent = readFileSync(path.join(tmp, 'components', 'Header.tsx'), 'utf-8');
    expect(headerContent).toContain('/login');
    expect(headerContent).toContain('/register');
  }, 60_000);

  it.concurrent('d) Generated login page code quality: has required elements, no debug artifacts', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);
    const eventBus = makeMockEventBus();

    const streamResponse = buildLoginPageStreamResponse();
    const llm = makeMockLlm('', streamResponse);
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const fileContexts = buildFullstackFileContexts(tmp);
    const projectMap = makeFullstackProjectMap(fileContexts);

    const task = makeTask({
      description: 'Create login page with email and password form',
      files: ['app/login/page.tsx'],
      type: 'single_file',
      lane: 3,
    });

    const result = await executor.execute(task, projectMap);
    expect(result.success).toBe(true);

    const generated = readFileSync(path.join(tmp, 'app', 'login', 'page.tsx'), 'utf-8');

    // Required elements
    expect(generated).toContain("'use client'");
    expect(generated).toContain('useState');
    expect(generated).toContain('<form');
    expect(generated).toContain('type="email"');
    expect(generated).toContain('type="password"');
    expect(generated).toContain('type="submit"');
    expect(generated).toContain('setError');
    expect(generated).toContain('fetch');

    // No debug artifacts
    expect(generated).not.toContain('console.log');
    expect(generated).not.toContain('hardcoded');
    expect(generated).not.toContain('TODO');
  });
});
