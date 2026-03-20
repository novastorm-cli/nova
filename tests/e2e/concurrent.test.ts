import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import { mkdtempSync, rmSync, cpSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import type { Observation, ProjectMap, DependencyNode } from '../../packages/core/src/models/types.js';
import type { NovaEvent, NovaEventType } from '../../packages/core/src/models/events.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const FIXTURE_NEXTJS = path.join(ROOT, 'tests', 'fixtures', 'nextjs-app');
const FIXTURE_VITE = path.join(ROOT, 'tests', 'fixtures', 'vite-app');
const TEST_PROJECT = '/Users/vladimirpronevic/RiderProjects/test-project';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

function httpGet(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    }).on('error', reject);
  });
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeTmp(prefix = 'nova-concurrent-'): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createTargetServer(html: string, port: number): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    server.listen(port, () => resolve(server));
  });
}

function closeServer(server: http.Server | null): Promise<void> {
  return new Promise((resolve) => {
    if (server?.listening) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

function createOverlayScript(tmpDir: string): string {
  const scriptPath = path.join(tmpDir, `nova-overlay-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(scriptPath, '/* nova overlay concurrent test */\nconsole.log("overlay loaded");');
  return scriptPath;
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://localhost:${port}/nova-ws`);
    client.on('open', () => resolve(client));
    client.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Cleanup tracking
// ---------------------------------------------------------------------------

const tmpDirsToClean: string[] = [];
const serversToClose: http.Server[] = [];
const proxiesToStop: Array<{ stop: () => Promise<void>; isRunning: () => boolean }> = [];
const wsClientsToClose: WebSocket[] = [];

afterAll(async () => {
  // Close WS clients
  for (const ws of wsClientsToClose) {
    try { ws.close(); } catch { /* ignore */ }
  }
  // Stop proxies
  for (const p of proxiesToStop) {
    try { if (p.isRunning()) await p.stop(); } catch { /* ignore */ }
  }
  // Close servers
  for (const s of serversToClose) {
    await closeServer(s);
  }
  // Remove tmp dirs
  for (const dir of tmpDirsToClean) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function trackTmp(): string {
  const dir = makeTmp();
  tmpDirsToClean.push(dir);
  return dir;
}

// ============================================================================
// 1. Concurrent Proxy Tests
// ============================================================================

describe.concurrent('Concurrent Proxy Tests', () => {

  // ── 1.1 Three proxy servers simultaneously with different HTML ──

  it.concurrent('spins up 3 proxies simultaneously with different HTML, all inject overlay', async () => {
    const { ProxyServer } = await import('../../packages/proxy/src/ProxyServer.js');

    const htmls = [
      '<html><body><h1>Server Alpha</h1></body></html>',
      '<html><body><h2>Server Beta</h2></body></html>',
      '<html><body><h3>Server Gamma</h3></body></html>',
    ];

    // Allocate all 6 ports in parallel
    const ports = await Promise.all(
      Array.from({ length: 6 }, () => getRandomPort()),
    );

    const targets: http.Server[] = [];
    const proxies: InstanceType<typeof ProxyServer>[] = [];

    try {
      // Start 3 target servers and 3 proxies concurrently
      await Promise.all(
        htmls.map(async (html, i) => {
          const targetPort = ports[i * 2];
          const proxyPort = ports[i * 2 + 1];
          const tmpDir = trackTmp();
          const overlayPath = createOverlayScript(tmpDir);

          const target = await createTargetServer(html, targetPort);
          targets.push(target);
          serversToClose.push(target);

          const proxy = new ProxyServer();
          proxies.push(proxy);
          proxiesToStop.push(proxy);

          await proxy.start(targetPort, proxyPort, overlayPath);
        }),
      );

      // Verify all 3 proxies inject the overlay script and serve correct content
      const results = await Promise.all(
        proxies.map((_, i) => httpGet(`http://localhost:${ports[i * 2 + 1]}/`)),
      );

      for (let i = 0; i < 3; i++) {
        expect(results[i].status).toBe(200);
        expect(results[i].body).toContain('<script src="/nova-overlay.js">');
      }

      expect(results[0].body).toContain('<h1>Server Alpha</h1>');
      expect(results[1].body).toContain('<h2>Server Beta</h2>');
      expect(results[2].body).toContain('<h3>Server Gamma</h3>');
    } finally {
      for (const p of proxies) {
        try { if (p.isRunning()) await p.stop(); } catch { /* ignore */ }
      }
      for (const t of targets) {
        await closeServer(t);
      }
    }
  });

  // ── 1.2 Concurrent HTTP requests to same proxy ──

  it.concurrent('handles 10 parallel HTTP GET requests to the same proxy', async () => {
    const { ProxyServer } = await import('../../packages/proxy/src/ProxyServer.js');

    const targetPort = await getRandomPort();
    const proxyPort = await getRandomPort();
    const tmpDir = trackTmp();
    const overlayPath = createOverlayScript(tmpDir);

    let requestCount = 0;
    const target = http.createServer((_req, res) => {
      requestCount++;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><p>Request #${requestCount}</p></body></html>`);
    });
    await new Promise<void>((resolve) => target.listen(targetPort, resolve));
    serversToClose.push(target);

    const proxy = new ProxyServer();
    proxiesToStop.push(proxy);
    await proxy.start(targetPort, proxyPort, overlayPath);

    // Fire 10 concurrent requests
    const results = await Promise.all(
      Array.from({ length: 10 }, () => httpGet(`http://localhost:${proxyPort}/`)),
    );

    for (const result of results) {
      expect(result.status).toBe(200);
      expect(result.body).toContain('<script src="/nova-overlay.js">');
      expect(result.body).toContain('Request #');
    }

    // All 10 requests should have reached the target
    expect(requestCount).toBe(10);

    await proxy.stop();
    await closeServer(target);
  });

  // ── 1.3 Proxy handles various HTML structures concurrently ──

  it.concurrent('injects overlay into various HTML structures concurrently', async () => {
    const { ProxyServer } = await import('../../packages/proxy/src/ProxyServer.js');

    const htmlVariants = [
      { html: '<html><body><p>Normal</p></body></html>', label: 'normal' },
      { html: '<html><p>No body tag</p></html>', label: 'no-body' },
      { html: '<p>No html or body tag</p>', label: 'no-html' },
      { html: '<!DOCTYPE html><html><head></head><body><main>Full</main></body></html>', label: 'full-doctype' },
    ];

    const pairs = await Promise.all(
      htmlVariants.map(async () => ({
        targetPort: await getRandomPort(),
        proxyPort: await getRandomPort(),
      })),
    );

    const targets: http.Server[] = [];
    const proxies: Array<InstanceType<typeof ProxyServer>> = [];

    try {
      await Promise.all(
        htmlVariants.map(async (variant, i) => {
          const { targetPort, proxyPort } = pairs[i];
          const tmpDir = trackTmp();
          const overlayPath = createOverlayScript(tmpDir);

          const target = await createTargetServer(variant.html, targetPort);
          targets.push(target);

          const proxy = new ProxyServer();
          proxies.push(proxy);
          await proxy.start(targetPort, proxyPort, overlayPath);
        }),
      );

      const results = await Promise.all(
        pairs.map(({ proxyPort }) => httpGet(`http://localhost:${proxyPort}/`)),
      );

      // All responses should contain the injected script
      for (let i = 0; i < results.length; i++) {
        expect(results[i].status).toBe(200);
        expect(results[i].body).toContain('<script src="/nova-overlay.js">');
      }

      // Verify original content preserved
      expect(results[0].body).toContain('<p>Normal</p>');
      expect(results[1].body).toContain('<p>No body tag</p>');
      expect(results[2].body).toContain('<p>No html or body tag</p>');
      expect(results[3].body).toContain('<main>Full</main>');
    } finally {
      for (const p of proxies) {
        try { if (p.isRunning()) await p.stop(); } catch { /* ignore */ }
      }
      for (const t of targets) {
        await closeServer(t);
      }
    }
  });

  // ── 1.4 Multiple WebSocket connections to same proxy ──

  it.concurrent('handles multiple WebSocket connections simultaneously', async () => {
    const { ProxyServer } = await import('../../packages/proxy/src/ProxyServer.js');
    const { WebSocketServer: NovaWsServer } = await import('../../packages/proxy/src/WebSocketServer.js');

    const targetPort = await getRandomPort();
    const proxyPort = await getRandomPort();
    const tmpDir = trackTmp();
    const overlayPath = createOverlayScript(tmpDir);

    const target = await createTargetServer('<html><body>ws-multi</body></html>', targetPort);
    serversToClose.push(target);

    const proxy = new ProxyServer();
    proxiesToStop.push(proxy);
    await proxy.start(targetPort, proxyPort, overlayPath);

    const httpServer = proxy.getHttpServer()!;
    const wsServer = new NovaWsServer();
    wsServer.start(httpServer);

    const observations: Observation[] = [];
    wsServer.onObservation((obs) => {
      observations.push(obs);
    });

    // Connect 4 WS clients simultaneously
    const clients = await Promise.all(
      Array.from({ length: 4 }, () => connectWs(proxyPort)),
    );
    for (const c of clients) wsClientsToClose.push(c);

    expect(wsServer.getClientCount()).toBe(4);

    // Each client sends a different observation
    await Promise.all(
      clients.map((client, i) => {
        const obs: Observation = {
          screenshot: Buffer.from(`screenshot-${i}`),
          currentUrl: `http://localhost:3000/page-${i}`,
          transcript: `observation from client ${i}`,
          timestamp: Date.now(),
        };
        client.send(JSON.stringify(obs));
        return Promise.resolve();
      }),
    );

    await waitFor(300);

    expect(observations).toHaveLength(4);
    const urls = observations.map((o) => o.currentUrl).sort();
    expect(urls).toEqual([
      'http://localhost:3000/page-0',
      'http://localhost:3000/page-1',
      'http://localhost:3000/page-2',
      'http://localhost:3000/page-3',
    ]);

    // Server sends event — all clients should receive it
    const receivedByClient: NovaEvent[][] = clients.map(() => []);
    clients.forEach((client, i) => {
      client.on('message', (data) => {
        receivedByClient[i].push(JSON.parse(data.toString()));
      });
    });

    const event: NovaEvent = { type: 'status', data: { message: 'broadcast test' } };
    wsServer.sendEvent(event);

    await waitFor(200);

    for (let i = 0; i < 4; i++) {
      expect(receivedByClient[i]).toHaveLength(1);
      expect(receivedByClient[i][0]).toEqual(event);
    }

    // Cleanup
    for (const c of clients) c.close();
    await proxy.stop();
    await closeServer(target);
  });
});

// ============================================================================
// 2. Concurrent Indexer Tests
// ============================================================================

describe.concurrent('Concurrent Indexer Tests', () => {

  // ── 2.1 Index real test-project ──

  it.runIf(existsSync(TEST_PROJECT)).concurrent('indexes real Next.js test-project and detects framework, routes, components', async () => {
    const { ProjectIndexer } = await import('../../packages/core/src/indexer/ProjectIndexer.js');

    // Work on a copy to avoid side effects
    const tmp = trackTmp();
    cpSync(TEST_PROJECT, tmp, {
      recursive: true,
      filter: (src) => !src.includes('node_modules') && !src.includes('.next') && !src.includes('.nova'),
    });

    const indexer = new ProjectIndexer();
    const map: ProjectMap = await indexer.index(tmp);

    // Framework detection
    expect(map.stack.framework).toBe('next.js');
    expect(map.stack.typescript).toBe(true);
    expect(map.stack.language).toBe('typescript');

    // Routes — the test-project has app/page.tsx and app/products/
    expect(map.routes.length).toBeGreaterThan(0);
    expect(map.routes.some((r) => r.path === '/')).toBe(true);

    // Components — the test-project has components/ directory
    expect(map.components.length).toBeGreaterThan(0);

    // Dependencies graph should be populated
    expect(map.dependencies.size).toBeGreaterThan(0);

    // Compressed context should be non-empty
    expect(map.compressedContext.length).toBeGreaterThan(0);
  }, 30_000);

  // ── 2.2 Index nextjs-app and vite-app fixtures concurrently ──

  it.concurrent('indexes nextjs-app and vite-app fixtures concurrently with different results', async () => {
    const { ProjectIndexer } = await import('../../packages/core/src/indexer/ProjectIndexer.js');

    const tmpNextjs = trackTmp();
    const tmpVite = trackTmp();

    cpSync(FIXTURE_NEXTJS, tmpNextjs, { recursive: true });
    cpSync(FIXTURE_VITE, tmpVite, { recursive: true });

    const [nextjsMap, viteMap] = await Promise.all([
      new ProjectIndexer().index(tmpNextjs),
      new ProjectIndexer().index(tmpVite),
    ]);

    // Frameworks should differ
    expect(nextjsMap.stack.framework).toBe('next.js');
    expect(viteMap.stack.framework).toBe('vite');

    // Next.js fixture has API routes, Vite doesn't
    expect(nextjsMap.endpoints.length).toBeGreaterThan(0);
    expect(viteMap.endpoints).toHaveLength(0);

    // Next.js fixture has page routes
    expect(nextjsMap.routes.some((r) => r.path === '/')).toBe(true);

    // Vite fixture has components
    expect(viteMap.components.length).toBeGreaterThan(0);

    // Dev commands differ — the fixture uses `npm run dev` which runs next/vite
    expect(nextjsMap.devCommand).toContain('dev');
    expect(viteMap.devCommand).toContain('dev');
    // Verify they are not identical (different frameworks)
    expect(nextjsMap.stack.framework).not.toBe(viteMap.stack.framework);
  }, 20_000);

  // ── 2.3 Concurrent GraphStore operations ──

  it.concurrent('handles concurrent GraphStore read/write/search operations', async () => {
    const { GraphStore } = await import('../../packages/core/src/storage/GraphStore.js');

    const tmp = trackTmp();
    const novaPath = path.join(tmp, '.nova');
    fs.mkdirSync(novaPath, { recursive: true });

    const store = new GraphStore(novaPath);

    // Save initial nodes
    const initialNodes: DependencyNode[] = [
      { filePath: 'src/App.tsx', imports: ['./Header'], exports: ['App'], type: 'component', keywords: ['App', 'Main'] },
      { filePath: 'src/Header.tsx', imports: [], exports: ['Header'], type: 'component', keywords: ['Header', 'Navigation'] },
      { filePath: 'src/utils.ts', imports: [], exports: ['formatDate', 'parseUrl'], type: 'util', keywords: ['Format', 'Parse'] },
    ];

    await store.save(initialNodes);

    // Run concurrent operations: upsert, search, load, getImporters
    const [
      loadResult,
      searchApp,
      searchHeader,
      importersOfHeader,
      _upsertResult,
    ] = await Promise.all([
      store.load(),
      store.search('App'),
      store.search('Header'),
      store.getImporters('./Header'),
      store.upsertNode({
        filePath: 'src/Footer.tsx',
        imports: ['./utils'],
        exports: ['Footer'],
        type: 'component',
        keywords: ['Footer'],
      }),
    ]);

    expect(loadResult).toHaveLength(3);
    expect(searchApp.length).toBeGreaterThan(0);
    expect(searchApp[0].filePath).toBe('src/App.tsx');
    expect(searchHeader.length).toBeGreaterThan(0);
    expect(importersOfHeader).toContain('src/App.tsx');

    // After upsert, verify the node was added
    const afterUpsert = await store.load();
    expect(afterUpsert).toHaveLength(4);
    expect(afterUpsert.some((n) => n.filePath === 'src/Footer.tsx')).toBe(true);

    // Run more concurrent operations: remove + search
    await Promise.all([
      store.removeNode('src/utils.ts'),
      store.search('Footer'),
    ]);

    const afterRemove = await store.load();
    expect(afterRemove).toHaveLength(3);
    expect(afterRemove.some((n) => n.filePath === 'src/utils.ts')).toBe(false);
  });
});

// ============================================================================
// 3. Concurrent Core Logic Tests
// ============================================================================

describe.concurrent('Concurrent Core Logic Tests', () => {

  // ── 3.1 LaneClassifier on 20+ inputs concurrently ──

  it.concurrent('classifies 20+ inputs concurrently via Promise.all', async () => {
    const { LaneClassifier } = await import('../../packages/core/src/brain/LaneClassifier.js');

    const classifier = new LaneClassifier();

    const inputs: Array<{ desc: string; files: string[]; expectedLane: 1 | 2 | 3 | 4 }> = [
      // Lane 1: style/text keywords, single file
      { desc: 'change color to blue', files: ['file.tsx'], expectedLane: 1 },
      { desc: 'update font size', files: ['style.css'], expectedLane: 1 },
      { desc: 'fix margin on header', files: ['header.tsx'], expectedLane: 1 },
      { desc: 'change background to white', files: ['page.tsx'], expectedLane: 1 },
      { desc: 'update placeholder text', files: ['input.tsx'], expectedLane: 1 },
      // Lane 2: single file, non-style
      { desc: 'fix the login button handler', files: ['login.tsx'], expectedLane: 2 },
      { desc: 'update form validation', files: ['form.tsx'], expectedLane: 2 },
      { desc: 'fix api response parsing', files: ['api.ts'], expectedLane: 2 },
      { desc: 'improve error handling', files: ['errors.ts'], expectedLane: 2 },
      { desc: 'optimize database query', files: ['db.ts'], expectedLane: 2 },
      // Lane 3: multi-file or add/create
      { desc: 'add a new page for settings', files: ['pages/settings.tsx'], expectedLane: 3 },
      { desc: 'create component for dashboard', files: ['Dashboard.tsx'], expectedLane: 3 },
      { desc: 'update logic across modules', files: ['a.ts', 'b.ts'], expectedLane: 3 },
      { desc: 'implement search feature', files: ['search.ts', 'index.ts', 'api.ts'], expectedLane: 3 },
      { desc: 'new endpoint for orders', files: ['orders/route.ts'], expectedLane: 3 },
      { desc: 'sync state across files', files: ['store.ts', 'reducer.ts'], expectedLane: 3 },
      // Lane 4: refactoring keywords
      { desc: 'refactor the auth module', files: ['auth.ts'], expectedLane: 4 },
      { desc: 'migrate to new API format', files: ['api.ts'], expectedLane: 4 },
      { desc: 'rewrite the routing system', files: ['router.ts'], expectedLane: 4 },
      { desc: 'redesign the component tree', files: ['App.tsx'], expectedLane: 4 },
      { desc: 'restructure the data layer', files: ['data.ts', 'models.ts'], expectedLane: 4 },
      { desc: 'upgrade authentication flow', files: ['auth.ts', 'login.tsx'], expectedLane: 4 },
    ];

    const results = await Promise.all(
      inputs.map(async ({ desc, files, expectedLane }) => ({
        desc,
        expectedLane,
        actualLane: classifier.classify(desc, files),
      })),
    );

    for (const { desc, expectedLane, actualLane } of results) {
      expect(actualLane, `"${desc}" should be lane ${expectedLane}`).toBe(expectedLane);
    }
  });

  // ── 3.2 DiffApplier generate+apply on 5 different files concurrently ──

  it.concurrent('generates and applies diffs on 5 different files concurrently', async () => {
    const { DiffApplier } = await import('../../packages/core/src/executor/DiffApplier.js');

    const tmp = trackTmp();

    const fileChanges = [
      {
        name: 'component.tsx',
        before: 'const title = "Hello";\nconst subtitle = "World";',
        after: 'const title = "Goodbye";\nconst subtitle = "Universe";',
      },
      {
        name: 'utils.ts',
        before: 'const version = "1.0.0";\nconst author = "Alice";',
        after: 'const version = "2.0.0";\nconst author = "Bob";\nconst license = "MIT";',
      },
      {
        name: 'config.ts',
        before: 'const port = 3000;\nconst host = "localhost";\nconst debug = false;',
        after: 'const port = 8080;\nconst host = "0.0.0.0";\nconst debug = true;',
      },
      {
        name: 'types.ts',
        before: 'type Name = string;\ntype Age = number;',
        after: 'type Name = string;\ntype Age = number;\ntype Email = string;\ntype CreatedAt = Date;',
      },
      {
        name: 'handler.ts',
        before: 'const method = "GET";\nconst path = "/api";',
        after: 'const method = "POST";\nconst path = "/api/v2";\nconst timeout = 5000;',
      },
    ];

    // Write all original files
    for (const fc of fileChanges) {
      writeFileSync(path.join(tmp, fc.name), fc.before, 'utf-8');
    }

    // Generate and apply diffs concurrently
    await Promise.all(
      fileChanges.map(async (fc) => {
        const applier = new DiffApplier();
        const filePath = path.join(tmp, fc.name);
        const diff = applier.generate(fc.before, fc.after, fc.name);

        expect(diff.length).toBeGreaterThan(0);
        await applier.apply(filePath, diff);
      }),
    );

    // Verify all files were correctly modified
    for (const fc of fileChanges) {
      const result = readFileSync(path.join(tmp, fc.name), 'utf-8');
      expect(result, `${fc.name} should match expected content`).toBe(fc.after);
    }
  });

  // ── 3.3 EventBus with 100 concurrent emits ──

  it.concurrent('handles 100 concurrent emits across different event types', async () => {
    const { NovaEventBus } = await import('../../packages/core/src/events/EventBus.js');

    const bus = new NovaEventBus();

    const received: Record<string, NovaEvent[]> = {
      status: [],
      task_started: [],
      file_changed: [],
      llm_chunk: [],
    };

    bus.on('status', (event) => { received.status.push(event); });
    bus.on('task_started', (event) => { received.task_started.push(event); });
    bus.on('file_changed', (event) => { received.file_changed.push(event); });
    bus.on('llm_chunk', (event) => { received.llm_chunk.push(event); });

    // Emit 100 events concurrently: 25 of each type
    const emits = Array.from({ length: 100 }, (_, i) => {
      const mod = i % 4;
      return new Promise<void>((resolve) => {
        if (mod === 0) {
          bus.emit({ type: 'status', data: { message: `status-${i}` } });
        } else if (mod === 1) {
          bus.emit({ type: 'task_started', data: { taskId: `task-${i}` } });
        } else if (mod === 2) {
          bus.emit({ type: 'file_changed', data: { filePath: `file-${i}.ts`, source: 'nova' } });
        } else {
          bus.emit({ type: 'llm_chunk', data: { text: `chunk-${i}`, phase: 'code' } });
        }
        resolve();
      });
    });

    await Promise.all(emits);

    expect(received.status).toHaveLength(25);
    expect(received.task_started).toHaveLength(25);
    expect(received.file_changed).toHaveLength(25);
    expect(received.llm_chunk).toHaveLength(25);

    // Verify data integrity of a few events
    expect(received.status[0].data).toHaveProperty('message');
    expect(received.task_started[0].data).toHaveProperty('taskId');
    expect(received.file_changed[0].data).toHaveProperty('filePath');
    expect(received.llm_chunk[0].data).toHaveProperty('text');
  });

  // ── 3.4 Concurrent NovaDir.init on 5 different temp dirs ──

  it.concurrent('initializes NovaDir in 5 different temp dirs simultaneously', async () => {
    const { NovaDir } = await import('../../packages/core/src/storage/NovaDir.js');

    const dirs = Array.from({ length: 5 }, () => trackTmp());

    // Initialize all 5 concurrently
    await Promise.all(
      dirs.map(async (dir) => {
        const novaDir = new NovaDir();
        await novaDir.init(dir);
      }),
    );

    // Verify all 5 have the correct structure
    for (const dir of dirs) {
      const novaDir = new NovaDir();
      expect(novaDir.exists(dir)).toBe(true);
      expect(existsSync(path.join(dir, '.nova', 'recipes'))).toBe(true);
      expect(existsSync(path.join(dir, '.nova', 'history'))).toBe(true);
      expect(existsSync(path.join(dir, '.nova', 'cache'))).toBe(true);
      expect(existsSync(path.join(dir, '.nova', 'graph.json'))).toBe(true);
      expect(existsSync(path.join(dir, '.nova', 'config.toml'))).toBe(true);
      expect(existsSync(path.join(dir, '.nova', 'context.md'))).toBe(true);

      // Verify graph.json is valid JSON
      const graphContent = readFileSync(path.join(dir, '.nova', 'graph.json'), 'utf-8');
      expect(JSON.parse(graphContent)).toEqual([]);

      // Verify .gitignore was created/updated
      const gitignore = readFileSync(path.join(dir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('.nova');
    }
  });
});

// ============================================================================
// 4. Concurrent WebSocket Stress Tests
// ============================================================================

describe.concurrent('Concurrent WebSocket Stress Tests', () => {

  // ── 4.1 Five WS clients send observations simultaneously ──

  it.concurrent('5 clients send observations simultaneously, server receives all', async () => {
    const { ProxyServer } = await import('../../packages/proxy/src/ProxyServer.js');
    const { WebSocketServer: NovaWsServer } = await import('../../packages/proxy/src/WebSocketServer.js');

    const targetPort = await getRandomPort();
    const proxyPort = await getRandomPort();
    const tmpDir = trackTmp();
    const overlayPath = createOverlayScript(tmpDir);

    const target = await createTargetServer('<html><body>stress-test</body></html>', targetPort);

    const proxy = new ProxyServer();
    await proxy.start(targetPort, proxyPort, overlayPath);

    const httpServer = proxy.getHttpServer()!;
    const wsServer = new NovaWsServer();
    wsServer.start(httpServer);

    const receivedObservations: Observation[] = [];
    const receivedConfirms: number[] = [];
    const receivedCancels: number[] = [];
    const receivedAppends: string[] = [];
    const receivedErrors: string[] = [];

    wsServer.onObservation((obs) => { receivedObservations.push(obs); });
    wsServer.onConfirm(() => { receivedConfirms.push(Date.now()); });
    wsServer.onCancel(() => { receivedCancels.push(Date.now()); });
    wsServer.onAppend((text) => { receivedAppends.push(text); });
    wsServer.onBrowserError((error) => { receivedErrors.push(error); });

    // Connect 5 clients
    const clients = await Promise.all(
      Array.from({ length: 5 }, () => connectWs(proxyPort)),
    );

    expect(wsServer.getClientCount()).toBe(5);

    // Each client sends: 1 observation, 1 confirm, 1 append, 1 browser_error
    await Promise.all(
      clients.map(async (client, i) => {
        // Observation
        client.send(JSON.stringify({
          type: 'observation',
          data: {
            screenshotBase64: Buffer.from(`screenshot-${i}`).toString('base64'),
            currentUrl: `http://localhost/page-${i}`,
            transcript: `task from client ${i}`,
            timestamp: Date.now(),
          },
        }));

        // Small delay to avoid message ordering issues
        await waitFor(50);

        // Confirm
        client.send(JSON.stringify({ type: 'confirm' }));

        // Append
        client.send(JSON.stringify({ type: 'append', data: { text: `appended-${i}` } }));

        // Browser error
        client.send(JSON.stringify({ type: 'browser_error', data: { error: `error-${i}` } }));
      }),
    );

    await waitFor(500);

    // Verify observations
    expect(receivedObservations).toHaveLength(5);
    const obsUrls = receivedObservations.map((o) => o.currentUrl).sort();
    expect(obsUrls).toEqual([
      'http://localhost/page-0',
      'http://localhost/page-1',
      'http://localhost/page-2',
      'http://localhost/page-3',
      'http://localhost/page-4',
    ]);

    // Verify other message types
    expect(receivedConfirms).toHaveLength(5);
    expect(receivedAppends).toHaveLength(5);
    expect(receivedAppends.sort()).toEqual([
      'appended-0', 'appended-1', 'appended-2', 'appended-3', 'appended-4',
    ]);
    expect(receivedErrors).toHaveLength(5);
    expect(receivedErrors.sort()).toEqual([
      'error-0', 'error-1', 'error-2', 'error-3', 'error-4',
    ]);

    // Cleanup
    for (const c of clients) c.close();
    await proxy.stop();
    await closeServer(target);
  });

  // ── 4.2 Rapid-fire server events to multiple clients ──

  it.concurrent('server sends rapid-fire events to multiple clients, all received', async () => {
    const { ProxyServer } = await import('../../packages/proxy/src/ProxyServer.js');
    const { WebSocketServer: NovaWsServer } = await import('../../packages/proxy/src/WebSocketServer.js');

    const targetPort = await getRandomPort();
    const proxyPort = await getRandomPort();
    const tmpDir = trackTmp();
    const overlayPath = createOverlayScript(tmpDir);

    const target = await createTargetServer('<html><body>rapid-fire</body></html>', targetPort);

    const proxy = new ProxyServer();
    await proxy.start(targetPort, proxyPort, overlayPath);

    const httpServer = proxy.getHttpServer()!;
    const wsServer = new NovaWsServer();
    wsServer.start(httpServer);

    // Connect 3 clients
    const clients = await Promise.all(
      Array.from({ length: 3 }, () => connectWs(proxyPort)),
    );

    // Set up message collection for each client
    const receivedByClient: NovaEvent[][] = [[], [], []];
    clients.forEach((client, i) => {
      client.on('message', (data) => {
        receivedByClient[i].push(JSON.parse(data.toString()));
      });
    });

    // Server sends 20 rapid-fire events of mixed types
    const eventTypes: NovaEvent[] = [];
    for (let i = 0; i < 20; i++) {
      const mod = i % 4;
      let event: NovaEvent;
      if (mod === 0) {
        event = { type: 'status', data: { message: `status-${i}` } };
      } else if (mod === 1) {
        event = { type: 'task_started', data: { taskId: `task-${i}` } };
      } else if (mod === 2) {
        event = { type: 'llm_chunk', data: { text: `chunk-${i}`, phase: 'code' } };
      } else {
        event = { type: 'task_completed', data: { taskId: `task-${i}`, diff: `diff-${i}`, commitHash: `hash-${i}` } };
      }
      eventTypes.push(event);
      wsServer.sendEvent(event);
    }

    await waitFor(500);

    // Each of the 3 clients should have received all 20 events
    for (let c = 0; c < 3; c++) {
      expect(receivedByClient[c]).toHaveLength(20);

      // Verify event types match
      for (let i = 0; i < 20; i++) {
        expect(receivedByClient[c][i].type).toBe(eventTypes[i].type);
      }
    }

    // Verify status events have correct data
    const statusEvents = receivedByClient[0].filter((e) => e.type === 'status');
    expect(statusEvents).toHaveLength(5);
    for (const se of statusEvents) {
      expect((se.data as { message: string }).message).toMatch(/^status-\d+$/);
    }

    // Cleanup
    for (const c of clients) c.close();
    await proxy.stop();
    await closeServer(target);
  });
});
