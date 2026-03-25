import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ChatSessionRecord, ChatSessionRequest, ChatSessionTitleRecord, SkillRef, ToolCallInfo } from "../types";

interface JsonlMutationEntry {
  kind?: unknown;
  k?: unknown;
  v?: unknown;
}

interface MutableChatSessionRecord {
  sessionId: string | null;
  creationDate: string | null;
  lastMessageDate: string | null;
  customTitle: string | null;
  firstRequestText: string | null;
}

interface JsonlSessionLine {
  kind?: unknown;
  k?: unknown;
  v?: unknown;
}

function createContainer(nextKey: string | number | undefined): Record<string, unknown> | unknown[] {
  return typeof nextKey === "number" ? [] : {};
}

function setNestedValue(obj: Record<string, unknown>, keyPath: (string | number)[], value: unknown): void {
  if (keyPath.length === 0) {
    return;
  }
  let current: unknown = obj;
  for (let index = 0; index < keyPath.length - 1; index++) {
    const key = keyPath[index];
    const nextKey = keyPath[index + 1];
    if (!current || typeof current !== "object") {
      return;
    }
    const record = current as Record<string | number, unknown>;
    if (!(key in record) || record[key] === null || record[key] === undefined) {
      record[key] = createContainer(nextKey);
    }
    current = record[key];
  }
  if (current && typeof current === "object") {
    const lastKey = keyPath[keyPath.length - 1];
    (current as Record<string | number, unknown>)[lastKey] = value;
  }
}

function appendToArray(obj: Record<string, unknown>, keyPath: (string | number)[], items: unknown[]): void {
  if (keyPath.length === 0) {
    return;
  }
  let current: unknown = obj;
  for (let index = 0; index < keyPath.length; index++) {
    const key = keyPath[index];
    const nextKey = keyPath[index + 1];
    if (!current || typeof current !== "object") {
      return;
    }
    const record = current as Record<string | number, unknown>;
    if (!(key in record) || record[key] === null || record[key] === undefined) {
      record[key] = index === keyPath.length - 1 ? [] : createContainer(nextKey);
    }
    current = record[key];
  }
  if (Array.isArray(current)) {
    current.push(...items);
  }
}

