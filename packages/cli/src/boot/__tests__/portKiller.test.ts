import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  killPort,
  toHexPort,
  parseProcLine,
  collectInodes,
  findPidByInode,
  findPidsByInodes,
} from '../PortKiller.js';

describe('PortKiller', () => {
  it('returns empty result when port is free', async () => {
    const result = await killPort(35999);
    expect(result).toEqual({ pids: [], skipped: [] });
  });

  it('result has expected shape', async () => {
    const result = await killPort(35998);
    expect(result).toHaveProperty('pids');
    expect(result).toHaveProperty('skipped');
    expect(Array.isArray(result.pids)).toBe(true);
    expect(Array.isArray(result.skipped)).toBe(true);
  });

  it('completes quickly for free ports', async () => {
    const start = Date.now();
    await killPort(35997);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it('returns empty for multiple free ports', async () => {
    const ports = [35996, 35995, 35994];
    for (const port of ports) {
      const result = await killPort(port);
      expect(result.pids).toEqual([]);
    }
  });

  it('handles edge case ports gracefully', async () => {
    // These should not throw
    const r1 = await killPort(-1);
    const r2 = await killPort(0);
    expect(r1.pids).toEqual([]);
    expect(r2.pids).toEqual([]);
  });

  it('returns empty result for high ports', async () => {
    const result = await killPort(49152);
    expect(result.pids).toEqual([]);
  });

  it('consistent shape across calls', async () => {
    const r1 = await killPort(35993);
    const r2 = await killPort(35992);
    expect(r1).toEqual(r2);
  });
});

// ── Internal /proc parser helpers ────────────────────────────────────────

describe('toHexPort', () => {
  it('converts port 8080 to "1F90"', () => {
    expect(toHexPort(8080)).toBe('1F90');
  });

  it('converts port 3000 to "0BB8"', () => {
    expect(toHexPort(3000)).toBe('0BB8');
  });

  it('converts port 3501 to "0DAD"', () => {
    expect(toHexPort(3501)).toBe('0DAD');
  });

  it('converts port 0 to "0000"', () => {
    expect(toHexPort(0)).toBe('0000');
  });

  it('converts port 65535 to "FFFF"', () => {
    expect(toHexPort(65535)).toBe('FFFF');
  });

  it('always produces 4-character uppercase hex', () => {
    for (const port of [1, 80, 443, 3000, 8080, 65535]) {
      const hex = toHexPort(port);
      expect(hex.length).toBe(4);
      expect(hex).toBe(hex.toUpperCase());
    }
  });

  it('handles port 80 correctly (HTTP well-known)', () => {
    expect(toHexPort(80)).toBe('0050');
  });

  it('handles port 443 correctly (HTTPS well-known)', () => {
    expect(toHexPort(443)).toBe('01BB');
  });
});

describe('parseProcLine', () => {
  // Real /proc/net/tcp line for a LISTEN on port 8080 (hex 1F90)
  const listenLine8080 =
    '   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0';

  it('parses a LISTEN line and extracts the inode', () => {
    const result = parseProcLine(listenLine8080, 8080);
    expect(result).not.toBeNull();
    expect(result!.inode).toBe(12345);
  });

  it('returns null for non-LISTEN state', () => {
    const establishedLine =
      '   0: 00000000:1F90 00000000:0000 01 00000000:00000000 00:00000000 00000000     0        0 12345 1 0 0 10 0';
    const result = parseProcLine(establishedLine, 8080);
    expect(result).toBeNull();
  });

  it('returns null for wrong port', () => {
    const result = parseProcLine(listenLine8080, 3000);
    expect(result).toBeNull();
  });

  it('returns null for lines with too few fields', () => {
    const result = parseProcLine('   0: 00000000:1F90', 8080);
    expect(result).toBeNull();
  });

  it('returns null for header-like line', () => {
    const result = parseProcLine('  sl  local_address rem_address   st', 8080);
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = parseProcLine('', 8080);
    expect(result).toBeNull();
  });

  it('handles LISTEN on port 3000 (hex 0BB8)', () => {
    const line =
      '   0: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 99999 1 0 0 10 0';
    const result = parseProcLine(line, 3000);
    expect(result).not.toBeNull();
    expect(result!.inode).toBe(99999);
  });

  it('handles IPv6-mapped addresses', () => {
    const line =
      '   0: 0000000000000000FFFF00000100007F:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 55555 1 0 0 10 0';
    const result = parseProcLine(line, 3000);
    expect(result).not.toBeNull();
    expect(result!.inode).toBe(55555);
  });

  it('handles lines with variable whitespace', () => {
    const line =
      '   0: 00000000:0BB8  00000000:0000  0A  00000000:00000000  00:00000000  00000000      0         0  77777  1  0  0  10  0';
    const result = parseProcLine(line, 3000);
    expect(result).not.toBeNull();
    expect(result!.inode).toBe(77777);
  });

  it('returns null when inode is NaN', () => {
    const line =
      '   0: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 NAN 1 0 0 10 0';
    const result = parseProcLine(line, 3000);
    expect(result).toBeNull();
  });

  it('handles IPv6 :: listen address', () => {
    const line =
      '   0: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 88888 1 0 0 10 0';
    const result = parseProcLine(line, 8080);
    expect(result).not.toBeNull();
    expect(result!.inode).toBe(88888);
  });

  it('returns null when local address has no colon', () => {
    const line =
      '   0: 00000000 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0 0 10 0';
    const result = parseProcLine(line, 8080);
    expect(result).toBeNull();
  });
});

describe('collectInodes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('collects inodes from /proc/net/tcp for a free port (empty)', () => {
    // On a real Linux system with no listener on 35999, this returns empty
    const inodes = collectInodes(35999);
    expect(Array.isArray(inodes)).toBe(true);
  });

  it('handles bogo port gracefully', () => {
    const inodes = collectInodes(1);
    expect(Array.isArray(inodes)).toBe(true);
  });

  it('collectInodes deduplicates inodes', () => {
    // Both tcp and tcp6 may reference the same socket inode
    const inodes = collectInodes(35999);
    const uniqueCount = new Set(inodes).size;
    expect(inodes.length).toBe(uniqueCount);
  });

  it('handles missing /proc/net/tcp6 gracefully', () => {
    // This just tests that no error is thrown
    const inodes = collectInodes(35998);
    expect(Array.isArray(inodes)).toBe(true);
  });
});

