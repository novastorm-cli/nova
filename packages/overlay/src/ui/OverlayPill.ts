import type { IOverlayPill } from '../contracts/IOverlayUI.js';
import { strings } from './strings.js';
import { COLORS, PILL_SIZE, Z_INDEX, TRANSITION } from './styles.js';

const STORAGE_KEY_X = 'nova-pill-x';
const STORAGE_KEY_Y = 'nova-pill-y';

/** Drag must exceed this distance (px) before it is considered a drag, not a click. */
const DRAG_DEADZONE = 4;

type PillState = 'idle' | 'listening' | 'processing' | 'error';

/** Detect whether the user is on macOS (for shortcut glyph rendering). */
function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  // navigator.platform is the classic check (e.g. "MacIntel").
  if (/mac/i.test(navigator.platform)) return true;
  // Modern check via User-Agent Client Hints API.
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform === 'macOS') return true;
  return false;
}

/** Build the shortcut label for a key: ⌥I on macOS, Alt+I elsewhere. */
function shortcutGlyph(key: string): string {
  return isMac() ? `\u2325${key}` : `Alt+${key}`;
}

export class OverlayPill implements IOverlayPill {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private pillEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private dropdownVisible = false;
  private quickEditHandler: (() => void) | null = null;
  private multiEditHandler: (() => void) | null = null;
  private gestureModeHandler: (() => void) | null = null;
  private recentTasksHandler: (() => void) | null = null;
  private activityLogHandler: (() => void) | null = null;
  private activeMode: 'none' | 'quickEdit' | 'multiEdit' = 'none';
  private gestureModeActive = false;
  private currentState: PillState = 'idle';

  // Pointer-based drag state
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  /** Total distance moved since pointerdown (for deadzone check). */
  private dragDist = 0;
  /** Whether the deadzone threshold has been crossed. */
  private hasMoved = false;
  /** The pointer ID of the active drag (for capture). */
  private activePointerId = -1;
  /** Set to true after pointerup handled the toggle, to suppress the subsequent click. */
  private toggledViaPointer = false;
  /** Set to true after a drag completed, to suppress the subsequent click. */
  private dragCompleted = false;

  private readonly boundPointerMove = this.handlePointerMove.bind(this);
  private readonly boundPointerUp = this.handlePointerUp.bind(this);
  private readonly boundDocumentClick = this.handleDocumentClick.bind(this);

  // ── mount ─────────────────────────────────────────────────────

  mount(container: HTMLElement): void {
    if (this.host) return;

    this.host = document.createElement('div');
    this.host.setAttribute('data-nova-pill', '');
    this.host.setAttribute('data-nova', 'pill');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyleSheet();
    this.shadow.appendChild(style);

    this.pillEl = document.createElement('button');
    this.pillEl.className = 'nova-pill idle';
    this.pillEl.setAttribute('data-nova', 'pill');
    this.pillEl.setAttribute('aria-label', strings.pillAriaLabel);
    this.pillEl.setAttribute('aria-haspopup', 'menu');
    this.pillEl.setAttribute('aria-expanded', 'false');
    this.pillEl.setAttribute('tabindex', '0');
    this.pillEl.innerHTML = this.getIcon();

    this.shadow.appendChild(this.pillEl);

    this.dropdownEl = document.createElement('div');
    this.dropdownEl.className = 'pill-dropdown hidden';
    this.dropdownEl.setAttribute('role', 'menu');
    this.dropdownEl.innerHTML = this.buildDropdownHtml();
    this.dropdownEl.addEventListener('click', this.handleDropdownClick.bind(this));
    this.shadow.appendChild(this.dropdownEl);

    // Listen for keydown on the host element so we catch keyboard events
    // from both the pill button and dropdown items, which bubble through
    // the shadow DOM to the host (keyboard events are composed: true).
    this.host.addEventListener('keydown', this.handleDropdownKeyDown.bind(this));

    document.addEventListener('click', this.boundDocumentClick, true);

    // Always use fixed positioning with left/top (never right/bottom)
    this.host.style.position = 'fixed';
    this.host.style.left = 'auto';
    this.host.style.top = 'auto';
    this.host.style.right = 'auto';
    this.host.style.bottom = 'auto';
    this.host.style.zIndex = String(Z_INDEX.pill);
    this.host.style.pointerEvents = 'auto';

    this.host.style.width = `${PILL_SIZE}px`;
    this.host.style.height = `${PILL_SIZE}px`;

    // Restore saved position from localStorage, clamped to viewport
    this.restorePosition();

    // Pointer events for drag (with deadzone) and click
    this.pillEl.addEventListener('pointerdown', this.handlePointerDown.bind(this));
    // Synthetic click fallback (for Playwright and programmatic clicks)
    this.pillEl.addEventListener('click', this.handlePillClick.bind(this));

    container.appendChild(this.host);

    // Load saved gesture mode state
    const savedGestureMode = localStorage.getItem('nova-gesture-mode') === 'true';
    this.setGestureModeActive(savedGestureMode);
  }