function extractAgentNameFromUri(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "agent") {
    return null;
  }
  const parts = trimmed.split(/[/:#]/).filter((part) => part.length > 0);
  const candidate = parts.at(-1) ?? trimmed;
  return candidate === "agent" ? null : candidate;
}

function detectAvailableSkills(_systemText: string): SkillRef[] {
  return [];
}

function detectLoadedSkills(_toolCalls: ToolCallInfo[], _toolCallArgs: Record<string, string>): SkillRef[] {
  return [];
}

function enrichSubagentToolCalls(toolCalls: ToolCallInfo[], rawRequest: unknown): void {
  const request = rawRequest as Record<string, unknown>;
  const response = request.response as unknown[] | undefined;
  if (!Array.isArray(response)) {
    return;
  }

  const subagentParents = new Map<string, string>();
  const childrenByParent = new Map<string, ToolCallInfo[]>();
  const parentOrder: string[] = [];

  for (const entry of response) {
    const parsed = entry as Record<string, unknown>;
    if (parsed.kind !== "toolInvocationSerialized") {
      continue;
    }
    const toolCallId = typeof parsed.toolCallId === "string" ? parsed.toolCallId : undefined;
    const toolId = typeof parsed.toolId === "string" ? parsed.toolId : undefined;
    const parentId = typeof parsed.subAgentInvocationId === "string" ? parsed.subAgentInvocationId : undefined;

    if (toolId === "runSubagent" && toolCallId) {
      const toolSpecificData = parsed.toolSpecificData as Record<string, unknown> | undefined;
      if (toolSpecificData?.kind === "subagent" && !subagentParents.has(toolCallId)) {
        subagentParents.set(toolCallId, String(toolSpecificData.description ?? ""));
        parentOrder.push(toolCallId);
      }
    }

    if (parentId && toolCallId) {
      const children = childrenByParent.get(parentId) ?? [];
      children.push({
        id: toolCallId,
        name: String(toolId ?? ""),
      });
      childrenByParent.set(parentId, children);
    }
  }

  if (subagentParents.size === 0) {
    return;
  }

  let insertIndex = toolCalls.findIndex((toolCall) => toolCall.name === "runSubagent");
  if (insertIndex === -1) {
    insertIndex = toolCalls.length;
  }
  const filtered = toolCalls.filter((toolCall) => toolCall.name !== "runSubagent");
  toolCalls.length = 0;
  toolCalls.push(...filtered);

  const enriched = parentOrder.map(
    (id) =>
      ({
        id,
        name: "runSubagent",
        subagentDescription: subagentParents.get(id),
        childToolCalls: childrenByParent.get(id) ?? [],
      }) satisfies ToolCallInfo,
  );
  toolCalls.splice(insertIndex, 0, ...enriched);
}

function extractMcpSources(rawRequest: unknown): Map<string, string> {
  const request = rawRequest as Record<string, unknown>;
  const response = request.response as unknown[] | undefined;
  const sources = new Map<string, string>();
  if (!Array.isArray(response)) {
    return sources;
  }

  for (const entry of response) {
    const parsed = entry as Record<string, unknown>;
    if (parsed.kind !== "toolInvocationSerialized") {
      continue;
    }
    const source = parsed.source as Record<string, unknown> | undefined;
    if (source?.type !== "mcp") {
      continue;
    }
    const toolId = typeof parsed.toolId === "string" ? parsed.toolId : undefined;
    const serverLabel = typeof source.serverLabel === "string" ? source.serverLabel : undefined;
    if (toolId && serverLabel && !sources.has(toolId)) {
      sources.set(toolId, serverLabel);
    }
  }

  return sources;
}

function applyMcpSources(toolCalls: ToolCallInfo[], mcpSources: Map<string, string>): void {
  if (mcpSources.size === 0) {
    return;
  }
  for (const toolCall of toolCalls) {
    const server = mcpSources.get(toolCall.name);
    if (server) {
      toolCall.mcpServer = server;
    }
    if (toolCall.childToolCalls) {
      applyMcpSources(toolCall.childToolCalls, mcpSources);
    }
  }
}

function truncateTitle(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function stringifyDisplayValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function extractSession(
  workspaceId: string,
  fallbackSessionId: string,
  state: Record<string, unknown>,
  source: "jsonl" | "json",
  agentNameByRequest: Array<string | null> = [],
): ChatSessionRecord | null {
  const rawRequests = Array.isArray(state.requests) ? state.requests : [];
  const requests: ChatSessionRequest[] = rawRequests.map((rawRequest, index) => {
    const request = rawRequest as Record<string, unknown>;
    const agent = request.agent as Record<string, unknown> | undefined;
    const result = request.result as Record<string, unknown> | undefined;
    const metadata = result?.metadata as Record<string, unknown> | undefined;
    const timings = result?.timings as Record<string, number> | undefined;
    const usage = result?.usage as Record<string, number> | undefined;

    const toolCalls: ToolCallInfo[] = [];
    const toolCallArgs: Record<string, string> = {};
    const rounds = (metadata?.toolCallRounds as unknown[]) ?? [];
    for (const round of rounds) {
      const parsedRound = round as Record<string, unknown>;
      for (const toolCall of (parsedRound.toolCalls as Record<string, unknown>[]) ?? []) {
        toolCalls.push({
          id: String(toolCall.id ?? ""),
          name: String(toolCall.name ?? ""),
        });
      }
    }

    const toolCallResults = (metadata?.toolCallResults ?? {}) as Record<string, Record<string, unknown>>;
    for (const [id, toolResult] of Object.entries(toolCallResults)) {
      const content = toolResult.content as Record<string, unknown>[] | undefined;
      if (content?.[0]) {
        toolCallArgs[id] = stringifyDisplayValue(content[0].value);
      }
    }
    for (const toolCall of toolCalls) {
      if (toolCallArgs[toolCall.id]) {
        toolCall.args = toolCallArgs[toolCall.id];
      }
    }

    enrichSubagentToolCalls(toolCalls, rawRequest);
    applyMcpSources(toolCalls, extractMcpSources(rawRequest));

    let systemText = "";
    const rendered = metadata?.renderedUserMessage;
    if (Array.isArray(rendered)) {
      for (const part of rendered) {
        const parsedPart = part as Record<string, unknown>;
        const value = parsedPart.value ?? parsedPart.text;
        if (typeof value === "string") {
          systemText += `${value}\n`;
        }
      }
    }

    const message = request.message as Record<string, unknown> | undefined;
    return {
      requestId: String(request.requestId ?? `request-${index}`),
      timestamp: typeof request.timestamp === "number" ? request.timestamp : 0,
      agentId: String(agent?.id ?? ""),
      customAgentName: agentNameByRequest[index] ?? null,
      modelId: String(request.modelId ?? ""),
      messageText: String(message?.text ?? ""),
      timings: {
        firstProgress: typeof timings?.firstProgress === "number" ? timings.firstProgress : null,
        totalElapsed: typeof timings?.totalElapsed === "number" ? timings.totalElapsed : null,
      },
      toolCalls,
      availableSkills: detectAvailableSkills(systemText),
      loadedSkills: detectLoadedSkills(toolCalls, toolCallArgs),
    };
  });

  const firstRequestText = extractFirstRequestText(rawRequests);
  const title = sanitiseText(state.customTitle) ?? (firstRequestText ? truncateTitle(firstRequestText) : null);
  const createdAt =
    normaliseTimestamp(state.creationDate ?? state.createdAt) ??
    normaliseTimestamp(requests[0]?.timestamp) ??
    new Date(0).toISOString();
  const lastMessageAt =
    normaliseTimestamp(state.lastMessageDate ?? state.updatedAt) ??
    normaliseTimestamp(requests.at(-1)?.timestamp) ??
    null;

  return {
    chatSessionId: sanitiseText(state.sessionId) ?? fallbackSessionId,
    workspaceId,
    title,
    createdAt,
    lastMessageAt,
    firstRequestText,
    requests,
    source,
    provider: "copilot",
  };
}

function normaliseTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (/^\d+$/.test(trimmed)) {
      return new Date(Number.parseInt(trimmed, 10)).toISOString();
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  return null;
}

function sanitiseText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readObjectProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return Reflect.get(value, key);
}

function extractFirstRequestText(requests: unknown): string | null {
  if (!Array.isArray(requests)) {
    return null;
  }
  for (const request of requests) {
    const text = sanitiseText(readObjectProperty(readObjectProperty(request, "message"), "text"));
    if (text) {
      return text;
    }
  }
  return null;
}

function mergeBaseRecord(target: MutableChatSessionRecord, value: unknown): void {
  if (!value || typeof value !== "object") {
    return;
  }
  const sessionId = sanitiseText(readObjectProperty(value, "sessionId"));
  const creationDate = normaliseTimestamp(
    readObjectProperty(value, "creationDate") ?? readObjectProperty(value, "createdAt"),
  );
  const lastMessageDate = normaliseTimestamp(
    readObjectProperty(value, "lastMessageDate") ??
      readObjectProperty(value, "updatedAt") ??
      readObjectProperty(value, "creationDate"),
  );
  const customTitle = sanitiseText(readObjectProperty(value, "customTitle"));
  const firstRequestText = extractFirstRequestText(readObjectProperty(value, "requests"));

  target.sessionId = sessionId ?? target.sessionId;
  target.creationDate = creationDate ?? target.creationDate;
  target.lastMessageDate = lastMessageDate ?? target.lastMessageDate;
  target.customTitle = customTitle ?? target.customTitle;
  target.firstRequestText = firstRequestText ?? target.firstRequestText;
}

function buildTitleRecord(
  workspaceId: string,
  fallbackSessionId: string,
  state: MutableChatSessionRecord,
): ChatSessionTitleRecord | null {
  if (!state.customTitle || !state.creationDate) {
    return null;
  }
  return {
    chatSessionId: state.sessionId ?? fallbackSessionId,
    workspaceId,
    title: state.customTitle,
    createdAt: state.creationDate,
    lastMessageAt: state.lastMessageDate,
    firstRequestText: state.firstRequestText,
  };
}

function mergeTitleRecords(
  existing: ChatSessionTitleRecord,
  candidate: ChatSessionTitleRecord,
): ChatSessionTitleRecord {
  const existingLast = existing.lastMessageAt ? Date.parse(existing.lastMessageAt) : 0;
  const candidateLast = candidate.lastMessageAt ? Date.parse(candidate.lastMessageAt) : 0;
  const newer = candidateLast >= existingLast ? candidate : existing;
  const older = newer === candidate ? existing : candidate;
  return {
    ...older,
    ...newer,
    title: newer.title || older.title,
    firstRequestText: newer.firstRequestText ?? older.firstRequestText,
    lastMessageAt: newer.lastMessageAt ?? older.lastMessageAt,
  };
}

async function parseJsonChatSessionFile(filePath: string, workspaceId: string): Promise<ChatSessionTitleRecord | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const record = extractSession(
      workspaceId,
      path.basename(filePath, path.extname(filePath)),
      parsed as Record<string, unknown>,
      "json",
    );
    if (!record?.title) {
      return null;
    }
    return {
      chatSessionId: record.chatSessionId,
      workspaceId: record.workspaceId,
      title: record.title,
      createdAt: record.createdAt,
      lastMessageAt: record.lastMessageAt,
      firstRequestText: record.firstRequestText,
    };
  } catch {
    return null;
  }
}

