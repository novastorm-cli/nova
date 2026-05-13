import type { IOverlayPill } from '../contracts/IOverlayUI.js';
import { strings } from './strings.js';
import { COLORS, PILL_SIZE, Z_INDEX, TRANSITION } from './styles.js';

const STORAGE_KEY_X = 'nova-pill-x';
const STORAGE_KEY_Y = 'nova-pill-y';

type PillState = 'idle' | 'listening' | 'processing' | 'error';

export class OverlayPill implements IOverlayPill {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private pillEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private dropdownVisible = false;
  private quickEditHandler: (() => void) | null = null;
  private multiEditHandler: (() => void) | null = null;
  private gestureModeHandler: (() => void) | null = null;
  private activeMode: 'none' | 'quickEdit' | 'multiEdit' = 'none';
  private gestureModeActive = false;
  private currentState: PillState = 'idle';

  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private hasMoved = false;

  private readonly boundMouseMove = this.handleMouseMove.bind(this);
  private readonly boundMouseUp = this.handleMouseUp.bind(this);
  private readonly boundDocumentClick = this.handleDocumentClick.bind(this);

  mount(container: HTMLElement): void {
    if (this.host) return;

    this.host = document.createElement('div');
    this.host.setAttribute('data-nova-pill', '');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyleSheet();
    this.shadow.appendChild(style);

    this.pillEl = document.createElement('button');
    this.pillEl.className = 'nova-pill idle';
    this.pillEl.setAttribute('aria-label', strings.pillAriaLabel);
    this.pillEl.innerHTML = this.getIcon();

    this.shadow.appendChild(this.pillEl);

    this.dropdownEl = document.createElement('div');
    this.dropdownEl.className = 'pill-dropdown hidden';
    this.dropdownEl.innerHTML = `
      <button class="dropdown-item" data-mode="quickEdit">
        <span class="dropdown-icon">&#127919;</span> ${strings.quickEditLabel} <span class="shortcut">&#x2325;I</span>
      </button>
      <button class="dropdown-item" data-mode="multiEdit">
        <span class="dropdown-icon">&#128204;</span> ${strings.multiEditLabel} <span class="shortcut">&#x2325;K</span>
      </button>
      <button class="dropdown-item" data-mode="projectMap">
        <span class="dropdown-icon">&#128506;</span> ${strings.projectMapLabel} <span class="shortcut">&#x2325;M</span>
      </button>
      <div class="dropdown-divider"></div>
      <button class="dropdown-item gesture-toggle" data-mode="gestureMode">
        <span class="dropdown-icon">&#9757;</span> ${strings.gestureModeLabel} <span class="shortcut">&#x2325;G</span>
        <span class="toggle-indicator"></span>
      </button>
    `;
    this.dropdownEl.addEventListener('click', this.handleDropdownClick.bind(this));
    this.shadow.appendChild(this.dropdownEl);

    document.addEventListener('click', this.boundDocumentClick, true);

    // Always position at bottom-right of viewport
    this.host.style.position = 'fixed';
    this.host.style.right = '20px';
    this.host.style.bottom = '80px'; // Above transcript bar
    this.host.style.left = 'auto';
    this.host.style.top = 'auto';
    this.host.style.zIndex = String(Z_INDEX.pill);
    this.host.style.pointerEvents = 'auto';

    this.pillEl.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.pillEl.addEventListener('click', this.handleClick.bind(this));

    container.appendChild(this.host);

    // Load saved gesture mode state
    const savedGestureMode = localStorage.getItem('nova-gesture-mode') === 'true';
    this.setGestureModeActive(savedGestureMode);
  }

  unmount(): void {
    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mouseup', this.boundMouseUp);
    document.removeEventListener('click', this.boundDocumentClick, true);
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.pillEl = null;
    this.dropdownEl = null;
  }

  setState(state: PillState): void {
    this.currentState = state;
    if (!this.pillEl) return;
    this.pillEl.className = `nova-pill ${state}`;
    this.host?.setAttribute('data-state', state);
  }

  onQuickEdit(handler: () => void): void {
    this.quickEditHandler = handler;
  }

  onMultiEdit(handler: () => void): void {
    this.multiEditHandler = handler;
  }

  onGestureMode(handler: () => void): void {
    this.gestureModeHandler = handler;
  }

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

  private handleClick(e: MouseEvent): void {
    if (this.hasMoved) {
      e.preventDefault();
      return;
    }
    this.toggleDropdown();
  }

  private toggleDropdown(): void {
    this.dropdownVisible = !this.dropdownVisible;
    if (!this.dropdownEl) return;
    if (this.dropdownVisible) {
      this.dropdownEl.classList.remove('hidden');
    } else {
      this.dropdownEl.classList.add('hidden');
    }
  }

  private closeDropdown(): void {
    this.dropdownVisible = false;
    this.dropdownEl?.classList.add('hidden');
  }

  private handleDropdownClick(e: MouseEvent): void {
    const target = (e.target as HTMLElement).closest('.dropdown-item') as HTMLElement | null;
    if (!target) return;
    e.stopPropagation();
    const mode = target.dataset.mode;
    if (mode === 'quickEdit') {
      this.quickEditHandler?.();
    } else if (mode === 'multiEdit') {
      this.multiEditHandler?.();
    } else if (mode === 'projectMap') {
      window.open('/nova-project-map', '_blank');
    } else if (mode === 'gestureMode') {
      this.gestureModeHandler?.();
    }
    this.closeDropdown();
  }

  private handleDocumentClick(e: MouseEvent): void {
    if (!this.dropdownVisible || !this.host) return;
    const path = e.composedPath();
    if (!path.includes(this.host)) {
      this.closeDropdown();
    }
  }

  private handleMouseDown(e: MouseEvent): void {
    if (!this.host) return;
    this.isDragging = true;
    this.hasMoved = false;

    const rect = this.host.getBoundingClientRect();
    this.dragOffsetX = e.clientX - rect.left;
    this.dragOffsetY = e.clientY - rect.top;

    document.addEventListener('mousemove', this.boundMouseMove);
    document.addEventListener('mouseup', this.boundMouseUp);
    e.preventDefault();
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isDragging || !this.host) return;
    this.hasMoved = true;

    const x = Math.max(0, Math.min(e.clientX - this.dragOffsetX, window.innerWidth - PILL_SIZE));
    const y = Math.max(0, Math.min(e.clientY - this.dragOffsetY, window.innerHeight - PILL_SIZE));

    this.host.style.left = `${x}px`;
    this.host.style.top = `${y}px`;
    this.host.style.right = 'auto';
    this.host.style.bottom = 'auto';
  }

  private handleMouseUp(): void {
    if (!this.isDragging || !this.host) return;
    this.isDragging = false;

    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mouseup', this.boundMouseUp);

    if (this.hasMoved) {
      const rect = this.host.getBoundingClientRect();
      localStorage.setItem(STORAGE_KEY_X, String(rect.left));
      localStorage.setItem(STORAGE_KEY_Y, String(rect.top));
    }
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
      @keyframes pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
        50% { box-shadow: 0 0 0 12px rgba(16, 185, 129, 0); }
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      .pill-dropdown {
        position: absolute;
        bottom: calc(100% + 8px);
        right: 0;
        background: var(--nova-dropdown-bg);
        border-radius: 10px;
        border: 1px solid var(--nova-panel-border);
        box-shadow: 0 8px 32px var(--nova-pill-shadow);
        overflow: hidden;
        min-width: 180px;
        pointer-events: auto;
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
