import type { DashboardPayload } from "./dashboardMessages";

/** Escape HTML special characters to prevent XSS in server-rendered content. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generate the HTML shell for the Copilot Usage Dashboard WebView.
 *
 * The generated page contains:
 * - KPI cards: Total Accepted, Acceptance Rate, Estimated Time Saved, Sessions
 * - Efficiency Graph: Chart.js acceptance-rate timeline (populated by the webview script)
 * - Session Summary Table: per-session stats (populated by the webview script)
 *
 * Dynamic rendering is handled by the bundled webview script (`dashboard.js`).
 * The initial payload is embedded as `window.__dashboardData` for first-render
 * performance, and updated via `postMessage` on subsequent log refreshes.
 */
export function getHtmlContent(nonce: string, scriptUri: string, payload: DashboardPayload): string {
  const allDates = payload.timeline.map((t) => t.date).sort();
  const minDate = allDates[0] ?? "";
  const maxDate = allDates[allDates.length - 1] ?? "";
  const dateRangeLabel =
    minDate && maxDate
      ? minDate === maxDate
        ? `<p class="date-range-label">${escapeHtml(minDate.replace(/-/g, "/"))}</p>`
        : `<p class="date-range-label">${escapeHtml(minDate.replace(/-/g, "/"))} – ${escapeHtml(maxDate.replace(/-/g, "/"))}</p>`
      : "";

  const scriptTags = buildScriptTags(nonce, scriptUri, payload);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:;">
  <title>GitHub Copilot Usage</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 20px 24px;
      margin: 0;
    }
    h1 { font-size: 1.4em; margin: 0 0 4px; }
    h2 { font-size: 1.05em; margin: 24px 0 10px; }
    .date-range-label { font-size: 0.85em; opacity: 0.65; margin: 0 0 20px; }

    /* ── KPI Cards ─────────────────────────────────────────── */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 14px;
      margin-bottom: 28px;
    }
    .kpi-card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      padding: 18px 16px 14px;
      text-align: center;
    }
    .kpi-value {
      font-size: 2.1em;
      font-weight: 700;
      color: var(--vscode-charts-blue);
      line-height: 1.1;
    }
    .kpi-label {
      font-size: 0.8em;
      margin-top: 6px;
      opacity: 0.75;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /* ── Efficiency Graph ──────────────────────────────────── */
    .chart-container {
      position: relative;
      margin-bottom: 28px;
      max-height: 280px;
    }
    .no-data { opacity: 0.6; font-style: italic; font-size: 0.9em; }

    /* ── Insights ──────────────────────────────────────────── */
    .insights-section { margin-bottom: 28px; }
    .insight-card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-left: 3px solid var(--vscode-charts-blue);
      border-radius: 4px;
      padding: 10px 14px;
      margin: 6px 0;
      font-size: 0.9em;
    }

    /* ── Session Summary Table ─────────────────────────────── */
    .session-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85em;
      margin-bottom: 24px;
    }
    .session-table th,
    .session-table td {
      padding: 7px 10px;
      text-align: left;
      border-bottom: 1px solid var(--vscode-editor-inactiveSelectionBackground);
    }
    .session-table th {
      opacity: 0.7;
      font-weight: 600;
    }
    .session-table tr:last-child td { border-bottom: none; }

    /* ── Export button ─────────────────────────────────────── */
    .export-btn {
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      border-radius: 4px;
      padding: 6px 14px;
      cursor: pointer;
      font-size: 0.85em;
      font-family: var(--vscode-font-family);
      margin-bottom: 20px;
    }
    .export-btn:hover { opacity: 0.85; }
  </style>
</head>
<body>
  <h1>🤖 GitHub Copilot Usage Dashboard</h1>
  ${dateRangeLabel}

  <button id="btn-export-md" class="export-btn">📄 Export Report (Markdown)</button>

  <!-- KPI Cards — populated by webview script -->
  <div id="kpi-cards" class="kpi-grid"></div>

  <!-- Efficiency Graph -->
  <h2>📈 Acceptance Rate Timeline</h2>
  <div class="chart-container">
    <canvas id="efficiency-chart"></canvas>
  </div>

  <!-- Insights -->
  <div id="insights-container" class="insights-section"></div>

  <!-- Session Summary Table -->
  <h2>📂 Session Summary</h2>
  <div id="session-table-container"></div>

  ${scriptTags}
</body>
</html>`;
}

/** Emit the nonce-protected data + script tags for the dashboard WebView. */
function buildScriptTags(nonce: string, scriptUri: string, payload: DashboardPayload): string {
  // Escape sequences that could break out of a <script> block:
  // - `</` → `<\/`  (prevent premature </script>)
  // - `<!--` → `<\!--`  (prevent HTML comment injection)
  const json = JSON.stringify(payload).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--");
  return `<script nonce="${nonce}">window.__dashboardData=${json};</script>
<script nonce="${nonce}" src="${scriptUri}"></script>`;
}