async function parseJsonChatSessionRecord(filePath: string, workspaceId: string): Promise<ChatSessionRecord | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return extractSession(workspaceId, path.basename(filePath, path.extname(filePath)), parsed, "json");
  } catch {
    return null;
  }
}

async function parseJsonlChatSessionFile(
  filePath: string,
  workspaceId: string,
): Promise<ChatSessionTitleRecord | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const state: Record<string, unknown> = {};
    let currentAgentName: string | null = null;
    const agentNameByRequest: Array<string | null> = [];

    for (const line of lines) {
      let entry: JsonlSessionLine;
      try {
        entry = JSON.parse(line) as JsonlSessionLine;
      } catch {
        continue;
      }

      switch (entry.kind) {
        case 0: {
          if (entry.v && typeof entry.v === "object") {
            Object.assign(state, entry.v as Record<string, unknown>);
            const inputState = (entry.v as Record<string, unknown>).inputState as Record<string, unknown> | undefined;
            const mode = inputState?.mode as Record<string, unknown> | undefined;
            if (mode?.kind === "agent" && typeof mode.id === "string") {
              currentAgentName = extractAgentNameFromUri(mode.id);
            }
          }
          break;
        }
        case 1: {
          const keyPath = Array.isArray(entry.k) ? (entry.k as Array<string | number>) : [];
          if (keyPath.length > 0) {
            setNestedValue(state, keyPath, entry.v);
            if (keyPath[0] === "inputState" && keyPath[1] === "mode") {
              const mode = entry.v as Record<string, unknown> | undefined;
              if (mode?.kind === "agent" && typeof mode.id === "string") {
                currentAgentName = extractAgentNameFromUri(mode.id);
              } else {
                currentAgentName = null;
              }
            }
          }
          break;
        }
        case 2: {
          const keyPath = Array.isArray(entry.k) ? (entry.k as Array<string | number>) : [];
          if (keyPath.length > 0 && Array.isArray(entry.v)) {
            if (keyPath.length === 1 && keyPath[0] === "requests") {
              for (let index = 0; index < entry.v.length; index++) {
                agentNameByRequest.push(currentAgentName);
              }
            }
            appendToArray(state, keyPath, entry.v);
          }
          break;
        }
      }
    }

    const record = extractSession(
      workspaceId,
      path.basename(filePath, path.extname(filePath)),
      state,
      "jsonl",
      agentNameByRequest,
    );
    if (!record?.title) {
      return null;
    }
    return {
      chatSessionId: record.chatSessionId,
      workspaceId: record.workspaceId,
      title: record.title,
      createdAt: record.createdAt,
      lastMessageAt: record.lastMessageAt,
      firstRequestText: record.firstRequestText,
    };
  } catch {
    return null;
  }
}

