import * as vscode from "vscode";
import * as assert from "assert";
import {
  type InlineCompletionMetadata,
  InlineCompletionTracker,
  wrapInlineCompletionProvider,
} from "../../src/events/inlineCompletionWrapper";

// ---------------------------------------------------------------------------
// Minimal document / position / context stubs used by provideInlineCompletionItems
// ---------------------------------------------------------------------------

function makeDocument(languageId: string): vscode.TextDocument {
  return { languageId, uri: vscode.Uri.file(`/tmp/${languageId || "plain"}.ts`) } as unknown as vscode.TextDocument;
}

const stubPosition = new vscode.Position(0, 0);
const stubContext: vscode.InlineCompletionContext = {
  triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
  selectedCompletionInfo: undefined,
};
const stubToken: vscode.CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: (_event: unknown) => ({ dispose: () => {} }),
};

// ---------------------------------------------------------------------------
// wrapInlineCompletionProvider – pure function tests (no VS Code API needed)
// ---------------------------------------------------------------------------

suite("wrapInlineCompletionProvider", () => {
  test("injects tracking command into each item (array return)", () => {
    const original = new vscode.InlineCompletionItem("hello");
    const provider: vscode.InlineCompletionItemProvider = {
      provideInlineCompletionItems: () => [original],
    };

    const shownCalls: InlineCompletionMetadata[] = [];
    const acceptedCalls: InlineCompletionMetadata[] = [];
    const wrapped = wrapInlineCompletionProvider(provider, "my.accept.cmd", (l) => shownCalls.push(l));

    const result = wrapped.provideInlineCompletionItems(
      makeDocument("typescript"),
      stubPosition,
      stubContext,
      stubToken,
    );

    assert.ok(Array.isArray(result));
    const items = result as vscode.InlineCompletionItem[];
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].command?.command, "my.accept.cmd");
    const arg = items[0].command?.arguments?.[0] as { metadata: InlineCompletionMetadata; originalCommand: undefined };
    assert.strictEqual(arg.metadata.languageId, "typescript");
    assert.strictEqual(arg.metadata.acceptedText, "hello");
    assert.strictEqual(arg.metadata.lineNumber, 0);
    assert.strictEqual(arg.originalCommand, undefined);
  });

  test("preserves original command in arguments[1]", () => {
    const originalCmd: vscode.Command = { command: "ext.existing", title: "Original", arguments: ["arg"] };
    const item = new vscode.InlineCompletionItem("world", undefined, originalCmd);
    const provider: vscode.InlineCompletionItemProvider = {
      provideInlineCompletionItems: () => [item],
    };

    const wrapped = wrapInlineCompletionProvider(provider, "my.accept.cmd", () => {});
    const result = wrapped.provideInlineCompletionItems(makeDocument("python"), stubPosition, stubContext, stubToken);

    const items = result as vscode.InlineCompletionItem[];
    const arg = items[0].command?.arguments?.[0] as {
      metadata: InlineCompletionMetadata;
      originalCommand: vscode.Command;
    };
    assert.deepStrictEqual(arg.originalCommand, originalCmd);
  });

  test("injects tracking command into InlineCompletionList return", () => {
    const list: vscode.InlineCompletionList = { items: [new vscode.InlineCompletionItem("item1")] };
    const provider: vscode.InlineCompletionItemProvider = {
      provideInlineCompletionItems: () => list,
    };

    const wrapped = wrapInlineCompletionProvider(provider, "my.accept.cmd", () => {});
    const result = wrapped.provideInlineCompletionItems(makeDocument("rust"), stubPosition, stubContext, stubToken);

    assert.ok(!Array.isArray(result));
    const returnedList = result as vscode.InlineCompletionList;
    assert.strictEqual(returnedList.items[0].command?.command, "my.accept.cmd");
    const arg = returnedList.items[0].command?.arguments?.[0] as { metadata: InlineCompletionMetadata };
    assert.strictEqual(arg.metadata.languageId, "rust");
  });

  test("returns null/undefined unchanged", () => {
    const provider: vscode.InlineCompletionItemProvider = {
      provideInlineCompletionItems: () => null,
    };

    const wrapped = wrapInlineCompletionProvider(provider, "my.accept.cmd", () => {});
    const result = wrapped.provideInlineCompletionItems(makeDocument("go"), stubPosition, stubContext, stubToken);
    assert.strictEqual(result, null);
  });

  test("handles Promise return (array)", async () => {
    const provider: vscode.InlineCompletionItemProvider = {
      provideInlineCompletionItems: () => Promise.resolve([new vscode.InlineCompletionItem("async")]),
    };

    const wrapped = wrapInlineCompletionProvider(provider, "my.accept.cmd", () => {});
    const result = await (wrapped.provideInlineCompletionItems(
      makeDocument("java"),
      stubPosition,
      stubContext,
      stubToken,
    ) as Promise<vscode.InlineCompletionItem[]>);

    assert.ok(Array.isArray(result));
    assert.strictEqual(result[0].command?.command, "my.accept.cmd");
    const arg = result[0].command?.arguments?.[0] as { metadata: InlineCompletionMetadata };
    assert.strictEqual(arg.metadata.languageId, "java");
  });

  test("handles Promise return (null)", async () => {
    const provider: vscode.InlineCompletionItemProvider = {
      provideInlineCompletionItems: () => Promise.resolve(null),
    };

    const wrapped = wrapInlineCompletionProvider(provider, "my.accept.cmd", () => {});
    const result = await (wrapped.provideInlineCompletionItems(
      makeDocument("java"),
      stubPosition,
      stubContext,
      stubToken,
    ) as Promise<null>);
    assert.strictEqual(result, null);
  });

  test("handleDidShowCompletionItem calls onShown with languageId from command args", () => {
    const provider: vscode.InlineCompletionItemProvider = {
      provideInlineCompletionItems: () => [],
    };

    const shownCalls: InlineCompletionMetadata[] = [];
    const wrapped = wrapInlineCompletionProvider(provider, "my.accept.cmd", (l) => shownCalls.push(l));

    // Simulate a shown item that carries languageId in command.arguments[0]
    const shownItem = new vscode.InlineCompletionItem("shown");
    shownItem.command = {
      command: "my.accept.cmd",
      title: "",
      arguments: [
        { metadata: { languageId: "typescript", acceptedText: "shown", uri: "file:///tmp/test.ts", lineNumber: 12 } },
      ],
    };

    wrapped.handleDidShowCompletionItem?.(shownItem);
    assert.deepStrictEqual(shownCalls, [
      { languageId: "typescript", acceptedText: "shown", uri: "file:///tmp/test.ts", lineNumber: 12 },
    ]);
  });

  test("handleDidShowCompletionItem delegates to original provider", () => {
    let delegated = false;
    const provider = {
      provideInlineCompletionItems: () => [],
      handleDidShowCompletionItem: () => {
        delegated = true;
      },
    };

    const wrapped = wrapInlineCompletionProvider(provider, "my.accept.cmd", () => {});
    const item = new vscode.InlineCompletionItem("x");
    wrapped.handleDidShowCompletionItem?.(item);
    assert.strictEqual(delegated, true);
  });

  test("handleDidShowCompletionItem with empty languageId still increments", () => {
    const shownCalls: InlineCompletionMetadata[] = [];
    const provider: vscode.InlineCompletionItemProvider = { provideInlineCompletionItems: () => [] };
    const wrapped = wrapInlineCompletionProvider(provider, "cmd", (l) => shownCalls.push(l));

    // item without command -> empty languageId
    wrapped.handleDidShowCompletionItem?.(new vscode.InlineCompletionItem("x"));
    assert.deepStrictEqual(shownCalls, [{ languageId: "", acceptedText: "", uri: "", lineNumber: 0 }]);
  });

  test("handleDidPartiallyAcceptCompletionItem delegates to original provider", () => {
    let delegatedItem: vscode.InlineCompletionItem | undefined;
    const provider = {
      provideInlineCompletionItems: () => [],
      handleDidPartiallyAcceptCompletionItem: (item: vscode.InlineCompletionItem) => {
        delegatedItem = item;
      },
    };

    const wrapped = wrapInlineCompletionProvider(provider, "cmd", () => {});
    const item = new vscode.InlineCompletionItem("partial");
    wrapped.handleDidPartiallyAcceptCompletionItem?.(item, { acceptedLength: 3 });
    assert.strictEqual(delegatedItem, item);
  });
});

