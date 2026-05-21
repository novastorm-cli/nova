import { strings } from './strings.js';
import { Z_INDEX } from './styles.js';

/** Status lifecycle for a single mission feature. */
type FeatureStatus = 'pending' | 'executing' | 'completed' | 'failed';

interface MissionFeatureState {
  id: string;
  description: string;
  type?: string | undefined;
  files?: string[] | undefined;
  dependencies: string[];
  status: FeatureStatus;
  commitHash?: string | undefined;
  error?: string | undefined;
  element: HTMLElement;
}

interface StoredFeature {
  id: string;
  description: string;
  type?: string | undefined;
  files?: string[] | undefined;
  dependencies: string[];
  status: FeatureStatus;
  commitHash?: string | undefined;
  error?: string | undefined;
}

interface StoredMission {
  missionId: string;
  features: StoredFeature[];
  iteration: number;
  maxIterations: number;
  verdict?: string | undefined;
  missionStatus: string;
}

const AUTO_HIDE_DELAY_MS = 5000;
const STORAGE_KEY = 'nova-mission-panel-state';
const RECENT_MISSIONS_KEY = 'nova:recent-missions';
const MAX_RECENT_MISSIONS = 10;

export class MissionPanel {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private listEl: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;
  private titleBar: HTMLElement | null = null;
  private progressEl: HTMLElement | null = null;
  private iterationBadge: HTMLElement | null = null;
  private verdictBanner: HTMLElement | null = null;
  private features: Map<string, MissionFeatureState> = new Map();
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private isHovering = false;
  private isHistoryMode = false;
  private currentMissionId: string | null = null;
  private currentIteration = 0;
  private maxIterations = 5;

  /** Returns the host element (for layout manager registration). */
  getHost(): HTMLElement | null {
    return this.host;
  }

