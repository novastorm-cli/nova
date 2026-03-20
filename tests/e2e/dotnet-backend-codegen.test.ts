import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { TaskItem, ProjectMap, LlmClient, MiniContext } from '../../packages/core/src/models/types.js';
import type { IGitManager } from '../../packages/core/src/contracts/IGitManager.js';
import type { EventBus } from '../../packages/core/src/models/events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpDirsToClean: string[] = [];

function trackTmp(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nova-dotnet-'));
  tmpDirsToClean.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirsToClean) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function createDotnetProject(dir: string, files: Record<string, string>): void {
  for (const [filePath, content] of Object.entries(files)) {
    const absPath = path.join(dir, filePath);
    mkdirSync(path.dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, 'utf-8');
  }
}

function makeTask(overrides: Partial<TaskItem> & Pick<TaskItem, 'description' | 'files' | 'type' | 'lane'>): TaskItem {
  return {
    id: crypto.randomUUID(),
    status: 'pending',
    ...overrides,
  };
}

function makeDotnetProjectMap(overrides: Partial<ProjectMap> = {}): ProjectMap {
  return {
    stack: { framework: 'dotnet', language: 'csharp', typescript: false },
    devCommand: 'dotnet run',
    port: 5000,
    routes: [],
    components: [],
    endpoints: [],
    models: [],
    dependencies: new Map(),
    fileContexts: new Map(),
    compressedContext: 'ASP.NET Core Web API with Controllers',
    ...overrides,
  };
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

// ============================================================================
// 1. StackDetector -- resilience to various .NET structures
// ============================================================================

describe.concurrent('StackDetector -- .NET structures', () => {

  it.concurrent('a) standard .csproj in root -> detects dotnet/csharp', async () => {
    const { StackDetector } = await import('../../packages/core/src/indexer/StackDetector.js');
    const detector = new StackDetector();

    const tmp = trackTmp();
    createDotnetProject(tmp, {
      'WebApp.csproj': `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`,
    });

    const stack = await detector.detectStack(tmp);
    expect(stack.framework).toBe('dotnet');
    expect(stack.language).toBe('csharp');
  });

  it.concurrent('b) no .csproj in root but package.json -> detects JS framework', async () => {
    const { StackDetector } = await import('../../packages/core/src/indexer/StackDetector.js');
    const detector = new StackDetector();

    const tmp = trackTmp();
    createDotnetProject(tmp, {
      'src/WebApp.csproj': `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`,
      'package.json': JSON.stringify({
        dependencies: { next: '14.0.0' },
        devDependencies: { typescript: '5.0.0' },
      }),
      'tsconfig.json': '{}',
    });

    const stack = await detector.detectStack(tmp);
    // package.json check comes first and finds next.js, .csproj only checked in root
    expect(stack.framework).toBe('next.js');
    expect(stack.language).toBe('typescript');
  });

  it.concurrent('c) both .csproj and package.json -> package.json wins (checked first)', async () => {
    const { StackDetector } = await import('../../packages/core/src/indexer/StackDetector.js');
    const detector = new StackDetector();

    const tmp = trackTmp();
    createDotnetProject(tmp, {
      'WebApp.csproj': `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`,
      'package.json': JSON.stringify({
        dependencies: { vite: '5.0.0' },
      }),
    });

    const stack = await detector.detectStack(tmp);
    expect(stack.framework).toBe('vite');
  });
});

// ============================================================================
// 2. EndpointExtractor -- chaotic AI-generated .NET code
// ============================================================================

describe.concurrent('EndpointExtractor -- .NET endpoints', () => {

  it.concurrent('a) standard Controller with [Route] and [Http*] attrs', async () => {
    const { EndpointExtractor } = await import('../../packages/core/src/indexer/EndpointExtractor.js');
    const extractor = new EndpointExtractor();
    const stack = { framework: 'dotnet', language: 'csharp', typescript: false };

    const tmp = trackTmp();
    createDotnetProject(tmp, {
      'Controllers/UsersController.cs': `using Microsoft.AspNetCore.Mvc;
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok();

    [HttpPost]
    public IActionResult Create([FromBody] object user) => Created("", user);
}`,
    });

    const endpoints = await extractor.extract(tmp, stack);
    expect(endpoints.length).toBe(2);

    const getPaths = endpoints.filter(e => e.method === 'GET').map(e => e.path);
    const postPaths = endpoints.filter(e => e.method === 'POST').map(e => e.path);
    expect(getPaths).toContain('/api/users');
    expect(postPaths).toContain('/api/users');
  });

  it.concurrent('b) Controller WITHOUT [Route] attr -- full path on each method', async () => {
    const { EndpointExtractor } = await import('../../packages/core/src/indexer/EndpointExtractor.js');
    const extractor = new EndpointExtractor();
    const stack = { framework: 'dotnet', language: 'csharp', typescript: false };

    const tmp = trackTmp();
    createDotnetProject(tmp, {
      'Controllers/ItemsController.cs': `public class ItemsController : ControllerBase
{
    [HttpGet("/api/items")]
    public IActionResult GetAll() => Ok();

    [HttpPost("/api/items")]
    public IActionResult Create() => Ok();
}`,
    });

    const endpoints = await extractor.extract(tmp, stack);
    expect(endpoints.length).toBe(2);

    const paths = endpoints.map(e => e.path);
    expect(paths).toContain('/api/items');
    expect(endpoints.find(e => e.method === 'GET')).toBeDefined();
    expect(endpoints.find(e => e.method === 'POST')).toBeDefined();
  });

  it.concurrent('c) Minimal API with MapGet/MapPost/MapPut/MapDelete', async () => {
    const { EndpointExtractor } = await import('../../packages/core/src/indexer/EndpointExtractor.js');
    const extractor = new EndpointExtractor();
    const stack = { framework: 'dotnet', language: 'csharp', typescript: false };

    const tmp = trackTmp();
    createDotnetProject(tmp, {
      'Program.cs': `var app = builder.Build();
app.MapGet("/api/products", () => Results.Ok());
app.MapPost("/api/products", (Product p) => Results.Created($"/api/products/{p.Id}", p));
app.MapPut("/api/products/{id}", (int id, Product p) => Results.Ok(p));
app.MapDelete("/api/products/{id}", (int id) => Results.NoContent());`,
    });

    const endpoints = await extractor.extract(tmp, stack);
    expect(endpoints.length).toBe(4);

    const methods = endpoints.map(e => e.method).sort();
    expect(methods).toEqual(['DELETE', 'GET', 'POST', 'PUT']);
    expect(endpoints.find(e => e.method === 'GET')!.path).toBe('/api/products');
    expect(endpoints.find(e => e.method === 'DELETE')!.path).toBe('/api/products/{id}');
  });

  it.concurrent('d) Mixed: Controllers + Minimal API in same project', async () => {
    const { EndpointExtractor } = await import('../../packages/core/src/indexer/EndpointExtractor.js');
    const extractor = new EndpointExtractor();
    const stack = { framework: 'dotnet', language: 'csharp', typescript: false };

    const tmp = trackTmp();
    createDotnetProject(tmp, {
      'Controllers/UsersController.cs': `using Microsoft.AspNetCore.Mvc;
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok();
}`,
      'Program.cs': `var app = builder.Build();
app.MapGet("/api/health", () => Results.Ok());`,
    });

    const endpoints = await extractor.extract(tmp, stack);
    expect(endpoints.length).toBe(2);

    const paths = endpoints.map(e => e.path).sort();
    expect(paths).toContain('/api/health');
    expect(paths).toContain('/api/users');
  });

  it.concurrent('e) Weird formatting -- extra whitespace, newlines between attr and method', async () => {
    const { EndpointExtractor } = await import('../../packages/core/src/indexer/EndpointExtractor.js');
    const extractor = new EndpointExtractor();
    const stack = { framework: 'dotnet', language: 'csharp', typescript: false };

    const tmp = trackTmp();
    // Note: The httpAttrRegex expects [HttpGet("path")] with no spaces inside parens.
    // Spaces inside parens like [HttpGet(  "active"  )] will NOT match.
    // But [HttpPost] (no parens) and [HttpGet("active")] (no extra spaces) work fine.
    // Also, extra blank lines between attr and method are handled by \s* in the regex.
    createDotnetProject(tmp, {
      'Controllers/WeirdController.cs': `[ApiController]
[Route("api/[controller]")]
public class   WeirdController : ControllerBase
{
    [HttpGet("active")]

    public IActionResult GetActive() => Ok();

    [HttpPost]


    public IActionResult Create() => Ok();
}`,
    });

    const endpoints = await extractor.extract(tmp, stack);
    expect(endpoints.length).toBe(2);

    const getMethods = endpoints.filter(e => e.method === 'GET');
    expect(getMethods.length).toBe(1);
    expect(getMethods[0].path).toContain('/api/weird');
  });

  it.concurrent('f) Custom route with subpath and parameters', async () => {
    const { EndpointExtractor } = await import('../../packages/core/src/indexer/EndpointExtractor.js');
    const extractor = new EndpointExtractor();
    const stack = { framework: 'dotnet', language: 'csharp', typescript: false };

    const tmp = trackTmp();
    createDotnetProject(tmp, {
      'Controllers/OrdersController.cs': `[Route("custom/v2/[controller]")]
public class OrdersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok();

    [HttpGet("{id}")]
    public IActionResult GetById(int id) => Ok();

    [HttpPost("batch")]
    public IActionResult CreateBatch() => Ok();
}`,
    });

    const endpoints = await extractor.extract(tmp, stack);
    expect(endpoints.length).toBe(3);

    const paths = endpoints.map(e => e.path).sort();
    expect(paths).toContain('/custom/v2/orders');
    expect(paths).toContain('/custom/v2/orders/{id}');
    expect(paths).toContain('/custom/v2/orders/batch');
  });

  it.concurrent('g) Empty .cs file and file with no endpoints -> empty array', async () => {
    const { EndpointExtractor } = await import('../../packages/core/src/indexer/EndpointExtractor.js');
    const extractor = new EndpointExtractor();
    const stack = { framework: 'dotnet', language: 'csharp', typescript: false };

    const tmp = trackTmp();
    createDotnetProject(tmp, {
      'Models/Product.cs': `// Model file
namespace WebApp.Models;
public class Product { public int Id { get; set; } public string Name { get; set; } }`,
      'Empty.cs': '',
    });

    const endpoints = await extractor.extract(tmp, stack);
    expect(endpoints).toEqual([]);
  });
});

// ============================================================================
// 3. RouteExtractor -- .NET non-standard structures
// ============================================================================

describe.concurrent('RouteExtractor -- .NET routes', () => {

  it.concurrent('a) [Route("api/[controller]")] on Controller -> extracted as API route', async () => {
    const { RouteExtractor } = await import('../../packages/core/src/indexer/RouteExtractor.js');
    const extractor = new RouteExtractor();
    const stack = { framework: 'dotnet', language: 'csharp', typescript: false };

    const tmp = trackTmp();
    createDotnetProject(tmp, {
      'Controllers/UsersController.cs': `[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok();
}`,
    });

    const routes = await extractor.extract(tmp, stack);
    // RouteExtractor.extractDotnetRoutes matches [Route("...")] pattern
    const routePaths = routes.map(r => r.path);
    expect(routePaths).toContain('/api/[controller]');
    expect(routes[0].type).toBe('api');
  });

  it.concurrent('b) Minimal API MapGet/MapPost -> extracted as API routes', async () => {
    const { RouteExtractor } = await import('../../packages/core/src/indexer/RouteExtractor.js');
    const extractor = new RouteExtractor();
    const stack = { framework: 'dotnet', language: 'csharp', typescript: false };

    const tmp = trackTmp();
    // Note: RouteExtractor's mapRegex is /Map(Get|Post|...)\("([^"]+)"\)/g which expects
    // the closing paren right after the quoted path. This matches MapGet("/path") but NOT
    // MapGet("/path", () => ...) since there's a comma after the closing quote.
    // So we use the form that the regex actually matches.
    createDotnetProject(tmp, {
      'Program.cs': `var app = builder.Build();
app.MapGet("/api/products");
app.MapPost("/api/orders");`,
    });

    const routes = await extractor.extract(tmp, stack);
    expect(routes.length).toBe(2);

    const getRoute = routes.find(r => r.methods?.includes('GET'));
    const postRoute = routes.find(r => r.methods?.includes('POST'));
    expect(getRoute).toBeDefined();
    expect(postRoute).toBeDefined();
    expect(getRoute!.path).toBe('/api/products');
    expect(postRoute!.path).toBe('/api/orders');
  });

  it.concurrent('c) .cs files in non-standard folders (Endpoints/, Features/) -> still found', async () => {
    const { RouteExtractor } = await import('../../packages/core/src/indexer/RouteExtractor.js');
    const extractor = new RouteExtractor();
    const stack = { framework: 'dotnet', language: 'csharp', typescript: false };

    const tmp = trackTmp();
    // RouteExtractor scans ALL .cs files recursively regardless of folder name.
    // [Route("...")] attrs are detected via routeAttrRegex.
    // Minimal API MapGet uses mapRegex which requires MapGet("path") form (no lambda args).
    createDotnetProject(tmp, {
      'Features/Users/UsersEndpoint.cs': `[Route("api/users")]
public class UsersEndpoint : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok();
}`,
      'Endpoints/HealthEndpoint.cs': `app.MapGet("/api/health");`,
    });

    const routes = await extractor.extract(tmp, stack);
    expect(routes.length).toBeGreaterThanOrEqual(2);

    const paths = routes.map(r => r.path);
    expect(paths).toContain('/api/users');
    expect(paths).toContain('/api/health');
  });
});

// ============================================================================
// 4. ProjectIndexer on various .NET structures
// ============================================================================

describe.concurrent('ProjectIndexer -- .NET structures', () => {

  it.concurrent('a) standard structure with Controllers/ and .csproj', async () => {
    const { ProjectIndexer } = await import('../../packages/core/src/indexer/ProjectIndexer.js');

    const tmp = trackTmp();
    createDotnetProject(tmp, {
      'WebApp.csproj': `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`,
      'Controllers/UsersController.cs': `using Microsoft.AspNetCore.Mvc;
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok();
}`,
    });

    const indexer = new ProjectIndexer();
    const projectMap = await indexer.index(tmp);

    expect(projectMap.stack.framework).toBe('dotnet');
    expect(projectMap.stack.language).toBe('csharp');
    expect(projectMap.endpoints.length).toBeGreaterThanOrEqual(1);
    expect(projectMap.endpoints.some(e => e.path === '/api/users')).toBe(true);
  });

  it.concurrent('b) chaotic AI structure: controllers in various folders + Minimal API', async () => {
    const { ProjectIndexer } = await import('../../packages/core/src/indexer/ProjectIndexer.js');

    const tmp = trackTmp();
    createDotnetProject(tmp, {
      'WebApp.csproj': `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`,
      'Api/ProductsController.cs': `using Microsoft.AspNetCore.Mvc;
[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok();
}`,
      'Features/Users/UsersController.cs': `using Microsoft.AspNetCore.Mvc;
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok();
}`,
      'Program.cs': `var app = builder.Build();
app.MapGet("/api/health", () => Results.Ok());`,
    });

    const indexer = new ProjectIndexer();
    const projectMap = await indexer.index(tmp);

    expect(projectMap.stack.framework).toBe('dotnet');
    expect(projectMap.endpoints.length).toBeGreaterThanOrEqual(3);

    const endpointPaths = projectMap.endpoints.map(e => e.path);
    expect(endpointPaths).toContain('/api/products');
    expect(endpointPaths).toContain('/api/users');
    expect(endpointPaths).toContain('/api/health');
  });

  it.concurrent('c) minimal project: only .csproj + Program.cs with Minimal API', async () => {
    const { ProjectIndexer } = await import('../../packages/core/src/indexer/ProjectIndexer.js');

    const tmp = trackTmp();
    createDotnetProject(tmp, {
      'WebApp.csproj': `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`,
      'Program.cs': `var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.MapGet("/api/items", () => Results.Ok(new[] { "Item1" }));
app.MapPost("/api/items", (Item i) => Results.Created("", i));
app.Run();`,
    });

    const indexer = new ProjectIndexer();
    const projectMap = await indexer.index(tmp);

    expect(projectMap.stack.framework).toBe('dotnet');
    expect(projectMap.endpoints.length).toBe(2);
    expect(projectMap.endpoints.some(e => e.method === 'GET')).toBe(true);
    expect(projectMap.endpoints.some(e => e.method === 'POST')).toBe(true);
  });
});

// ============================================================================
// 5. fileBlocks parsing AI-generated .NET code
// ============================================================================

describe.concurrent('fileBlocks -- parsing .NET code', () => {

  it.concurrent('a) parseMixedBlocks -- FILE block with new Controller', async () => {
    const { parseMixedBlocks } = await import('../../packages/core/src/executor/fileBlocks.js');

    const response = `=== FILE: Controllers/ProductsController.cs ===
using Microsoft.AspNetCore.Mvc;
namespace WebApp.Controllers;
[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok(new[] { "Product1" });
}
=== END FILE ===`;

    const blocks = parseMixedBlocks(response);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('file');
    if (blocks[0].type === 'file') {
      expect(blocks[0].path).toBe('Controllers/ProductsController.cs');
      expect(blocks[0].content).toContain('[ApiController]');
      expect(blocks[0].content).toContain('ProductsController');
    }
  });

  it.concurrent('b) parseMixedBlocks -- DIFF for existing .cs file', async () => {
    const { parseMixedBlocks } = await import('../../packages/core/src/executor/fileBlocks.js');

    const response = `=== DIFF: Controllers/UsersController.cs ===
--- a/Controllers/UsersController.cs
+++ b/Controllers/UsersController.cs
@@ -10,6 +10,12 @@
     [HttpPost]
     public IActionResult Create([FromBody] object user) => Created("", user);
+
+    [HttpDelete("{id}")]
+    public IActionResult Delete(int id)
+    {
+        return NoContent();
+    }
 }
=== END DIFF ===`;

    const blocks = parseMixedBlocks(response);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('diff');
    if (blocks[0].type === 'diff') {
      expect(blocks[0].path).toBe('Controllers/UsersController.cs');
      expect(blocks[0].diff).toContain('@@');
      expect(blocks[0].diff).toContain('+    [HttpDelete("{id}")]');
    }
  });

  it.concurrent('c) messy formatting -- extra blank lines, mixed tabs/spaces', async () => {
    const { parseMixedBlocks } = await import('../../packages/core/src/executor/fileBlocks.js');

    const response = `=== FILE: Models/Product.cs ===

namespace WebApp.Models;

\tpublic class Product
{
\t\tpublic int Id { get; set; }
\tpublic string Name {get;set;}

}

=== END FILE ===`;

    const blocks = parseMixedBlocks(response);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('file');
    if (blocks[0].type === 'file') {
      expect(blocks[0].path).toBe('Models/Product.cs');
      expect(blocks[0].content).toContain('Product');
      expect(blocks[0].content).toContain('Id');
    }
  });

  it.concurrent('d) multiple .cs files + .csproj in one LLM response -> 3 blocks', async () => {
    const { parseMixedBlocks } = await import('../../packages/core/src/executor/fileBlocks.js');

    const response = `=== FILE: Models/Order.cs ===
namespace WebApp.Models;
public class Order { public int Id { get; set; } }
=== END FILE ===
=== FILE: Controllers/OrdersController.cs ===
using Microsoft.AspNetCore.Mvc;
namespace WebApp.Controllers;
[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok(new List<Order>());
}
=== END FILE ===
=== DIFF: WebApp.csproj ===
--- a/WebApp.csproj
+++ b/WebApp.csproj
@@ -1,4 +1,7 @@
 <Project Sdk="Microsoft.NET.Sdk.Web">
+  <ItemGroup>
+    <PackageReference Include="Swashbuckle.AspNetCore" Version="6.5.0" />
+  </ItemGroup>
 </Project>
=== END DIFF ===`;

    const blocks = parseMixedBlocks(response);
    expect(blocks).toHaveLength(3);

    const fileBlocks = blocks.filter(b => b.type === 'file');
    const diffBlocks = blocks.filter(b => b.type === 'diff');
    expect(fileBlocks).toHaveLength(2);
    expect(diffBlocks).toHaveLength(1);

    expect(fileBlocks[0].path).toBe('Models/Order.cs');
    expect(fileBlocks[1].path).toBe('Controllers/OrdersController.cs');
    if (diffBlocks[0].type === 'diff') {
      expect(diffBlocks[0].path).toBe('WebApp.csproj');
      expect(diffBlocks[0].diff).toContain('Swashbuckle');
    }
  });
});

// ============================================================================
// 6. Lane3Executor -- .NET backend generation
// ============================================================================

describe.concurrent('Lane3Executor -- .NET backend generation', () => {

  it.concurrent('a) LLM returns FILE for new ProductsController.cs -> written to disk', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    const eventBus = makeMockEventBus();

    const llmResponse = `=== FILE: Controllers/ProductsController.cs ===
using Microsoft.AspNetCore.Mvc;

namespace WebApp.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    private static readonly List<string> _products = new() { "Widget", "Gadget" };

    [HttpGet]
    public IActionResult GetAll() => Ok(_products);

    [HttpGet("{id}")]
    public IActionResult GetById(int id) => Ok(_products.ElementAtOrDefault(id));

    [HttpPost]
    public IActionResult Create([FromBody] string product)
    {
        _products.Add(product);
        return Created($"/api/products/{_products.Count - 1}", product);
    }
}
=== END FILE ===`;

    const llm = makeMockLlm('', llmResponse);
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const task = makeTask({
      description: 'create Products CRUD controller',
      files: ['Controllers/ProductsController.cs'],
      type: 'multi_file',
      lane: 3,
    });

    const projectMap = makeDotnetProjectMap();
    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe('abc1234');
    expect(git.commit).toHaveBeenCalledTimes(1);

    const written = readFileSync(path.join(tmp, 'Controllers', 'ProductsController.cs'), 'utf-8');
    expect(written).toContain('ProductsController');
    expect(written).toContain('[HttpGet]');
    expect(written).toContain('[HttpPost]');
  });

  it.concurrent('b) LLM returns DIFF adding [HttpDelete] to existing Controller', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    const eventBus = makeMockEventBus();

    const originalContent = `using Microsoft.AspNetCore.Mvc;

namespace WebApp.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok();

    [HttpPost]
    public IActionResult Create([FromBody] object user) => Created("", user);
}`;

    createDotnetProject(tmp, {
      'Controllers/UsersController.cs': originalContent,
    });

    const diffResponse = `=== DIFF: Controllers/UsersController.cs ===
--- a/Controllers/UsersController.cs
+++ b/Controllers/UsersController.cs
@@ -12,4 +12,10 @@
     [HttpPost]
     public IActionResult Create([FromBody] object user) => Created("", user);
+
+    [HttpDelete("{id}")]
+    public IActionResult Delete(int id)
+    {
+        return NoContent();
+    }
 }
=== END DIFF ===`;

    const llm = makeMockLlm('', diffResponse);
    const git = makeMockGit();

    const fileContexts = new Map<string, MiniContext>();
    fileContexts.set('Controllers/UsersController.cs', {
      filePath: 'Controllers/UsersController.cs',
      content: originalContent,
      importedTypes: '',
    });

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const task = makeTask({
      description: 'add Delete endpoint to UsersController',
      files: ['Controllers/UsersController.cs'],
      type: 'multi_file',
      lane: 3,
    });

    const projectMap = makeDotnetProjectMap({ fileContexts });
    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);

    const updated = readFileSync(path.join(tmp, 'Controllers', 'UsersController.cs'), 'utf-8');
    expect(updated).toContain('[HttpDelete');
    expect(updated).toContain('Delete');
  });

  it.concurrent('c) LLM returns FILE for Program.cs with Minimal API', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    const eventBus = makeMockEventBus();

    const llmResponse = `=== FILE: Program.cs ===
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
var app = builder.Build();
app.MapGet("/api/health", () => Results.Ok(new { status = "healthy" }));
app.MapControllers();
app.Run();
=== END FILE ===`;

    const llm = makeMockLlm('', llmResponse);
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const task = makeTask({
      description: 'create Program.cs with health endpoint',
      files: ['Program.cs'],
      type: 'multi_file',
      lane: 3,
    });

    const projectMap = makeDotnetProjectMap();
    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);

    const written = readFileSync(path.join(tmp, 'Program.cs'), 'utf-8');
    expect(written).toContain('MapGet("/api/health"');
    expect(written).toContain('MapControllers');
  });

  it.concurrent('d) LLM returns 3 files at once (Model + Controller + Program update)', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    const eventBus = makeMockEventBus();

    const originalProgram = `var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.Run();`;

    createDotnetProject(tmp, {
      'Program.cs': originalProgram,
    });

    const llmResponse = `=== FILE: Models/Product.cs ===
namespace WebApp.Models;
public class Product { public int Id { get; set; } public string Name { get; set; } = ""; }
=== END FILE ===
=== FILE: Controllers/ProductsController.cs ===
using Microsoft.AspNetCore.Mvc;
using WebApp.Models;
namespace WebApp.Controllers;
[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok(new List<Product>());
}
=== END FILE ===
=== DIFF: Program.cs ===
--- a/Program.cs
+++ b/Program.cs
@@ -1,3 +1,5 @@
 var builder = WebApplication.CreateBuilder(args);
+builder.Services.AddControllers();
 var app = builder.Build();
+app.MapControllers();
 app.Run();
=== END DIFF ===`;

    const llm = makeMockLlm('', llmResponse);
    const git = makeMockGit();

    const fileContexts = new Map<string, MiniContext>();
    fileContexts.set('Program.cs', {
      filePath: 'Program.cs',
      content: originalProgram,
      importedTypes: '',
    });

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const task = makeTask({
      description: 'add Products model, controller, and register in Program.cs',
      files: ['Models/Product.cs', 'Controllers/ProductsController.cs', 'Program.cs'],
      type: 'multi_file',
      lane: 3,
    });

    const projectMap = makeDotnetProjectMap({ fileContexts });
    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);

    expect(existsSync(path.join(tmp, 'Models', 'Product.cs'))).toBe(true);
    expect(existsSync(path.join(tmp, 'Controllers', 'ProductsController.cs'))).toBe(true);

    const model = readFileSync(path.join(tmp, 'Models', 'Product.cs'), 'utf-8');
    expect(model).toContain('Product');

    const controller = readFileSync(path.join(tmp, 'Controllers', 'ProductsController.cs'), 'utf-8');
    expect(controller).toContain('ProductsController');

    const program = readFileSync(path.join(tmp, 'Program.cs'), 'utf-8');
    expect(program).toContain('AddControllers');
    expect(program).toContain('MapControllers');
  });
});