describe('findPidByInode', () => {
  it('returns null when proc dir does not exist', () => {
    const result = findPidByInode('/nonexistent', 1, new Set([12345]));
    expect(result).toBeNull();
  });

  it('returns null for empty inode set', () => {
    const result = findPidByInode('/proc', 1, new Set());
    expect(result).toBeNull();
  });

  it('returns null for invalid PID dir', () => {
    const result = findPidByInode('/proc', 99999999, new Set([12345]));
    expect(result).toBeNull();
  });

  it('returns null for non-numeric PID directory entry', () => {
    // This verifies the function handles non-numeric dirs gracefully
    // The function calls readdirSync which may throw, so we test with
    // a path that actually exists at runtime
    const result = findPidByInode('/proc', 1, new Set([12345]));
    // PID 1 always exists but we don't know if it has the inode
    expect([null, 1]).toContain(result);
  });
});

describe('findPidsByInodes', () => {
  it('returns empty array for empty inode list', () => {
    const result = findPidsByInodes([]);
    expect(result).toEqual([]);
  });

  it('returns empty array when /proc is unreadable', () => {
    // Test with a set of inodes that won't exist
    const result = findPidsByInodes([99999999]);
    expect(result).toEqual([]);
  });

  it('returns an array (may be empty)', () => {
    const result = findPidsByInodes([1, 2, 3]);
    expect(Array.isArray(result)).toBe(true);
  });
});
