import { readFile, writeFile, mkdir, readdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { MissionState, FeatureResult, MissionStatus } from '../models/types.js';
import { MissionNotFoundError, type IMissionStore } from '../contracts/IMissionStore.js';
import type { ILogger } from '../contracts/ILogger.js';

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Validate that a parsed JSON object conforms to the MissionState shape.
 * Returns the validated MissionState or null if it fails basic checks.
 */
function validateMissionState(raw: unknown): MissionState | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const obj = raw as Record<string, unknown>;

  // Required fields
  if (typeof obj.id !== 'string' || obj.id.trim().length === 0) return null;
  if (typeof obj.taskId !== 'string') return null;
  if (typeof obj.status !== 'string') return null;
  if (typeof obj.iteration !== 'number') return null;
  if (typeof obj.maxIterations !== 'number') return null;

  // Validate status value
  const validStatuses: Set<string> = new Set([
    'planning',
    'awaiting_confirmation',
    'executing',
    'reviewing',
    'completed',
    'failed',
  ]);
  if (!validStatuses.has(obj.status)) return null;

  // Validate featureResults (must be object if present)
  if (obj.featureResults !== undefined && obj.featureResults !== null) {
    if (typeof obj.featureResults !== 'object') return null;
  }

  return {
    id: obj.id,
    taskId: obj.taskId,
    status: obj.status as MissionStatus,
    plan: obj.plan as MissionState['plan'],
    featureResults: (obj.featureResults as Record<string, FeatureResult>) ?? {},
    directorVerdict: obj.directorVerdict as MissionState['directorVerdict'],
    iteration: obj.iteration,
    maxIterations: obj.maxIterations,
  };
}

// ── MissionStore ───────────────────────────────────────────────────────

export class MissionStore implements IMissionStore {
  private readonly missionsDir: string;

  constructor(
    projectPath: string,
    private readonly logger?: ILogger,
  ) {
    this.missionsDir = join(projectPath, '.nova', 'missions');
  }

  /**
   * Persists a mission state to .nova/missions/{id}.json.
   * Writes atomically: first to a temp file, then renames.
   * Creates the directory if it doesn't exist.
   */
  async save(mission: MissionState): Promise<void> {
    this.logger?.info('MissionStore: saving mission', {
      missionId: mission.id,
      status: mission.status,
      iteration: mission.iteration,
    });

    // Ensure directory exists
    await mkdir(this.missionsDir, { recursive: true });

    const json = JSON.stringify(mission, null, 2);
    const filePath = join(this.missionsDir, `${mission.id}.json`);

    // Atomic write: write to temp file first, then rename
    const tempPath = join(
      this.missionsDir,
      `.${mission.id}.${createHash('md5').update(randomUUID()).digest('hex').slice(0, 8)}.tmp`,
    );

    try {
      // Ensure parent directory exists
      await mkdir(dirname(tempPath), { recursive: true });
      await writeFile(tempPath, json, 'utf-8');
      await rename(tempPath, filePath);
    } catch (error) {
      // Clean up temp file on failure
      try {
        await import('node:fs/promises').then((fs) => fs.unlink(tempPath));
      } catch {
        // best effort cleanup
      }
      throw error;
    }

    this.logger?.info('MissionStore: mission saved', {
      missionId: mission.id,
      filePath,
    });
  }

  /**
   * Loads a mission state from disk.
   * Returns null if the file doesn't exist or contains invalid JSON.
   */
  async load(id: string): Promise<MissionState | null> {
    const filePath = join(this.missionsDir, `${id}.json`);

    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      return null; // File doesn't exist
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger?.warn('MissionStore: corrupted JSON in mission file', {
        missionId: id,
        filePath,
      });
      return null;
    }

    const mission = validateMissionState(parsed);
    if (!mission) {
      this.logger?.warn('MissionStore: mission file failed schema validation', {
        missionId: id,
        filePath,
      });
      return null;
    }

    return mission;
  }

  /**
   * Returns all missions by reading all .json files in .nova/missions/.
   * Files that fail to parse are skipped with a warning.
   */
  async getAll(): Promise<MissionState[]> {
    const missions: MissionState[] = [];

    let entries: string[];
    try {
      entries = await readdir(this.missionsDir);
    } catch {
      // Directory doesn't exist or can't be read
      return [];
    }

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      // Skip temp files
      if (entry.startsWith('.')) continue;

      const id = entry.slice(0, -5); // Remove .json suffix
      const mission = await this.load(id);
      if (mission) {
        missions.push(mission);
      } else {
        this.logger?.warn('MissionStore: skipping unparseable mission file', {
          entry,
        });
      }
    }

    return missions;
  }

  /**
   * Returns all missions that are NOT in a terminal state.
   * Terminal states: 'completed', 'failed'.
   */
  async getActive(): Promise<MissionState[]> {
    const all = await this.getAll();
    return all.filter((m) => m.status !== 'completed' && m.status !== 'failed');
  }

  /**
   * Updates the status of a mission and saves to disk atomically.
   * Throws MissionNotFoundError if the mission doesn't exist.
   */
  async updateStatus(id: string, status: MissionState['status']): Promise<void> {
    this.logger?.info('MissionStore: updating status', {
      missionId: id,
      newStatus: status,
    });

    const mission = await this.load(id);
    if (!mission) {
      throw new MissionNotFoundError(id);
    }

    mission.status = status;

    await this.save(mission);

    this.logger?.info('MissionStore: status updated', {
      missionId: id,
      status,
    });
  }

  /**
   * Records a worker result for a specific feature within a mission.
   * Does NOT change mission status (use updateStatus for that).
   */
  async appendFeatureResult(
    id: string,
    featureId: string,
    result: FeatureResult,
  ): Promise<void> {
    this.logger?.info('MissionStore: appending feature result', {
      missionId: id,
      featureId,
      success: result.success,
    });

    const mission = await this.load(id);
    if (!mission) {
      throw new MissionNotFoundError(id);
    }

    mission.featureResults[featureId] = result;

    await this.save(mission);

    this.logger?.info('MissionStore: feature result appended', {
      missionId: id,
      featureId,
    });
  }
}
