import type { ICursorTracker, CursorPoint, IDomCapture } from '../contracts/ICapture.js';
import type { Gesture, GestureElement } from './GestureTypes.js';
import { buildGestureElement } from './gestureUtils.js';

const CIRCLE_MIN_POINTS = 15;
const CIRCLE_MIN_DURATION_MS = 500;
const CIRCLE_RADIUS_STD_THRESHOLD = 0.3;
const CIRCLE_MIN_ANGLE = 315 * (Math.PI / 180); // 315 degrees in radians
const PATH_MIN_DISTANCE = 100;
const PATH_MAX_DURATION_MS = 5000;
const DWELL_RADIUS = 20;
const DWELL_MIN_DURATION_MS = 500;
const MAX_GESTURES = 3;

interface DwellRecord {
  element: Element;
  point: CursorPoint;
  startTime: number;
  endTime: number;
}

export class GestureRecognizer {
  private tracker: ICursorTracker;
  private domCapture: IDomCapture;
  private dwellRecords: DwellRecord[] = [];

  constructor(tracker: ICursorTracker, domCapture: IDomCapture) {
    this.tracker = tracker;
    this.domCapture = domCapture;

    // Listen for dwell events from tracker
    this.tracker.onDwell((element, point) => {
      this.dwellRecords.push({
        element,
        point,
        startTime: point.timestamp - DWELL_MIN_DURATION_MS,
        endTime: point.timestamp,
      });

      // Keep only last 10 dwells
      if (this.dwellRecords.length > 10) {
        this.dwellRecords.shift();
      }
    });
  }

  recognize(): Gesture[] {
    const gestures: Gesture[] = [];
    const trail = this.tracker.getTrail();

    // Detect circle gestures
    const circleGesture = this.detectCircle(trail);
    if (circleGesture) {
      gestures.push(circleGesture);
    }

    // Detect path gestures (A -> B via two dwells)
    const pathGestures = this.detectPaths();
    for (const pg of pathGestures) {
      if (gestures.length < MAX_GESTURES) {
        gestures.push(pg);
      }
    }

    // Detect dwell gestures
    const dwellGestures = this.detectDwells();
    for (const dg of dwellGestures) {
      if (gestures.length < MAX_GESTURES) {
        gestures.push(dg);
      }
    }

    // Sort by endTime descending, take most recent
    gestures.sort((a, b) => b.endTime - a.endTime);
    return gestures.slice(0, MAX_GESTURES);
  }

  clear(): void {
    this.dwellRecords = [];
  }

  private detectCircle(trail: CursorPoint[]): Gesture | null {
    if (trail.length < CIRCLE_MIN_POINTS) return null;

    // Check the last segment of points
    const candidates = trail.slice(-Math.max(CIRCLE_MIN_POINTS, Math.min(trail.length, 60)));
    const duration = candidates[candidates.length - 1]!.timestamp - candidates[0]!.timestamp;
    if (duration < CIRCLE_MIN_DURATION_MS) return null;

    // Compute centroid
    let cx = 0;
    let cy = 0;
    for (const p of candidates) {
      cx += p.x;
      cy += p.y;
    }
    cx /= candidates.length;
    cy /= candidates.length;

    // Compute mean radius and std deviation
    const radii: number[] = [];
    for (const p of candidates) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      radii.push(Math.sqrt(dx * dx + dy * dy));
    }

    const meanRadius = radii.reduce((a, b) => a + b, 0) / radii.length;
    if (meanRadius < 10) return null; // Too small

    const variance = radii.reduce((sum, r) => sum + (r - meanRadius) ** 2, 0) / radii.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev / meanRadius > CIRCLE_RADIUS_STD_THRESHOLD) return null;

    // Compute total angular traversal
    let totalAngle = 0;
    for (let i = 1; i < candidates.length; i++) {
      const angle1 = Math.atan2(candidates[i - 1]!.y - cy, candidates[i - 1]!.x - cx);
      const angle2 = Math.atan2(candidates[i]!.y - cy, candidates[i]!.x - cx);
      let delta = angle2 - angle1;
      // Normalize to [-PI, PI]
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      totalAngle += Math.abs(delta);
    }

    if (totalAngle < CIRCLE_MIN_ANGLE) return null;

    // Build region bounding box
    const xs = candidates.map((p) => p.x);
    const ys = candidates.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // Element at centroid
    const element = this.tracker.getElementAtTime(
      candidates[Math.floor(candidates.length / 2)]!.timestamp,
    );

    const elements: GestureElement[] = [];
    if (element) {
      elements.push(buildGestureElement(element, 'encircled', this.domCapture));
    }

    return {
      type: 'circle',
      startTime: candidates[0]!.timestamp,
      endTime: candidates[candidates.length - 1]!.timestamp,
      elements,
      region: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      },
    };
  }

  private detectPaths(): Gesture[] {
    const gestures: Gesture[] = [];
    const records = this.dwellRecords;

    for (let i = 0; i < records.length - 1; i++) {
      const a = records[i]!;
      const b = records[i + 1]!;

      const timeDiff = b.startTime - a.endTime;
      if (timeDiff > PATH_MAX_DURATION_MS || timeDiff < 0) continue;

      const dx = b.point.x - a.point.x;
      const dy = b.point.y - a.point.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < PATH_MIN_DISTANCE) continue;

      const elements: GestureElement[] = [
        buildGestureElement(a.element, 'source', this.domCapture),
        buildGestureElement(b.element, 'target', this.domCapture),
      ];

      gestures.push({
        type: 'path',
        startTime: a.startTime,
        endTime: b.endTime,
        elements,
      });
    }

    return gestures;
  }

  private detectDwells(): Gesture[] {
    return this.dwellRecords.map((record) => ({
      type: 'dwell' as const,
      startTime: record.startTime,
      endTime: record.endTime,
      elements: [buildGestureElement(record.element, 'source', this.domCapture)],
    }));
  }
}