  // ── unmount ───────────────────────────────────────────────────

  unmount(): void {
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);
    document.removeEventListener('click', this.boundDocumentClick, true);
    // Release pointer capture if active
    if (this.activePointerId >= 0 && this.pillEl?.hasPointerCapture?.(this.activePointerId)) {
      this.pillEl.releasePointerCapture(this.activePointerId);
    }
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.pillEl = null;
    this.dropdownEl = null;
  }

  // ── State ─────────────────────────────────────────────────────

  setState(state: PillState): void {
    this.currentState = state;
    if (!this.pillEl) return;
    this.pillEl.className = `nova-pill ${state}`;
    this.host?.setAttribute('data-state', state);
  }

  // ── Callbacks ─────────────────────────────────────────────────

  onQuickEdit(handler: () => void): void {
    this.quickEditHandler = handler;
  }

  onMultiEdit(handler: () => void): void {
    this.multiEditHandler = handler;
  }

  onGestureMode(handler: () => void): void {
    this.gestureModeHandler = handler;
  }

  onRecentTasks(handler: () => void): void {
    this.recentTasksHandler = handler;
  }

  onActivityLog(handler: () => void): void {
    this.activityLogHandler = handler;
  }

  // ── Gesture mode visual ───────────────────────────────────────

  setGestureModeActive(active: boolean): void {
    this.gestureModeActive = active;
    if (!this.dropdownEl) return;
    const toggle = this.dropdownEl.querySelector('.gesture-toggle .toggle-indicator');
    if (toggle) {
      if (active) {
        toggle.classList.add('on');
      } else {
        toggle.classList.remove('on');
      }
    }
  }

  setActiveMode(mode: 'none' | 'quickEdit' | 'multiEdit'): void {
    this.activeMode = mode;
    if (!this.dropdownEl) return;
    const items = this.dropdownEl.querySelectorAll('.dropdown-item');
    items.forEach((item) => {
      const el = item as HTMLElement;
      if (el.dataset.mode === mode) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });
  }

  // ── Dropdown logic ────────────────────────────────────────────

  private toggleDropdown(): void {
    this.dropdownVisible = !this.dropdownVisible;
    if (!this.dropdownEl || !this.host || !this.pillEl) return;

    if (this.dropdownVisible) {
      this.pillEl.setAttribute('aria-expanded', 'true');
      this.positionDropdown();
      this.dropdownEl.classList.remove('hidden');
    } else {
      this.pillEl.setAttribute('aria-expanded', 'false');
      this.dropdownEl.classList.add('hidden');
    }
  }

  private closeDropdown(): void {
    this.dropdownVisible = false;
    if (this.pillEl) {
      this.pillEl.setAttribute('aria-expanded', 'false');
    }
    this.dropdownEl?.classList.add('hidden');
  }

  /**
   * Position the dropdown above or below the pill depending on
   * available viewport space.
   */
  private positionDropdown(): void {
    if (!this.dropdownEl || !this.host) return;

    const pillRect = this.host.getBoundingClientRect();
    const pillTop = pillRect.top;
    const pillBottom = pillRect.bottom;
    const windowHeight = window.innerHeight;

    // Estimate dropdown height (use a safe minimum of 200px)
    const dropdownEstHeight = Math.max(this.dropdownEl.scrollHeight || 200, 200);
    const gap = 8;

    const spaceAbove = pillTop;
    // Used conceptually: if spaceAbove < dropdownEstHeight + gap, flip below

    // Reset any inline overrides
    this.dropdownEl.style.bottom = '';
    this.dropdownEl.style.top = '';

    if (spaceAbove >= dropdownEstHeight + gap) {
      // Enough space above → position above the pill
      this.dropdownEl.style.bottom = `${windowHeight - pillTop + gap}px`;
    } else {
      // Not enough space above → position below the pill
      this.dropdownEl.style.top = `${pillBottom + gap}px`;
    }
  }

  // ── Dropdown click handler ────────────────────────────────────

  private handleDropdownClick(e: MouseEvent): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>('.dropdown-item');
    if (!target) return;
    e.stopPropagation();
    this.activateDropdownItem(target);
  }

  /** Activate a dropdown item by its DOM element. */
  private activateDropdownItem(target: HTMLElement): void {
    const mode = target.dataset.mode;
    if (mode === 'quickEdit') {
      this.quickEditHandler?.();
    } else if (mode === 'multiEdit') {
      this.multiEditHandler?.();
    } else if (mode === 'projectMap') {
      window.open('/nova-project-map', '_blank');
    } else if (mode === 'activityLog') {
      this.activityLogHandler?.();
    } else if (mode === 'recentTasks') {
      this.recentTasksHandler?.();
    } else if (mode === 'gestureMode') {
      this.gestureModeHandler?.();
    }
    this.closeDropdown();
  }

  // ── Dropdown keyboard handler ─────────────────────────────────

  private handleDropdownKeyDown(e: Event): void {
    const ke = e as KeyboardEvent;
    if (!this.dropdownVisible || !this.dropdownEl) return;

    const items = this.getDropdownItems();
    if (items.length === 0) return;

    if (ke.key === 'ArrowDown' || ke.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      this.navigateDropdown(items, ke.key === 'ArrowDown');
      return;
    }

    if (ke.key === 'Enter' || ke.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      const focused = this.getFocusedDropdownItem(items);
      if (focused) {
        this.activateDropdownItem(focused);
      }
      return;
    }

    if (ke.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.closeDropdown();
      // Return focus to the pill button
      this.pillEl?.focus();
      return;
    }

    if (ke.key === 'Tab') {
      // Close dropdown and let Tab proceed naturally
      this.closeDropdown();
      // pillEl is a button with no explicit tabindex, so it's naturally
      // in the tab order.  Closing the dropdown and letting the event
      // bubble lets the browser move focus to the next element after
      // the pill in the document tab order.
      return;
    }
  }

  /** Get all focusable dropdown item elements. */
  private getDropdownItems(): HTMLElement[] {
    if (!this.dropdownEl) return [];
    return Array.from(this.dropdownEl.querySelectorAll('.dropdown-item'));
  }

  /** Get the currently focused dropdown item, or null if none is focused. */
  private getFocusedDropdownItem(items: HTMLElement[]): HTMLElement | null {
    const active = this.shadow?.activeElement as HTMLElement | null;
    if (active && items.includes(active)) return active;
    return null;
  }

  /** Navigate up or down through dropdown items, wrapping at edges. */
  private navigateDropdown(items: HTMLElement[], down: boolean): void {
    const current = this.getFocusedDropdownItem(items);
    const idx = current ? items.indexOf(current) : -1;

    let nextIdx: number;
    if (down) {
      nextIdx = idx < 0 ? 0 : idx + 1 >= items.length ? 0 : idx + 1;
    } else {
      nextIdx = idx < 0 ? items.length - 1 : idx - 1 < 0 ? items.length - 1 : idx - 1;
    }

    items[nextIdx]?.focus();
  }

  // ── Document click to close dropdown ──────────────────────────

  private handleDocumentClick(e: MouseEvent): void {
    if (!this.dropdownVisible || !this.host) return;
    const path = e.composedPath();
    if (!path.includes(this.host)) {
      this.closeDropdown();
    }
  }

  // ── Pointer event handlers (drag + click via deadzone) ─────────

  private handlePointerDown(e: PointerEvent): void {
    if (!this.host || !this.pillEl) return;
    if (e.button !== 0) return; // Only left button

    this.dragging = true;
    this.hasMoved = false;
    this.dragDist = 0;
    this.activePointerId = e.pointerId;

    const rect = this.host.getBoundingClientRect();
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragOffsetX = e.clientX - rect.left;
    this.dragOffsetY = e.clientY - rect.top;

    // Capture pointer so we get events even if the pointer leaves the element
    try {
      this.pillEl.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture may not be available in some jsdom versions
    }

    document.addEventListener('pointermove', this.boundPointerMove);
    document.addEventListener('pointerup', this.boundPointerUp);
    // Prevent the subsequent click event — we handle toggle in pointerup
    e.preventDefault();
    e.stopPropagation();
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.dragging || !this.host) return;

    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;
    this.dragDist = Math.hypot(dx, dy);

    if (this.dragDist > DRAG_DEADZONE) {
      this.hasMoved = true;
    }

    if (this.hasMoved) {
      const x = Math.max(0, Math.min(e.clientX - this.dragOffsetX, window.innerWidth - PILL_SIZE));
      const y = Math.max(0, Math.min(e.clientY - this.dragOffsetY, window.innerHeight - PILL_SIZE));

      this.host.style.left = `${x}px`;
      this.host.style.top = `${y}px`;
      this.host.style.right = 'auto';
      this.host.style.bottom = 'auto';
    }
  }

  private handlePointerUp(): void {
    if (!this.dragging || !this.host || !this.pillEl) return;
    this.dragging = false;

    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);

    // Release pointer capture
    try {
      if (this.activePointerId >= 0 && this.pillEl.hasPointerCapture?.(this.activePointerId)) {
        this.pillEl.releasePointerCapture(this.activePointerId);
      }
    } catch {
      // Ignore
    }
    this.activePointerId = -1;

    if (this.hasMoved) {
      // Drag completed — save position
      const rect = this.host.getBoundingClientRect();
      localStorage.setItem(STORAGE_KEY_X, String(Math.round(rect.left)));
      localStorage.setItem(STORAGE_KEY_Y, String(Math.round(rect.top)));
      this.hasMoved = false;
      this.dragCompleted = true;
    } else {
      // No drag (within deadzone) — treat as a click → toggle dropdown
      this.hasMoved = false;
      this.toggledViaPointer = true;
      this.toggleDropdown();
    }
  }

  /** Handles synthetic click events (e.g., from Playwright or programmatic clicks). */
  private handlePillClick(): void {
    // If already handled by pointer events (toggle or drag), suppress this click.
    if (this.toggledViaPointer) {
      this.toggledViaPointer = false;
      return;
    }
    if (this.dragCompleted) {
      this.dragCompleted = false;
      return;
    }
    this.toggleDropdown();
  }

  // ── Position restore ──────────────────────────────────────────

  private restorePosition(): void {
    if (!this.host) return;

    let x: number | null = null;
    let y: number | null = null;

    try {
      const sx = localStorage.getItem(STORAGE_KEY_X);
      const sy = localStorage.getItem(STORAGE_KEY_Y);
      if (sx !== null) x = parseFloat(sx);
      if (sy !== null) y = parseFloat(sy);
    } catch {
      // localStorage unavailable
    }

    if (x === null || y === null || isNaN(x) || isNaN(y)) {
      // Default: bottom-right area of viewport
      x = window.innerWidth - PILL_SIZE - 20;
      y = window.innerHeight - PILL_SIZE - 80;
    }

    // Clamp to viewport
    const clampedX = Math.max(0, Math.min(window.innerWidth - PILL_SIZE, x));
    const clampedY = Math.max(0, Math.min(window.innerHeight - PILL_SIZE, y));

    this.host.style.left = `${clampedX}px`;
    this.host.style.top = `${clampedY}px`;
    this.host.style.right = 'auto';
    this.host.style.bottom = 'auto';
  }

  // ── HTML builders ─────────────────────────────────────────────

  private buildDropdownHtml(): string {
    const alt = shortcutGlyph('I');
    const altK = shortcutGlyph('K');
    const altM = shortcutGlyph('M');
    const altG = shortcutGlyph('G');

    return `
      <button class="dropdown-item" data-mode="quickEdit">
        <span class="dropdown-icon">&#127919;</span> ${strings.quickEditLabel} <span class="shortcut">${alt}</span>
      </button>
      <button class="dropdown-item" data-mode="multiEdit">
        <span class="dropdown-icon">&#128204;</span> ${strings.multiEditLabel} <span class="shortcut">${altK}</span>
      </button>
      <button class="dropdown-item" data-mode="projectMap">
        <span class="dropdown-icon">&#128506;</span> ${strings.projectMapLabel} <span class="shortcut">${altM}</span>
      </button>
      <button class="dropdown-item" data-mode="activityLog">
        <span class="dropdown-icon">&#128203;</span> ${strings.activityLogPillLabel}
      </button>
      <button class="dropdown-item" data-mode="recentTasks">
        <span class="dropdown-icon">&#128337;</span> ${strings.recentTasksLabel}
      </button>
      <div class="dropdown-divider"></div>
      <button class="dropdown-item gesture-toggle" data-mode="gestureMode">
        <span class="dropdown-icon">&#9757;</span> ${strings.gestureModeLabel} <span class="shortcut">${altG}</span>
        <span class="toggle-indicator"></span>
      </button>
    `;
  }

  private getIcon(): string {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>`;
  }

  private getStyleSheet(): string {
    return `
      .nova-pill {
        width: ${PILL_SIZE}px;
        height: ${PILL_SIZE}px;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: ${COLORS.white};
        transition: ${TRANSITION};
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        outline: none;
        user-select: none;
        touch-action: none;
      }
      .nova-pill:hover {
        transform: scale(1.1);
      }
      .nova-pill.idle {
        background: ${COLORS.idle};
      }
      .nova-pill.listening {
        background: ${COLORS.listening};
        animation: pulse 1.5s ease-in-out infinite;
      }
      .nova-pill.processing {
        background: ${COLORS.processing};
        animation: spin 1.2s linear infinite;
      }
      .nova-pill.error {
        background: ${COLORS.error};
      }
      @media (prefers-reduced-motion: no-preference) {
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
          50% { box-shadow: 0 0 0 12px rgba(16, 185, 129, 0); }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      }
      .pill-dropdown {
        position: fixed;
        right: 20px;
        background: var(--nova-dropdown-bg);
        border-radius: 10px;
        border: 1px solid var(--nova-panel-border);
        box-shadow: 0 8px 32px var(--nova-pill-shadow);
        overflow: hidden;
        min-width: 180px;
        pointer-events: auto;
        z-index: ${Z_INDEX.pill};
      }
      .pill-dropdown.hidden { display: none; }
      .dropdown-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        width: 100%;
        border: none;
        background: transparent;
        color: var(--nova-text-primary);
        font-size: 13px;
        cursor: pointer;
        text-align: left;
        border-left: 3px solid transparent;
        transition: all 0.15s;
      }
      .dropdown-item:hover { background: var(--nova-dropdown-hover); }
      .dropdown-item.active { border-left-color: var(--nova-accent); background: var(--nova-dropdown-hover); }
      .shortcut { margin-left: auto; color: var(--nova-text-secondary); font-size: 11px; }
      .dropdown-divider {
        height: 1px;
        background: var(--nova-panel-border);
        margin: 4px 0;
      }
      .toggle-indicator {
        width: 28px;
        height: 16px;
        border-radius: 8px;
        background: var(--nova-text-secondary);
        position: relative;
        display: inline-block;
        margin-left: 8px;
        transition: background 0.2s;
        flex-shrink: 0;
      }
      .toggle-indicator::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #fff;
        transition: transform 0.2s;
      }
      .toggle-indicator.on {
        background: var(--nova-success);
      }
      .toggle-indicator.on::after {
        transform: translateX(12px);
      }
    `;
  }
}
