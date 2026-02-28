import * as assert from "assert";
import * as vscode from "vscode";

import { InlineCompletionTracker, wrapInlineCompletionProvider } from "../inlineCompletionWrapper";

// ---------------------------------------------------------------------------
// Minimal document / position / context stubs used by provideInlineCompletionItems
// ---------------------------------------------------------------------------

function makeDocument(languageId: string): vscode.TextDocument {
  return { languageId } as unknown as vscode.TextDocument;
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

    const shownCalls: string[] = [];
    const acceptedCalls: string[] = [];
    const wrapped = wrapInlineCompletionProvider(
      provider,
      "my.accept.cmd",
      (l) => shownCalls.push(l),
      (l) => acceptedCalls.push(l),
    );

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
    assert.strictEqual(items[0].command?.arguments?.[0], "typescript");
    // The original (undefined) command is forwarded as arguments[1]
    assert.strictEqual(items[0].command?.arguments?.[1], undefined);
  });

  test("preserves original command in arguments[1]", () => {
    const originalCmd: vscode.Command = { command: "ext.existing", title: "Original", arguments: ["arg"] };
    const item = new vscode.InlineCompletionItem("world", undefined, originalCmd);
    const provider: vscode.InlineCompletionItemProvider = {
      provideInlineCompletionItems: () => [item],
    };

    const wrapped = wrapInlineCompletionProvider(
      provider,
      "my.accept.cmd",
      () => {},
      () => {},
    );
    const result = wrapped.provideInlineCompletionItems(makeDocument("python"), stubPosition, stubContext, stubToken);

    const items = result as vscode.InlineCompletionItem[];
    assert.deepStrictEqual(items[0].command?.arguments?.[1], originalCmd);
  });

  test("injects tracking command into InlineCompletionList return", () => {
    const list: vscode.InlineCompletionList = { items: [new vscode.InlineCompletionItem("item1")] };
    const provider: vscode.InlineCompletionItemProvider = {
      provideInlineCompletionItems: () => list,
    };

    const wrapped = wrapInlineCompletionProvider(
      provider,
      "my.accept.cmd",
      () => {},
      () => {},
    );
    const result = wrapped.provideInlineCompletionItems(makeDocument("rust"), stubPosition, stubContext, stubToken);

    assert.ok(!Array.isArray(result));
    const returnedList = result as vscode.InlineCompletionList;
    assert.strictEqual(returnedList.items[0].command?.command, "my.accept.cmd");
    assert.strictEqual(returnedList.items[0].command?.arguments?.[0], "rust");
  });

  test("returns null/undefined unchanged", () => {
    const provider: vscode.InlineCompletionItemProvider = {
      provideInlineCompletionItems: () => null,
    };

    const wrapped = wrapInlineCompletionProvider(
      provider,
      "my.accept.cmd",
      () => {},
      () => {},
    );
    const result = wrapped.provideInlineCompletionItems(makeDocument("go"), stubPosition, stubContext, stubToken);
    assert.strictEqual(result, null);
  });

  test("handles Promise return (array)", async () => {
    const provider: vscode.InlineCompletionItemProvider = {
      provideInlineCompletionItems: () => Promise.resolve([new vscode.InlineCompletionItem("async")]),
    };

    const wrapped = wrapInlineCompletionProvider(
      provider,
      "my.accept.cmd",
      () => {},
      () => {},
    );
    const result = await (wrapped.provideInlineCompletionItems(
      makeDocument("java"),
      stubPosition,
      stubContext,
      stubToken,
    ) as Promise<vscode.InlineCompletionItem[]>);

    assert.ok(Array.isArray(result));
    assert.strictEqual(result[0].command?.command, "my.accept.cmd");
    assert.strictEqual(result[0].command?.arguments?.[0], "java");
  });

  test("handles Promise return (null)", async () => {
    const provider: vscode.InlineCompletionItemProvider = {
      provideInlineCompletionItems: () => Promise.resolve(null),
    };

    const wrapped = wrapInlineCompletionProvider(
      provider,
      "my.accept.cmd",
      () => {},
      () => {},
    );
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

    const shownCalls: string[] = [];
    const wrapped = wrapInlineCompletionProvider(
      provider,
      "my.accept.cmd",
      (l) => shownCalls.push(l),
      () => {},
    );

    // Simulate a shown item that carries languageId in command.arguments[0]
    const shownItem = new vscode.InlineCompletionItem("shown");
    shownItem.command = { command: "my.accept.cmd", title: "", arguments: ["typescript", undefined] };

    wrapped.handleDidShowCompletionItem?.(shownItem);
    assert.deepStrictEqual(shownCalls, ["typescript"]);
  });

  test("handleDidShowCompletionItem delegates to original provider", () => {
    let delegated = false;
    const provider = {
      provideInlineCompletionItems: () => [],
      handleDidShowCompletionItem: () => {
        delegated = true;
      },
    };

    const wrapped = wrapInlineCompletionProvider(
      provider,
      "my.accept.cmd",
      () => {},
      () => {},
    );
    const item = new vscode.InlineCompletionItem("x");
    wrapped.handleDidShowCompletionItem?.(item);
    assert.strictEqual(delegated, true);
  });

  test("handleDidShowCompletionItem with empty languageId still increments", () => {
    const shownCalls: string[] = [];
    const provider: vscode.InlineCompletionItemProvider = { provideInlineCompletionItems: () => [] };
    const wrapped = wrapInlineCompletionProvider(
      provider,
      "cmd",
      (l) => shownCalls.push(l),
      () => {},
    );

    // item without command -> empty languageId
    wrapped.handleDidShowCompletionItem?.(new vscode.InlineCompletionItem("x"));
    assert.deepStrictEqual(shownCalls, [""]);
  });

  test("handleDidPartiallyAcceptCompletionItem delegates to original provider", () => {
    let delegatedItem: vscode.InlineCompletionItem | undefined;
    const provider = {
      provideInlineCompletionItems: () => [],
      handleDidPartiallyAcceptCompletionItem: (item: vscode.InlineCompletionItem) => {
        delegatedItem = item;
      },
    };

    const wrapped = wrapInlineCompletionProvider(
      provider,
      "cmd",
      () => {},
      () => {},
    );
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
    await vscode.commands.executeCommand(InlineCompletionTracker.ACCEPT_COMMAND, "typescript", undefined);
    assert.strictEqual(tracker.stats.totalAccepted, 1);
    assert.deepStrictEqual(tracker.stats.byLanguage.get("typescript"), { shown: 0, accepted: 1 });
  });

  test("acceptance command with empty languageId still increments total", async () => {
    await vscode.commands.executeCommand(InlineCompletionTracker.ACCEPT_COMMAND, "", undefined);
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
      await vscode.commands.executeCommand(InlineCompletionTracker.ACCEPT_COMMAND, "go", {
        command: dummyCmd,
        title: "",
        arguments: [],
      });
      assert.strictEqual(originalCalled, true);
    } finally {
      reg.dispose();
    }
  });

  test("accumulates multiple acceptance events across languages", async () => {
    await vscode.commands.executeCommand(InlineCompletionTracker.ACCEPT_COMMAND, "typescript", undefined);
    await vscode.commands.executeCommand(InlineCompletionTracker.ACCEPT_COMMAND, "python", undefined);
    await vscode.commands.executeCommand(InlineCompletionTracker.ACCEPT_COMMAND, "typescript", undefined);

    assert.strictEqual(tracker.stats.totalAccepted, 3);
    assert.deepStrictEqual(tracker.stats.byLanguage.get("typescript"), { shown: 0, accepted: 2 });
    assert.deepStrictEqual(tracker.stats.byLanguage.get("python"), { shown: 0, accepted: 1 });
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
