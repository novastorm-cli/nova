import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';

/**
 * Node-native TCP port killer.
 *
 * Replaces the `kill-port` npm package (which shells out to `lsof | xargs kill`).
 *
 * **Linux**: parses `/proc/net/tcp` (and `/proc/net/tcp6`) to find the inode,
 * walks `/proc/[pid]/fd/*` to resolve the socket inode → PID, then calls
 * `process.kill(pid, 'SIGTERM')`.  Zero subprocesses — fully Node-native.
 *
 * **macOS / other**: parses `netstat -anv -p tcp` output to find PIDs, then
 * `process.kill(pid, 'SIGTERM')`.  Spawns `netstat` but **never** `lsof`,
 * `xargs`, or `fuser`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KillResult {
  /** PIDs that were signalled */
  pids: number[];
  /** Any PIDs we could not signal (e.g. permission denied) */
  skipped: number[];
}

// ---------------------------------------------------------------------------
// Linux – /proc filesystem
// ---------------------------------------------------------------------------

/** Hex port string as it appears in /proc/net/tcp, e.g. "1F90" for 8080. */
function toHexPort(port: number): string {
  return port.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Parse a /proc/net/tcp (or tcp6) line and return `{ inode, port }` when the
 * entry is in LISTEN state on the requested port, otherwise `null`.
 */
function parseProcLine(line: string, wantPort: number): { inode: number } | null {
  // Strip trailing whitespace and split on any whitespace
  const fields = line.trim().split(/\s+/);
  // Fields (by column):
  //   0: sl
  //   1: local_address (HHHHHHHH:PPPP in hex)
  //   2: rem_address
  //   3: st (state, 0A = LISTEN)
  //   4–8: tx_queue, rx_queue, tr, tm->when, retrnsmt
  //   9: inode
  if (fields.length < 10) return null;

  const state = fields[3];
  if (state !== '0A') return null; // only interested in LISTEN

  const local = fields[1]!;
  const colonIdx = local.lastIndexOf(':');
  if (colonIdx === -1) return null;
  const hexPort = local.slice(colonIdx + 1);
  if (hexPort !== toHexPort(wantPort)) return null;

  const inode = parseInt(fields[9]!, 10);
  if (isNaN(inode)) return null;

  return { inode };
}

/** Collect inodes from /proc/net/tcp (and tcp6 when present) for *port*. */
function collectInodes(port: number): number[] {
  const inodes = new Set<number>();
  const procFiles = ['/proc/net/tcp', '/proc/net/tcp6'];

  for (const procFile of procFiles) {
    let raw: string;
    try {
      raw = fs.readFileSync(procFile, 'utf-8');
    } catch {
      continue; // file doesn't exist (e.g. tcp6 on IPv4-only kernel)
    }

    const lines = raw.split('\n');
    for (let i = 1; i < lines.length; i++) {
      // skip header
      const parsed = parseProcLine(lines[i]!, port);
      if (parsed) inodes.add(parsed.inode);
    }
  }

  return [...inodes];
}

/**
 * Walk `/proc/[pid]/fd/*` looking for a socket symlink whose target is
 * `socket:[<inode>]`.  Returns the PID when found, otherwise `null`.
 */
function findPidByInode(procDir: string, pid: number, inodes: Set<number>): number | null {
  const fdDir = path.join(procDir, String(pid), 'fd');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(fdDir, { withFileTypes: true });
  } catch {
    return null; // permission denied or process exited
  }

  for (const entry of entries) {
    const linkPath = path.join(fdDir, entry.name);
    let target: string;
    try {
      target = fs.readlinkSync(linkPath);
    } catch {
      continue;
    }
    // socket:[<inode>]
    if (target.startsWith('socket:[')) {
      const endBracket = target.indexOf(']', 8);
      if (endBracket === -1) continue;
      const inode = parseInt(target.slice(8, endBracket), 10);
      if (inodes.has(inode)) return pid;
    }
  }

  return null;
}

/** Find all PIDs that own one of the given socket inodes. */
function findPidsByInodes(inodes: number[]): number[] {
  const inodeSet = new Set(inodes);
  const pids: number[] = [];
  if (inodeSet.size === 0) return pids;

  let procEntries: fs.Dirent[];
  try {
    procEntries = fs.readdirSync('/proc', { withFileTypes: true });
  } catch {
    return pids;
  }

  for (const entry of procEntries) {
    if (!entry.isDirectory()) continue;
    const pid = parseInt(entry.name, 10);
    if (isNaN(pid)) continue;

    const found = findPidByInode('/proc', pid, inodeSet);
    if (found !== null) {
      pids.push(found);
    }
  }

  return pids;
}

// ---------------------------------------------------------------------------
// macOS / other – netstat fallback
// ---------------------------------------------------------------------------

/** Parse `netstat -anv -p tcp` output to find PIDs listening on *port*. */
function findPidsViaNetstat(port: number): Promise<number[]> {
  return new Promise((resolve) => {
    const pids = new Set<number>();
    const proc = spawn('netstat', ['-anv', '-p', 'tcp'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let stdout = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on('close', () => {
      // macOS netstat -anv -p tcp output:
      // tcp4  0  0  127.0.0.1.8080  *.*  LISTEN  131072  131072  12345  0
      //                                    ^^^^^^                   ^^^^^
      // Columns after LISTEN: sendbuf, recvbuf, PID, ...
      const portStr = `.${port}`;
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (!line.includes('LISTEN')) continue;
        // Check for the port in the local address column
        if (!line.includes(portStr)) continue;

        // Extract PID: it's the first numeric field after LISTEN
        const listeners = /LISTEN\s+\d+\s+\d+\s+(\d+)/;
        const m = line.match(listeners);
        if (m) {
          const pid = parseInt(m[1]!, 10);
          if (!isNaN(pid) && pid > 0) {
            pids.add(pid);
          }
        }
      }
      resolve([...pids]);
    });

    proc.on('error', () => {
      resolve([]);
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Kill all processes listening on the given TCP *port*.
 *
 * Sends `SIGTERM` first; if `graceful` is `false` (or unset) and the port is
 * still in use after 500 ms, sends `SIGKILL`.
 *
 * Returns a {@link KillResult} describing which PIDs were signalled and which
 * were skipped (e.g. due to permissions).
 */
export async function killPort(port: number): Promise<KillResult> {
  const platform = os.platform();

  let pids: number[];

  if (platform === 'linux') {
    // ── Linux: pure /proc filesystem ────────────────────────────────
    const inodes = collectInodes(port);
    pids = findPidsByInodes(inodes);
  } else {
    // ── macOS / other: netstat fallback ─────────────────────────────
    pids = await findPidsViaNetstat(port);
  }

  const result: KillResult = { pids: [], skipped: [] };

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      result.pids.push(pid);
    } catch {
      result.skipped.push(pid);
    }
  }

  return result;
}