  mount(container: HTMLElement): void {
    this.host = document.createElement('div');
    this.host.setAttribute('data-nova', 'mission-panel');
    this.host.style.position = 'fixed';
    this.host.style.zIndex = String(Z_INDEX.missionPanel);
    this.host.style.pointerEvents = 'none';

    this.host.setAttribute('role', 'region');
    this.host.setAttribute('aria-label', 'Mission progress');

    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadow.appendChild(style);

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'mission-panel hidden';
    this.panelEl.setAttribute('data-nova', 'mission-panel-inner');

    // Title bar with close button
    this.titleBar = document.createElement('div');
    this.titleBar.className = 'mission-panel-title-bar';

    const titleWrapper = document.createElement('div');
    titleWrapper.className = 'mission-title-wrapper';

    const title = document.createElement('div');
    title.className = 'mission-panel-title';
    title.textContent = strings.missionPanelTitle;
    titleWrapper.appendChild(title);

    // Progress counter
    this.progressEl = document.createElement('div');
    this.progressEl.className = 'mission-progress';
    this.progressEl.textContent = '';
    titleWrapper.appendChild(this.progressEl);

    // Iteration badge
    this.iterationBadge = document.createElement('div');
    this.iterationBadge.className = 'mission-iteration-badge hidden';
    this.iterationBadge.textContent = '';
    titleWrapper.appendChild(this.iterationBadge);

    this.titleBar.appendChild(titleWrapper);

    // Close button (×)
    const closeBtn = document.createElement('button');
    closeBtn.className = 'mission-panel-close';
    closeBtn.setAttribute('data-nova', 'close');
    closeBtn.setAttribute('aria-label', strings.missionPanelCloseAriaLabel);
    closeBtn.innerHTML = strings.closeX;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeImmediately();
    });
    this.titleBar.appendChild(closeBtn);

    this.panelEl.appendChild(this.titleBar);

    // Verdict banner (hidden by default)
    this.verdictBanner = document.createElement('div');
    this.verdictBanner.className = 'mission-verdict hidden';
    this.verdictBanner.setAttribute('aria-live', 'polite');
    this.panelEl.appendChild(this.verdictBanner);

    // Feature list with role="list"
    this.listEl = document.createElement('div');
    this.listEl.className = 'mission-feature-list';
    this.listEl.setAttribute('role', 'list');
    this.panelEl.appendChild(this.listEl);

    this.shadow.appendChild(this.panelEl);

    // Pin-on-hover: suspend/resume auto-hide timer
    this.panelEl.addEventListener('pointerenter', () => {
      this.isHovering = true;
      this.clearHideTimer();
    });
    this.panelEl.addEventListener('pointerleave', () => {
      this.isHovering = false;
      this.checkAllDone();
    });

    container.appendChild(this.host);

    // Restore state after hot reload
    this.restoreState();
  }

  unmount(): void {
    this.clearHideTimer();
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.listEl = null;
    this.panelEl = null;
    this.titleBar = null;
    this.progressEl = null;
    this.iterationBadge = null;
    this.verdictBanner = null;
    this.features.clear();
    this.currentMissionId = null;
  }

  /** Set the mission plan from a `mission_planned` event. */
  setPlan(plan: {
    missionId?: string | undefined;
    features: Array<{
      id: string;
      description: string;
      type?: string | undefined;
      files?: string[] | undefined;
      dependencies?: string[] | undefined;
    }>;
    autoApproved?: boolean | undefined;
  }): void {
    // Only show the latest plan — clear previous mission
    this.clearHideTimer();
    this.features.clear();
    if (this.listEl) {
      this.listEl.innerHTML = '';
    }
    this.isHistoryMode = false;

    // Hide any previous verdict
    if (this.verdictBanner) {
      this.verdictBanner.className = 'mission-verdict hidden';
      this.verdictBanner.textContent = '';
    }

    // Reset iteration tracking
    this.currentIteration = 0;
    this.maxIterations = 5;
    if (this.iterationBadge) {
      this.iterationBadge.className = 'mission-iteration-badge hidden';
      this.iterationBadge.textContent = '';
    }

    if (!plan.features || plan.features.length === 0) {
      // Empty plan — show message
      const emptyRow = document.createElement('div');
      emptyRow.className = 'mission-empty';
      emptyRow.textContent = strings.missionNoFeatures;
      emptyRow.setAttribute('role', 'listitem');
      this.listEl?.appendChild(emptyRow);
      this.show();
      this.saveState();
      return;
    }

    // Detect dependencies for arrow rendering
    const allDepIds = new Set<string>();
    for (const f of plan.features) {
      for (const dep of f.dependencies ?? []) {
        allDepIds.add(dep);
      }
    }

    for (const feature of plan.features) {
      const hasDeps = (feature.dependencies?.length ?? 0) > 0;
      const isDependedOn = allDepIds.has(feature.id);
      const element = this.createFeatureRow(
        feature.description,
        'pending',
        feature.type,
        feature.files?.length,
        hasDeps,
        isDependedOn,
      );
      this.listEl?.appendChild(element);
      this.features.set(feature.id, {
        id: feature.id,
        description: feature.description,
        type: feature.type,
        files: feature.files,
        dependencies: feature.dependencies ?? [],
        status: 'pending',
        element,
      });
    }

    // Show auto-approved badge if applicable
    if (plan.autoApproved && this.verdictBanner) {
      this.verdictBanner.className = 'mission-verdict mission-auto-approved';
      this.verdictBanner.textContent = strings.missionAutoApproved;
    }

    this.updateProgress();
    this.show();
    this.saveState();
  }

  setFeatureStarted(featureId: string): void {
    const entry = this.features.get(featureId);
    if (!entry) return;
    entry.status = 'executing';
    this.updateFeatureRow(entry);
    this.updateProgress();
    this.saveState();
  }

  setFeatureCompleted(featureId: string, commitHash?: string): void {
    const entry = this.features.get(featureId);
    if (!entry) return;
    entry.status = 'completed';
    entry.commitHash = commitHash;
    this.updateFeatureRow(entry);
    this.updateProgress();
    this.saveState();
    this.persistToRecent();
    this.checkAllDone();
  }

  setFeatureFailed(featureId: string, error?: string): void {
    const entry = this.features.get(featureId);
    if (!entry) return;
    entry.status = 'failed';
    entry.error = error;
    this.updateFeatureRow(entry);
    this.updateProgress();
    this.saveState();
    this.persistToRecent();
    this.checkAllDone();
  }

  setStreamingText(featureId: string, text: string, phase: string): void {
    const entry = this.features.get(featureId);
    if (!entry || !this.shadow) return;

    const row = entry.element;
    let streamArea = row.querySelector('.mission-stream');
    if (!streamArea) {
      streamArea = document.createElement('div');
      streamArea.className = `mission-stream phase-${phase}`;
      row.appendChild(streamArea);
    }

    streamArea.className = `mission-stream phase-${phase}`;
    streamArea.textContent = text;
    streamArea.scrollTop = (streamArea as HTMLElement).scrollHeight;
  }

  /** Show the director's verdict. */
  setVerdict(decision: string, feedback?: Array<{ featureId: string; actionItems: string[] }>): void {
    if (!this.verdictBanner) return;

    const isApproved = decision === 'APPROVED';
    this.verdictBanner.className = `mission-verdict mission-verdict-${isApproved ? 'approved' : 'revision'}`;
    this.verdictBanner.textContent = isApproved
      ? strings.missionVerdictApproved
      : strings.missionVerdictNeedsRevision;

    // If NEEDS_REVISION, highlight failed features
    if (!isApproved && feedback) {
      for (const item of feedback) {
        const entry = this.features.get(item.featureId);
        if (entry) {
          entry.element.classList.add('needs-revision');
        }
      }
    }

    this.saveState();
  }

  /** Update the iteration badge. */
  setIteration(iteration: number, maxIterations: number): void {
    this.currentIteration = iteration;
    this.maxIterations = maxIterations;

    if (this.iterationBadge) {
      this.iterationBadge.className = 'mission-iteration-badge';
      this.iterationBadge.textContent = strings.missionIteration(iteration, maxIterations);
    }

    this.saveState();
  }

  /** Set the mission to completed state with optional commit hash. */
  setMissionCompleted(commitHash?: string): void {
    if (this.verdictBanner) {
      if (!this.verdictBanner.textContent?.includes(strings.missionVerdictApproved)) {
        this.verdictBanner.className = 'mission-verdict mission-verdict-approved';
        this.verdictBanner.textContent =
          strings.missionVerdictApproved +
          (commitHash ? ` (${commitHash.slice(0, 7)})` : '');
      }
    }

    this.persistToRecent();
    this.checkAllDone();
    this.saveState();
  }

  /** Set the mission to failed state. */
  setMissionFailed(error?: string): void {
    if (this.verdictBanner) {
      this.verdictBanner.className = 'mission-verdict mission-verdict-failed';
      this.verdictBanner.textContent =
        `${strings.missionFailed}${error ? ': ' + error : ''}`;
    }

    // Do NOT auto-hide on failure — user needs to see the error
    this.clearHideTimer();
    this.persistToRecent();
    this.saveState();
  }

  show(): void {
    this.panelEl?.classList.remove('hidden');
  }

  hide(): void {
    this.clearHideTimer();
    this.panelEl?.classList.add('hidden');
  }

  /** Close immediately — used by the × button. */
  closeImmediately(): void {
    this.clearHideTimer();
    this.isHistoryMode = false;
    this.panelEl?.classList.add('hidden');
    if (this.listEl) this.listEl.innerHTML = '';
    this.features.clear();
    this.currentMissionId = null;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // sessionStorage may be unavailable
    }
  }

  /** Get the current state for test hooks. */
  getState(): {
    missionId: string | null;
    features: Array<{ id: string; description: string; status: FeatureStatus }>;
    iteration: number;
    maxIterations: number;
    isVisible: boolean;
  } {
    return {
      missionId: this.currentMissionId,
      features: Array.from(this.features.values()).map((f) => ({
        id: f.id,
        description: f.description,
        status: f.status,
      })),
      iteration: this.currentIteration,
      maxIterations: this.maxIterations,
      isVisible: this.panelEl ? !this.panelEl.classList.contains('hidden') : false,
    };
  }

  // ── Private helpers ──────────────────────────────────────

  private updateProgress(): void {
    if (!this.progressEl) return;

    const total = this.features.size;
    const done = Array.from(this.features.values()).filter(
      (f) => f.status === 'completed' || f.status === 'failed',
    ).length;

    if (total > 0) {
      this.progressEl.textContent = strings.missionProgress(done, total);
    } else {
      this.progressEl.textContent = '';
    }
  }

  private checkAllDone(): void {
    if (this.features.size === 0) return;

    const allDone = Array.from(this.features.values()).every(
      (f) => f.status === 'completed' || f.status === 'failed',
    );
    if (allDone) {
      this.clearHideTimer();
      if (!this.isHovering) {
        this.hideTimer = setTimeout(() => {
          this.hide();
          try {
            sessionStorage.removeItem(STORAGE_KEY);
          } catch {
            // sessionStorage may be unavailable
          }
        }, AUTO_HIDE_DELAY_MS);
      }
    }
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private createFeatureRow(
    description: string,
    status: FeatureStatus,
    type?: string,
    fileCount?: number,
    hasDeps?: boolean,
    isDependedOn?: boolean,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = `mission-feature-row status-${status}`;
    row.setAttribute('role', 'listitem');

    // Dependency arrow indicator (left side)
    if (hasDeps) {
      const arrow = document.createElement('span');
      arrow.className = 'mission-dep-arrow depends-on';
      arrow.innerHTML = strings.missionDepArrow;
      arrow.setAttribute('aria-label', 'Depends on another feature');
      row.appendChild(arrow);
    } else if (isDependedOn) {
      const arrow = document.createElement('span');
      arrow.className = 'mission-dep-arrow depended-by';
      arrow.innerHTML = strings.missionDepArrowDependedBy;
      arrow.setAttribute('aria-label', 'Depended on by other features');
      row.appendChild(arrow);
    } else {
      // Spacer to align with arrow rows
      const spacer = document.createElement('span');
      spacer.className = 'mission-dep-arrow';
      spacer.innerHTML = '&nbsp;';
      row.appendChild(spacer);
    }

    const icon = document.createElement('span');
    icon.className = 'mission-feature-icon';
    icon.innerHTML = this.getIcon(status);

    const desc = document.createElement('span');
    desc.className = 'mission-feature-desc';
    desc.textContent = description;
    desc.title = description;

    // Type badge
    if (type) {
      const badge = document.createElement('span');
      badge.className = 'mission-feature-type';
      badge.textContent = type;
      row.appendChild(icon);
      row.appendChild(desc);
      row.appendChild(badge);
    } else {
      row.appendChild(icon);
      row.appendChild(desc);
    }

    // File count
    if (fileCount !== undefined && fileCount > 0) {
      const fileInfo = document.createElement('span');
      fileInfo.className = 'mission-feature-files';
      fileInfo.textContent = `${fileCount} file${fileCount !== 1 ? 's' : ''}`;
      row.appendChild(fileInfo);
    }

    return row;
  }

  private updateFeatureRow(entry: MissionFeatureState): void {
    const row = entry.element;

    // Update status class
    row.className = row.className
      .replace(/status-\w+/g, `status-${entry.status}`)
      .replace(/\s+/g, ' ')
      .trim();
    if (!row.className.includes(`status-${entry.status}`)) {
      row.className = `mission-feature-row status-${entry.status}`;
    }

    const icon = row.querySelector('.mission-feature-icon');
    if (icon) {
      icon.innerHTML = this.getIcon(entry.status);
    }

    // Update file info with commit hash or error
    let meta = row.querySelector('.mission-feature-meta');
    if (entry.status === 'completed' || entry.status === 'failed') {
      if (!meta) {
        meta = document.createElement('span');
        meta.className = 'mission-feature-meta';
        row.appendChild(meta);
      }
      if (entry.status === 'completed' && entry.commitHash) {
        meta.textContent = entry.commitHash.slice(0, 7);
      } else if (entry.status === 'failed' && entry.error) {
        meta.textContent = entry.error.slice(0, 30);
        (meta as HTMLElement).setAttribute('title', entry.error);
      }
    } else if (meta) {
      meta.remove();
    }
  }

  private getIcon(status: FeatureStatus): string {
    switch (status) {
      case 'pending':
        return '<svg class="mission-spinner" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="30 14" stroke-linecap="round"/></svg>';
      case 'executing':
        return '<svg class="mission-spinner mission-spinner-fast" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="30 14" stroke-linecap="round"/></svg>';
      case 'completed':
        return '<svg class="mission-check" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="currentColor" opacity="0.15"/><circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/><path class="checkmark" d="M5 9.5L7.5 12L13 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      case 'failed':
        return '<svg class="mission-fail" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="currentColor" opacity="0.15"/><circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 6L12 12M12 6L6 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    }
  }

  // ── Persistence ──────────────────────────────────────────

  private saveState(): void {
    try {
      if (this.isHistoryMode) return; // Don't persist history views

      const features = Array.from(this.features.values()).map((f) => ({
        id: f.id,
        description: f.description,
        type: f.type,
        files: f.files,
        dependencies: f.dependencies,
        status: f.status,
        commitHash: f.commitHash,
        error: f.error,
      }));

      const data: StoredMission = {
        missionId: this.currentMissionId ?? '',
        features,
        iteration: this.currentIteration,
        maxIterations: this.maxIterations,
        verdict: this.verdictBanner?.textContent ?? undefined,
        missionStatus: this.features.size === 0
          ? 'empty'
          : Array.from(this.features.values()).every(
              (f) => f.status === 'completed' || f.status === 'failed',
            )
            ? 'terminal'
            : 'in-progress',
      };

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // sessionStorage might be unavailable
    }
  }

  private restoreState(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const data = JSON.parse(raw) as StoredMission;
      if (!data || !data.features || data.features.length === 0) return;

      // Discard stale terminal state
      if (data.missionStatus === 'terminal') {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }

      // Restore features
      this.features.clear();
      if (this.listEl) this.listEl.innerHTML = '';

      this.currentMissionId = data.missionId || null;
      this.currentIteration = data.iteration;
      this.maxIterations = data.maxIterations;

      // Restore iteration badge
      if (this.iterationBadge && data.iteration > 0) {
        this.iterationBadge.className = 'mission-iteration-badge';
        this.iterationBadge.textContent = strings.missionIteration(data.iteration, data.maxIterations);
      }

      // Restore verdict banner
      if (data.verdict && this.verdictBanner) {
        if (data.verdict.includes(strings.missionVerdictApproved)) {
          this.verdictBanner.className = 'mission-verdict mission-verdict-approved';
        } else if (data.verdict.includes('NEEDS REVISION')) {
          this.verdictBanner.className = 'mission-verdict mission-verdict-revision';
        }
        this.verdictBanner.textContent = data.verdict;
      }

      // Detect dependency relations for arrow rendering
      const allDepIds = new Set<string>();
      for (const f of data.features) {
        for (const dep of f.dependencies) {
          allDepIds.add(dep);
        }
      }

      for (const stored of data.features) {
        const hasDeps = stored.dependencies.length > 0;
        const isDependedOn = allDepIds.has(stored.id);
        const element = this.createFeatureRow(
          stored.description,
          stored.status,
          stored.type,
          stored.files?.length,
          hasDeps,
          isDependedOn,
        );
        this.listEl?.appendChild(element);
        const entry: MissionFeatureState = {
          ...stored,
          element,
        };
        this.features.set(stored.id, entry);

        if (stored.status === 'completed' || stored.status === 'failed') {
          this.updateFeatureRow(entry);
        }
      }

      this.updateProgress();
      this.show();
    } catch {
      // Ignore parse errors
    }
  }

  private persistToRecent(): void {
    try {
      const terminal = Array.from(this.features.values()).filter(
        (f) => f.status === 'completed' || f.status === 'failed',
      );
      if (terminal.length === 0) return;

      let recent: StoredMission[] = [];
      const raw = localStorage.getItem(RECENT_MISSIONS_KEY);
      if (raw) {
        recent = JSON.parse(raw) as StoredMission[];
        if (!Array.isArray(recent)) recent = [];
      }

      // Create a mission entry
      const mission: StoredMission = {
        missionId: this.currentMissionId ?? `mission-${Date.now()}`,
        features: Array.from(this.features.values()).map((f) => ({
          id: f.id,
          description: f.description,
          type: f.type,
          files: f.files,
          dependencies: f.dependencies,
          status: f.status,
          commitHash: f.commitHash,
          error: f.error,
        })),
        iteration: this.currentIteration,
        maxIterations: this.maxIterations,
        missionStatus: Array.from(this.features.values()).some((f) => f.status === 'failed')
          ? 'failed'
          : 'completed',
      };

      // Dedup by missionId
      const existingIdx = recent.findIndex((m) => m.missionId === mission.missionId);
      if (existingIdx >= 0) {
        recent[existingIdx] = mission;
      } else {
        recent.unshift(mission);
      }

      if (recent.length > MAX_RECENT_MISSIONS) {
        recent = recent.slice(0, MAX_RECENT_MISSIONS);
      }

      localStorage.setItem(RECENT_MISSIONS_KEY, JSON.stringify(recent));
    } catch {
      // localStorage might be unavailable
    }
  }

  // ── Styles ───────────────────────────────────────────────

  private getStyles(): string {
    return `
      .mission-panel {
        background: var(--nova-panel-bg);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        max-width: 450px;
        min-width: 300px;
        max-height: 70vh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        pointer-events: auto;
        opacity: 1;
        transform: translateY(0);
        transition: opacity 0.3s ease, transform 0.3s ease;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .mission-panel.hidden {
        display: none;
      }

      .mission-panel-title-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 12px 8px 16px;
        flex-shrink: 0;
      }

      .mission-title-wrapper {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .mission-panel-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--nova-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        white-space: nowrap;
      }

      .mission-progress {
        font-size: 12px;
        font-weight: 500;
        color: var(--nova-accent);
        white-space: nowrap;
      }

      .mission-iteration-badge {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 4px;
        background: var(--nova-surface-subtle);
        color: var(--nova-warning, #f59e0b);
        white-space: nowrap;
      }

      .mission-iteration-badge.hidden {
        display: none;
      }

      .mission-panel-close {
        background: none;
        border: none;
        color: var(--nova-text-secondary);
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        padding: 2px 4px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s, background 0.15s;
      }

      .mission-panel-close:hover {
        color: var(--nova-text-primary);
        background: var(--nova-surface-subtle);
      }

      .mission-panel-close:focus-visible {
        outline: 2px solid var(--nova-accent);
        outline-offset: 2px;
      }

      .mission-verdict {
        padding: 8px 16px;
        font-size: 12px;
        font-weight: 600;
        text-align: center;
        border-bottom: 1px solid var(--nova-surface-subtle);
        flex-shrink: 0;
      }

      .mission-verdict.hidden {
        display: none;
      }

      .mission-verdict-approved {
        color: var(--nova-success);
        background: color-mix(in srgb, var(--nova-success) 8%, transparent);
      }

      .mission-verdict-revision {
        color: var(--nova-warning, #f59e0b);
        background: color-mix(in srgb, var(--nova-warning, #f59e0b) 10%, transparent);
      }

      .mission-verdict-failed {
        color: var(--nova-error);
        background: color-mix(in srgb, var(--nova-error) 8%, transparent);
      }

      .mission-auto-approved {
        color: var(--nova-accent);
        background: color-mix(in srgb, var(--nova-accent) 8%, transparent);
      }

      .mission-feature-list {
        padding: 4px 12px 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
      }

      .mission-empty {
        padding: 16px;
        text-align: center;
        font-size: 13px;
        color: var(--nova-text-secondary);
        font-style: italic;
      }

      .mission-feature-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 6px;
        font-size: 13px;
        color: var(--nova-text-primary);
        background: var(--nova-surface-subtle);
      }

      .mission-feature-row.needs-revision {
        border-left: 3px solid var(--nova-warning, #f59e0b);
        background: color-mix(in srgb, var(--nova-warning, #f59e0b) 8%, transparent);
      }

      .mission-dep-arrow {
        flex-shrink: 0;
        width: 20px;
        font-family: monospace;
        font-size: 12px;
        text-align: center;
      }

      .mission-dep-arrow.depends-on {
        color: var(--nova-text-secondary);
      }

      .mission-dep-arrow.depended-by {
        color: var(--nova-accent);
      }

      .mission-feature-icon {
        flex-shrink: 0;
        width: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .mission-feature-desc {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .mission-feature-type {
        flex-shrink: 0;
        font-size: 9px;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: 3px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--nova-accent);
        background: color-mix(in srgb, var(--nova-accent) 12%, transparent);
      }

      .mission-feature-files {
        flex-shrink: 0;
        font-size: 10px;
        color: var(--nova-text-secondary);
        font-family: "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }

      .mission-feature-meta {
        flex-shrink: 0;
        font-size: 11px;
        font-family: "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        color: var(--nova-text-secondary);
      }

      /* Status styling */
      .status-executing .mission-feature-desc {
        color: var(--nova-accent);
      }

      .status-completed .mission-feature-desc {
        color: var(--nova-success);
      }

      .status-failed .mission-feature-desc {
        color: var(--nova-error);
      }

      .status-failed .mission-feature-meta {
        color: var(--nova-error);
      }

      /* Icons */
      .mission-spinner {
        animation: mission-spin 1s linear infinite;
        color: var(--nova-accent);
      }

      .mission-spinner.mission-spinner-fast {
        animation: mission-spin 0.6s linear infinite;
        color: var(--nova-accent);
      }

      .mission-check {
        color: var(--nova-success);
      }

      .mission-check .checkmark {
        stroke-dasharray: 20;
        stroke-dashoffset: 20;
        animation: checkmark-draw 0.4s ease forwards;
      }

      .mission-fail {
        color: var(--nova-error);
      }

      /* Streaming output area */
      .mission-stream {
        margin-top: 4px;
        padding: 4px 6px;
        background: var(--nova-surface-subtle);
        border-radius: 4px;
        font-family: "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 11px;
        max-height: 100px;
        overflow-y: auto;
        overflow-x: hidden;
        white-space: pre-wrap;
        word-break: break-all;
        color: var(--nova-text-primary);
      }

      .mission-stream.phase-reasoning {
        color: var(--nova-text-secondary);
        font-style: italic;
      }

      .mission-stream.phase-code {
        color: var(--nova-text-primary);
        font-style: normal;
      }

      @media (prefers-reduced-motion: no-preference) {
        @keyframes mission-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes checkmark-draw {
          to { stroke-dashoffset: 0; }
        }
      }
    `;
  }
}
