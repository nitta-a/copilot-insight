import type { Chart } from "chart.js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { DailyUsagePoint, SummaryData } from "../../src/ui/dashboardMessages";
import { createDailyUsageChart, getColors } from "../chartBuilders";
import { formatAiCredits } from "../dashboardUtils";

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
  `;

  @property({ attribute: false }) usage: SummaryData["cliUsageStats"] = null;
  @state() private period = "30";
  private creditsChart: Chart | null = null;
  private tokensChart: Chart | null = null;

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
  }

  resizeCharts(): void {
    this.creditsChart?.resize();
    this.tokensChart?.resize();
  }

  disconnectedCallback(): void {
    this.destroyCharts();
    super.disconnectedCallback();
  }

  private destroyCharts(): void {
    this.creditsChart?.destroy();
    this.tokensChart?.destroy();
    this.creditsChart = null;
    this.tokensChart = null;
  }

  render() {
    const usage = this.usage;
    const days = this.visibleDays();
    return html`
      <header>
        <h2>Daily token and AI credit consumption</h2>
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
      <p>Local Copilot CLI / SDK records only. Dates are model-call dates in UTC.
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
    `;
  }
}
