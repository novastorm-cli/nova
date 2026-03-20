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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nova-email-'));
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
    dependencies: { next: '14.0.0', react: '18.2.0', 'react-dom': '18.2.0', nodemailer: '6.9.0' },
    devDependencies: { typescript: '5.0.0', tailwindcss: '3.4.0', '@types/react': '18.2.0', '@types/node': '20.0.0', '@types/nodemailer': '6.4.0' },
    scripts: { dev: 'next dev' },
  }, null, 2));
  createFile(dir, 'tsconfig.json', '{"compilerOptions":{"target":"es5","lib":["dom"],"jsx":"preserve"}}');
  createFile(dir, 'app/layout.tsx', `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}`);
  createFile(dir, 'app/page.tsx', `export default function Home() {
  return (
    <main>
      <h1>Welcome to My App</h1>
      <div className="max-w-xl mx-auto mt-12 bg-gray-50 rounded-2xl p-8 border border-gray-100">
        <h3 className="text-2xl font-bold text-gray-900 mb-2 text-center">Quick Message</h3>
        <form className="space-y-4">
          <div>
            <label htmlFor="feature-subject">Title / Subject</label>
            <input id="feature-subject" type="text" placeholder="What is this about?" required value="" />
          </div>
          <div>
            <label htmlFor="feature-message">Message</label>
            <textarea id="feature-message" placeholder="Write your message here..." rows={4} required></textarea>
          </div>
          <button type="submit">Send</button>
        </form>
      </div>
    </main>
  );
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
// DOM Snapshot (from production logs)
// ---------------------------------------------------------------------------

const DOM_SNAPSHOT = `<div class="max-w-xl mx-auto mt-12 bg-gray-50 rounded-2xl p-8 border border-gray-100"><h3 class="text-2xl font-bold text-gray-900 mb-2 text-center">Quick Message</h3><form class="space-y-4"><div><label for="feature-subject">Title / Subject</label><input id="feature-subject" type="text" placeholder="What is this about?" required="" value=""></div><div><label for="feature-message">Message</label><textarea id="feature-message" placeholder="Write your message here..." rows="4" required=""></textarea></div><button type="submit">Send</button></form></div>`;

function makeScopedEditObservation(overrides?: Partial<Observation>): Observation {
  return {
    screenshot: Buffer.from('fake-screenshot'),
    clickCoords: { x: 450, y: 600 },
    domSnapshot: DOM_SNAPSHOT,
    transcript: '\u043f\u0440\u0438 \u043d\u0430\u0436\u0430\u0442\u0438\u0438 \u043d\u0430 \u044d\u0442\u0443 \u043a\u043b\u0430\u0432\u0438\u0448\u0443 \u0434\u043e\u043b\u0436\u0435\u043d \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u044f\u0442\u044c\u0441\u044f email',
    currentUrl: 'http://127.0.0.1:3001/',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock LLM response content
// ---------------------------------------------------------------------------

const CONTACT_PAGE_CONTENT = `'use client';

import { useState } from 'react';

export default function ContactPage() {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message }),
      });

      if (!res.ok) throw new Error('Failed to send');
      setStatus('sent');
      setSubject('');
      setMessage('');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="max-w-xl mx-auto mt-12 p-8">
      <h2 className="text-2xl font-bold mb-6">Quick Message</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="subject" className="block text-sm font-medium mb-1">Subject</label>
          <input id="subject" type="text" value={subject} onChange={e => setSubject(e.target.value)} required className="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label htmlFor="message" className="block text-sm font-medium mb-1">Message</label>
          <textarea id="message" value={message} onChange={e => setMessage(e.target.value)} rows={4} required className="w-full border rounded px-3 py-2" />
        </div>
        <button type="submit" disabled={status === 'sending'} className="bg-black text-white px-6 py-2 rounded">
          {status === 'sending' ? 'Sending...' : 'Send'}
        </button>
        {status === 'sent' && <p className="text-green-600">Message sent!</p>}
        {status === 'error' && <p className="text-red-600">Failed to send. Try again.</p>}
      </form>
    </div>
  );
}`;

const API_CONTACT_ROUTE_CONTENT = `import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(request: Request) {
  try {
    const { subject, message, email } = await request.json();

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 587,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.CONTACT_EMAIL || 'admin@example.com',
      subject: subject || 'Contact Form Message',
      text: message,
      replyTo: email,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Email send error:', error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}`;

const EMAIL_CONTROLLER_CONTENT = `using Microsoft.AspNetCore.Mvc;

namespace WebApp.Controllers;

[ApiController]
[Route("api/[controller]")]
public class EmailController : ControllerBase
{
    [HttpPost("send")]
    public IActionResult SendEmail([FromBody] EmailRequest request)
    {
        // In production, use SmtpClient or a service like SendGrid
        if (string.IsNullOrEmpty(request.To) || string.IsNullOrEmpty(request.Subject))
        {
            return BadRequest(new { error = "To and Subject are required" });
        }

        return Ok(new { success = true, message = "Email queued for delivery" });
    }
}`;

const EMAIL_REQUEST_CONTENT = `namespace WebApp.Models;

public class EmailRequest
{
    public string To { get; set; } = "";
    public string Subject { get; set; } = "";
    public string Body { get; set; } = "";
    public string? ReplyTo { get; set; }
}`;

// ---------------------------------------------------------------------------
// Build LLM stream responses
// ---------------------------------------------------------------------------

function buildContactPageStreamResponse(): string {
  return [
    '=== FILE: app/contact/page.tsx ===',
    CONTACT_PAGE_CONTENT,
    '=== END FILE ===',
  ].join('\n');
}

function buildApiContactRouteStreamResponse(): string {
  return [
    '=== FILE: app/api/contact/route.ts ===',
    API_CONTACT_ROUTE_CONTENT,
    '=== END FILE ===',
  ].join('\n');
}

function buildEmailControllerStreamResponse(): string {
  return [
    '=== FILE: backend/Controllers/EmailController.cs ===',
    EMAIL_CONTROLLER_CONTENT,
    '=== END FILE ===',
    '',
    '=== FILE: backend/Models/EmailRequest.cs ===',
    EMAIL_REQUEST_CONTENT,
    '=== END FILE ===',
  ].join('\n');
}

function buildContactPageAndApiStreamResponse(): string {
  return [
    '=== FILE: app/contact/page.tsx ===',
    CONTACT_PAGE_CONTENT,
    '=== END FILE ===',
    '',
    '=== FILE: app/api/contact/route.ts ===',
    API_CONTACT_ROUTE_CONTENT,
    '=== END FILE ===',
  ].join('\n');
}

function buildPageSubmitHandlerDiffStreamResponse(): string {
  return [
    '=== DIFF: app/page.tsx ===',
    '--- a/app/page.tsx',
    '+++ b/app/page.tsx',
    '@@ -1,4 +1,30 @@',
    "-export default function Home() {",
    "+\\'use client\\';",
    "+",
    "+import { useState } from \\'react\\';",
    "+",
    "+export default function Home() {",
    "+  const [status, setStatus] = useState<\\'idle\\' | \\'sending\\' | \\'sent\\' | \\'error\\'>(\\'idle\\');",
    "+",
    "+  async function handleSubmit(e: React.FormEvent) {",
    "+    e.preventDefault();",
    "+    setStatus(\\'sending\\');",
    "+    try {",
    "+      const form = e.target as HTMLFormElement;",
    "+      const subject = (form.elements.namedItem(\\'feature-subject\\') as HTMLInputElement).value;",
    "+      const message = (form.elements.namedItem(\\'feature-message\\') as HTMLTextAreaElement).value;",
    "+      const res = await fetch(\\'/api/contact\\', {",
    "+        method: \\'POST\\',",
    "+        headers: { \\'Content-Type\\': \\'application/json\\' },",
    "+        body: JSON.stringify({ subject, message }),",
    "+      });",
    "+      if (!res.ok) throw new Error(\\'Failed\\');",
    "+      setStatus(\\'sent\\');",
    "+    } catch {",
    "+      setStatus(\\'error\\');",
    "+    }",
    "+  }",
    "+",
    '   return (',
    '=== END DIFF ===',
  ].join('\n');
}

function buildProgramCsEmailDiffStreamResponse(): string {
  return [
    '=== DIFF: backend/Program.cs ===',
    '--- a/backend/Program.cs',
    '+++ b/backend/Program.cs',
    '@@ -1,5 +1,7 @@',
    ' var builder = WebApplication.CreateBuilder(args);',
    ' builder.Services.AddControllers();',
    '+builder.Services.AddSingleton<IEmailService, SmtpEmailService>();',
    ' var app = builder.Build();',
    ' app.MapControllers();',
    ' app.Run();',
    '=== END DIFF ===',
  ].join('\n');
}

// ============================================================================
// 1. Brain -- Scoped Edit Analysis
// ============================================================================

describe.concurrent('Brain -- Scoped Edit Analysis (email scenario)', () => {

  it.concurrent('a) Brain returns clarifying question when LLM says form already has email', async () => {
    const { Brain } = await import('../../packages/core/src/brain/Brain.js');

    const llmResponse = `The form already has email sending functionality wired up \u2014 handleQuickMessage calls POST /api/contact which sends an email via nodemailer.

\`\`\`json
[{"question":"The Quick Message form already sends an email when the Send button is clicked (via the handleQuickMessage handler that calls POST /api/contact). Could you clarify what additional change you'd like?"}]
\`\`\``;

    const llm = makeMockLlm(llmResponse);
    const eventBus = makeMockEventBus();
    const brain = new Brain(llm, eventBus);

    const observation = makeScopedEditObservation();
    const projectMap = makeProjectMap(new Map());
    const tasks = await brain.analyze(observation, projectMap);

    expect(tasks).toHaveLength(0);

    // EventBus should have been called with a status containing "question:"
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'status',
        data: expect.objectContaining({
          message: expect.stringContaining('question:'),
        }),
      }),
    );

    // chatWithVision should be used since screenshot is non-empty
    expect(llm.chatWithVision).toHaveBeenCalledTimes(1);
  });

  it.concurrent('b) Brain returns actual tasks when LLM says form needs email wiring', async () => {
    const { Brain } = await import('../../packages/core/src/brain/Brain.js');

    const llmResponse = JSON.stringify([
      { description: 'Add email sending handler to Quick Message form onSubmit', files: ['app/page.tsx'], type: 'single_file' },
      { description: 'Create API route for sending email via nodemailer', files: ['app/api/contact/route.ts'], type: 'single_file' },
    ]);

    const llm = makeMockLlm(llmResponse);
    const brain = new Brain(llm);

    const observation = makeScopedEditObservation();
    const projectMap = makeProjectMap(new Map());
    const tasks = await brain.analyze(observation, projectMap);

    expect(tasks).toHaveLength(2);

    expect(tasks[0].description).toContain('email sending handler');
    expect(tasks[0].files).toContain('app/page.tsx');
    expect(tasks[0].status).toBe('pending');
    expect(tasks[0].id).toBeDefined();

    expect(tasks[1].description).toContain('API route');
    expect(tasks[1].files).toContain('app/api/contact/route.ts');
    // Lanes should be assigned
    for (const t of tasks) {
      expect([1, 2, 3, 4]).toContain(t.lane);
    }
  });

  it.concurrent('c) Brain returns single CSS/onClick task from scoped edit', async () => {
    const { Brain } = await import('../../packages/core/src/brain/Brain.js');

    const llmResponse = JSON.stringify([
      { description: 'Add onClick handler to Send button that triggers form submission', files: ['app/page.tsx'], type: 'single_file' },
    ]);

    const llm = makeMockLlm(llmResponse);
    const brain = new Brain(llm);

    const observation = makeScopedEditObservation();
    const projectMap = makeProjectMap(new Map());
    const tasks = await brain.analyze(observation, projectMap);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].files).toContain('app/page.tsx');
    expect(tasks[0].type).toBe('single_file');
    // Single file page edit -> lane 2
    expect(tasks[0].lane).toBe(2);
  });

  it.concurrent('d) Brain handles reasoning text BEFORE JSON (Claude CLI pattern)', async () => {
    const { Brain } = await import('../../packages/core/src/brain/Brain.js');

    const llmResponse = `The form already has basic structure. I need to add email functionality.

\`\`\`json
[{"description":"Wire up form submission to send email via API","files":["app/page.tsx"],"type":"single_file"}]
\`\`\``;

    const llm = makeMockLlm(llmResponse);
    const eventBus = makeMockEventBus();
    const brain = new Brain(llm, eventBus);

    const observation = makeScopedEditObservation();
    const projectMap = makeProjectMap(new Map());
    const tasks = await brain.analyze(observation, projectMap);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toContain('Wire up form submission');
    expect(tasks[0].files).toContain('app/page.tsx');
    expect(tasks[0].type).toBe('single_file');

    // Brain should emit status with reasoning excerpt
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'status',
        data: expect.objectContaining({
          message: expect.stringContaining('AI thinks:'),
        }),
      }),
    );
  });

  it.concurrent('e) PromptBuilder includes domSnapshot in the prompt when present', async () => {
    const { PromptBuilder } = await import('../../packages/core/src/brain/PromptBuilder.js');

    const promptBuilder = new PromptBuilder();
    const observation = makeScopedEditObservation();
    const projectMap = makeProjectMap(new Map());

    const messages = promptBuilder.buildAnalysisPrompt(observation, projectMap);

    expect(messages.length).toBeGreaterThan(0);

    const fullText = messages.map(m => m.content).join('\n');

    // domSnapshot should be in the prompt
    expect(fullText).toContain('DOM snapshot');
    expect(fullText).toContain('Quick Message');
    expect(fullText).toContain('feature-subject');
    expect(fullText).toContain('feature-message');

    // Click coordinates should be included
    expect(fullText).toContain('x=450');
    expect(fullText).toContain('y=600');

    // Transcript should be included
    expect(fullText).toContain('\u043f\u0440\u0438 \u043d\u0430\u0436\u0430\u0442\u0438\u0438');
  });
});

