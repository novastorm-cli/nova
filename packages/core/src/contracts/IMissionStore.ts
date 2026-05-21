import type { MissionState, FeatureResult } from '../models/types.js';

export class MissionNotFoundError extends Error {
  constructor(missionId: string) {
    super(`Mission not found: ${missionId}`);
    this.name = 'MissionNotFoundError';
  }
}

export interface IMissionStore {
  /**
   * Persists a mission state to .nova/missions/{id}.json.
   * Creates the directory if it doesn't exist.
   * Writes JSON atomically (write to temp file, then rename).
   */
  save(mission: MissionState): Promise<void>;

  /**
   * Loads a mission state from disk.
   * Returns null if the mission file doesn't exist or contains invalid JSON.
   */
  load(id: string): Promise<MissionState | null>;

  /**
   * Returns all missions (reads all .json files in .nova/missions/).
   * Files that fail to parse are skipped with a warning.
   */
  getAll(): Promise<MissionState[]>;

  /**
   * Returns all missions not in a terminal state (completed, failed).
   */
  getActive(): Promise<MissionState[]>;

  /**
   * Updates the status of a mission and saves to disk.
   * Also updates the internal updatedAt timestamp.
   * Throws MissionNotFoundError if the mission doesn't exist.
   */
  updateStatus(id: string, status: MissionState['status']): Promise<void>;

  /**
   * Records a worker result for a specific feature within a mission.
   * Does NOT change mission status (use updateStatus for that).
   */
  appendFeatureResult(id: string, featureId: string, result: FeatureResult): Promise<void>;
}
