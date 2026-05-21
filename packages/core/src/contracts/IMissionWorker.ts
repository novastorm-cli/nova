import type { MissionFeature, ProjectMap, FeatureResult } from '../models/types.js';

export interface IMissionWorker {
  /**
   * Implements a single mission feature using the standard/strong LLM model.
   *
   * Process:
   * 1. Builds prompt with feature description + project context (stack, files, packages)
   * 2. Calls the LLM with the standard model (NOT the orchestrator model)
   * 3. Parses FILE/DIFF/DELETE blocks from the response
   * 4. Applies blocks to disk via parseMixedBlocks/applyMixedBlocks
   * 5. Validates generated code via CodeValidator (tsc + imports)
   * 6. Auto-fixes validation errors via CodeFixer (max 2 fix iterations)
   * 7. Validates all file paths through PathGuard
   *
   * @param feature - The feature to implement
   * @param projectMap - Project context including stack, routes, files, packages
   * @returns FeatureResult with generated files, diff, validation status, and fix iterations
   */
  execute(
    feature: MissionFeature,
    projectMap: ProjectMap,
  ): Promise<FeatureResult>;
}
