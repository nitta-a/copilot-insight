import * as vscode from "vscode";

export interface InlineCompletionMetadata {
  languageId: string;
  acceptedText: string;
  uri: string;
  lineNumber: number;
}

interface TrackingCommandArguments {
  metadata: InlineCompletionMetadata;
  originalCommand: vscode.Command | undefined;
}

/** Real-time inline completion statistics for the current VS Code session. */
export interface RealtimeInlineStats {
  readonly totalShown: number;
  readonly totalAccepted: number;
  readonly byLanguage: ReadonlyMap<string, { shown: number; accepted: number }>;
}

/**
 * Augmented interface that adds the VS Code inline-completions proposed API
 * methods present at runtime in VS Code >= 1.79 but not yet reflected in the
 * stable `@types/vscode` definitions (see `inlineCompletionsAdditions`).
 */
interface AugmentedInlineCompletionItemProvider extends vscode.InlineCompletionItemProvider {
  handleDidShowCompletionItem?(item: vscode.InlineCompletionItem, updatedInsertText?: string): void;
  handleDidPartiallyAcceptCompletionItem?(item: vscode.InlineCompletionItem, info: { acceptedLength: number }): void;
}

/**
 * Wraps an `InlineCompletionItemProvider` to intercept its show and accept
 * events without changing any observable completion behaviour.
 *
 * - Each `InlineCompletionItem` returned by `provideInlineCompletionItems` has
 *   a tracking command injected; the command fires `onAccepted` with the
 *   document's language ID when the user accepts the suggestion.  Any command
 *   that was already on the item is forwarded so no existing behaviour is lost.
 * - `handleDidShowCompletionItem` calls `onShown` synchronously and then
 *   delegates to the original provider's implementation if present.
 * - `handleDidPartiallyAcceptCompletionItem` is forwarded transparently.
 *
 * @param provider        The provider to wrap.
 * @param acceptCommand   The VS Code command ID to inject for acceptance tracking.
 * @param onShown         Called with `languageId` each time a completion is shown.
 * @param onAccepted      Called with `languageId` each time a completion is accepted.
 */
export function wrapInlineCompletionProvider(
  provider: vscode.InlineCompletionItemProvider,
  acceptCommand: string,
  onShown: (metadata: InlineCompletionMetadata) => void,
): AugmentedInlineCompletionItemProvider {
  const augmented = provider as AugmentedInlineCompletionItemProvider;
  return {
    /** Provide completions, injecting the acceptance-tracking command into each item. */
    provideInlineCompletionItems(
      document: vscode.TextDocument,
      position: vscode.Position,
      context: vscode.InlineCompletionContext,
      token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
      const rawResult = provider.provideInlineCompletionItems(document, position, context, token);
      const languageId = document.languageId;

      if (!rawResult) {
        return rawResult;
      }

      /** Injects a tracking command while preserving any existing command. */
      function wrapItems(items: vscode.InlineCompletionItem[]): vscode.InlineCompletionItem[] {
        return items.map((item) => ({
          ...item,
          command: {
            command: acceptCommand,
            title: "",
            arguments: [
              {
                metadata: buildInlineCompletionMetadata(document, position, item),
                originalCommand: item.command,
              } satisfies TrackingCommandArguments,
            ],
          } satisfies vscode.Command,
        }));
      }

      // Handle both synchronous and Promise-based returns.
      if (rawResult instanceof Promise) {
        return rawResult.then((result) => {
          if (!result) {
            return result;
          }
          if (Array.isArray(result)) {
            return wrapItems(result);
          }
          return { ...result, items: wrapItems(result.items) };
        });
      }

      if (Array.isArray(rawResult)) {
        return wrapItems(rawResult);
      }
      return { ...rawResult, items: wrapItems((rawResult as vscode.InlineCompletionList).items) };
    },

    /**
     * Fired by VS Code when one of this provider's items is displayed.
     * The item carries `languageId` in `command.arguments[0]` (set above).
     */
    handleDidShowCompletionItem(item: vscode.InlineCompletionItem, updatedInsertText?: string): void {
      onShown(readMetadataFromCommand(item));
      augmented.handleDidShowCompletionItem?.(item, updatedInsertText);
    },

    /** Forward partial-accept events to the original provider if it supports them. */
    handleDidPartiallyAcceptCompletionItem(item: vscode.InlineCompletionItem, info: { acceptedLength: number }): void {
      augmented.handleDidPartiallyAcceptCompletionItem?.(item, info);
    },
  };
}

/**
 * Wraps `vscode.languages.registerInlineCompletionItemProvider` so that any
 * provider registered *after* this tracker is installed has its show and accept
 * events intercepted and counted in real-time.
 *
 * Accuracy improvements over log-file parsing:
 * - `handleDidShowCompletionItem` fires synchronously when VS Code displays an
 *   inline suggestion — no log-write latency.
 * - A tracking command injected into each `InlineCompletionItem` fires
 *   synchronously when the user accepts it — no pattern-matching required.
 * - Events are counted in-process, so they cannot be lost due to file I/O
 *   errors or log-rotation.
 *
 * Usage:
 * ```ts
 * const tracker = new InlineCompletionTracker(context);
 * // later:
 * const { totalShown, totalAccepted } = tracker.stats;
 * ```
 */
export class InlineCompletionTracker implements vscode.Disposable {
  /** VS Code command used to record an inline acceptance. Internal use only. */
  static readonly ACCEPT_COMMAND = "copilot-insight.internal.trackInlineAccepted";

