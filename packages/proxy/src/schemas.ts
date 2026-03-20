import { z } from 'zod';

const ConfirmMessageSchema = z.object({ type: z.literal('confirm') });
const CancelMessageSchema = z.object({ type: z.literal('cancel') });
const AppendMessageSchema = z.object({
  type: z.literal('append'),
  data: z.object({ text: z.string().default('') }),
});
const BrowserErrorMessageSchema = z.object({
  type: z.literal('browser_error'),
  data: z.object({ error: z.string().default('') }),
});
const SecretsSubmitMessageSchema = z.object({
  type: z.literal('secrets_submit'),
  data: z.object({ secrets: z.record(z.string()) }),
});
const ObservationMessageSchema = z.object({
  type: z.literal('observation'),
  data: z.object({
    screenshotBase64: z.string().optional(),
    screenshot: z.any().optional(),
    clickCoords: z.object({ x: z.number(), y: z.number() }).optional(),
    domSnapshot: z.string().optional(),
    transcript: z.string().optional(),
    currentUrl: z.string().default(''),
    consoleErrors: z.array(z.string()).optional(),
    timestamp: z.number().default(Date.now()),
    gestureContext: z.any().optional(),
    autoExecute: z.boolean().optional(),
  }),
});

export const WsMessageSchema = z.discriminatedUnion('type', [
  ConfirmMessageSchema,
  CancelMessageSchema,
  AppendMessageSchema,
  BrowserErrorMessageSchema,
  SecretsSubmitMessageSchema,
  ObservationMessageSchema,
]);

export type WsMessage = z.infer<typeof WsMessageSchema>;
