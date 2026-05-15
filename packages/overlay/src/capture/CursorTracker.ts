import type { ICursorTracker, CursorPoint } from '../contracts/ICapture.js';

const MAX_BUFFER_SIZE = 500;
const DWELL_RADIUS = 20;
const DWELL_TIMEOUT_MS = 500;
const FRAME_SKIP = 4; // Sample every 4th frame (~64ms at 60fps)

export class CursorTracker implements ICursorTracker {
  private buffer: CursorPoint[] = [];
  private elementCache: Map<number, Element | null> = new Map();
  private tracking = false;
  private frameCount = 0;
  private lastX = -1;
  private lastY = -1;
  private dwellHandlers: Array<(element: Element, point: CursorPoint) => void> = [];
  private dwellTimer: ReturnType<typeof setTimeout> | null = null;
  private dwellAnchor: CursorPoint | null = null;
  private dwellFired = false;
  private rafId: number | null = null;

  private readonly boundMouseMove = this.handleMouseMove.bind(this);

  start(): void {
    if (this.tracking) return;
    this.tracking = true;
    this.frameCount = 0;
    document.addEventListener('mousemove', this.boundMouseMove, { passive: true });
  }

  stop(): void {
    if (!this.tracking) return;
    this.tracking = false;
    document.removeEventListener('mousemove', this.boundMouseMove);
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.clearDwellTimer();
  }

  isTracking(): boolean {
    return this.tracking;
  }

  getTrail(): CursorPoint[] {
    return this.buffer.slice();
  }

  getPointAtTime(ts: number): CursorPoint | null {
    if (this.buffer.length === 0) return null;

    // Binary search for nearest timestamp
    let lo = 0;
    let hi = this.buffer.length - 1;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.buffer[mid]!.timestamp < ts) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    // Check lo and lo-1 for closest match
    if (lo > 0) {
      const diffLo = Math.abs(this.buffer[lo]!.timestamp - ts);
      const diffPrev = Math.abs(this.buffer[lo - 1]!.timestamp - ts);
      if (diffPrev < diffLo) return this.buffer[lo - 1] ?? null;
    }

    return this.buffer[lo] ?? null;
  }

  getElementAtTime(ts: number): Element | null {
    const point = this.getPointAtTime(ts);
    if (!point) return null;

    const cached = this.elementCache.get(point.timestamp);
    if (cached !== undefined) return cached;

    const el = this.elementFromPointFiltered(point.x, point.y);
    this.elementCache.set(point.timestamp, el);
    return el;
  }

  onDwell(handler: (element: Element, point: CursorPoint) => void): void {
    this.dwellHandlers.push(handler);
  }

  clear(): void {
    this.buffer = [];
    this.elementCache.clear();
    this.clearDwellTimer();
    this.dwellAnchor = null;
    this.dwellFired = false;
  }

  private handleMouseMove(e: MouseEvent): void {
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    if (this.rafId !== null) return;

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.frameCount++;

      if (this.frameCount % FRAME_SKIP !== 0) return;

      const point: CursorPoint = {
        x: this.lastX,
        y: this.lastY,
        timestamp: Date.now(),
      };

      // Add to buffer
      this.buffer.push(point);
      if (this.buffer.length > MAX_BUFFER_SIZE) {
        const removed = this.buffer.shift()!;
        this.elementCache.delete(removed.timestamp);
      }

      // Cache element
      const el = this.elementFromPointFiltered(point.x, point.y);
      this.elementCache.set(point.timestamp, el);

      // Dwell detection
      this.checkDwell(point);
    });
  }

  private checkDwell(point: CursorPoint): void {
    if (!this.dwellAnchor) {
      this.dwellAnchor = point;
      this.dwellFired = false;
      this.startDwellTimer();
      return;
    }

    const dx = point.x - this.dwellAnchor.x;
    const dy = point.y - this.dwellAnchor.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > DWELL_RADIUS) {
      // Moved outside dwell radius — reset anchor
      this.dwellAnchor = point;
      this.dwellFired = false;
      this.clearDwellTimer();
      this.startDwellTimer();
    }
  }

  private startDwellTimer(): void {
    this.clearDwellTimer();
    this.dwellTimer = setTimeout(() => {
      if (!this.dwellAnchor || this.dwellFired) return;

      const el = this.elementFromPointFiltered(this.dwellAnchor.x, this.dwellAnchor.y);
      if (el) {
        this.dwellFired = true;
        for (const handler of this.dwellHandlers) {
          handler(el, this.dwellAnchor);
        }
      }
    }, DWELL_TIMEOUT_MS);
  }

  private clearDwellTimer(): void {
    if (this.dwellTimer !== null) {
      clearTimeout(this.dwellTimer);
      this.dwellTimer = null;
    }
  }

  private elementFromPointFiltered(x: number, y: number): Element | null {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;

    // Ignore elements inside #nova-root (overlay)
    if (el.closest('#nova-root')) return null;

    return el;
  }
}