async function parseJsonlChatSessionRecord(filePath: string, workspaceId: string): Promise<ChatSessionRecord | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const state: Record<string, unknown> = {};
    let currentAgentName: string | null = null;
    const agentNameByRequest: Array<string | null> = [];

    for (const line of lines) {
      let entry: JsonlSessionLine;
      try {
        entry = JSON.parse(line) as JsonlSessionLine;
      } catch {
        continue;
      }

      switch (entry.kind) {
        case 0: {
          if (entry.v && typeof entry.v === "object") {
            Object.assign(state, entry.v as Record<string, unknown>);
            const inputState = (entry.v as Record<string, unknown>).inputState as Record<string, unknown> | undefined;
            const mode = inputState?.mode as Record<string, unknown> | undefined;
            if (mode?.kind === "agent" && typeof mode.id === "string") {
              currentAgentName = extractAgentNameFromUri(mode.id);
            }
          }
          break;
        }
        case 1: {
          const keyPath = Array.isArray(entry.k) ? (entry.k as Array<string | number>) : [];
          if (keyPath.length > 0) {
            setNestedValue(state, keyPath, entry.v);
            if (keyPath[0] === "inputState" && keyPath[1] === "mode") {
              const mode = entry.v as Record<string, unknown> | undefined;
              if (mode?.kind === "agent" && typeof mode.id === "string") {
                currentAgentName = extractAgentNameFromUri(mode.id);
              } else {
                currentAgentName = null;
              }
            }
          }
          break;
        }
        case 2: {
          const keyPath = Array.isArray(entry.k) ? (entry.k as Array<string | number>) : [];
          if (keyPath.length > 0 && Array.isArray(entry.v)) {
            if (keyPath.length === 1 && keyPath[0] === "requests") {
              for (let index = 0; index < entry.v.length; index++) {
                agentNameByRequest.push(currentAgentName);
              }
            }
            appendToArray(state, keyPath, entry.v);
          }
          break;
        }
      }
    }

    return extractSession(
      workspaceId,
      path.basename(filePath, path.extname(filePath)),
      state,
      "jsonl",
      agentNameByRequest,
    );
  } catch {
    return null;
  }
}

