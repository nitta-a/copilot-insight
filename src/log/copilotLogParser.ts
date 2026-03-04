import * as path from "node:path";
import * as vscode from "vscode";
import { findCopilotDirs, getSortedSessionDirs, parseLogDirectory } from "./logFileReader";
import { findSessionRoot } from "../utils/logPaths";
import type { CopilotUsageStats, ParsingContext } from "../types";

export type { CopilotUsageStats, DateStat } from "../types";

/** Lazy output channel for diagnostic logging. */
let _outputChannel: vscode.OutputChannel | undefined;
function getOutputChannel(): vscode.OutputChannel {
  if (!_outputChannel) {
    _outputChannel = vscode.window.createOutputChannel("Copilot Insight");
  }
  return _outputChannel;
}

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
    byContextSource: new Map(),
    byContextEffectiveness: new Map(),
    subagentRequests: 0,
    agenticRatio: 0,
    autonomousDurationMs: 0,
    toolUsageStats: new Map(),
    subagentLoops: 0,
    subagentLoopsStarted: 0,
    completionRate: 0,
    subagentByModel: new Map(),
    autonomousDurationByModel: new Map(),
    agenticDepthByModel: new Map(),
    latencySum: 0,
    latencyCount: 0,
    chatLatencySum: 0,
    chatLatencyCount: 0,
    currentSessionId: "",
    activeSubagentLoop: null,
    activeSubagentLoopModel: null,
    activeSubagentLoopActionCount: 0,
    loopsStartedByModel: new Map(),
    loopsCompletedByModel: new Map(),
    totalLoopActionsByModel: new Map(),
    loopDistributionByModel: new Map(),
  };

  try {
    // Locate the VS Code session root by scanning the path string for the
    // `.../logs/<timestamp>` segment — depth-independent and cross-platform.
    const channel = getOutputChannel();
    channel.appendLine(`Log URI: ${logUri.fsPath}`);

    const sessionRoot = findSessionRoot(logUri.fsPath);
    channel.appendLine(sessionRoot ? `Session root: ${sessionRoot}` : `Session root: not found`);

    let logBaseDir: string;
    let fallbackSessionDir: string;
    if (sessionRoot) {
      logBaseDir = path.dirname(sessionRoot);
      fallbackSessionDir = sessionRoot;
    } else {
      channel.appendLine(`Warning: could not detect session root from ${logUri.fsPath}; using fixed-depth fallback`);
      logBaseDir = path.dirname(path.dirname(path.dirname(logUri.fsPath)));
      fallbackSessionDir = path.dirname(path.dirname(logUri.fsPath));
    }

    channel.appendLine(`Searching for logs in: ${logBaseDir}`);

    const sessionDirs = await getSortedSessionDirs(logBaseDir, fallbackSessionDir);

    for (const sessDir of sessionDirs) {
      try {
        ctx.currentSessionId = path.basename(sessDir);
        channel.appendLine(`Scanning session: ${sessDir}`);

        const copilotDirs = await findCopilotDirs(sessDir);
        if (copilotDirs.length === 0) {
          channel.appendLine(`  Skipped: no GitHub Copilot log directories found in ${sessDir}`);
        }
        for (const copilotLogDir of copilotDirs) {
          channel.appendLine(`  Found Copilot log dir: ${copilotLogDir}`);
          await parseLogDirectory(copilotLogDir, ctx);
        }
      } catch {
        // Skip unreadable session directories
        channel.appendLine(`  Skipped: could not read session directory ${sessDir}`);
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

  const totalRequests = ctx.totalShown + ctx.totalChat;
  if (totalRequests > 0) {
    ctx.agenticRatio = (ctx.subagentRequests / totalRequests) * 100;
  }

  if (ctx.subagentLoopsStarted > 0) {
    ctx.completionRate = (ctx.subagentLoops / ctx.subagentLoopsStarted) * 100;
  }

  // Compute per-model agentic depth statistics from accumulated data.
  const allModelKeys = new Set([...ctx.loopsStartedByModel.keys(), ...ctx.loopsCompletedByModel.keys()]);
  for (const model of allModelKeys) {
    const started = ctx.loopsStartedByModel.get(model) ?? 0;
    const completed = ctx.loopsCompletedByModel.get(model) ?? 0;
    const totalActions = ctx.totalLoopActionsByModel.get(model) ?? 0;
    const totalDurationMs = ctx.autonomousDurationByModel.get(model) ?? 0;
    const dist = ctx.loopDistributionByModel.get(model) ?? {
      bucket1: 0,
      bucket2: 0,
      bucket3to5: 0,
      bucket6to10: 0,
      bucket11plus: 0,
    };
    ctx.agenticDepthByModel.set(model, {
      loopDistribution: dist,
      avgLoopActions: completed > 0 ? totalActions / completed : 0,
      completionRate: started > 0 ? (completed / started) * 100 : 0,
      velocityMsPerAction: totalActions > 0 ? totalDurationMs / totalActions : 0,
    });
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