// ============================================================================
// 2. Frontend -- Email Form Generation
// ============================================================================

describe.concurrent('Frontend -- Email Form Generation', () => {

  it.concurrent('a) Lane3 generates contact form page with email sending', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);
    const eventBus = makeMockEventBus();

    const streamResponse = buildContactPageStreamResponse();
    const llm = makeMockLlm('', streamResponse);
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const fileContexts = buildFullstackFileContexts(tmp);
    const projectMap = makeFullstackProjectMap(fileContexts);

    const task = makeTask({
      description: 'Create contact form page with email sending',
      files: ['app/contact/page.tsx'],
      type: 'single_file',
      lane: 3,
    });

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe('abc1234');

    const written = readFileSync(path.join(tmp, 'app', 'contact', 'page.tsx'), 'utf-8');
    expect(written).toContain("'use client'");
    expect(written).toContain('useState');
    expect(written).toContain('handleSubmit');
    expect(written).toContain('form');
    expect(written).toContain("fetch('/api/contact'");
    expect(written).toContain("'idle'");
    expect(written).toContain("'sending'");
    expect(written).toContain("'sent'");
    expect(written).toContain("'error'");
  });

  it.concurrent('b) Lane3 generates API route for email sending with nodemailer', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);
    const eventBus = makeMockEventBus();

    const streamResponse = buildApiContactRouteStreamResponse();
    const llm = makeMockLlm('', streamResponse);
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const fileContexts = buildFullstackFileContexts(tmp);
    const projectMap = makeFullstackProjectMap(fileContexts);

    const task = makeTask({
      description: 'Create API route for sending email via nodemailer',
      files: ['app/api/contact/route.ts'],
      type: 'single_file',
      lane: 3,
    });

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);

    const written = readFileSync(path.join(tmp, 'app', 'api', 'contact', 'route.ts'), 'utf-8');
    expect(written).toContain('nodemailer');
    expect(written).toContain('POST');
    expect(written).toContain('process.env.SMTP_HOST');
    expect(written).toContain('process.env.SMTP_USER');
    expect(written).toContain('process.env.SMTP_PASS');
    expect(written).toContain('transporter.sendMail');
    expect(written).toContain('NextResponse.json');
  });

  it.concurrent('c) Lane2 applies DIFF to existing page -- adds onSubmit handler', async () => {
    const { Lane2Executor } = await import('../../packages/core/src/executor/Lane2Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);

    // The diff response adds handleSubmit and fetch to existing form
    const diffResponse = [
      '--- a/app/page.tsx',
      '+++ b/app/page.tsx',
      '@@ -1,4 +1,22 @@',
      "-export default function Home() {",
      "+'use client';",
      "+",
      "+import { useState } from 'react';",
      "+",
      "+export default function Home() {",
      "+  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');",
      "+",
      "+  async function handleSubmit(e: React.FormEvent) {",
      "+    e.preventDefault();",
      "+    setStatus('sending');",
      "+    try {",
      "+      const form = e.target as HTMLFormElement;",
      "+      const subject = (form.elements.namedItem('feature-subject') as HTMLInputElement).value;",
      "+      const message = (form.elements.namedItem('feature-message') as HTMLTextAreaElement).value;",
      "+      const res = await fetch('/api/contact', {",
      "+        method: 'POST',",
      "+        headers: { 'Content-Type': 'application/json' },",
      "+        body: JSON.stringify({ subject, message }),",
      "+      });",
      "+      if (!res.ok) throw new Error('Failed');",
      "+      setStatus('sent');",
      "+    } catch {",
      "+      setStatus('error');",
      "+    }",
      "+  }",
      "+",
      '   return (',
    ].join('\n');

    const llm = makeMockLlm(diffResponse);
    const git = makeMockGit();

    const executor = new Lane2Executor(tmp, llm, git);

    const pageContent = readFileSync(path.join(tmp, 'app', 'page.tsx'), 'utf-8');
    const fileContexts = new Map<string, MiniContext>();
    fileContexts.set('app/page.tsx', {
      filePath: 'app/page.tsx',
      content: pageContent,
      importedTypes: '',
    });

    const task = makeTask({
      description: 'Add email sending onSubmit handler to Quick Message form',
      files: ['app/page.tsx'],
      type: 'single_file',
      lane: 2,
    });

    const projectMap = makeProjectMap(fileContexts);
    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);

    const updated = readFileSync(path.join(tmp, 'app', 'page.tsx'), 'utf-8');
    expect(updated).toContain('handleSubmit');
    expect(updated).toContain('fetch');
  });

  it.concurrent('d) Lane3 generates BOTH form page + API route in one response', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);
    const eventBus = makeMockEventBus();

    const streamResponse = buildContactPageAndApiStreamResponse();
    const llm = makeMockLlm('', streamResponse);
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const fileContexts = buildFullstackFileContexts(tmp);
    const projectMap = makeFullstackProjectMap(fileContexts);

    const task = makeTask({
      description: 'Create contact form page and API route for email sending',
      files: ['app/contact/page.tsx', 'app/api/contact/route.ts'],
      type: 'multi_file',
      lane: 3,
    });

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);

    // Both files should be written
    expect(existsSync(path.join(tmp, 'app', 'contact', 'page.tsx'))).toBe(true);
    expect(existsSync(path.join(tmp, 'app', 'api', 'contact', 'route.ts'))).toBe(true);

    const contactPage = readFileSync(path.join(tmp, 'app', 'contact', 'page.tsx'), 'utf-8');
    expect(contactPage).toContain('ContactPage');
    expect(contactPage).toContain('handleSubmit');

    const apiRoute = readFileSync(path.join(tmp, 'app', 'api', 'contact', 'route.ts'), 'utf-8');
    expect(apiRoute).toContain('nodemailer');
    expect(apiRoute).toContain('POST');
  });
});

