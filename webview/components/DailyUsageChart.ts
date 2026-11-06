import type { Chart } from "chart.js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { DailyUsagePoint, SummaryData } from "../../src/ui/dashboardMessages";
import { summarizeInterventions } from "../../src/log/interventions";
import { summarizeModelCalls } from "../../src/log/diagnostics";
import { formatPause } from "../dashboardUtils";
import { summarizeFusion } from "../../src/log/fusion";
import { toAiCredits } from "../../src/utils";
import { createDailyUsageChart, createProjectUsageChart, getColors } from "../chartBuilders";
import { formatAiCredits } from "../dashboardUtils";
import {
  formatProjectShare,
  projectChartRows,
  projectPeriodRange,
  projectsForPeriod,
  type ProjectPeriod,
} from "../utils/projectUsage";
import { recordedPeriod } from "../utils/recordedPeriod";

@customElement("copilot-daily-usage-chart")
export class DailyUsageChart extends LitElement {
  static styles = css`
    :host { display: block; margin: 24px 0; }
    header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
    h2 { font-size: 1.1em; }
    h3 { font-size: 0.95em; }
    p { font-size: 0.85em; opacity: 0.8; line-height: 1.6; }
    .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 24px; }
    .canvas { position: relative; height: 260px; }
    select, button {
      color: var(--vscode-foreground); background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border, #888); border-radius: 4px; padding: 5px 8px;
    }
    button { cursor: pointer; }
    .warning { color: var(--vscode-editorWarning-foreground, #bf8803); }
    .table { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85em; margin-top: 12px; }
    th, td { padding: 6px 10px; text-align: right; border-bottom: 1px solid var(--vscode-panel-border, #888); }
    th:first-child, td:first-child { text-align: left; }
    details { margin-top: 16px; }
    .project-path { display: block; opacity: 0.75; overflow-wrap: anywhere; }
    .project-chart-scroll { max-height: 500px; overflow-y: auto; }
    .project-canvas { position: relative; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
    .permission-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr)); gap: 10px; margin: 14px 0; }
    .permission-metric { border: 1px solid var(--vscode-panel-border, #888); border-radius: 4px; padding: 12px; }
    .permission-metric dt { font-size: 0.85em; opacity: 0.85; }
    .permission-metric dd { margin: 6px 0 0; font-size: 1.35em; font-weight: 600; font-variant-numeric: tabular-nums; }
    .permission-metric small { display: block; margin-top: 4px; font-size: 0.8em; opacity: 0.8; }
    .permission-row { display: grid; grid-template-columns: minmax(85px, 1fr) minmax(80px, 3fr) auto; align-items: center; gap: 10px; font-size: 0.85em; }
    .permission-row span:first-child { overflow-wrap: anywhere; }
    .fusion-list { list-style: none; padding: 0; margin: 12px 0; display: grid; gap: 12px; }
    .fusion-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(100px, 1fr) auto; align-items: center; gap: 10px; font-size: 0.85em; }
    .fusion-steps { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
    .fusion-step { border: 1px solid var(--vscode-panel-border, #888); border-radius: 4px; padding: 3px 7px; overflow-wrap: anywhere; }
    .fusion-track { height: 12px; border: 1px solid var(--vscode-panel-border, #888); border-radius: 3px; overflow: hidden; }
    .fusion-bar { height: 100%; background: var(--vscode-progressBar-background, #0078d4); }
    .fusion-credit-bar { background: var(--vscode-charts-green, #388a34); }
    .fusion-value { white-space: nowrap; font-variant-numeric: tabular-nums; }
    @media (max-width: 550px) {
      .fusion-row { grid-template-columns: minmax(0, 1fr) auto; }
      .fusion-steps, .fusion-label { grid-column: 1 / -1; }
    }
  `;

  @property({ attribute: false }) usage: SummaryData["cliUsageStats"] = null;
  @state() private period = "30";
  @state() private projectPeriod: ProjectPeriod = "all";
  private creditsChart: Chart | null = null;
  private tokensChart: Chart | null = null;
  private projectCreditsChart: Chart | null = null;
  private projectTokensChart: Chart | null = null;

  private visibleDays(): DailyUsagePoint[] {
    const days = this.usage?.dailyUsage ?? [];
    const lastDate = days.at(-1)?.date;
    if (this.period === "all" || !lastDate) {
      return days;
    }
    const cutoff = Date.parse(`${lastDate}T00:00:00Z`) - (Number(this.period) - 1) * 86_400_000;
    return days.filter((day) => Date.parse(`${day.date}T00:00:00Z`) >= cutoff);
  }