export function resolveWorkspaceStorageRoot(logBaseDir: string): string {
  return path.join(path.dirname(logBaseDir), "User", "workspaceStorage");
}

/** Module-level cache for Windows workspace storage roots (WSL /mnt crawl is expensive). */
const WIN_ROOTS_CACHE_TTL_MS = 5 * 60 * 1000;
let winRootsCache: { roots: string[]; cachedAt: number } | null = null;

/** @internal Exported for testing only. */
export function clearWindowsRootsCache(): void {
  winRootsCache = null;
}

/**
 * Discovers Windows-side VS Code workspaceStorage roots when running under WSL.
 *
 * VS Code Remote/WSL runs the extension host in WSL while the renderer (UI / chat panel)
 * runs on Windows and writes chatSessions JSONL to the Windows AppData path.
 * This function enumerates mounted Windows drives under /mnt/ and returns every
 * `{drive}/Users/{user}/AppData/Roaming/{Code|Code - Insiders}/User/workspaceStorage`
 * path that exists on disk.
 *
 * Returns an empty array on non-Linux platforms or when /mnt/ is not accessible.
 */
export async function discoverWindowsWorkspaceStorageRoots(): Promise<string[]> {
  if (process.platform !== "linux") {
    return [];
  }
  // Return cached results within TTL.
  if (winRootsCache && Date.now() - winRootsCache.cachedAt <= WIN_ROOTS_CACHE_TTL_MS) {
    return winRootsCache.roots;
  }
  const roots: string[] = [];
  let driveEntries: Dirent[] = [];
  try {
    driveEntries = await fs.readdir("/mnt", { withFileTypes: true });
  } catch {
    return [];
  }
  for (const driveEntry of driveEntries) {
    // Accept only single-letter drive names (c, d, …) to skip /mnt/wsl, /mnt/wslg, etc.
    if (!driveEntry.isDirectory() || !/^[a-z]$/.test(driveEntry.name)) {
      continue;
    }
    const usersPath = path.join("/mnt", driveEntry.name, "Users");
    let userEntries: Dirent[] = [];
    try {
      userEntries = await fs.readdir(usersPath, { withFileTypes: true });
    } catch {
      continue;
    }
    const skipNames = new Set(["Public", "Default", "All Users", "Default User"]);
    for (const userEntry of userEntries) {
      if (!userEntry.isDirectory() || skipNames.has(userEntry.name)) {
        continue;
      }
      for (const variant of ["Code", "Code - Insiders"]) {
        const candidate = path.join(
          usersPath,
          userEntry.name,
          "AppData",
          "Roaming",
          variant,
          "User",
          "workspaceStorage",
        );
        try {
          await fs.access(candidate);
          roots.push(candidate);
        } catch {
          // Path does not exist — skip
        }
      }
    }
  }
  winRootsCache = { roots, cachedAt: Date.now() };
  return roots;
}

