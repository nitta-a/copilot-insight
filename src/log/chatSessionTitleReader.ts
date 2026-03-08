import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ChatSessionTitleRecord } from "../types";

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
    const state: MutableChatSessionRecord = {
      sessionId: null,
      creationDate: null,
      lastMessageDate: null,
      customTitle: null,
      firstRequestText: null,
    };
    mergeBaseRecord(state, parsed);
    return buildTitleRecord(workspaceId, path.basename(filePath, path.extname(filePath)), state);
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
    const state: MutableChatSessionRecord = {
      sessionId: null,
      creationDate: null,
      lastMessageDate: null,
      customTitle: null,
      firstRequestText: null,
    };
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      let entry: JsonlMutationEntry;
      try {
        entry = JSON.parse(line) as JsonlMutationEntry;
      } catch {
        continue;
      }
      if (entry.kind === 0) {
        mergeBaseRecord(state, entry.v);
        continue;
      }
      const keyPath = Array.isArray(entry.k) ? entry.k : [];
      if (keyPath.length === 1 && keyPath[0] === "customTitle") {
        state.customTitle = sanitiseText(entry.v) ?? state.customTitle;
        continue;
      }
      if (keyPath.length === 1 && keyPath[0] === "creationDate") {
        state.creationDate = normaliseTimestamp(entry.v) ?? state.creationDate;
        continue;
      }
      if (keyPath.length === 1 && keyPath[0] === "lastMessageDate") {
        state.lastMessageDate = normaliseTimestamp(entry.v) ?? state.lastMessageDate;
        continue;
      }
      if (keyPath.length > 0 && keyPath[0] === "requests") {
        state.firstRequestText = extractFirstRequestText(entry.v) ?? state.firstRequestText;
      }
    }
    return buildTitleRecord(workspaceId, path.basename(filePath, path.extname(filePath)), state);
  } catch {
    return null;
  }
}

export function resolveWorkspaceStorageRoot(logBaseDir: string): string {
  return path.join(path.dirname(logBaseDir), "User", "workspaceStorage");
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