// ---------------------------------------------------------------------------
// InlineCompletionTracker – integration tests (runs inside VS Code)
// ---------------------------------------------------------------------------

suite("InlineCompletionTracker", () => {
  let tracker: InlineCompletionTracker;
  let savedRegisterFn: typeof vscode.languages.registerInlineCompletionItemProvider;

  // Capture the real function before any test runs so teardown can always restore it.
  suiteSetup(() => {
    savedRegisterFn = vscode.languages.registerInlineCompletionItemProvider;
  });

  setup(() => {
    const subscriptions: vscode.Disposable[] = [];
    tracker = new InlineCompletionTracker({ subscriptions } as unknown as vscode.ExtensionContext);
  });

  teardown(() => {
    tracker.dispose();
    // Safety net: always restore the function in case dispose failed.
    (vscode.languages as unknown as Record<string, unknown>).registerInlineCompletionItemProvider = savedRegisterFn;
  });

  test("initial stats are zero", () => {
    const { totalShown, totalAccepted, byLanguage } = tracker.stats;
    assert.strictEqual(totalShown, 0);
    assert.strictEqual(totalAccepted, 0);
    assert.strictEqual(byLanguage.size, 0);
  });

  test("stats snapshot is immutable (new Map each call)", () => {
    const s1 = tracker.stats;
    const s2 = tracker.stats;
    assert.notStrictEqual(s1.byLanguage, s2.byLanguage);
  });

  test("acceptance command increments totalAccepted with languageId", async () => {
    await vscode.commands.executeCommand(InlineCompletionTracker.ACCEPT_COMMAND, {
      metadata: { languageId: "typescript", acceptedText: "hello", uri: "file:///tmp/test.ts", lineNumber: 4 },
      originalCommand: undefined,
    });
    assert.strictEqual(tracker.stats.totalAccepted, 1);
    assert.deepStrictEqual(tracker.stats.byLanguage.get("typescript"), { shown: 0, accepted: 1 });
  });

  test("acceptance command with empty languageId still increments total", async () => {
    await vscode.commands.executeCommand(InlineCompletionTracker.ACCEPT_COMMAND, {
      metadata: { languageId: "", acceptedText: "", uri: "", lineNumber: 0 },
      originalCommand: undefined,
    });
    assert.strictEqual(tracker.stats.totalAccepted, 1);
    assert.strictEqual(tracker.stats.byLanguage.size, 0);
  });

  test("acceptance command executes original command when provided", async () => {
    let originalCalled = false;
    const dummyCmd = "copilot-insight-test.internal.dummyForAcceptTest";
    const reg = vscode.commands.registerCommand(dummyCmd, () => {
      originalCalled = true;
    });
    try {
      await vscode.commands.executeCommand(InlineCompletionTracker.ACCEPT_COMMAND, {
        metadata: { languageId: "go", acceptedText: "fmt.Println", uri: "file:///tmp/test.go", lineNumber: 1 },
        originalCommand: {
          command: dummyCmd,
          title: "",
          arguments: [],
        },
      });
      assert.strictEqual(originalCalled, true);
    } finally {
      reg.dispose();
    }
  });

  test("accumulates multiple acceptance events across languages", async () => {
    await vscode.commands.executeCommand(InlineCompletionTracker.ACCEPT_COMMAND, {
      metadata: { languageId: "typescript", acceptedText: "a", uri: "file:///tmp/a.ts", lineNumber: 1 },
      originalCommand: undefined,
    });
    await vscode.commands.executeCommand(InlineCompletionTracker.ACCEPT_COMMAND, {
      metadata: { languageId: "python", acceptedText: "b", uri: "file:///tmp/a.py", lineNumber: 2 },
      originalCommand: undefined,
    });
    await vscode.commands.executeCommand(InlineCompletionTracker.ACCEPT_COMMAND, {
      metadata: { languageId: "typescript", acceptedText: "c", uri: "file:///tmp/b.ts", lineNumber: 3 },
      originalCommand: undefined,
    });

    assert.strictEqual(tracker.stats.totalAccepted, 3);
    assert.deepStrictEqual(tracker.stats.byLanguage.get("typescript"), { shown: 0, accepted: 2 });
    assert.deepStrictEqual(tracker.stats.byLanguage.get("python"), { shown: 0, accepted: 1 });
  });

  test("acceptance callback receives metadata", async () => {
    const callbacks: InlineCompletionMetadata[] = [];
    tracker.dispose();
    tracker = new InlineCompletionTracker({ subscriptions: [] } as unknown as vscode.ExtensionContext, {
      onAccepted: (metadata) => {
        callbacks.push(metadata);
      },
    });

    await vscode.commands.executeCommand(InlineCompletionTracker.ACCEPT_COMMAND, {
      metadata: { languageId: "typescript", acceptedText: "const x = 1;", uri: "file:///tmp/test.ts", lineNumber: 9 },
      originalCommand: undefined,
    });

    assert.deepStrictEqual(callbacks, [
      { languageId: "typescript", acceptedText: "const x = 1;", uri: "file:///tmp/test.ts", lineNumber: 9 },
    ]);
  });

  test("dispose restores the original registerInlineCompletionItemProvider", () => {
    // After construction the function should be the patched version.
    assert.notStrictEqual(vscode.languages.registerInlineCompletionItemProvider, savedRegisterFn);

    tracker.dispose();

    assert.strictEqual(vscode.languages.registerInlineCompletionItemProvider, savedRegisterFn);
  });

  test("dispose is idempotent", () => {
    tracker.dispose();
    assert.doesNotThrow(() => tracker.dispose());
  });
});