/**
 * Concurrency-limited async pool.  Runs at most `concurrency` tasks at a time.
 * Preserves insertion order of results.
 */
async function asyncPool<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

/**
 * Single-pass scan of `workspaceStorageRoot` returning both full session records and
 * derived title records.  Workspaces and their files are processed with bounded
 * concurrency to avoid overwhelming WSL/cross-filesystem bridges.
 */
export async function readAllChatSessionData(workspaceStorageRoot: string): Promise<{
  titleRecords: ChatSessionTitleRecord[];
  sessionRecords: ChatSessionRecord[];
}> {
  let workspaceEntries: Dirent[] = [];
  try {
    workspaceEntries = await fs.readdir(workspaceStorageRoot, { withFileTypes: true });
  } catch {
    return { titleRecords: [], sessionRecords: [] };
  }

  const dirEntries = workspaceEntries.filter((e) => e.isDirectory());

  // Process all workspaces with bounded concurrency (8) to avoid overwhelming
  // cross-filesystem bridges (e.g. WSL ↔ Windows /mnt/).
  const workspaceResults = await asyncPool(
    dirEntries.map((workspaceEntry) => async () => {
      const workspaceId = workspaceEntry.name;
      const chatSessionsDir = path.join(workspaceStorageRoot, workspaceId, "chatSessions");
      let files: Dirent[] = [];
      try {
        files = await fs.readdir(chatSessionsDir, { withFileTypes: true });
      } catch {
        return [] as (ChatSessionRecord | null)[];
      }

      // Process all files in the same workspace in parallel.
      return Promise.all(
        files
          .filter((f) => f.isFile() && (f.name.endsWith(".jsonl") || f.name.endsWith(".json")))
          .map((file) => {
            const filePath = path.join(chatSessionsDir, file.name);
            return file.name.endsWith(".jsonl")
              ? parseJsonlChatSessionRecord(filePath, workspaceId)
              : parseJsonChatSessionRecord(filePath, workspaceId);
          }),
      );
    }),
    8,
  );

  // Deduplicate by chatSessionId, keeping the most-recent lastMessageAt.
  const sessionMap = new Map<string, ChatSessionRecord>();
  const titleMap = new Map<string, ChatSessionTitleRecord>();

  for (const records of workspaceResults) {
    for (const record of records) {
      if (!record) {
        continue;
      }

      // Merge session.
      const existingSession = sessionMap.get(record.chatSessionId);
      if (!existingSession) {
        sessionMap.set(record.chatSessionId, record);
      } else {
        const existingLast = existingSession.lastMessageAt ? Date.parse(existingSession.lastMessageAt) : 0;
        const candidateLast = record.lastMessageAt ? Date.parse(record.lastMessageAt) : 0;
        sessionMap.set(record.chatSessionId, candidateLast >= existingLast ? record : existingSession);
      }

      // Derive title record (only when title is present).
      if (record.title) {
        const titleRecord: ChatSessionTitleRecord = {
          chatSessionId: record.chatSessionId,
          workspaceId: record.workspaceId,
          title: record.title,
          createdAt: record.createdAt,
          lastMessageAt: record.lastMessageAt,
          firstRequestText: record.firstRequestText,
        };
        const existingTitle = titleMap.get(record.chatSessionId);
        titleMap.set(record.chatSessionId, existingTitle ? mergeTitleRecords(existingTitle, titleRecord) : titleRecord);
      }
    }
  }

  const sessionRecords = [...sessionMap.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const titleRecords = [...titleMap.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return { titleRecords, sessionRecords };
}

export async function readChatSessionTitleRecords(workspaceStorageRoot: string): Promise<ChatSessionTitleRecord[]> {
  const merged = new Map<string, ChatSessionTitleRecord>();
  let workspaceEntries: Dirent[] = [];
  try {
    workspaceEntries = await fs.readdir(workspaceStorageRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const workspaceEntry of workspaceEntries) {
    if (!workspaceEntry.isDirectory()) {
      continue;
    }
    const workspaceId = workspaceEntry.name;
    const chatSessionsDir = path.join(workspaceStorageRoot, workspaceId, "chatSessions");
    let files: Dirent[] = [];
    try {
      files = await fs.readdir(chatSessionsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile()) {
        continue;
      }
      const filePath = path.join(chatSessionsDir, file.name);
      const record = file.name.endsWith(".jsonl")
        ? await parseJsonlChatSessionFile(filePath, workspaceId)
        : file.name.endsWith(".json")
          ? await parseJsonChatSessionFile(filePath, workspaceId)
          : null;
      if (!record) {
        continue;
      }
      const existing = merged.get(record.chatSessionId);
      merged.set(record.chatSessionId, existing ? mergeTitleRecords(existing, record) : record);
    }
  }

  return [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function readChatSessionRecords(workspaceStorageRoot: string): Promise<ChatSessionRecord[]> {
  const merged = new Map<string, ChatSessionRecord>();
  let workspaceEntries: Dirent[] = [];
  try {
    workspaceEntries = await fs.readdir(workspaceStorageRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const workspaceEntry of workspaceEntries) {
    if (!workspaceEntry.isDirectory()) {
      continue;
    }
    const workspaceId = workspaceEntry.name;
    const chatSessionsDir = path.join(workspaceStorageRoot, workspaceId, "chatSessions");
    let files: Dirent[] = [];
    try {
      files = await fs.readdir(chatSessionsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile()) {
        continue;
      }
      const filePath = path.join(chatSessionsDir, file.name);
      const record = file.name.endsWith(".jsonl")
        ? await parseJsonlChatSessionRecord(filePath, workspaceId)
        : file.name.endsWith(".json")
          ? await parseJsonChatSessionRecord(filePath, workspaceId)
          : null;
      if (!record) {
        continue;
      }
      const existing = merged.get(record.chatSessionId);
      if (!existing) {
        merged.set(record.chatSessionId, record);
        continue;
      }
      const existingLast = existing.lastMessageAt ? Date.parse(existing.lastMessageAt) : 0;
      const candidateLast = record.lastMessageAt ? Date.parse(record.lastMessageAt) : 0;
      merged.set(record.chatSessionId, candidateLast >= existingLast ? record : existing);
    }
  }

  return [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
