/**
 * AgentIntelligenceOverview — Lit Web Component for displaying the Agent
 * Intelligence Overview section including stat cards, model tables, CLI tool
 * efficiency, agent types, feature signals, and planning metrics.
 *
 * Uses light DOM so that:
 *  1. Global dashboard CSS classes apply directly.
 *  2. The React chart container divs (`#db-model-depth-chart`,
 *     `#db-agentic-scatter`) are discoverable via `document.getElementById`
 *     after the component renders, allowing `dashboard.ts` to mount React
 *     charts into them.
 *
 * Usage:
 *   const el = document.createElement("copilot-agent-intelligence-overview") as AgentIntelligenceOverview;
 *   el.agenticStats = payload.agenticStats;
 *   container.appendChild(el);
 *   await el.updateComplete; // wait for light-DOM render
 *   // document.getElementById("db-model-depth-chart") is now available
 *
 * Properties:
 *   agenticStats — AgenticStats object from DashboardPayload.
 */

import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type {
  AgentIntelligenceOverview as AgentIntelligenceOverviewData,
  DashboardPayload,
} from "../../src/ui/dashboardMessages";
import { escHtml, formatDuration, trunc } from "../dashboardUtils";

const MAX_TABLE_ROWS = 8;
const MAX_TABLE_CELL_LENGTH = 28;

@customElement("copilot-agent-intelligence-overview")
export class AgentIntelligenceOverview extends LitElement {
  override createRenderRoot() {
    // Light DOM — relies on global dashboard CSS classes and allows
    // document.getElementById to find the React chart container divs.
    return this;
  }

  @property({ type: Object }) agenticStats: DashboardPayload["agenticStats"] | null = null;

  render() {
    const { agenticStats } = this;
    if (!agenticStats) {
      return nothing;
    }

    const {
      featureSignals,
      subagentRequests,
      agentIntelligenceOverview,
      cliToolExecutions,
      cliReasoningTokens,
      cliAgentTypes,
    } = agenticStats;
    const { browserTools, pluginOrSkills, memoryManagement, agentDebug } = featureSignals;
    const hasFeatureSignals = [browserTools.total, pluginOrSkills.total, memoryManagement.total, agentDebug.total].some(
      (total) => total > 0,
    );

    const hasData =
      subagentRequests > 0 ||
      hasFeatureSignals ||
      cliToolExecutions.length > 0 ||
      cliReasoningTokens > 0 ||
      cliAgentTypes.length > 0;

    if (!hasData) {
      return html`<p class="no-data">No autonomous activity or 1.110 feature signals detected in this period.</p>`;
    }

    return html`${this._renderOverview(agenticStats, agentIntelligenceOverview, hasFeatureSignals)}`;
  }