  protected updated(): void {
    this.destroyCharts();
    const creditsCanvas = this.renderRoot.querySelector<HTMLCanvasElement>("#daily-credits");
    const tokensCanvas = this.renderRoot.querySelector<HTMLCanvasElement>("#daily-tokens");
    const days = this.visibleDays();
    if (creditsCanvas && tokensCanvas && days.length > 0) {
      const colors = getColors();
      this.creditsChart = createDailyUsageChart(creditsCanvas, days, "credits", colors);
      this.tokensChart = createDailyUsageChart(tokensCanvas, days, "tokens", colors);
    }
    const projectCredits = this.renderRoot.querySelector<HTMLCanvasElement>("#project-credits");
    const projectTokens = this.renderRoot.querySelector<HTMLCanvasElement>("#project-tokens");
    if (projectCredits && projectTokens && this.usage?.projects) {
      const rows = projectChartRows(projectsForPeriod(this.usage.projects, this.projectPeriod));
      const colors = getColors();
      this.projectCreditsChart = createProjectUsageChart(projectCredits, rows, "credits", colors);
      this.projectTokensChart = createProjectUsageChart(projectTokens, rows, "tokens", colors);
    }
  }

  resizeCharts(): void {
    this.creditsChart?.resize();
    this.tokensChart?.resize();
    this.projectCreditsChart?.resize();
    this.projectTokensChart?.resize();
  }

  disconnectedCallback(): void {
    this.destroyCharts();
    super.disconnectedCallback();
  }

  private destroyCharts(): void {
    this.creditsChart?.destroy();
    this.tokensChart?.destroy();
    this.projectCreditsChart?.destroy();
    this.projectTokensChart?.destroy();
    this.creditsChart = null;
    this.tokensChart = null;
    this.projectCreditsChart = null;
    this.projectTokensChart = null;
  }

