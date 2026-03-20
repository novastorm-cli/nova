import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import net from 'node:net';
import os from 'node:os';
import { DevServerRunner } from '../DevServerRunner.js';

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

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('DevServerRunner', () => {
  let runner: InstanceType<typeof DevServerRunner>;
  let port: number;
  let cwd: string;

  beforeEach(async () => {
    port = await getRandomPort();
    runner = new DevServerRunner();
    cwd = os.tmpdir();
  });

  afterEach(async () => {
    if (runner?.isRunning()) {
      await runner.kill();
    }
  });

  function serverCommand(p: number): string {
    return `node -e "require('http').createServer((req,res)=>{res.writeHead(200);res.end('ok')}).listen(${p})"`;
  }

  it('spawn() starts a process and isRunning() returns true', async () => {
    await runner.spawn(serverCommand(port), cwd, port);
    expect(runner.isRunning()).toBe(true);
  });

  it('onReady callback is called when health check passes', async () => {
    const readyHandler = vi.fn();
    runner.onReady(readyHandler);

    await runner.spawn(serverCommand(port), cwd, port);

    // Health check polls every 500ms, wait up to 5s
    const deadline = Date.now() + 5000;
    while (!readyHandler.mock.calls.length && Date.now() < deadline) {
      await waitFor(200);
    }

    expect(readyHandler).toHaveBeenCalledOnce();
  });

  it('getLogs() contains stdout from the process', async () => {
    const logPort = await getRandomPort();
    const command = `node -e "console.log('NOVA_TEST_OUTPUT'); require('http').createServer((req,res)=>{res.writeHead(200);res.end('ok')}).listen(${logPort})"`;

    await runner.spawn(command, cwd, logPort);

    // Wait for logs to accumulate
    const deadline = Date.now() + 5000;
    while (!runner.getLogs().includes('NOVA_TEST_OUTPUT') && Date.now() < deadline) {
      await waitFor(200);
    }

    expect(runner.getLogs()).toContain('NOVA_TEST_OUTPUT');
  });

  it('kill() terminates the process and isRunning() returns false', async () => {
    await runner.spawn(serverCommand(port), cwd, port);
    expect(runner.isRunning()).toBe(true);

    await runner.kill();

    expect(runner.isRunning()).toBe(false);
  });

  it('onError callback is called when process crashes', async () => {
    const errorHandler = vi.fn();
    runner.onError(errorHandler);

    // Command that exits immediately with an error.
    // spawn() rejects because pollUntilReady detects the process died,
    // but the onError callback should also fire from the 'exit' event.
    const crashCommand = `node -e "process.exit(1)"`;

    try {
      await runner.spawn(crashCommand, cwd, port);
    } catch {
      // Expected — pollUntilReady rejects when the process exits before becoming ready
    }

    // Wait for error callback (may already have been called synchronously)
    const deadline = Date.now() + 5000;
    while (!errorHandler.mock.calls.length && Date.now() < deadline) {
      await waitFor(200);
    }

    expect(errorHandler).toHaveBeenCalled();
    const errorArg = errorHandler.mock.calls[0][0];
    expect(typeof errorArg).toBe('string');
  });
});
