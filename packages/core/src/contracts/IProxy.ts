import type { Observation } from '../models/types.js';
import type { NovaEvent } from '../models/events.js';

export interface IProxyServer {
  /**
   * Starts HTTP proxy server.
   *
   * - Proxies all HTTP requests from proxyPort to targetPort
   * - For HTML responses: injects <script src="/nova-overlay.js"></script> before </body>
   * - Serves /nova-overlay.js from the given overlayScriptPath
   * - Strips Content-Security-Policy headers (for dev mode)
   * - Does NOT modify non-HTML responses (JSON, CSS, JS, images)
   *
   * @param targetPort - the dev server port (e.g. 3000)
   * @param proxyPort - the port to listen on (e.g. 3001)
   * @param overlayScriptPath - absolute path to nova-overlay.js bundle
   *
   * @throws if proxyPort is already in use
   */
  start(targetPort: number, proxyPort: number, overlayScriptPath: string): Promise<void>;

  /** Stops the proxy server. */
  stop(): Promise<void>;

  /** Returns true if proxy is running. */
  isRunning(): boolean;
}

export interface IWebSocketServer {
  /**
   * Starts WebSocket server on the given HTTP server.
   * Endpoint: ws://localhost:{port}/nova-ws
   *
   * Receives Observation objects from overlay.
   * Sends NovaEvent objects to overlay.
   */
  start(httpServer: any): void;

  /** Register handler for incoming observations. */
  onObservation(handler: (observation: Observation) => void): void;

  /** Send event to all connected overlay clients. */
  sendEvent(event: NovaEvent): void;

  /** Returns number of connected clients. */
  getClientCount(): number;
}

export interface IDevServerRunner {
  /**
   * Spawns the dev server as a child process.
   *
   * - Captures stdout/stderr
   * - Health-checks by polling http://localhost:{port} every 500ms
   * - Calls onReady when first successful response (max wait: 30s)
   * - Calls onError if process exits unexpectedly
   *
   * @param command - shell command to run (e.g. "npm run dev")
   * @param cwd - working directory
   * @param port - expected port, used for health check
   */
  spawn(command: string, cwd: string, port: number): Promise<void>;

  /** Register callback for when server is ready (health check passes). */
  onReady(handler: () => void): void;

  /** Register callback for when server crashes or exits. */
  onError(handler: (error: string) => void): void;

  /** Returns captured stdout + stderr as string. */
  getLogs(): string;

  /** Gracefully kills the dev server process (SIGTERM, then SIGKILL after 5s). */
  kill(): Promise<void>;

  /** Register callback for dev server stdout/stderr output. */
  onOutput(handler: (output: string) => void): void;

  /** Returns true if process is running. */
  isRunning(): boolean;
}
