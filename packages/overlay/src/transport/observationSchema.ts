import { z } from 'zod';
import type { BrowserObservation } from './WebSocketClient.js';

export const BrowserObservationSchema = z.object({
  screenshotBase64: z.string(),
  clickCoords: z.object({ x: z.number(), y: z.number() }).optional(),
  domSnapshot: z.string().optional(),
  transcript: z.string().optional(),
  currentUrl: z.string(),
  consoleErrors: z.array(z.string()).optional(),
  timestamp: z.number(),
  gestureContext: z.object({
    gestures: z.array(z.object({
      type: z.string(),
      startTime: z.number(),
      endTime: z.number(),
      elements: z.array(z.object({
        tagName: z.string(),
        selector: z.string(),
        domSnippet: z.string(),
        role: z.string(),
      })),
      region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
    })),
    summary: z.string(),
  }).optional(),
  selectedArea: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    screenshotBase64: z.string().optional(),
  }).optional(),
}) satisfies z.ZodType<BrowserObservation>;
