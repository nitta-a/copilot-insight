import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { DashboardPayload } from "../../src/ui/dashboardMessages";
import { formatDuration, trunc } from "../dashboardUtils";

@customElement("copilot-agent-intelligence-overview")
export class AgentIntelligenceOverview extends LitElement {
  override createRenderRoot() {
    return this;
  }

  @property({ type: Object }) agenticStats: DashboardPayload["agenticStats"] | null = null;

  render() {
    const stats = this.agenticStats;
    if (!stats) return nothing;
    const categories = [
      ["Browser Tools", stats.featureSignals.browserTools],
      ["Plugins / Skills", stats.featureSignals.pluginOrSkills],
      ["Session Memory / Compact", stats.featureSignals.memoryManagement],
      ["Agent Debug", stats.featureSignals.agentDebug],
    ] as const;
    const hasEvents = stats.subagentRequests > 0 || stats.autonomousDurationMs > 0 ||
      stats.toolUsageStats.length > 0 || stats.cliToolExecutions.length > 0 || stats.cliAgentTypes.length > 0 ||
      categories.some(([, category]) => category.total > 0);
    if (!hasEvents) return nothing;
    return html`
      <hr class="db-section-sep" />
      <h2>🤖 Recorded Agent Activity</h2>
      ${stats.subagentRequests > 0 || stats.autonomousDurationMs > 0 ? html`<p>Legacy VS Code agent log: ${stats.subagentRequests > 0 ? `${stats.subagentRequests} recorded subagent requests` : ""}${stats.subagentRequests > 0 && stats.autonomousDurationMs > 0 ? "; " : ""}${stats.autonomousDurationMs > 0 ? `${formatDuration(stats.autonomousDurationMs)} recorded elapsed time` : ""}.</p>` : nothing}
      ${stats.toolUsageStats.length ? html`
        <h3>Legacy VS Code agent log events</h3>
        <ul>${stats.toolUsageStats.map(({ intent, count }) => html`<li>${intent}: ${count}</li>`)}</ul>
      ` : nothing}
      ${stats.cliToolExecutions.length ? html`
        <h3>CLI Tool Executions</h3>
        <table class="db-lang-table">
          <tr><th>Tool</th><th>Total</th><th>Success</th><th>Fail</th></tr>
          ${stats.cliToolExecutions.map(({ name, total, success, fail }) => html`<tr><td>${trunc(name, 28)}</td><td>${total}</td><td>${success}</td><td>${fail}</td></tr>`)}
        </table>
      ` : nothing}
      ${stats.cliAgentTypes.length ? html`
        <h3>CLI Agent Types</h3>
        <ul>${stats.cliAgentTypes.map(({ name, count }) => html`<li>${name}: ${count}</li>`)}</ul>
      ` : nothing}
      ${categories.filter(([, category]) => category.total > 0).map(([label, category]) => html`
        <h3>${label}</h3>
        <p>${category.total} recorded events</p>
        <ul>${category.breakdown.map(({ name, count }) => html`<li>${name}: ${count}</li>`)}</ul>
      `)}
    `;
  }
}