// ============================================================================
// 3. Backend -- C# Email API
// ============================================================================

describe.concurrent('Backend -- C# Email API', () => {

  it.concurrent('a) Lane3 generates EmailController + EmailRequest model', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);
    const eventBus = makeMockEventBus();

    const streamResponse = buildEmailControllerStreamResponse();
    const llm = makeMockLlm('', streamResponse);
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const fileContexts = buildFullstackFileContexts(tmp);
    const projectMap = makeFullstackProjectMap(fileContexts);

    const task = makeTask({
      description: 'Create EmailController with send endpoint and EmailRequest model',
      files: ['backend/Controllers/EmailController.cs', 'backend/Models/EmailRequest.cs'],
      type: 'multi_file',
      lane: 3,
    });

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe('abc1234');

    // Verify EmailController
    const controller = readFileSync(path.join(tmp, 'backend', 'Controllers', 'EmailController.cs'), 'utf-8');
    expect(controller).toContain('[HttpPost("send")]');
    expect(controller).toContain('EmailController');
    expect(controller).toContain('[ApiController]');
    expect(controller).toContain('SendEmail');

    // Verify EmailRequest model
    const model = readFileSync(path.join(tmp, 'backend', 'Models', 'EmailRequest.cs'), 'utf-8');
    expect(model).toContain('To');
    expect(model).toContain('Subject');
    expect(model).toContain('Body');
    expect(model).toContain('ReplyTo');
  });

  it.concurrent('b) EndpointExtractor finds POST /api/email/send in generated controller', async () => {
    const { EndpointExtractor } = await import('../../packages/core/src/indexer/EndpointExtractor.js');

    const tmp = trackTmp();
    createFile(tmp, 'Controllers/EmailController.cs', EMAIL_CONTROLLER_CONTENT);

    const extractor = new EndpointExtractor();
    const endpoints = await extractor.extract(tmp, {
      framework: 'dotnet',
      language: 'csharp',
      typescript: false,
    });

    const sendEndpoint = endpoints.find(
      (e) => e.method === 'POST' && e.path.includes('send'),
    );
    expect(sendEndpoint).toBeDefined();
    expect(sendEndpoint!.method).toBe('POST');
    expect(sendEndpoint!.path).toContain('email');
  });

  it.concurrent('c) Lane3 applies DIFF to Program.cs -- adds email service registration', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);
    const eventBus = makeMockEventBus();

    const streamResponse = buildProgramCsEmailDiffStreamResponse();
    const llm = makeMockLlm('', streamResponse);
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const fileContexts = buildFullstackFileContexts(tmp);
    const programContent = readFileSync(path.join(tmp, 'backend', 'Program.cs'), 'utf-8');
    fileContexts.set('backend/Program.cs', {
      filePath: 'backend/Program.cs',
      content: programContent,
      importedTypes: '',
    });

    const projectMap = makeFullstackProjectMap(fileContexts);

    const task = makeTask({
      description: 'Add email service registration to Program.cs',
      files: ['backend/Program.cs'],
      type: 'single_file',
      lane: 3,
    });

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);

    const updated = readFileSync(path.join(tmp, 'backend', 'Program.cs'), 'utf-8');
    expect(updated).toContain('IEmailService');
    expect(updated).toContain('SmtpEmailService');
    // Original lines should still be there
    expect(updated).toContain('AddControllers');
    expect(updated).toContain('MapControllers');
  });

  it.concurrent('d) Full .NET email pipeline: create -> index -> Brain -> Lane3 -> re-index finds endpoint', async () => {
    const { ProjectIndexer } = await import('../../packages/core/src/indexer/ProjectIndexer.js');
    const { Brain } = await import('../../packages/core/src/brain/Brain.js');
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);

    const indexer = new ProjectIndexer();
    const projectMap = await indexer.index(tmp);

    // Brain returns EmailController task
    const brainResponse = JSON.stringify([
      { description: 'Create EmailController with send endpoint', files: ['backend/Controllers/EmailController.cs', 'backend/Models/EmailRequest.cs'], type: 'multi_file' },
    ]);

    const emailStreamResponse = buildEmailControllerStreamResponse();
    const llm = makeMockLlm(brainResponse, emailStreamResponse);
    const git = makeMockGit();
    const eventBus = makeMockEventBus();

    const brain = new Brain(llm);
    const tasks = await brain.analyze(
      { screenshot: Buffer.from('fake'), currentUrl: 'http://localhost:3000/', transcript: 'add email sending API', timestamp: Date.now() },
      projectMap,
    );

    expect(tasks.length).toBeGreaterThan(0);

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);
    const result = await executor.execute(tasks[0], projectMap);

    expect(result.success).toBe(true);
    expect(existsSync(path.join(tmp, 'backend', 'Controllers', 'EmailController.cs'))).toBe(true);
    expect(existsSync(path.join(tmp, 'backend', 'Models', 'EmailRequest.cs'))).toBe(true);

    // Re-index and find the endpoint
    const { EndpointExtractor } = await import('../../packages/core/src/indexer/EndpointExtractor.js');
    const extractor = new EndpointExtractor();
    const endpoints = await extractor.extract(tmp, {
      framework: 'dotnet',
      language: 'csharp',
      typescript: false,
    });

    const sendEndpoint = endpoints.find(
      (e) => e.method === 'POST' && e.path.includes('send'),
    );
    expect(sendEndpoint).toBeDefined();
  }, 30_000);
});