  render() {
    const usage = this.usage;
    const days = this.visibleDays();
    const lastDate = this.usage?.dailyUsage.at(-1)?.date ?? null;
    const { start } = recordedPeriod(this.period, [lastDate]);
    const fusionRange = recordedPeriod(this.period, [
      lastDate,
      ...(usage?.fusionRuns ?? []).map((run) =>
        run.timestamp ? new Date(run.timestamp).toISOString().slice(0, 10) : null,
      ),
    ]);
    const fusion = summarizeFusion(usage?.fusionRuns ?? [], fusionRange.start, fusionRange.end);
    const undated = (usage?.fusionRuns ?? []).filter((run) => !run.timestamp).length;
    const interventionThreads = usage?.interventionThreads ?? [];
    const interventionDates = interventionThreads
      .flatMap(({ interventions }) =>
        interventions
          ? [
              ...interventions.permissions.flatMap((p) => [p.requestedAt, p.respondedAt]),
              ...interventions.steering,
              ...interventions.stops,
            ]
              .filter((date): date is string => !!date)
              .map((date) => date.slice(0, 10))
          : [],
      )
      .sort();
    const { start: interventionStart, end: interventionEnd } = recordedPeriod(this.period, [
      lastDate,
      ...interventionDates,
    ]);
    const intervention = summarizeInterventions(interventionThreads, interventionStart, interventionEnd);
    const modelCalls = summarizeModelCalls(usage?.modelCalls ?? []);
    const projectInterventions = new Map<string | null, typeof interventionThreads>();
    for (const thread of interventionThreads) {
      const key = thread.projectPath ?? null;
      projectInterventions.set(key, [...(projectInterventions.get(key) ?? []), thread]);
    }
    const maxPermissionCount = Math.max(0, ...intervention.counts.map(([, count]) => count));
    const maxPath = Math.max(0, ...fusion.paths.map(([, count]) => count));
    const maxCredits = Math.max(0, ...fusion.roles.map(([, credits]) => credits ?? 0));
    const phaseNames = new Map([
      ["primary", "Initial generation"],
      ["judge", "Judge"],
      ["repair", "Repair"],
    ]);
    const phaseName = (phase: string) => phaseNames.get(phase) ?? phase;
    const projects = projectsForPeriod(usage?.projects ?? [], this.projectPeriod);
    const projectRange = projectPeriodRange(this.projectPeriod);
    const projectDates = (usage?.projects ?? []).flatMap((project) => project.dailyUsage.map((day) => day.date)).sort();
    const projectTotals = projectChartRows(projects)[0];
    return html`
      <header>
        <h2><span aria-hidden="true">📅</span> Daily token and AI credit consumption</h2>
        <label>Period
          <select aria-label="Usage period" .value=${this.period} @change=${(event: Event) => {
            if (event.target instanceof HTMLSelectElement) {
              this.period = event.target.value;
            }
          }}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="all">All recorded days</option>
          </select>
        </label>
        <button @click=${() => this.dispatchEvent(new CustomEvent("show-usage-threads", { bubbles: true, composed: true }))}>
          View thread totals
        </button>
      </header>
      <p>Displayed period (UTC): ${lastDate ? `${start ?? days[0]?.date ?? lastDate} – ${lastDate}` : "No dated records available"}.</p>
      <p>Local Copilot session records, including CLI and Agent Host. Dates are model-call dates in UTC.
        Periods end at the latest recorded day. Cached input is already included in input tokens.
        AI credits are usage units, not a currency charge or account-wide bill.</p>
      ${
        usage?.unattributedTokens || usage?.unattributedAiCredits
          ? html`<p class="warning">Cumulative thread totals also include usage or accounting adjustments
            without a model-call date:
            ${usage.unattributedTokens.toLocaleString()} tokens;
            ${formatAiCredits(usage.unattributedAiCredits)} AI credits.
            These are not assigned to a day in the graphs.</p>`
          : nothing
      }
      ${
        usage && (usage.totalAiCredits === null || days.some((day) => day.aiCredits === null))
          ? html`<p class="warning">Some credit data is unavailable. Missing credits are not counted as zero;
            the daily table identifies gaps.</p>`
          : nothing
      }
      ${
        days.length === 0
          ? html`<p>No timestamped usage records are available. Cumulative totals may still be available in Sessions.</p>`
          : html`
          <div class="charts">
            <section>
              <h3>AI credits per day</h3>
              <div class="canvas"><canvas id="daily-credits" role="img" aria-label="Daily AI credit consumption; values in the daily usage table"></canvas></div>
            </section>
            <section>
              <h3>Tokens per day</h3>
              <div class="canvas"><canvas id="daily-tokens" role="img" aria-label="Daily input and output tokens; values in the daily usage table"></canvas></div>
            </section>
          </div>
          <details>
            <summary>Daily usage table</summary>
            <div class="table"><table>
              <thead><tr><th scope="col">Date (UTC)</th><th scope="col">Input</th><th scope="col">Output</th><th scope="col">AI credits</th></tr></thead>
              <tbody>${days.map(
                (day) => html`<tr>
                <td>${day.date}</td><td>${day.inputTokens.toLocaleString()}</td>
                <td>${day.outputTokens.toLocaleString()}</td><td>${formatAiCredits(day.aiCredits)}</td>
              </tr>`,
              )}</tbody>
            </table></div>
          </details>`
      }
      ${
        modelCalls.length
          ? html`<section>
        <h3>Model call timing</h3>
        <p>All recorded SDK calls; independent of the selected period. Averages describe observed calls, not model speed for equivalent tasks.</p>
        <div class="table"><table><thead><tr><th scope="col">Model</th><th scope="col">Average call time</th><th scope="col">Average time to first token</th></tr></thead>
        <tbody>${modelCalls.map((item) => html`<tr><td>${item.model}</td><td>${item.duration === null ? "Unavailable" : formatPause(Math.round(item.duration))} (${item.durationSamples} calls)</td><td>${item.firstToken === null ? "Unavailable" : formatPause(Math.round(item.firstToken))} (${item.firstTokenSamples} calls)</td></tr>`)}</tbody></table></div>
      </section>`
          : nothing
      }
      ${
        interventionThreads.some((thread) => thread.interventions)
          ? html`<section>
        <h3>Permission confirmations and other observed events</h3>
        <p>Period (UTC): ${this.period === "all" ? "all recorded dates" : interventionEnd ? `${interventionStart} – ${interventionEnd}` : "no dated events"}. Responses use response dates; messages and stops use event dates. Undated events are excluded.</p>
        <dl class="permission-metrics">
          <div class="permission-metric"><dt>Human permission responses</dt><dd>${intervention.human.toLocaleString()}</dd></div>
          <div class="permission-metric"><dt>Host policy decisions</dt><dd>${intervention.hostPolicy.toLocaleString()}</dd><small>Decisions, not necessarily approvals</small></div>
          <div class="permission-metric"><dt>Sessions with human responses</dt><dd>${intervention.humanSessions.toLocaleString()} / ${intervention.observedSessions.toLocaleString()}</dd><small>Out of sessions with a permission request or response</small></div>
          <div class="permission-metric"><dt>Median request-to-response elapsed</dt><dd>${intervention.median === null ? "Unavailable" : formatPause(intervention.median)}</dd><small>${intervention.samples.toLocaleString()} valid samples</small></div>
        </dl>
        <h4>Human response targets</h4>
        ${
          intervention.counts.length
            ? html`<ul class="fusion-list">${[...intervention.counts]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(
                  ([kind, count]) => html`<li class="permission-row">
          <span>${kind}</span><span class="fusion-track" aria-hidden="true"><span class="fusion-bar" style=${`display:block;width:${(count / maxPermissionCount) * 100}%`}></span></span><span class="fusion-value">${count.toLocaleString()}</span>
        </li>`,
                )}</ul>`
            : html`<p>No human permission responses in this period.</p>`
        }
        <p>Bars compare response counts. Elapsed time can include absence, sleep, or concurrent work.</p>
        <h4>Other observed events</h4>
        <dl class="permission-metrics">
          <div class="permission-metric"><dt>Messages during execution (steering)</dt><dd>${intervention.steering.toLocaleString()}</dd><small>Message origin is not necessarily human</small></div>
          <div class="permission-metric"><dt>User-initiated stops</dt><dd>${intervention.stops.toLocaleString()}</dd></div>
        </dl>
        ${
          usage?.projects !== null
            ? html`<details><summary>By project folder</summary><div class="table"><table>
          <thead><tr><th scope="col">Project</th><th scope="col">Human responses</th><th scope="col">Target breakdown</th><th scope="col">Median elapsed / samples</th><th scope="col">Sessions with human responses / observed</th><th scope="col">Steering / user stops</th></tr></thead>
          <tbody>${[...projectInterventions].map(([path, threads]) => {
            const item = summarizeInterventions(threads, interventionStart, interventionEnd);
            return html`<tr><td>${path ?? "Unknown"}</td><td>${item.human}</td><td>${item.counts.map(([kind, count]) => `${kind}: ${count}`).join(", ") || "—"}</td><td>${item.median === null ? "Unavailable" : formatPause(item.median)} / ${item.samples}</td><td>${item.humanSessions} / ${item.observedSessions}</td><td>${item.steering} / ${item.stops}</td></tr>`;
          })}</tbody></table></div></details>`
            : html`<p>Project attribution unavailable for older snapshots.</p>`
        }
      </section>`
          : nothing
      }
      ${
        usage?.fusionRuns?.length
          ? html`<section>
        <h3>Fusion execution paths</h3>
        <p>Period (UTC): ${this.period === "all" ? "all recorded dates" : fusionRange.end ? `${fusionRange.start} – ${fusionRange.end}` : "no dated events"}. ${fusion.count} runs; ${undated} undated runs excluded. Dates use the first observed Fusion event. Fusion usage is part of session usage, not an additional charge.</p>
        <h4>Observed paths</h4>
        <p>Only recorded phases are shown; the planned pattern may differ. Bars compare run counts.</p>
        ${
          fusion.paths.length
            ? html`<ul class="fusion-list">${fusion.paths.map(
                ([path, count]) => html`
          <li class="fusion-row">
            <span class="fusion-steps">${path.split(" → ").map((phase, index) => html`${index ? html`<span aria-hidden="true">→</span><span class="sr-only"> then </span>` : nothing}<span class="fusion-step">${phaseName(phase)}</span>`)}</span>
            <span class="fusion-track" aria-hidden="true"><span class="fusion-bar" style=${`display:block;width:${maxPath ? (count / maxPath) * 100 : 0}%`}></span></span>
            <span class="fusion-value">${count} ${count === 1 ? "run" : "runs"}</span>
          </li>`,
              )}</ul>`
            : html`<p>No execution paths in this period.</p>`
        }
        <h4>AI credits by phase</h4>
        <p>Bars compare recorded phase credits; unavailable amounts are not treated as zero.</p>
        ${
          fusion.roles.length
            ? html`<ul class="fusion-list">${fusion.roles.map(
                ([role, credits]) => html`
          <li class="fusion-row">
            <span class="fusion-label">${phaseName(role)}</span>
            ${credits === null ? html`<span></span>` : html`<span class="fusion-track" aria-hidden="true"><span class="fusion-bar fusion-credit-bar" style=${`display:block;width:${maxCredits ? (credits / maxCredits) * 100 : 0}%`}></span></span>`}
            <span class="fusion-value">${formatAiCredits(toAiCredits(credits))} AI credits</span>
          </li>`,
              )}</ul>`
            : html`<p>No phase credits in this period.</p>`
        }
        <p>Repair after an observed judge: ${fusion.repaired} / ${fusion.judged} (${fusion.judged ? `${((100 * fusion.repaired) / fusion.judged).toFixed(1)}%` : "unavailable"}).</p>
      </section>`
          : nothing
      }
      <section>
        <header><h3>Usage by project</h3>
          <label>Period
            <select aria-label="Project usage period" .value=${this.projectPeriod} @change=${(event: Event) => {
              if (event.target instanceof HTMLSelectElement) {
                this.projectPeriod = event.target.value as ProjectPeriod;
              }
            }}>
              <option value="all">All time</option>
              <option value="week">This week (Monday–today)</option>
              <option value="lastWeek">Last week (Monday–Sunday)</option>
              <option value="month">This month</option>
              <option value="7">Last 7 days</option>
              <option value="14">Last 2 weeks</option>
              <option value="30">Last 30 days</option>
            </select>
          </label>
        </header>
        <p>Period (UTC): ${
          projectRange
            ? `${projectRange.start} – ${projectRange.end} (inclusive)`
            : projectDates.length && usage?.projectDailyUsageAvailable
              ? `All time; dated records span ${projectDates[0]} – ${projectDates[projectDates.length - 1]}. Totals also include undated usage and adjustments.`
              : "All time; date range unavailable. Totals include undated usage and adjustments."
        }</p>
        <p>Usage is attributed to the folder at session start. Separate worktree paths are separate projects.
          AI credits show “Unavailable” when accounting is incomplete.</p>
        ${
          this.projectPeriod !== "all"
            ? html`<p>UTC calendar days, inclusive. Only timestamped model-call records are included;
          undated usage and cumulative accounting adjustments are excluded, so period totals may differ from reconciled session totals.</p>`
            : nothing
        }
        ${
          usage?.projects === null
            ? html`<p>Project data is unavailable in this saved snapshot. Refresh to read current session records.</p>`
            : this.projectPeriod !== "all" && usage && !usage.projectDailyUsageAvailable
              ? html`<p>Period data is unavailable in this saved snapshot. Refresh to read current session records.</p>`
              : projects.length
                ? html`<div class="charts">
                <section><h3>Tokens by project</h3>
                  <div class="project-chart-scroll"><div class="project-canvas" style=${`height: ${Math.max(180, (projects.length + 1) * 36 + 60)}px`}>
                    <canvas id="project-tokens" role="img" aria-label="Total and project input and output tokens; details in the project usage table"></canvas>
                  </div></div>
                </section>
                <section><h3>AI credits by project</h3>
                  <div class="project-chart-scroll"><div class="project-canvas" style=${`height: ${Math.max(180, (projects.length + 1) * 36 + 60)}px`}>
                    <canvas id="project-credits" role="img" aria-label="Total and project AI credits; unavailable amounts and details in the project usage table"></canvas>
                  </div></div>
                </section>
              </div>
              <p>Chart labels show each project's share of all projects. Shares are unavailable when the total is zero or unknown.
                Chart numbers match the project rows below. The credit total is unavailable if any project's credits are unavailable.</p>
              <div class="table"><table>
                <thead><tr><th scope="col">Project</th><th scope="col">Input tokens</th><th scope="col">Output tokens</th><th scope="col">Token share</th><th scope="col">Cache read</th><th scope="col">Cache write</th><th scope="col">AI credits</th><th scope="col">Credit share</th></tr></thead>
                <tbody>${projects.map(
                  (project, index) => html`<tr>
                  <td>${index + 1}. ${project.name}${project.path ? html`<span class="project-path">${project.path}</span>` : nothing}</td>
                  <td>${project.inputTokens.toLocaleString()}</td><td>${project.outputTokens.toLocaleString()}</td>
                  <td>${formatProjectShare(project.inputTokens + project.outputTokens, projectTotals.inputTokens + projectTotals.outputTokens)}</td>
                  <td>${project.cacheReadTokens.toLocaleString()}</td><td>${project.cacheWriteTokens.toLocaleString()}</td>
                  <td>${formatAiCredits(project.aiCredits)}</td>
                  <td>${formatProjectShare(project.aiCredits, projectTotals.aiCredits)}</td>
                </tr>`,
                )}</tbody>
              </table></div>`
                : html`<p>No project usage is available.</p>`
        }
      </section>
    `;
  }
}