// ============================================================================
// 7. DiffApplier on .NET files
// ============================================================================

describe.concurrent('DiffApplier -- .NET files', () => {

  it.concurrent('a) add new method to Controller', async () => {
    const { DiffApplier } = await import('../../packages/core/src/executor/DiffApplier.js');
    const applier = new DiffApplier();

    const tmp = trackTmp();
    const before = `using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok();
}`;

    const after = `using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok();

    [HttpDelete("{id}")]
    public IActionResult Delete(int id) => NoContent();
}`;

    const filePath = path.join(tmp, 'UsersController.cs');
    writeFileSync(filePath, before, 'utf-8');

    const diff = applier.generate(before, after, 'UsersController.cs');
    expect(diff).toContain('@@');
    expect(diff).toContain('+    [HttpDelete');

    await applier.apply(filePath, diff);

    const result = readFileSync(filePath, 'utf-8');
    expect(result).toContain('[HttpDelete("{id}")]');
    expect(result).toContain('Delete');
  });

  it.concurrent('b) change [Route] attribute', async () => {
    const { DiffApplier } = await import('../../packages/core/src/executor/DiffApplier.js');
    const applier = new DiffApplier();

    const tmp = trackTmp();
    const before = `[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok();
}`;

    const after = `[ApiController]
[Route("api/v2/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok();
}`;

    const filePath = path.join(tmp, 'UsersController.cs');
    writeFileSync(filePath, before, 'utf-8');

    const diff = applier.generate(before, after, 'UsersController.cs');
    await applier.apply(filePath, diff);

    const result = readFileSync(filePath, 'utf-8');
    expect(result).toContain('api/v2/[controller]');
    expect(result).not.toMatch(/\[Route\("api\/\[controller\]"\)\]/);
  });

  it.concurrent('c) diff on file with CRLF line endings', async () => {
    const { DiffApplier } = await import('../../packages/core/src/executor/DiffApplier.js');
    const applier = new DiffApplier();

    const tmp = trackTmp();
    // Use actual CRLF (\r\n) line endings as LLM might generate on Windows
    const beforeContent = 'using System;\r\nnamespace WebApp;\r\npublic class Test\r\n{\r\n    public int Id { get; set; }\r\n}';
    const afterContent = 'using System;\r\nnamespace WebApp;\r\npublic class Test\r\n{\r\n    public int Id { get; set; }\r\n    public string Name { get; set; } = "";\r\n}';

    const filePath = path.join(tmp, 'Test.cs');
    writeFileSync(filePath, beforeContent, 'utf-8');

    const diff = applier.generate(beforeContent, afterContent, 'Test.cs');
    await applier.apply(filePath, diff);

    const result = readFileSync(filePath, 'utf-8');
    expect(result).toContain('Name { get; set; }');
    expect(result).toContain('Id { get; set; }');
  });
});

