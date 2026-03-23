/**
 * ContextCorrelationChart — Lit Web Component that renders a Chart.js mixed
 * chart (Bar = session counts, Line = acceptance rate) for the context
 * source-count buckets in the Overview tab. Sources include any files,
 * code snippets, or other context items attached to each chat session.
 *
 * Usage:
 *   const el = document.createElement("copilot-context-correlation") as ContextCorrelationChart;
 *   el.buckets = contextRichnessData.buckets;
 *   container.appendChild(el);
 *
 * Properties:
 *   buckets — ContextBucket[] from ContextRichnessData.
 */

import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type TooltipItem,
} from "chart.js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ContextBucket } from "../../src/ui/dashboardMessages";

// Register required Chart.js components (safe to call multiple times).
Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
  ArcElement,
);

@customElement("copilot-context-correlation")
export class ContextCorrelationChart extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    h3 {
      font-size: 0.95em;
      margin: 0 0 10px;
      opacity: 0.8;
    }
    .db-corr-card {
      background: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 80%, transparent);
      border: 1px solid var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 10px;
      padding: 16px;
      margin: 0 0 20px;
    }
    canvas {
      max-height: 220px;
    }
    .db-corr-no-data {
      opacity: 0.6;
      font-style: italic;
      font-size: 0.9em;
      padding: 12px 0;
    }
  `;

  @property({ type: Array }) buckets: ContextBucket[] = [];

  private _chart: Chart | null = null;

  disconnectedCallback() {
    super.disconnectedCallback();
    this._chart?.destroy();
    this._chart = null;
  }

  updated() {
    const canvas = this.shadowRoot?.querySelector<HTMLCanvasElement>("canvas");
    if (!canvas) {
      return;
    }

    const totalSessions = this.buckets.reduce((s, b) => s + b.sessionCount, 0);
    if (totalSessions === 0) {
      return;
    }

    const style = getComputedStyle(document.documentElement);
    const blue = style.getPropertyValue("--vscode-charts-blue").trim() || "#007acc";
    const green = style.getPropertyValue("--vscode-charts-green").trim() || "#4ec9b0";
    const foreground = style.getPropertyValue("--vscode-foreground").trim() || "#cccccc";
    const grid = style.getPropertyValue("--vscode-editor-inactiveSelectionBackground").trim() || "#3a3d41";

    this._chart?.destroy();

    const labels = this.buckets.map((b) => b.referenceCount);
    const sessionCounts = this.buckets.map((b) => b.sessionCount);
    const acceptanceRates = this.buckets.map((b) =>
      b.sessionCount > 0 ? Math.round((b.acceptedCount / b.sessionCount) * 1000) / 10 : 0,
    );

    this._chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            type: "bar",
            label: "Sessions",
            data: sessionCounts,
            backgroundColor: `${blue}99`,
            borderColor: blue,
            borderWidth: 1,
            yAxisID: "yLeft",
          },
          {
            type: "line",
            label: "Acceptance Rate (%)",
            data: acceptanceRates,
            borderColor: green,
            backgroundColor: `${green}33`,
            borderWidth: 2,
            pointRadius: 4,
            tension: 0.3,
            yAxisID: "yRight",
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: true, labels: { color: foreground } },
          tooltip: {
            callbacks: {
              title: (items: TooltipItem<"bar" | "line">[]) => `Sessions with ${items[0]?.label ?? ""}`,
              label: (item: TooltipItem<"bar" | "line">) => {
                if (item.datasetIndex === 1) {
                  return `Acceptance Rate: ${item.formattedValue}%`;
                }
                return `Sessions: ${item.formattedValue}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: foreground },
            grid: { color: grid },
          },
          yLeft: {
            type: "linear",
            position: "left",
            title: { display: true, text: "Session Count", color: foreground },
            ticks: { color: foreground },
            grid: { color: grid },
            beginAtZero: true,
          },
          yRight: {
            type: "linear",
            position: "right",
            title: { display: true, text: "Acceptance Rate (%)", color: foreground },
            ticks: { color: foreground, callback: (v) => `${v}%` },
            grid: { drawOnChartArea: false },
            beginAtZero: true,
            max: 100,
          },
        },
      },
    });
  }

  render() {
    const totalSessions = this.buckets.reduce((s, b) => s + b.sessionCount, 0);
    if (totalSessions === 0) {
      return nothing;
    }

    return html`
      <div class="db-corr-card">
        <h3>Context Sources vs Acceptance Rate</h3>
        <canvas></canvas>
      </div>
    `;
  }
}