  private _renderOverview(
    agenticStats: DashboardPayload["agenticStats"],
    overview: AgentIntelligenceOverviewData,
    hasFeatureSignals: boolean,
  ) {
    const ratioStr = agenticStats.agenticRatio.toFixed(1);
    const avgStr = overview.avgCallsPerLoop > 0 ? overview.avgCallsPerLoop.toFixed(1) : "—";
    const completionStr = overview.completionRate > 0 ? `${overview.completionRate.toFixed(1)}%` : "—";
    const cliReasoningStr =
      agenticStats.cliReasoningTokens > 0 ? agenticStats.cliReasoningTokens.toLocaleString() : "—";

    const durationCell =
      agenticStats.autonomousDurationMs > 0
        ? html`
            <div class="stat-card">
              <div class="stat-value">${formatDuration(agenticStats.autonomousDurationMs)}</div>
              <div class="stat-label">Autonomous Duration</div>
              <div class="stat-detail">total active time</div>
            </div>
          `
        : nothing;

    const planSuccessStr = overview.planCount > 0 ? `${overview.planSuccessRate.toFixed(1)}%` : "—";
    const planningSection =
      overview.planCount > 0
        ? html`
            <hr class="db-section-sep" />
            <h3 style="font-size:1em;margin:16px 0 10px">📋 Planning &amp; Execution</h3>
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-value">${overview.planCount}</div>
                <div class="stat-label">Plans Proposed</div>
                <div class="stat-detail">agent/plan proposals</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${overview.executedPlanCount}</div>
                <div class="stat-label">Plans Executed</div>
                <div class="stat-detail">led to file edits</div>
              </div>
              <div class="stat-card db-highlight">
                <div class="stat-value db-accent">${planSuccessStr}</div>
                <div class="stat-label">Success Rate</div>
                <div class="stat-detail">plans implemented</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${overview.userChoicesInPlan}</div>
                <div class="stat-label">User Choices</div>
                <div class="stat-detail">in-plan interactions</div>
              </div>
            </div>
          `
        : nothing;

    const modelRows = overview.autonomousRatioByModel.map(
      ({ model, subagentCount, totalCount, ratio, velocitySecondsPerAction }) => {
        const velocityStr = velocitySecondsPerAction > 0 ? `${velocitySecondsPerAction.toFixed(1)}s` : "—";
        return html`
          <tr>
            <td>${trunc(model, 30)}</td>
            <td>${subagentCount} / ${totalCount}</td>
            <td>${ratio.toFixed(1)}%</td>
            <td>${velocityStr}</td>
          </tr>
        `;
      },
    );

    const modelTable =
      modelRows.length > 0
        ? html`
            <h3 style="font-size:0.9em;margin:16px 0 6px;opacity:0.8">Autonomous Ratio by Model</h3>
            <table class="db-lang-table">
              <tr>
                <th>Model</th>
                <th>Autonomous / Total</th>
                <th>Ratio</th>
                <th>Avg sec / Action</th>
              </tr>
              ${modelRows}
            </table>
          `
        : nothing;

    const cliToolRowItems = agenticStats.cliToolExecutions
      .slice(0, MAX_TABLE_ROWS)
      .map(({ name, total, success, fail, successRate }) => {
        const rate = total > 0 ? `${successRate.toFixed(1)}%` : "—";
        return html`
        <tr>
          <td>${trunc(name, MAX_TABLE_CELL_LENGTH)}</td>
          <td>${total}</td>
          <td>${success}</td>
          <td>${fail}</td>
          <td>${rate}</td>
        </tr>
      `;
      });

    const cliToolSection =
      cliToolRowItems.length > 0
        ? html`
            <h3 style="font-size:0.9em;margin:16px 0 6px;opacity:0.8">CLI Tool Efficiency</h3>
            <table class="db-lang-table">
              <tr>
                <th>Tool</th>
                <th>Total</th>
                <th>Success</th>
                <th>Fail</th>
                <th>Success Rate</th>
              </tr>
              ${cliToolRowItems}
            </table>
          `
        : nothing;

    const cliAgentTypeRowItems = agenticStats.cliAgentTypes.slice(0, MAX_TABLE_ROWS).map(
      ({ name, count, share }) => html`
      <tr>
        <td>${trunc(name, MAX_TABLE_CELL_LENGTH)}</td>
        <td>${count}</td>
        <td>${share.toFixed(1)}%</td>
      </tr>
    `,
    );

    const cliAgentTypeSection =
      cliAgentTypeRowItems.length > 0
        ? html`
            <h3 style="font-size:0.9em;margin:16px 0 6px;opacity:0.8">CLI Agent Types</h3>
            <table class="db-lang-table">
              <tr>
                <th>Agent</th>
                <th>Count</th>
                <th>Share</th>
              </tr>
              ${cliAgentTypeRowItems}
            </table>
          `
        : nothing;

    const featureCards = [
      {
        label: "Browser Tools",
        total: agenticStats.featureSignals.browserTools.total,
        detail: agenticStats.featureSignals.browserTools.breakdown,
      },
      {
        label: "Plugins / Skills",
        total: agenticStats.featureSignals.pluginOrSkills.total,
        detail: agenticStats.featureSignals.pluginOrSkills.breakdown,
      },
      {
        label: "Session Memory / Compact",
        total: agenticStats.featureSignals.memoryManagement.total,
        detail: agenticStats.featureSignals.memoryManagement.breakdown,
      },
      {
        label: "Agent Debug",
        total: agenticStats.featureSignals.agentDebug.total,
        detail: agenticStats.featureSignals.agentDebug.breakdown,
      },
    ];

    const featureSection = hasFeatureSignals
      ? html`
          <hr class="db-section-sep" />
          <h3 style="font-size:1em;margin:16px 0 10px">🧪 VS Code 1.110 Feature Signals</h3>
          <div class="stats-grid">
            ${featureCards.map((card) => {
              const top = card.detail
                .slice(0, 2)
                .map((entry) => `${escHtml(entry.name)} (${entry.count})`)
                .join(" · ");
              return html`
                <div class="stat-card">
                  <div class="stat-value">${card.total}</div>
                  <div class="stat-label">${card.label}</div>
                  <div class="stat-detail">${top || "detected log signals"}</div>
                </div>
              `;
            })}
          </div>
        `
      : nothing;

    return html`
      <hr class="db-section-sep" />
      <h2>🤖 Agent Intelligence Overview</h2>
      <div class="stats-grid">
        <div class="stat-card db-highlight">
          <div class="stat-value db-accent">${overview.autonomousActionCount}</div>
          <div class="stat-label">Autonomous Actions</div>
          <div class="stat-detail">All agentic activity</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${ratioStr}%</div>
          <div class="stat-label">Agentic Ratio</div>
          <div class="stat-detail">of all requests</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${overview.agenticLoopCount}</div>
          <div class="stat-label">Agentic Loops</div>
          <div class="stat-detail">completed episodes</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${cliReasoningStr}</div>
          <div class="stat-label">CLI Reasoning Chars</div>
          <div class="stat-detail">assistant.reasoningText length</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${avgStr}</div>
          <div class="stat-label">Avg Calls / Loop</div>
          <div class="stat-detail">agentic depth</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${completionStr}</div>
          <div class="stat-label">Completion Rate</div>
          <div class="stat-detail">episodes completed</div>
        </div>
        ${durationCell}
      </div>
      ${modelTable} ${cliToolSection} ${cliAgentTypeSection} ${featureSection} ${planningSection}
      <div id="db-model-depth-chart" style="margin-top:16px"></div>
      <div id="db-agentic-scatter" style="margin-top:4px"></div>
    `;
  }
}
