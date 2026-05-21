/**
 * Layout slot manager for the nova overlay.
 *
 * Manages stacked bottom-left panels: ActivityLog (bottom-most),
 * SuggestionPanel (above), TaskPanel (top-most). Maintains an 8 px
 * gap between panels and recalculates positions when panel heights
 * change via ResizeObserver.
 */

export interface SlotConfig {
  /** The element whose position this manager controls. */
  element: HTMLElement;
}

/**
 * Ordered list of slot names from bottom (closest to viewport edge)
 * to top (farthest from viewport edge).
 */
const SLOT_ORDER_BOTTOM_UP: readonly string[] = ['activityLog', 'suggestionPanel', 'taskPanel', 'missionPanel'];

export const LAYOUT_GAP_PX = 8;
export const LAYOUT_LEFT_PX = 20;
export const LAYOUT_BOTTOM_PX = 20;

export class LayoutSlots {
  private slots = new Map<string, SlotConfig>();
  private observer: ResizeObserver | null = null;
  private gap: number;
  private baseLeft: number;
  private baseBottom: number;
  private rafHandle: number | null = null;

  constructor(opts?: { gap?: number; left?: number; bottom?: number }) {
    this.gap = opts?.gap ?? LAYOUT_GAP_PX;
    this.baseLeft = opts?.left ?? LAYOUT_LEFT_PX;
    this.baseBottom = opts?.bottom ?? LAYOUT_BOTTOM_PX;
  }

  /**
   * Register a panel element in a named slot.
   * The element will be positioned automatically in the bottom-left stack.
   */
  register(name: string, element: HTMLElement): void {
    this.slots.set(name, { element });
    element.setAttribute('data-slot', name);
    element.style.position = 'fixed';
    element.style.left = `${this.baseLeft}px`;
    element.style.top = 'auto';
    element.style.right = 'auto';
    // Clear any default bottom set by the component — LayoutSlots is
    // the sole positioning authority.
    element.style.bottom = '';
    this.ensureObserver();
    this.observer!.observe(element);
    // Apply positions immediately so panels don't overlap during the first frame.
    this.applyPositions();
  }

  /**
   * Unregister a slot (e.g. on unmount).
   */
  unregister(name: string): void {
    const slot = this.slots.get(name);
    if (slot && this.observer) {
      this.observer.unobserve(slot.element);
    }
    this.slots.delete(name);
    this.scheduleRecalc();
  }

  /**
   * Force an immediate recalculation of all slot positions.
   * Useful after manually toggling visibility.
   */
  recalc(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.applyPositions();
  }

  destroy(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.slots.clear();
  }

  // ── private ──────────────────────────────────────────────

  private ensureObserver(): void {
    if (this.observer) return;
    this.observer = new ResizeObserver((entries) => {
      let needsRecalc = false;
      for (const entry of entries) {
        const name = (entry.target as HTMLElement).getAttribute('data-slot');
        if (name && this.slots.has(name)) {
          needsRecalc = true;
          break;
        }
      }
      if (needsRecalc) {
        this.scheduleRecalc();
      }
    });
  }

  private scheduleRecalc(): void {
    if (this.rafHandle !== null) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.applyPositions();
    });
  }

  private applyPositions(): void {
    let nextBottom = this.baseBottom;

    for (const name of SLOT_ORDER_BOTTOM_UP) {
      const slot = this.slots.get(name);
      if (!slot) continue;

      const el = slot.element;

      // Skip hidden elements — they don't consume space.
      if (
        el.style.display === 'none' ||
        el.classList.contains('hidden') ||
        this.isPanelHidden(el)
      ) {
        continue;
      }

      // Determine height using the most reliable method available.
      // In jsdom getBoundingClientRect / offsetHeight return 0, so fall
      // back to inline style.height.
      const rect = el.getBoundingClientRect();
      let height = rect.height || el.offsetHeight || 0;
      if (height === 0 && el.style.height) {
        height = parseFloat(el.style.height) || 0;
      }

      el.style.bottom = `${nextBottom}px`;
      el.style.top = 'auto';
      el.style.right = 'auto';
      el.style.left = `${this.baseLeft}px`;

      if (height > 0) {
        nextBottom += height + this.gap;
      }
    }
  }

  /**
   * Check whether a panel's shadow-DOM panel element is hidden
   * (since the host element may still report dimensions even when
   * the inner panel is display:none).
   */
  private isPanelHidden(host: HTMLElement): boolean {
    const shadow = host.shadowRoot;
    if (!shadow) return host.offsetHeight === 0;

    // Look for the first visible child with a meaningful class.
    const panel = shadow.querySelector('.activity-panel, .suggestion-panel, .task-panel, .mission-panel');
    if (!panel) return false;

    if (panel.classList.contains('hidden') || (panel as HTMLElement).style.display === 'none') {
      return true;
    }

    return false;
  }
}

/** Singleton convenience — created by the compositor. */
let defaultLayout: LayoutSlots | null = null;

export function getLayoutSlots(): LayoutSlots {
  if (!defaultLayout) {
    defaultLayout = new LayoutSlots();
  }
  return defaultLayout;
}

export function createLayoutSlots(opts?: {
  gap?: number;
  left?: number;
  bottom?: number;
}): LayoutSlots {
  defaultLayout = new LayoutSlots(opts);
  return defaultLayout;
}
