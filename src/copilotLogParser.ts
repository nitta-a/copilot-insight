import * as fs from "node:fs/promises";
import * as path from "node:path";
import type * as vscode from "vscode";
import { getSortedSessionDirs, isDirectory, parseLogDirectory } from "./logFileReader";
import type { CopilotUsageStats, ParsingContext } from "./types";

export type { CopilotUsageStats, DateStat, LanguageStat } from "./types";

const COPILOT_DIR_NAMES = [
  "GitHub.copilot",
  "github.copilot",
  "GitHub.copilot-nightly",
  "GitHub.copilot-chat",
  "github.copilot-chat",
];

/** Maximum number of latency samples to retain per category to prevent unbounded memory growth. */
const MAX_LATENCY_SAMPLES = 10_000;

export async function parseCopilotLogs(logUri: vscode.Uri): Promise<CopilotUsageStats> {
  const ctx: ParsingContext = {
    totalShown: 0,
    totalAccepted: 0,
    totalRejected: 0,
    totalChat: 0,
    acceptanceRate: 0,
    avgLatencyMs: 0,
    byLanguage: new Map(),
    byDate: new Map(),
    byModel: new Map(),
    byChatModel: new Map(),
    byHour: new Map(),
    byChatIntent: new Map(),
    logFilesFound: 0,
    chatByDate: new Map(),
    chatByHour: new Map(),
    totalErrors: 0,
    errorsByType: new Map(),
    latencies: [],
    chatLatencies: [],
    latencyP50: 0,
    latencyP95: 0,
    latencyP99: 0,
    chatAvgLatencyMs: 0,
    chatLatencyP50: 0,
    chatLatencyP95: 0,
    bySession: new Map(),
    latencySum: 0,
    latencyCount: 0,
    chatLatencySum: 0,
    chatLatencyCount: 0,
    currentSessionId: "",
  };

  try {
    // logUri.fsPath is like: .../logs/<session>/<exthost>/copilot-insight/
    const extHostDir = path.dirname(logUri.fsPath);
    const sessionDir = path.dirname(extHostDir);
    const logBaseDir = path.dirname(sessionDir);

    const sessionDirs = await getSortedSessionDirs(logBaseDir, sessionDir);

    for (const sessDir of sessionDirs) {
      try {
        ctx.currentSessionId = path.basename(sessDir);
        const entries = await fs.readdir(sessDir);
        const extHostPaths = entries.map((entry) => path.join(sessDir, entry));
        const extHostDirs: string[] = [];
        for (const dirPath of extHostPaths) {
          if (await isDirectory(dirPath)) {
            extHostDirs.push(dirPath);
          }
        }

        for (const extHostDir of extHostDirs) {
          for (const dirName of COPILOT_DIR_NAMES) {
            const copilotLogDir = path.join(extHostDir, dirName);
            if (await isDirectory(copilotLogDir)) {
              await parseLogDirectory(copilotLogDir, ctx);
            }
          }
        }
      } catch {
        // Skip unreadable session directories
      }
    }
  } catch (e) {
    console.error("Error parsing Copilot logs:", e instanceof Error ? e.message : "unknown error");
  }

  if (ctx.totalShown > 0) {
    ctx.acceptanceRate = (ctx.totalAccepted / ctx.totalShown) * 100;
  }
  if (ctx.latencyCount > 0) {
    ctx.avgLatencyMs = ctx.latencySum / ctx.latencyCount;
  }
  if (ctx.chatLatencyCount > 0) {
    ctx.chatAvgLatencyMs = ctx.chatLatencySum / ctx.chatLatencyCount;
  }

  if (ctx.latencies.length > MAX_LATENCY_SAMPLES) {
    ctx.latencies = ctx.latencies.slice(-MAX_LATENCY_SAMPLES);
  }
  if (ctx.chatLatencies.length > MAX_LATENCY_SAMPLES) {
    ctx.chatLatencies = ctx.chatLatencies.slice(-MAX_LATENCY_SAMPLES);
  }

  if (ctx.latencies.length > 0) {
    ctx.latencies.sort((a, b) => a - b);
    ctx.latencyP50 = percentile(ctx.latencies, 0.5);
    ctx.latencyP95 = percentile(ctx.latencies, 0.95);
    ctx.latencyP99 = percentile(ctx.latencies, 0.99);
  }

  if (ctx.chatLatencies.length > 0) {
    ctx.chatLatencies.sort((a, b) => a - b);
    ctx.chatLatencyP50 = percentile(ctx.chatLatencies, 0.5);
    ctx.chatLatencyP95 = percentile(ctx.chatLatencies, 0.95);
  }

  return ctx;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