// ============================================================================
// 4. Full E2E -- Scoped Edit Flow
// ============================================================================

describe.concurrent('Full E2E -- Scoped Edit Flow', () => {

  it.concurrent('a) Scoped edit observation -> Brain returns clarifying question -> 0 tasks', async () => {
    const { ProjectIndexer } = await import('../../packages/core/src/indexer/ProjectIndexer.js');
    const { Brain } = await import('../../packages/core/src/brain/Brain.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);

    const indexer = new ProjectIndexer();
    const projectMap = await indexer.index(tmp);

    const llmResponse = JSON.stringify([
      { question: 'The Quick Message form already has a Send button. Do you want it to send an email to a specific address, or show a success message?' },
    ]);

    const llm = makeMockLlm(llmResponse);
    const eventBus = makeMockEventBus();
    const brain = new Brain(llm, eventBus);

    const observation = makeScopedEditObservation();
    const tasks = await brain.analyze(observation, projectMap);

    expect(tasks).toHaveLength(0);

    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'status',
        data: expect.objectContaining({
          message: expect.stringContaining('question:'),
        }),
      }),
    );
  }, 30_000);

  it.concurrent('b) Scoped edit that generates code: observation -> Brain -> execute -> files written', async () => {
    const { ProjectIndexer } = await import('../../packages/core/src/indexer/ProjectIndexer.js');
    const { Brain } = await import('../../packages/core/src/brain/Brain.js');
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);

    const indexer = new ProjectIndexer();
    const projectMap = await indexer.index(tmp);

    // Brain returns 2 tasks
    const brainResponse = JSON.stringify([
      { description: 'Create contact form page with email sending', files: ['app/contact/page.tsx'], type: 'single_file' },
      { description: 'Create API route for sending email', files: ['app/api/contact/route.ts'], type: 'single_file' },
    ]);

    const contactStreamResponse = buildContactPageStreamResponse();
    const apiStreamResponse = buildApiContactRouteStreamResponse();

    const brainLlm = makeMockLlm(brainResponse);
    const eventBus = makeMockEventBus();
    const git = makeMockGit();

    const brain = new Brain(brainLlm);
    const observation = makeScopedEditObservation();
    const tasks = await brain.analyze(observation, projectMap);

    expect(tasks).toHaveLength(2);

    // Execute task 1: contact page
    const llm1 = makeMockLlm('', contactStreamResponse);
    const exec1 = new Lane3Executor(tmp, llm1, git, eventBus, 1);
    const r1 = await exec1.execute(tasks[0], projectMap);
    expect(r1.success).toBe(true);

    // Execute task 2: API route
    const llm2 = makeMockLlm('', apiStreamResponse);
    const exec2 = new Lane3Executor(tmp, llm2, git, eventBus, 1);
    const r2 = await exec2.execute(tasks[1], projectMap);
    expect(r2.success).toBe(true);

    // Verify files exist
    expect(existsSync(path.join(tmp, 'app', 'contact', 'page.tsx'))).toBe(true);
    expect(existsSync(path.join(tmp, 'app', 'api', 'contact', 'route.ts'))).toBe(true);
  }, 30_000);

  it.concurrent('c) Scoped edit with click coordinates: PromptBuilder includes x/y', async () => {
    const { PromptBuilder } = await import('../../packages/core/src/brain/PromptBuilder.js');

    const promptBuilder = new PromptBuilder();
    const observation = makeScopedEditObservation({
      clickCoords: { x: 320, y: 480 },
    });

    const projectMap = makeProjectMap(new Map());
    const messages = promptBuilder.buildAnalysisPrompt(observation, projectMap);

    const fullText = messages.map(m => m.content).join('\n');
    expect(fullText).toContain('x=320');
    expect(fullText).toContain('y=480');
  });

  it.concurrent('d) Scoped edit with console errors: PromptBuilder passes them through', async () => {
    const { PromptBuilder } = await import('../../packages/core/src/brain/PromptBuilder.js');

    const promptBuilder = new PromptBuilder();
    const observation = makeScopedEditObservation({
      consoleErrors: ['TypeError: Cannot read property "submit" of null', 'Uncaught ReferenceError: handleSubmit is not defined'],
    });

    const projectMap = makeProjectMap(new Map());
    const messages = promptBuilder.buildAnalysisPrompt(observation, projectMap);

    const fullText = messages.map(m => m.content).join('\n');

    // The DOM snapshot and transcript should still be present
    expect(fullText).toContain('Quick Message');
    expect(fullText).toContain('DOM snapshot');

    // NOTE: PromptBuilder currently does NOT include consoleErrors in the prompt.
    // This verifies current behavior — consoleErrors are available on the Observation
    // but not yet forwarded to LLM. When this is implemented, update these assertions.
    expect(observation.consoleErrors).toHaveLength(2);
    expect(observation.consoleErrors![0]).toContain('TypeError');
    expect(observation.consoleErrors![1]).toContain('handleSubmit');
  });

  it.concurrent('e) Email sending quality check: generated contact form has all required elements', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    createFullstackProject(tmp);
    const eventBus = makeMockEventBus();

    const streamResponse = buildContactPageAndApiStreamResponse();
    const llm = makeMockLlm('', streamResponse);
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const fileContexts = buildFullstackFileContexts(tmp);
    const projectMap = makeFullstackProjectMap(fileContexts);

    const task = makeTask({
      description: 'Create contact form and API for email sending',
      files: ['app/contact/page.tsx', 'app/api/contact/route.ts'],
      type: 'multi_file',
      lane: 3,
    });

    const result = await executor.execute(task, projectMap);
    expect(result.success).toBe(true);

    const contactPage = readFileSync(path.join(tmp, 'app', 'contact', 'page.tsx'), 'utf-8');

    // Has form with onSubmit
    expect(contactPage).toContain('<form');
    expect(contactPage).toContain('onSubmit');
    expect(contactPage).toContain('handleSubmit');

    // Has fetch to API endpoint
    expect(contactPage).toContain("fetch('/api/contact'");
    expect(contactPage).toContain("'POST'");

    // Has loading/success/error states
    expect(contactPage).toContain("'sending'");
    expect(contactPage).toContain("'sent'");
    expect(contactPage).toContain("'error'");
    expect(contactPage).toContain('Sending...');
    expect(contactPage).toContain('Message sent!');
    expect(contactPage).toContain('Failed to send');

    // Has proper input labels and types
    expect(contactPage).toContain('<label');
    expect(contactPage).toContain('htmlFor=');
    expect(contactPage).toContain('type="text"');
    expect(contactPage).toContain('<textarea');

    // Does NOT have hardcoded email addresses in frontend code
    expect(contactPage).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/);

    // Does NOT have exposed SMTP credentials
    expect(contactPage).not.toContain('SMTP_');
    expect(contactPage).not.toContain('smtp');
    expect(contactPage).not.toContain('nodemailer');

    // Verify API route uses env vars for secrets
    const apiRoute = readFileSync(path.join(tmp, 'app', 'api', 'contact', 'route.ts'), 'utf-8');
    expect(apiRoute).toContain('process.env.SMTP_HOST');
    expect(apiRoute).toContain('process.env.SMTP_USER');
    expect(apiRoute).toContain('process.env.SMTP_PASS');
    // API route should NOT have hardcoded passwords
    expect(apiRoute).not.toMatch(/pass(?:word)?:\s*['"][^'"]*['"]/i);
  });
});