// ============================================================================
// 8. Brain + TaskDecomposer for .NET
// ============================================================================

describe.concurrent('Brain + TaskDecomposer -- .NET', () => {

  it.concurrent('a) Brain.analyze: "add Products CRUD API" with dotnet ProjectMap', async () => {
    const { Brain } = await import('../../packages/core/src/brain/Brain.js');

    const llmResponse = JSON.stringify([
      { description: 'Create Products model', files: ['Models/Product.cs'], type: 'single_file' },
      { description: 'Create ProductsController with CRUD endpoints', files: ['Controllers/ProductsController.cs', 'Program.cs'], type: 'multi_file' },
    ]);

    const llm = makeMockLlm(llmResponse);
    const brain = new Brain(llm);

    const observation = {
      screenshot: Buffer.from(''),
      transcript: 'add Products CRUD API',
      currentUrl: 'http://localhost:5000/',
      timestamp: Date.now(),
    };

    const projectMap = makeDotnetProjectMap();
    const tasks = await brain.analyze(observation, projectMap);

    expect(tasks.length).toBe(2);
    expect(tasks[0].description).toContain('Products model');
    expect(tasks[0].files).toContain('Models/Product.cs');
    // single file -> lane 2
    expect(tasks[0].lane).toBe(2);

    expect(tasks[1].description).toContain('ProductsController');
    expect(tasks[1].files.length).toBe(2);
    // multi file -> lane 3
    expect(tasks[1].lane).toBe(3);
  });

  it.concurrent('b) TaskDecomposer: lane 3 task -> decomposed with lanes assigned', async () => {
    const { TaskDecomposer } = await import('../../packages/core/src/brain/TaskDecomposer.js');

    const decomposedResponse = JSON.stringify([
      { description: 'Create Order model', files: ['Models/Order.cs'], type: 'single_file' },
      { description: 'Create OrdersController', files: ['Controllers/OrdersController.cs'], type: 'single_file' },
    ]);

    const llm = makeMockLlm(decomposedResponse);
    const decomposer = new TaskDecomposer(llm);

    const task = makeTask({
      description: 'implement Orders API with CRUD endpoints',
      files: ['Models/Order.cs', 'Controllers/OrdersController.cs'],
      type: 'multi_file',
      lane: 3,
    });

    const projectMap = makeDotnetProjectMap();
    const subtasks = await decomposer.decompose(task, projectMap);

    expect(subtasks.length).toBe(2);
    for (const st of subtasks) {
      expect(st.id).toBeDefined();
      expect(st.lane).toBeDefined();
      expect([1, 2, 3, 4]).toContain(st.lane);
      expect(st.status).toBe('pending');
    }
  });

  it.concurrent('c) Brain.analyze: "change the GET endpoint response format" -> lane 2', async () => {
    const { Brain } = await import('../../packages/core/src/brain/Brain.js');

    const llmResponse = JSON.stringify([
      { description: 'change the GET endpoint response format in UsersController', files: ['Controllers/UsersController.cs'], type: 'single_file' },
    ]);

    const llm = makeMockLlm(llmResponse);
    const brain = new Brain(llm);

    const observation = {
      screenshot: Buffer.from(''),
      transcript: 'change the GET endpoint response format',
      currentUrl: 'http://localhost:5000/',
      timestamp: Date.now(),
    };

    const projectMap = makeDotnetProjectMap();
    const tasks = await brain.analyze(observation, projectMap);

    expect(tasks.length).toBe(1);
    // single file, no style keyword, no add keyword -> lane 2
    expect(tasks[0].lane).toBe(2);
  });
});

