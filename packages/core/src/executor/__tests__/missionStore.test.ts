import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { MissionState, MissionPlan, FeatureResult } from '../../models/types.js';
import { MissionStore } from '../MissionStore.js';
import { MissionNotFoundError } from '../../contracts/IMissionStore.js';

// ── Helpers ───────────────────────────────────────────────────────────

function createMissionState(overrides: Partial<MissionState> = {}): MissionState {
  return {
    id: 'mission-test-1',
    taskId: 'task-test-1',
    status: 'planning',
    plan: { features: [] },
    featureResults: {},
    iteration: 0,
    maxIterations: 5,
    ...overrides,
  };
}

function createFeatureResult(overrides: Partial<FeatureResult> = {}): FeatureResult {
  return {
    success: true,
    featureId: 'feat-1',
    diff: '+++ feat-1.ts',
    generatedFiles: [{ path: 'feat-1.ts', content: '// code' }],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('MissionStore', () => {
  let projectDir: string;
  let store: MissionStore;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'nova-mission-store-'));
    store = new MissionStore(projectDir);
  });

  afterEach(() => {
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  // VAL-ORCH-030: MissionStore saves mission state to .nova/missions/{id}.json
  describe('save() - persistence (VAL-ORCH-030)', () => {
    it('saves mission state to .nova/missions/{id}.json', async () => {
      const mission = createMissionState({ id: 'm1' });
      await store.save(mission);

      const filePath = join(projectDir, '.nova', 'missions', 'm1.json');
      expect(existsSync(filePath)).toBe(true);

      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.id).toBe('m1');
      expect(parsed.status).toBe('planning');
      expect(parsed.maxIterations).toBe(5);
    });

    it('creates the .nova/missions/ directory if it does not exist', async () => {
      const mission = createMissionState({ id: 'new-mission' });
      await store.save(mission);

      const missionsDir = join(projectDir, '.nova', 'missions');
      expect(existsSync(missionsDir)).toBe(true);
    });

    it('pretty-prints JSON for human readability', async () => {
      const mission = createMissionState({ id: 'm1' });
      await store.save(mission);

      const filePath = join(projectDir, '.nova', 'missions', 'm1.json');
      const raw = readFileSync(filePath, 'utf-8');
      // Should be multi-line (pretty-printed)
      expect(raw.split('\n').length).toBeGreaterThan(1);
    });

    it('writes atomically (no partial writes)', async () => {
      const mission = createMissionState({ id: 'm-atomic' });
      await store.save(mission);

      const filePath = join(projectDir, '.nova', 'missions', 'm-atomic.json');
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      // Full state must be present
      expect(parsed.id).toBe('m-atomic');
      expect(parsed.taskId).toBe('task-test-1');
      expect(parsed.iteration).toBe(0);
      expect(parsed.maxIterations).toBe(5);
    });

    it('overwrites existing file on re-save', async () => {
      const mission = createMissionState({ id: 'm-overwrite', status: 'planning' });
      await store.save(mission);

      // Update and re-save
      mission.status = 'executing';
      await store.save(mission);

      const loaded = await store.load('m-overwrite');
      expect(loaded).not.toBeNull();
      expect(loaded!.status).toBe('executing');
    });
  });

  // VAL-ORCH-031: MissionStore loads mission state from disk
  describe('load() - deserialization (VAL-ORCH-031)', () => {
    it('loads a previously saved mission', async () => {
      const mission = createMissionState({
        id: 'm-load',
        status: 'executing',
        iteration: 2,
        featureResults: {
          'feat-1': createFeatureResult({ featureId: 'feat-1' }),
        },
      });
      await store.save(mission);

      const loaded = await store.load('m-load');
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('m-load');
      expect(loaded!.status).toBe('executing');
      expect(loaded!.iteration).toBe(2);
      expect(loaded!.featureResults['feat-1']).toBeDefined();
      expect(loaded!.featureResults['feat-1']!.success).toBe(true);
    });

    it('returns null for non-existent mission', async () => {
      const loaded = await store.load('nonexistent');
      expect(loaded).toBeNull();
    });

    it('returns null for corrupted JSON on disk', async () => {
      // Manually write corrupted JSON
      const missionsDir = join(projectDir, '.nova', 'missions');
      const { mkdirSync } = await import('node:fs');
      mkdirSync(missionsDir, { recursive: true });
      writeFileSync(join(missionsDir, 'corrupt.json'), '{ broken json }}');

      const loaded = await store.load('corrupt');
      expect(loaded).toBeNull();
    });

    it('returns null for file missing required fields', async () => {
      const missionsDir = join(projectDir, '.nova', 'missions');
      const { mkdirSync } = await import('node:fs');
      mkdirSync(missionsDir, { recursive: true });
      writeFileSync(
        join(missionsDir, 'incomplete.json'),
        JSON.stringify({ id: 'incomplete' }), // missing taskId, status, etc.
      );

      const loaded = await store.load('incomplete');
      expect(loaded).toBeNull();
    });

    it('loads mission with plan and directorVerdict', async () => {
      const plan: MissionPlan = {
        features: [
          { id: 'f1', description: 'Feature 1', files: ['a.ts'], type: 'multi_file', dependencies: [] },
          { id: 'f2', description: 'Feature 2', files: ['b.ts'], type: 'multi_file', dependencies: ['f1'] },
        ],
      };
      const mission = createMissionState({
        id: 'm-with-plan',
        plan,
        directorVerdict: {
          decision: 'APPROVED',
          feedback: [],
        },
      });
      await store.save(mission);

      const loaded = await store.load('m-with-plan');
      expect(loaded).not.toBeNull();
      expect(loaded!.plan!.features).toHaveLength(2);
      expect(loaded!.directorVerdict!.decision).toBe('APPROVED');
    });
  });

  // VAL-ORCH-032: MissionStore survives process restart
  describe('survives process restart (VAL-ORCH-032)', () => {
    it('new store instance sees previously saved missions', async () => {
      const mission = createMissionState({ id: 'm-survive', status: 'executing' });
      await store.save(mission);

      // Simulate restart: new instance reading from same directory
      const newStore = new MissionStore(projectDir);
      const loaded = await newStore.load('m-survive');

      expect(loaded).not.toBeNull();
      expect(loaded!.status).toBe('executing');
    });

    it('getActive() finds non-terminal missions after restart', async () => {
      await store.save(createMissionState({ id: 'active-1', status: 'executing' }));
      await store.save(createMissionState({ id: 'active-2', status: 'reviewing' }));
      await store.save(createMissionState({ id: 'done-1', status: 'completed' }));

      const newStore = new MissionStore(projectDir);
      const active = await newStore.getActive();

      const activeIds = active.map((m) => m.id);
      expect(activeIds).toContain('active-1');
      expect(activeIds).toContain('active-2');
      expect(activeIds).not.toContain('done-1');
    });

    it('does not include failed missions in getActive()', async () => {
      await store.save(createMissionState({ id: 'failed-1', status: 'failed' }));

      const newStore = new MissionStore(projectDir);
      const active = await newStore.getActive();

      expect(active.map((m) => m.id)).not.toContain('failed-1');
    });
  });

  // VAL-ORCH-033: MissionStore.getAll() returns all missions
  describe('getAll() (VAL-ORCH-033)', () => {
    it('returns all missions from the directory', async () => {
      await store.save(createMissionState({ id: 'm-a' }));
      await store.save(createMissionState({ id: 'm-b' }));
      await store.save(createMissionState({ id: 'm-c' }));

      const all = await store.getAll();
      expect(all).toHaveLength(3);
      const ids = all.map((m) => m.id).sort();
      expect(ids).toEqual(['m-a', 'm-b', 'm-c']);
    });

    it('returns empty array when directory is empty', async () => {
      const all = await store.getAll();
      expect(all).toEqual([]);
    });

    it('returns empty array when directory does not exist', async () => {
      // Use a project dir that doesn't have .nova/missions yet
      const freshStore = new MissionStore(join(projectDir, 'subdir'));
      const all = await freshStore.getAll();
      expect(all).toEqual([]);
    });

    it('skips corrupt files with warning', async () => {
      // Save one valid mission
      await store.save(createMissionState({ id: 'valid' }));

      // Create a corrupt file manually
      const missionsDir = join(projectDir, '.nova', 'missions');
      writeFileSync(join(missionsDir, 'corrupt.json'), '{ not valid }');
      // Create a valid JSON that's not a mission
      writeFileSync(join(missionsDir, 'not-mission.json'), JSON.stringify({ foo: 'bar' }));
      // Create a temp file (skipped)
      writeFileSync(join(missionsDir, '.temp.json'), JSON.stringify(createMissionState({ id: 'temp' })));

      const all = await store.getAll();
      // Only the valid mission should be returned
      expect(all).toHaveLength(1);
      expect(all[0]!.id).toBe('valid');
    });
  });

  // VAL-ORCH-034: MissionStore.updateStatus() changes status atomically
  describe('updateStatus() (VAL-ORCH-034)', () => {
    it('updates status and persists to disk', async () => {
      const mission = createMissionState({ id: 'm-status', status: 'planning' });
      await store.save(mission);

      await store.updateStatus('m-status', 'executing');

      const loaded = await store.load('m-status');
      expect(loaded!.status).toBe('executing');
    });

    it('throws MissionNotFoundError for non-existent mission', async () => {
      await expect(store.updateStatus('nonexistent', 'executing')).rejects.toThrow(
        MissionNotFoundError,
      );
    });

    it('updates status atomically (full state preserved)', async () => {
      const plan: MissionPlan = {
        features: [
          { id: 'f1', description: 'F1', files: ['a.ts'], type: 'multi_file', dependencies: [] },
        ],
      };
      const mission = createMissionState({
        id: 'm-atomic-status',
        plan,
        iteration: 3,
        featureResults: { f1: createFeatureResult() },
      });
      await store.save(mission);

      await store.updateStatus('m-atomic-status', 'reviewing');

      const loaded = await store.load('m-atomic-status');
      expect(loaded).not.toBeNull();
      expect(loaded!.status).toBe('reviewing');
      // Other fields preserved
      expect(loaded!.plan!.features).toHaveLength(1);
      expect(loaded!.iteration).toBe(3);
      expect(loaded!.featureResults['f1']).toBeDefined();
    });

    it('supports all valid status transitions', async () => {
      const validStatuses: Array<MissionState['status']> = [
        'planning',
        'awaiting_confirmation',
        'executing',
        'reviewing',
        'completed',
        'failed',
      ];

      for (const status of validStatuses) {
        const mission = createMissionState({ id: 'm-trans', status: 'planning' });
        await store.save(mission);

        await store.updateStatus('m-trans', status);
        const loaded = await store.load('m-trans');
        expect(loaded!.status).toBe(status);
      }
    });
  });

  // VAL-ORCH-035: MissionStore.appendFeatureResult() records worker results
  describe('appendFeatureResult() (VAL-ORCH-035)', () => {
    it('records a feature result in the mission', async () => {
      const mission = createMissionState({ id: 'm-append' });
      await store.save(mission);

      const result = createFeatureResult({ featureId: 'feat-1' });
      await store.appendFeatureResult('m-append', 'feat-1', result);

      const loaded = await store.load('m-append');
      expect(loaded!.featureResults['feat-1']).toBeDefined();
      expect(loaded!.featureResults['feat-1']!.success).toBe(true);
      expect(loaded!.featureResults['feat-1']!.featureId).toBe('feat-1');
    });

    it('thros MissionNotFoundError for non-existent mission', async () => {
      const result = createFeatureResult();
      await expect(
        store.appendFeatureResult('nonexistent', 'feat-1', result),
      ).rejects.toThrow(MissionNotFoundError);
    });

    it('preserves existing feature results when appending new ones', async () => {
      const mission = createMissionState({
        id: 'm-multi',
        featureResults: {
          'feat-1': createFeatureResult({ featureId: 'feat-1' }),
        },
      });
      await store.save(mission);

      const newResult = createFeatureResult({ featureId: 'feat-2' });
      await store.appendFeatureResult('m-multi', 'feat-2', newResult);

      const loaded = await store.load('m-multi');
      expect(loaded!.featureResults['feat-1']).toBeDefined();
      expect(loaded!.featureResults['feat-2']).toBeDefined();
    });

    it('does NOT change mission status', async () => {
      const mission = createMissionState({ id: 'm-nostatus', status: 'executing' });
      await store.save(mission);

      await store.appendFeatureResult('m-nostatus', 'feat-1', createFeatureResult());

      const loaded = await store.load('m-nostatus');
      expect(loaded!.status).toBe('executing'); // status unchanged
    });

    it('overwrites previous result for the same feature', async () => {
      const mission = createMissionState({
        id: 'm-overwrite',
        featureResults: {
          'feat-1': createFeatureResult({ featureId: 'feat-1', success: false, error: 'failed' }),
        },
      });
      await store.save(mission);

      const newResult = createFeatureResult({ featureId: 'feat-1', success: true });
      await store.appendFeatureResult('m-overwrite', 'feat-1', newResult);

      const loaded = await store.load('m-overwrite');
      expect(loaded!.featureResults['feat-1']!.success).toBe(true);
      expect(loaded!.featureResults['feat-1']!.error).toBeUndefined();
    });

    it('handles failed feature results', async () => {
      const mission = createMissionState({ id: 'm-failed' });
      await store.save(mission);

      const failedResult: FeatureResult = {
        success: false,
        featureId: 'feat-bad',
        error: 'Worker crashed',
        validationErrors: [{ file: 'bad.ts', line: 1, message: 'Syntax error' }],
      };
      await store.appendFeatureResult('m-failed', 'feat-bad', failedResult);

      const loaded = await store.load('m-failed');
      expect(loaded!.featureResults['feat-bad']!.success).toBe(false);
      expect(loaded!.featureResults['feat-bad']!.error).toBe('Worker crashed');
      expect(loaded!.featureResults['feat-bad']!.validationErrors).toHaveLength(1);
    });
  });
});
