export interface IOverlayPill {
  /**
   * Renders the floating pill in bottom-right corner.
   * Uses shadow DOM for style isolation from host app.
   *
   * States: idle (gray), listening (green pulse), processing (blue spin), error (red)
   * Draggable — remembers position in localStorage.
   * Click → calls onActivate callback.
   */
  mount(container: HTMLElement): void;
  unmount(): void;
  setState(state: 'idle' | 'listening' | 'processing' | 'error'): void;
  onActivate(handler: () => void): void;
}

export interface ICommandInput {
  /**
   * Text input panel for typing commands.
   * Shows below/above the pill depending on screen position.
   *
   * Enter → submit (calls onSubmit), Escape → close (calls onClose).
   * Arrow Up/Down → cycle through command history (stored in localStorage, max 50).
   * Can display interim voice transcription text.
   */
  show(anchorElement: HTMLElement): void;
  hide(): void;
  isVisible(): boolean;
  setTranscript(text: string): void;
  onSubmit(handler: (text: string) => void): void;
  onClose(handler: () => void): void;
}

export interface IElementSelector {
  /**
   * Enables element selection mode.
   * Hover → highlights element with outline (2px solid blue).
   * Click → selects element, calls onSelect with the element.
   * Escape → cancels mode, calls onCancel.
   *
   * Must NOT interfere with normal page interaction when not active.
   * Must prevent default click behavior when active (stopPropagation + preventDefault).
   */
  activate(): void;
  deactivate(): void;
  isActive(): boolean;
  onSelect(handler: (element: HTMLElement) => void): void;
  onCancel(handler: () => void): void;
}

export interface IStatusToast {
  /**
   * Shows a toast notification.
   *
   * Types: 'info' (blue), 'success' (green), 'error' (red)
   * Position: top-right, stacks vertically.
   * Auto-dismiss after 5s (configurable). Errors don't auto-dismiss.
   * Click on toast → calls onClick handler with toast id.
   * Max 5 visible toasts. Oldest dismissed when limit exceeded.
   */
  show(message: string, type: 'info' | 'success' | 'error', durationMs?: number): string;  // returns toast id
  dismiss(id: string): void;
  dismissAll(): void;
  onClick(handler: (id: string) => void): void;
}

export interface ITranscriptBar {
  mount(container: HTMLElement): void;
  unmount(): void;
  setTranscript(text: string, isFinal: boolean): void;
  setListening(active: boolean): void;
}
