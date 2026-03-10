import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as assert from "assert";
import {
  readChatSessionRecords,
  readChatSessionTitleRecords,
  resolveWorkspaceStorageRoot,
} from "../../src/log/chatSessionTitleReader";

suite("chatSessionTitleReader", () => {
  test("resolves workspaceStorage from the logs directory", () => {
    const root = resolveWorkspaceStorageRoot("/Users/test/Library/Application Support/Code/logs");
    assert.strictEqual(root, "/Users/test/Library/Application Support/Code/User/workspaceStorage");
  });

  test("reads custom titles from json and jsonl chat session files", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-chat-sessions-"));
    try {
      const workspaceStorageRoot = path.join(tempRoot, "User", "workspaceStorage");
      const workspaceDir = path.join(workspaceStorageRoot, "workspace-1", "chatSessions");
      await fs.mkdir(workspaceDir, { recursive: true });

      await fs.writeFile(
        path.join(workspaceDir, "chat-a.json"),
        JSON.stringify({
          sessionId: "chat-a",
          creationDate: 1760871632297,
          lastMessageDate: 1760871632297,
          customTitle: "アプリの概要説明依頼",
          requests: [{ message: { text: "Explain the app overview" } }],
        }),
        "utf-8",
      );
      await fs.writeFile(
        path.join(workspaceDir, "chat-b.jsonl"),
        [
          JSON.stringify({
            kind: 0,
            v: {
              sessionId: "chat-b",
              creationDate: 1760871632297,
              lastMessageDate: 1760871632397,
              requests: [],
            },
          }),
          JSON.stringify({ kind: 1, k: ["customTitle"], v: "自律性進化トレンドの可視化実装" }),
          JSON.stringify({
            kind: 2,
            k: ["requests"],
            v: [{ message: { text: "Visualize autonomy evolution trends" } }],
          }),
        ].join("\n"),
        "utf-8",
      );

      const records = await readChatSessionTitleRecords(workspaceStorageRoot);

      assert.strictEqual(records.length, 2);
      assert.deepStrictEqual(
        records.map((record) => record.title),
        ["アプリの概要説明依頼", "自律性進化トレンドの可視化実装"],
      );
      assert.strictEqual(records[1]?.firstRequestText, "Visualize autonomy evolution trends");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("reads chat session requests and tool calls from jsonl files", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-insight-chat-session-records-"));
    try {
      const workspaceStorageRoot = path.join(tempRoot, "User", "workspaceStorage");
      const workspaceDir = path.join(workspaceStorageRoot, "workspace-1", "chatSessions");
      await fs.mkdir(workspaceDir, { recursive: true });

      await fs.writeFile(
        path.join(workspaceDir, "chat-record.jsonl"),
        [
          JSON.stringify({
            kind: 0,
            v: {
              sessionId: "chat-record",
              creationDate: 1760871632297,
              lastMessageDate: 1760871632397,
              customTitle: "セッションエクスプローラーの実装計画",
              requests: [],
              inputState: { mode: { kind: "agent", id: "file:///custom/agents/plan.agent.md" } },
            },
          }),
          JSON.stringify({
            kind: 2,
            k: ["requests"],
            v: [
              {
                requestId: "request-1",
                timestamp: 1760871633000,
                agent: { id: "github.copilot.editsAgent" },
                modelId: "copilot/oswe-vscode-prime",
                message: { text: "セッションエクスプローラーの実装計画" },
                response: [
                  {
                    kind: "toolInvocationSerialized",
                    toolCallId: "sub-1",
                    toolId: "runSubagent",
                    toolSpecificData: { kind: "subagent", description: "Investigate session explorer" },
                  },
                  {
                    kind: "toolInvocationSerialized",
                    toolCallId: "child-1",
                    toolId: "workspace/editFile",
                    subAgentInvocationId: "sub-1",
                    source: { type: "mcp", serverLabel: "Docs" },
                  },
                ],
                result: {
                  timings: { firstProgress: 1200, totalElapsed: 5400 },
                  metadata: {
                    renderedUserMessage: [{ value: "system prompt" }],
                    toolCallRounds: [
                      {
                        toolCalls: [
                          { id: "sub-1", name: "runSubagent" },
                          { id: "read-1", name: "read_file" },
                        ],
                      },
                    ],
                    toolCallResults: {
                      "child-1": { content: [{ value: "src/ui/copilotUsageHtml.ts" }] },
                      "read-1": {
                        content: [{ value: { filePath: "src/worker/dbWorker.ts", startLine: 1, endLine: 40 } }],
                      },
                    },
                  },
                },
              },
            ],
          }),
        ].join("\n"),
        "utf-8",
      );

      const records = await readChatSessionRecords(workspaceStorageRoot);
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0]?.title, "セッションエクスプローラーの実装計画");
      assert.strictEqual(records[0]?.requests.length, 1);
      assert.strictEqual(records[0]?.requests[0]?.customAgentName, "plan.agent.md");
      assert.strictEqual(records[0]?.requests[0]?.toolCalls[0]?.name, "runSubagent");
      assert.strictEqual(records[0]?.requests[0]?.toolCalls[0]?.subagentDescription, "Investigate session explorer");
      assert.strictEqual(records[0]?.requests[0]?.toolCalls[0]?.childToolCalls?.[0]?.name, "workspace/editFile");
      assert.strictEqual(records[0]?.requests[0]?.toolCalls[0]?.childToolCalls?.[0]?.mcpServer, "Docs");
      const readFileArgs = JSON.parse(records[0]?.requests[0]?.toolCalls[1]?.args ?? "{}");
      assert.deepStrictEqual(readFileArgs, {
        filePath: "src/worker/dbWorker.ts",
        startLine: 1,
        endLine: 40,
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
