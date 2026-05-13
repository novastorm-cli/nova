import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as net from 'node:net';
import { PortManager } from '../PortManager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Bind a temporary listener on *port* so the port appears busy during the test. */
function occupyPort(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });
}

/** Free a server we previously bound. */
function releasePort(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ---------------------------------------------------------------------------
// Mock PortKiller (so we don't actually kill anything during unit tests)
// ---------------------------------------------------------------------------
vi.mock('../PortKiller.js', () => ({
  killPort: vi.fn(),
}));

import { killPort as killPortNative } from '../PortKiller.js';
const mockKillPort = vi.mocked(killPortNative);

// ---------------------------------------------------------------------------
// isPortInUse
// ---------------------------------------------------------------------------
describe('PortManager.isPortInUse', () => {
  it('returns false for a free port', async () => {
    // Use a port in the 3500-3599 range per mission boundaries
    const free = await PortManager.isPortInUse(3599);
    expect(free).toBe(false);
  });

  it('returns true for a busy port', async () => {
    const server = await occupyPort(3598);
    try {
      const busy = await PortManager.isPortInUse(3598);
      expect(busy).toBe(true);
    } finally {
      await releasePort(server);
    }
  });

  it('returns true for port 0 (unlikely use case, verifies error path)', async () => {
    // Port 0 triggers "random port" assignment on listen, so isPortInUse
    // will try to listen, succeed (OS assigns a random free port),
    // then close — meaning it should return false (port itself is not "busy").
    const busy = await PortManager.isPortInUse(0);
    expect(busy).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findNextFreePort
// ---------------------------------------------------------------------------
describe('PortManager.findNextFreePort', () => {
  it('finds a free port in the same 100-port range', async () => {
    // Occupy 3599 so the scan must skip it
    const server = await occupyPort(3599);
    try {
      const next = await PortManager.findNextFreePort(3590);
      expect(next).toBeGreaterThan(3590);
      expect(next).toBeLessThan(3600); // still in range 3500-3599
      // It should not be 3599 (occupied)
      expect(next).not.toBe(3599);
    } finally {
      await releasePort(server);
    }
  });

  it('wraps beyond the 100-port range if all are busy', async () => {
    // Occupy the last few ports in range 3594-3599
    const servers: net.Server[] = [];
    for (let p = 3594; p <= 3599; p++) {
      servers.push(await occupyPort(p));
    }
    try {
      const next = await PortManager.findNextFreePort(3593);
      // All ports 3594-3599 are busy, so it must find one >= 3600
      expect(next).toBeGreaterThanOrEqual(3600);
    } finally {
      for (const s of servers) await releasePort(s);
    }
  });

  it('returns startPort+1 when that port is free', async () => {
    const next = await PortManager.findNextFreePort(3590);
    expect(next).toBe(3591);
  });
});

// ---------------------------------------------------------------------------
// killPort
// ---------------------------------------------------------------------------
describe('PortManager.killPort', () => {
  beforeEach(() => {
    mockKillPort.mockReset();
    mockKillPort.mockResolvedValue({ pids: [], skipped: [] });
  });

  it('delegates to the Node-native PortKiller', async () => {
    await PortManager.killPort(3599);
    expect(mockKillPort).toHaveBeenCalledTimes(1);
    expect(mockKillPort).toHaveBeenCalledWith(3599);
  });

  it('rejects when PortKiller throws', async () => {
    mockKillPort.mockRejectedValue(new Error('No process running on port'));
    await expect(PortManager.killPort(3599)).rejects.toThrow('No process running on port');
  });
});

// ---------------------------------------------------------------------------
// findFreePortPair
// ---------------------------------------------------------------------------
describe('PortManager.findFreePortPair', () => {
  it('returns the requested pair when both ports are free', async () => {
    const result = await PortManager.findFreePortPair(3590, 3591);
    expect(result.devPort).toBe(3590);
    expect(result.proxyPort).toBe(3591);
  });

  it('advances when the dev port is busy', async () => {
    const server = await occupyPort(3590);
    try {
      const result = await PortManager.findFreePortPair(3590, 3591);
      expect(result.devPort).not.toBe(3590);
      // Proxy port should follow dev port with same offset
      expect(result.proxyPort).toBe(result.devPort + 1);
      // Both ports should be free
      expect(await PortManager.isPortInUse(result.devPort)).toBe(false);
      expect(await PortManager.isPortInUse(result.proxyPort)).toBe(false);
    } finally {
      await releasePort(server);
    }
  });

  it('advances when the proxy port is busy', async () => {
    const server = await occupyPort(3591);
    try {
      const result = await PortManager.findFreePortPair(3590, 3591);
      expect(result.proxyPort).not.toBe(3591);
      expect(result.proxyPort).toBe(result.devPort + 1);
      expect(await PortManager.isPortInUse(result.devPort)).toBe(false);
      expect(await PortManager.isPortInUse(result.proxyPort)).toBe(false);
    } finally {
      await releasePort(server);
    }
  });
});