  private _totalShown = 0;
  private _totalAccepted = 0;
  private readonly _byLanguage = new Map<string, { shown: number; accepted: number }>();
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _originalRegister: typeof vscode.languages.registerInlineCompletionItemProvider;
  private readonly _onAcceptedEvent?: (metadata: InlineCompletionMetadata) => void | Promise<void>;
  private readonly _onShownEvent?: (metadata: InlineCompletionMetadata) => void | Promise<void>;

  constructor(
    context: vscode.ExtensionContext,
    options?: {
      onAccepted?: (metadata: InlineCompletionMetadata) => void | Promise<void>;
      onShown?: (metadata: InlineCompletionMetadata) => void | Promise<void>;
    },
  ) {
    this._onAcceptedEvent = options?.onAccepted;
    this._onShownEvent = options?.onShown;
    // Save the exact original reference (no .bind()) so dispose() can restore it
    // with strict reference equality.
    this._originalRegister = vscode.languages.registerInlineCompletionItemProvider;

    // Keep a bound copy only for calling, so the 'this' context is correct at runtime.
    const callOriginal = this._originalRegister.bind(vscode.languages);

    // Patch the global registration function.
    (vscode.languages as unknown as Record<string, unknown>).registerInlineCompletionItemProvider = (
      selector: vscode.DocumentSelector,
      provider: vscode.InlineCompletionItemProvider,
    ): vscode.Disposable =>
      callOriginal(
        selector,
        wrapInlineCompletionProvider(provider, InlineCompletionTracker.ACCEPT_COMMAND, (metadata) =>
          this._onShown(metadata),
        ),
      );

    // Register the acceptance-tracking command.
    this._disposables.push(
      vscode.commands.registerCommand(
        InlineCompletionTracker.ACCEPT_COMMAND,
        async (args: TrackingCommandArguments | string, originalCmd?: vscode.Command) => {
          const { metadata, forwardedCommand } = normalizeAcceptCommandArgs(args, originalCmd);
          this._onAccepted(metadata);
          await this._onAcceptedEvent?.(metadata);
          if (forwardedCommand) {
            await vscode.commands.executeCommand(forwardedCommand.command, ...(forwardedCommand.arguments ?? []));
          }
        },
      ),
    );

    // Restore the original function when the extension is deactivated.
    context.subscriptions.push(this);
  }

  /** Current real-time statistics snapshot. */
  get stats(): RealtimeInlineStats {
    return {
      totalShown: this._totalShown,
      totalAccepted: this._totalAccepted,
      byLanguage: new Map(this._byLanguage),
    };
  }

  dispose(): void {
    // Restore the original registration function.
    (vscode.languages as unknown as Record<string, unknown>).registerInlineCompletionItemProvider =
      this._originalRegister;
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
  }

  private _onShown(metadata: InlineCompletionMetadata): void {
    this._totalShown++;
    if (metadata.languageId) {
      const entry = this._byLanguage.get(metadata.languageId) ?? { shown: 0, accepted: 0 };
      entry.shown++;
      this._byLanguage.set(metadata.languageId, entry);
    }
    void this._onShownEvent?.(metadata);
  }

  private _onAccepted(metadata: InlineCompletionMetadata): void {
    this._totalAccepted++;
    if (metadata.languageId) {
      const entry = this._byLanguage.get(metadata.languageId) ?? { shown: 0, accepted: 0 };
      entry.accepted++;
      this._byLanguage.set(metadata.languageId, entry);
    }
  }
}

function extractAcceptedText(item: vscode.InlineCompletionItem): string {
  const insertText = item.insertText;
  if (typeof insertText === "string") {
    return insertText;
  }
  if (insertText && typeof insertText === "object" && "value" in insertText && typeof insertText.value === "string") {
    return insertText.value;
  }
  return "";
}

function buildInlineCompletionMetadata(
  document: vscode.TextDocument,
  position: vscode.Position,
  item: vscode.InlineCompletionItem,
): InlineCompletionMetadata {
  return {
    languageId: document.languageId,
    acceptedText: extractAcceptedText(item),
    uri: document.uri?.toString() ?? "",
    lineNumber: position.line,
  };
}

function readMetadataFromCommand(item: vscode.InlineCompletionItem): InlineCompletionMetadata {
  const firstArg = item.command?.arguments?.[0];
  if (isTrackingCommandArguments(firstArg)) {
    return firstArg.metadata;
  }
  if (typeof firstArg === "string") {
    return {
      languageId: firstArg,
      acceptedText: "",
      uri: "",
      lineNumber: 0,
    };
  }
  return {
    languageId: "",
    acceptedText: "",
    uri: "",
    lineNumber: 0,
  };
}

function normalizeAcceptCommandArgs(
  args: TrackingCommandArguments | string,
  originalCmd?: vscode.Command,
): { metadata: InlineCompletionMetadata; forwardedCommand: vscode.Command | undefined } {
  if (isTrackingCommandArguments(args)) {
    return {
      metadata: args.metadata,
      forwardedCommand: args.originalCommand,
    };
  }
  return {
    metadata: {
      languageId: typeof args === "string" ? args : "",
      acceptedText: "",
      uri: "",
      lineNumber: 0,
    },
    forwardedCommand: originalCmd,
  };
}

function isTrackingCommandArguments(value: unknown): value is TrackingCommandArguments {
  return Boolean(
    value &&
      typeof value === "object" &&
      "metadata" in value &&
      value.metadata &&
      typeof (value as TrackingCommandArguments).metadata.languageId === "string",
  );
}
