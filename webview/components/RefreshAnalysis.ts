/**
 * RefreshAnalysis — Lit Web Component for displaying the Refresh ROI analysis
 * table and summary statistics.
 *
 * Uses light DOM so that global dashboard CSS classes apply directly.
 *
 * Usage:
 *   const el = document.createElement("copilot-refresh-analysis") as RefreshAnalysis;
 *   el.refreshAnalysis = payload.refreshAnalysis;
 *   container.appendChild(el);
 *
 * Properties:
 *   refreshAnalysis — array of RefreshAnalysis entries from DashboardPayload.
 */

import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { DashboardPayload } from "../../src/ui/dashboardMessages";
import { formatSignedPercent, formatSignedPoints, getDeltaClass } from "../dashboardUtils";

@customElement("copilot-refresh-analysis")
export class RefreshAnalysis extends LitElement {
  override createRenderRoot() {
    // Light DOM — relies on global dashboard CSS classes.
    return this;
  }

  @property({ type: Array }) refreshAnalysis: DashboardPayload["refreshAnalysis"] = [];

  render() {
    const { refreshAnalysis } = this;
    if (refreshAnalysis.length === 0) {
      return nothing;
    }

    const roiValues = refreshAnalysis.map((e) => e.refreshRoi).filter((v): v is number => v !== null);
    const avgRoi = roiValues.length > 0 ? roiValues.reduce((a, b) => a + b, 0) / roiValues.length : null;
    const avgRecoveryDelta = refreshAnalysis.reduce((sum, e) => sum + e.recoveryDelta, 0) / refreshAnalysis.length;
    const bestEntry =
      [...refreshAnalysis].sort((a, b) => (b.refreshRoi ?? -Infinity) - (a.refreshRoi ?? -Infinity))[0] ?? null;
    const latestEntry = refreshAnalysis.at(-1) ?? null;

    const sorted = [...refreshAnalysis].sort(
      (a, b) => new Date(b.event.timestamp).getTime() - new Date(a.event.timestamp).getTime(),
    );

    return html`
      <div class="db-refresh-history">
        <h2>🔄 Refresh ROI</h2>
        <div class="stats-grid">
          <div class="stat-card db-highlight">
            <div class="stat-value db-accent">${refreshAnalysis.length}</div>
            <div class="stat-label">Refresh Events</div>
            <div class="stat-detail">compact or truncation boundaries</div>
          </div>
          <div class="stat-card">
            <div class="stat-value ${getDeltaClass(avgRoi)}">${formatSignedPercent(avgRoi)}</div>
            <div class="stat-label">Average ROI</div>
            <div class="stat-detail">post.trueRate / pre.trueRate - 1</div>
          </div>
          <div class="stat-card">
            <div class="stat-value ${getDeltaClass(avgRecoveryDelta)}">${formatSignedPoints(avgRecoveryDelta)}</div>
            <div class="stat-label">Average Recovery</div>
            <div class="stat-detail">post true rate minus pre true rate</div>
          </div>
          <div class="stat-card">
            <div class="stat-value ${getDeltaClass(bestEntry?.refreshRoi ?? null)}">
              ${formatSignedPercent(bestEntry?.refreshRoi ?? null)}
            </div>
            <div class="stat-label">Best Refresh</div>
            <div class="stat-detail">${bestEntry?.event.type ?? latestEntry?.event.type ?? "memory"}</div>
          </div>
        </div>
        <div class="db-refresh-note">
          Compares the last 10 turns before and after each refresh boundary. Older VS Code logs without compact or
          truncation signals are hidden automatically.
        </div>
        <table class="db-lang-table">
          <tr>
            <th>Time</th>
            <th>Event</th>
            <th>Pre True Rate</th>
            <th>Post True Rate</th>
            <th>Recovery Delta</th>
            <th>Refresh ROI</th>
          </tr>
          ${sorted.map(
            (entry) => html`
              <tr>
                <td>${new Date(entry.event.timestamp).toLocaleString()}</td>
                <td>${entry.event.type}</td>
                <td>${entry.preTurns.trueRate.toFixed(1)}%</td>
                <td>${entry.postTurns.trueRate.toFixed(1)}%</td>
                <td class="${getDeltaClass(entry.recoveryDelta)}">${formatSignedPoints(entry.recoveryDelta)}</td>
                <td class="${getDeltaClass(entry.refreshRoi)}">${formatSignedPercent(entry.refreshRoi)}</td>
              </tr>
            `,
          )}
        </table>
      </div>
    `;
  }
}
