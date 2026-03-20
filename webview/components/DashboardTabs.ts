/**
 * DashboardTabs — Web Component (Custom Element) for the dashboard tab bar.
 *
 * Encapsulates the tab navigation UI inside a Shadow DOM, keeping global
 * styles unaffected. Tab content panels live in the light DOM as direct
 * children with a `data-tab-pane` attribute matching each tab's id.
 *
 * Usage:
 *   <dashboard-tabs active-tab="overview">
 *     <div data-tab-pane="overview">…</div>
 *     <div data-tab-pane="health"   style="display:none">…</div>
 *   </dashboard-tabs>
 *
 * Observed attributes:
 *   active-tab — id of the initially (or externally) selected tab.
 *
 * Fired events:
 *   tab-change — dispatched with { bubbles: true, composed: true } whenever
 *                the active tab changes (user click or programmatic call).
 *                detail: { tabId: string }
 */

interface TabDefinition {
  readonly id: string;
  readonly label: string;
}

const DASHBOARD_TABS: ReadonlyArray<TabDefinition> = [
  { id: "overview", label: "📊 Overview (ROI)" },
  { id: "health", label: "🔍 Health (Diagnostics)" },
  { id: "flow", label: "🌊 Flow (Velocity)" },
  { id: "prompt-insights", label: "💬 Prompt Insights" },
  { id: "sessions", label: "📂 Sessions" },
] as const;

const SHADOW_STYLES = `
  :host {
    display: block;
  }
  nav {
    display: flex;
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editor-inactiveSelectionBackground));
    margin-bottom: 16px;
  }
  button {
    background: transparent;
    color: var(--vscode-tab-inactiveForeground, var(--vscode-foreground));
    border: none;
    border-bottom: 2px solid transparent;
    padding: 8px 16px;
    cursor: pointer;
    font-size: 0.88em;
    font-family: var(--vscode-font-family);
    opacity: 0.75;
    margin-bottom: -1px;
  }
  button:hover {
    opacity: 1;
    background: var(--vscode-list-hoverBackground);
  }
  button.active {
    color: var(--vscode-tab-activeForeground, var(--vscode-foreground));
    border-bottom-color: var(--vscode-tab-activeBorderTop, var(--vscode-charts-blue));
    opacity: 1;
    font-weight: 600;
  }
`;

export interface TabChangeDetail {
  tabId: string;
}

/** Custom element that renders a styled tab bar in Shadow DOM. */
export class DashboardTabs extends HTMLElement {
  static readonly observedAttributes: string[] = ["active-tab"];

  private readonly _shadow: ShadowRoot;
  private _activeTab: string = DASHBOARD_TABS[0].id;

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    this._buildShadowDom();
  }

  connectedCallback(): void {
    // After upgrade, light-DOM children are available — sync pane visibility.
    this._updatePanes();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (name === "active-tab" && newValue !== null && newValue !== oldValue) {
      // External attribute change: update UI without re-firing the event
      // (the caller is already aware of the change).
      this._applyActiveTab(newValue, false);
    }
  }

  /** The currently active tab id. */
  get activeTab(): string {
    return this._activeTab;
  }

  /**
   * Programmatically switch to a tab and fire a `tab-change` CustomEvent so
   * that React and other Vanilla JS listeners can react to the change.
   */
  switchTab(tabId: string): void {
    this._applyActiveTab(tabId, true);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Core tab-switch logic.
   * @param tabId   Target tab id.
   * @param fireEvent Whether to dispatch the `tab-change` CustomEvent.
   */
  private _applyActiveTab(tabId: string, fireEvent: boolean): void {
    if (!DASHBOARD_TABS.some((t) => t.id === tabId)) {
      return;
    }
    if (tabId === this._activeTab) {
      return;
    }
    this._activeTab = tabId;
    this._updateButtons();
    this._updatePanes();
    if (fireEvent) {
      this.dispatchEvent(
        new CustomEvent<TabChangeDetail>("tab-change", {
          bubbles: true,
          composed: true,
          detail: { tabId },
        }),
      );
    }
  }

  /** Build the initial Shadow DOM: stylesheet + tab nav + default slot. */
  private _buildShadowDom(): void {
    const style = document.createElement("style");
    style.textContent = SHADOW_STYLES;

    const nav = document.createElement("nav");
    nav.setAttribute("role", "tablist");
    nav.setAttribute("part", "tab-list");

    for (const tab of DASHBOARD_TABS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.tab = tab.id;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", tab.id === this._activeTab ? "true" : "false");
      if (tab.id === this._activeTab) {
        btn.classList.add("active");
      }
      btn.textContent = tab.label;
      btn.addEventListener("click", () => {
        this._handleTabClick(tab.id);
      });
      nav.appendChild(btn);
    }

    const slot = document.createElement("slot");

    this._shadow.appendChild(style);
    this._shadow.appendChild(nav);
    this._shadow.appendChild(slot);
  }

  /**
   * Handle a user click on a tab button.
   * Delegates to `_applyActiveTab` for state/UI updates and event dispatch,
   * then syncs the reflected attribute so external observers see the change.
   */
  private _handleTabClick(tabId: string): void {
    if (tabId === this._activeTab) {
      return;
    }
    this._applyActiveTab(tabId, true);
    // Sync the reflected attribute. attributeChangedCallback will be triggered
    // but exits early because _activeTab was already updated by _applyActiveTab.
    this.setAttribute("active-tab", tabId);
  }

  /** Sync the active / aria-selected state of Shadow DOM tab buttons. */
  private _updateButtons(): void {
    this._shadow.querySelectorAll<HTMLButtonElement>("button[data-tab]").forEach((btn) => {
      const isActive = btn.dataset.tab === this._activeTab;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  /**
   * Show the active tab pane and hide all others.
   * Operates on light-DOM children that carry a `data-tab-pane` attribute.
   */
  private _updatePanes(): void {
    for (const child of this.children) {
      const el = child as HTMLElement;
      const paneId = el.dataset.tabPane;
      if (paneId !== undefined) {
        el.style.display = paneId === this._activeTab ? "" : "none";
      }
    }
  }
}

if (!customElements.get("dashboard-tabs")) {
  customElements.define("dashboard-tabs", DashboardTabs);
}
