import * as net from 'node:net';
import { killPort as killPortNative } from './PortKiller.js';

/**
 * Cross-platform port management.
 *
 * Port probing uses {@link net.createServer().listen} (no shelling out).
 * Port killing uses a Node-native implementation:
 *   - Linux:   parses `/proc/net/tcp` → find inode → walk `/proc/[pid]/fd`
 *              → `process.kill(pid, 'SIGTERM')`.  Zero subprocesses.
 *   - macOS:   parses `netstat -anv -p tcp` output → `process.kill`.
 *              Never spawns `lsof`, `xargs`, or `fuser`.
 */
export class PortManager {
  /**
   * Probe whether a port is in use.
   *
   * Opens a temporary server on the port; if it succeeds the port is free.
   * No shell subprocess is involved.
   */
  static async isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(true));
      server.once('listening', () => {
        server.close();
        resolve(false);
      });
      server.listen(port);
    });
  }

  /**
   * Kill the process holding *port*.
   *
   * Sends SIGTERM to each PID listening on the port.  On Linux this is
   * fully Node‑native (zero subprocesses); on macOS it shells out to
   * `netstat` only — never `lsof`, `xargs`, or `fuser`.
   */
  static async killPort(port: number): Promise<void> {
    await killPortNative(port);
  }

  /**
   * Scan for the next free port in the same 100‑port range as *startPort*.
   *
   * E.g. if startPort is 3523 the scan covers 3500–3599 (then wraps beyond).
   * Used by `--yes` when no `--port` is specified to auto‑heal a conflict.
   *
   * @param startPort  the port to start scanning from (exclusive).
   * @returns the first free port ≥ startPort+1.
   * @throws if no free port is found anywhere in 1–65535.
   */
  static async findNextFreePort(startPort: number): Promise<number> {
    const rangeStart = Math.floor(startPort / 100) * 100;
    const rangeEnd = rangeStart + 99;

    // First pass: same 100‑port range
    for (let p = startPort + 1; p <= rangeEnd; p++) {
      if (!(await PortManager.isPortInUse(p))) {
        return p;
      }
    }

    // Second pass: beyond the range to the end of the port space
    for (let p = rangeEnd + 1; p <= 65535; p++) {
      if (!(await PortManager.isPortInUse(p))) {
        return p;
      }
    }

    throw new Error('No free ports available (1-65535)');
  }

  /**
   * Find a free port pair (dev port + proxy port) starting from *devPort*.
   *
   * Ensures both ports in the pair are free.
   *
   * @returns `{ devPort, proxyPort }` with both ports confirmed free.
   */
  static async findFreePortPair(
    devPort: number,
    proxyPort: number,
  ): Promise<{ devPort: number; proxyPort: number }> {
    let d = devPort;
    let p = proxyPort;
    const offset = proxyPort - devPort;

    while ((await PortManager.isPortInUse(d)) || (await PortManager.isPortInUse(p))) {
      d = await PortManager.findNextFreePort(d);
      p = d + offset;
      if (p > 65535) {
        throw new Error('No free port pair available');
      }
    }

    return { devPort: d, proxyPort: p };
  }
}
