/**
 * MCP (Model Context Protocol) server for copilot-insight.
 *
 * Exposes three read-only tools that let external AI agents (Claude Desktop,
 * VS Code Copilot Chat, etc.) query locally accumulated usage statistics:
 *
 *  - `get_usage_summary`   — acceptance counts and estimated time saved
 *  - `get_model_efficiency` — best model per language cross-tabulation
 *  - `get_anomaly_report`  — z-score based anomaly detection on daily counts
 *
 * Communicates over StdIO; no cloud or external network access required.
 */

import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { InMemoryAnalyticsDb } from "../db/duckdbClient";
import { EventStorage } from "../events/eventStorage";
import { computeModelPerformance } from "../metrics/metricsEngine";
import type { CompletionAcceptEvent, TrackedEvent } from "../events/eventSchema";
export { resolveStoragePath } from "./storageResolver";

// ── Constants (mirrored from dashboardPayload.ts) ────────────────────────────

/** Average characters per accepted completion (used for ROI estimation). */
const AVG_CHARS_PER_COMPLETION = 40;

/** Estimated developer typing speed in chars/min (used for ROI estimation). */
const TYPING_SPEED_CPM = 200;

/** z-score magnitude above which a data point is considered an anomaly. */
const ANOMALY_Z_THRESHOLD = 2;

/** Number of history days used to compute the anomaly-detection baseline. */
const ANOMALY_BASELINE_DAYS = 14;

/** Minimum daily accepted count required to include a day in anomaly detection. */
const MIN_ACCEPTS_FOR_ANOMALY = 3;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Load all events from EventStorage into a fresh InMemoryAnalyticsDb. */
function buildDb(globalStoragePath: string): { db: InMemoryAnalyticsDb; allEvents: TrackedEvent[] } {
  const storage = new EventStorage(globalStoragePath);
  const dates = storage.listDates();
  const allEvents = dates.flatMap((d) => storage.readByDate(d));
  const db = new InMemoryAnalyticsDb();
  db.ingest(allEvents);
  return { db, allEvents };
}

// ── Server factory ────────────────────────────────────────────────────────────

/**
 * Initialise and connect the MCP server to the StdIO transport.
 *
 * @param globalStoragePath  Path to the extension's globalStorage directory
 *   (the directory that contains the `events/` sub-folder written by
 *   `EventStorage`).  In the VS Code host this is `context.globalStorageUri.fsPath`;
 *   when launched standalone it is supplied via `--storage` CLI argument or the
 *   `COPILOT_INSIGHT_STORAGE_PATH` environment variable.
 */
export async function startMcpServer(globalStoragePath: string): Promise<void> {
  const server = new Server({ name: "copilot-insight", version: "1.0.0" }, { capabilities: { tools: {} } });

  // ── Tool registry ───────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_usage_summary",
        description:
          "Returns Copilot completion statistics for the given number of recent days: total accepted completions, estimated minutes saved, and a per-language breakdown.",
        inputSchema: {
          type: "object" as const,
          properties: {
            days: {
              type: "number",
              description: "Number of recent days to include in the summary (default: 14, max: 365).",
            },
          },
        },
      },
      {
        name: "get_model_efficiency",
        description:
          "Returns per-language model efficiency statistics showing which AI model achieves the highest acceptance rate for each programming language.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "get_anomaly_report",
        description:
          "Returns anomaly detection results based on z-score analysis of daily completion acceptance counts. Days with |z| > 2 are flagged as anomalies.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
    ],
  }));

  // ── Tool dispatch ───────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "get_usage_summary") {
      const rawDays = args?.["days"];
      const days = typeof rawDays === "number" ? Math.max(1, Math.min(365, Math.floor(rawDays))) : 14;

      const storage = new EventStorage(globalStoragePath);
      const dates = storage.listDates();

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const recentEvents = dates.filter((d) => d >= cutoffStr).flatMap((d) => storage.readByDate(d));

      const acceptEvents = recentEvents.filter((e): e is CompletionAcceptEvent => e.eventType === "completionAccept");

      const totalAccepted = acceptEvents.length;
      const totalCharsAccepted = acceptEvents.reduce(
        (sum, e) => sum + (e.acceptedCharacters > 0 ? e.acceptedCharacters : AVG_CHARS_PER_COMPLETION),
        0,
      );
      const estimatedMinutesSaved = Math.round((totalCharsAccepted / TYPING_SPEED_CPM) * 10) / 10;

      const byLanguage: Record<string, number> = {};
      for (const e of acceptEvents) {
        const lang = e.languageId || "unknown";
        byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
      }

      const topLanguages = Object.entries(byLanguage)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([language, count]) => ({ language, count }));

      const result = {
        days,
        totalAccepted,
        totalCharsAccepted,
        estimatedMinutesSaved,
        topLanguages,
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "get_model_efficiency") {
      const storage = new EventStorage(globalStoragePath);
      const dates = storage.listDates();
      const allEvents = dates.flatMap((d) => storage.readByDate(d));

      const { crossTab, bestModelByLanguage } = computeModelPerformance(allEvents);

      const result = {
        bestModelByLanguage: Object.fromEntries(bestModelByLanguage),
        stats: crossTab.slice(0, 20).map((s) => ({
          modelName: s.modelName || "unknown",
          languageId: s.languageId || "unknown",
          totalAccepted: s.totalAccepted,
          totalCharsAccepted: s.totalCharsAccepted,
          avgLatencyMs: Math.round(s.avgLatencyMs),
        })),
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "get_anomaly_report") {
      const { db, allEvents } = buildDb(globalStoragePath);

      const baselines = db.calculateBaselines(ANOMALY_BASELINE_DAYS);

      const dailyCounts = new Map<string, number>();
      for (const e of allEvents) {
        if (e.eventType !== "completionAccept") {
          continue;
        }
        const date = e.timestamp.slice(0, 10);
        dailyCounts.set(date, (dailyCounts.get(date) ?? 0) + 1);
      }

      const canDetect = baselines.sampleSize >= 2 && baselines.stdDev > 0;

      const anomalies: Array<{ date: string; count: number; zScore: number; direction: string }> = [];
      const recentDays: Array<{
        date: string;
        count: number;
        zScore: number | null;
        isAnomaly: boolean;
      }> = [];

      for (const [date, count] of [...dailyCounts.entries()].sort()) {
        if (!canDetect || count < MIN_ACCEPTS_FOR_ANOMALY) {
          recentDays.push({ date, count, zScore: null, isAnomaly: false });
          continue;
        }
        const zScore = Math.round(((count - baselines.mean) / baselines.stdDev) * 100) / 100;
        const isAnomaly = Math.abs(zScore) > ANOMALY_Z_THRESHOLD;

        recentDays.push({ date, count, zScore, isAnomaly });

        if (isAnomaly) {
          anomalies.push({ date, count, zScore, direction: zScore < 0 ? "lower" : "higher" });
        }
      }

      await db.close();

      const result = {
        baseline: {
          mean: Math.round(baselines.mean * 100) / 100,
          stdDev: Math.round(baselines.stdDev * 100) / 100,
          sampleSize: baselines.sampleSize,
        },
        anomalies,
        recentDays: recentDays.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14),
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }

    return {
      content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