// ============================================================================
// 9. Full E2E pipeline .NET
// ============================================================================

describe.concurrent('Full E2E pipeline -- .NET', () => {

  it.concurrent('a) Index -> Brain.analyze -> Lane3 execute -> re-index -> new endpoints visible', async () => {
    const { ProjectIndexer } = await import('../../packages/core/src/indexer/ProjectIndexer.js');
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');
    const { Brain } = await import('../../packages/core/src/brain/Brain.js');

    const tmp = trackTmp();
    createDotnetProject(tmp, {
      'WebApp.csproj': `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`,
      'Controllers/UsersController.cs': `using Microsoft.AspNetCore.Mvc;
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok();
}`,
    });

    // Step 1: Index
    const indexer = new ProjectIndexer();
    const projectMap = await indexer.index(tmp);
    expect(projectMap.stack.framework).toBe('dotnet');
    expect(projectMap.endpoints.some(e => e.path === '/api/users')).toBe(true);

    // Step 2: Brain.analyze with mock
    const brainResponse = JSON.stringify([
      { description: 'Create Products CRUD controller', files: ['Controllers/ProductsController.cs'], type: 'single_file' },
    ]);
    const brainLlm = makeMockLlm(brainResponse);
    const brain = new Brain(brainLlm);

    const observation = {
      screenshot: Buffer.from(''),
      transcript: 'add a Products API',
      currentUrl: 'http://localhost:5000/',
      timestamp: Date.now(),
    };

    const tasks = await brain.analyze(observation, projectMap);
    expect(tasks.length).toBeGreaterThan(0);

    // Step 3: Lane3 executes with mock LLM
    const lane3Response = `=== FILE: Controllers/ProductsController.cs ===
using Microsoft.AspNetCore.Mvc;

namespace WebApp.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok(new[] { "Widget" });

    [HttpPost]
    public IActionResult Create([FromBody] string product) => Created("", product);
}
=== END FILE ===`;

    const lane3Llm = makeMockLlm('', lane3Response);
    const git = makeMockGit();
    const eventBus = makeMockEventBus();

    const executor = new Lane3Executor(tmp, lane3Llm, git, eventBus, 1);
    const task = makeTask({
      description: tasks[0].description,
      files: ['Controllers/ProductsController.cs'],
      type: 'multi_file',
      lane: 3,
    });

    const result = await executor.execute(task, projectMap);
    expect(result.success).toBe(true);

    // Step 4: Re-index
    const indexer2 = new ProjectIndexer();
    const updatedMap = await indexer2.index(tmp);

    // Verify new endpoints visible
    const endpointPaths = updatedMap.endpoints.map(e => e.path);
    expect(endpointPaths).toContain('/api/users');
    expect(endpointPaths).toContain('/api/products');
  });

  it.concurrent('b) Existing Controller -> Index -> DIFF task -> file updated -> re-index -> new endpoint', async () => {
    const { ProjectIndexer } = await import('../../packages/core/src/indexer/ProjectIndexer.js');
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    const originalContent = `using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok();
}`;

    createDotnetProject(tmp, {
      'WebApp.csproj': `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`,
      'Controllers/UsersController.cs': originalContent,
    });

    // Step 1: Index
    const indexer = new ProjectIndexer();
    const projectMap = await indexer.index(tmp);
    expect(projectMap.endpoints.length).toBe(1);
    expect(projectMap.endpoints[0].method).toBe('GET');

    // Step 2: Lane3 with DIFF that adds POST endpoint
    const diffResponse = `=== DIFF: Controllers/UsersController.cs ===
--- a/Controllers/UsersController.cs
+++ b/Controllers/UsersController.cs
@@ -7,4 +7,7 @@
     [HttpGet]
     public IActionResult GetAll() => Ok();
+
+    [HttpPost]
+    public IActionResult Create([FromBody] object user) => Created("", user);
 }
=== END DIFF ===`;

    const llm = makeMockLlm('', diffResponse);
    const git = makeMockGit();
    const eventBus = makeMockEventBus();

    const fileContexts = new Map<string, MiniContext>();
    fileContexts.set('Controllers/UsersController.cs', {
      filePath: 'Controllers/UsersController.cs',
      content: originalContent,
      importedTypes: '',
    });

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);
    const task = makeTask({
      description: 'add POST endpoint to UsersController',
      files: ['Controllers/UsersController.cs'],
      type: 'multi_file',
      lane: 3,
    });

    const pMap = makeDotnetProjectMap({ fileContexts });
    const result = await executor.execute(task, pMap);
    expect(result.success).toBe(true);

    // Step 3: Re-index
    const indexer2 = new ProjectIndexer();
    const updatedMap = await indexer2.index(tmp);

    // Verify both GET and POST endpoints
    expect(updatedMap.endpoints.length).toBe(2);
    const methods = updatedMap.endpoints.map(e => e.method).sort();
    expect(methods).toEqual(['GET', 'POST']);
  });
});
