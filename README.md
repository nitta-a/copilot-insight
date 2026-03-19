# Copilot Insight

> 🇬🇧 [English](#english) | 🇯🇵 [日本語](#japanese)

---

<a name="english"></a>

## English

A VS Code extension that parses GitHub Copilot's local log files and visualizes your usage statistics in a rich dashboard panel.

### Features

- **Usage Dashboard** — opens a detailed panel showing:
  - Total suggestions shown / accepted / declined
  - Overall acceptance rate, **True Acceptance Rate**, and estimated **minutes saved (ROI)** split into typing savings and agentic savings
  - **Best model** highlight derived from cross-language model performance
  - Daily usage chart with acceptance rate trendline (full span of available log data)
  - Weekly trend comparison (this week vs. last week)
  - AI model usage breakdown — Chat vs. Inline Completion, with per-model acceptance rate
  - Activity heatmap by hour of day
  - Auto-generated **Insights** summary (peak hour, weekly trend, chat/inline ratio)
- **Five-tab dashboard** — content is organised into focused tabs:
  - 📊 **Overview (ROI)**: summary cards, Insights, and Weekly Trend
  - 🔍 **Health (Diagnostics)**: True Acceptance Rate Timeline chart with anomaly highlighting, daily usage, model/latency/session breakdown, **Agent Intelligence Overview** (autonomous action count, loop completion rate, per-model agentic depth and velocity, **Planning & Execution** stats — Plans Proposed / Executed / Success Rate / User Choices)
  - 🌊 **Flow (Velocity)**: KPM vs completions scatter plot, activity heatmaps, **Context Effectiveness** breakdown by Copilot context source (Active File, Workspace, Symbol, Embeddings, etc.)
  - 💬 **Prompt Insights**: Tag Cloud of frequent terms, Intent Command donut, Prompt Length scatter chart, **Turn Churn** chart (multi-turn session distribution and resolution rate), and **Context Leverage** chart (reference-count buckets vs. acceptance rate)
  - 📂 **Sessions**: Session Intelligence Explorer with logical chat thread grouping, per-thread estimated minutes saved, autonomous-run highlighting, and drilldown timelines for user prompts, research, browser actions, file edits, and memory refresh boundaries
- **Real-time Status Bar** — live acceptance rate indicator in the VS Code status bar (`$(copilot) 73% (42/58)`); updates every 3 seconds during your coding session and opens the dashboard on click
- **MCP Server** — built-in Model Context Protocol server lets external AI agents (Claude Desktop, VS Code Copilot Chat, etc.) query your usage statistics via `get_usage_summary`, `get_model_efficiency`, and `get_anomaly_report` tools; no cloud or external network access required
- **Activity Bar** — dedicated sidebar view with quick-access buttons
- **Export** — export your statistics as CSV, JSON, Markdown report, or **PNG chart screenshot**
- **Refresh** — re-parse logs at any time with a single click

### How to Use

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **Copilot Insight: Show Usage**
3. The usage dashboard panel opens automatically

Alternatively, click the **Copilot Insight** icon in the Activity Bar on the left side of VS Code.

### Configuration

| Setting | Default | Description |
|---|---|---|
| `copilot-insight.maxSessionDirs` | `10` | Number of recent VS Code session directories to scan for Copilot logs (1–20) |
| `copilot-insight.defaultDisplayDays` | `14` | Default number of days shown in the Daily Usage chart (7, 14, or 30) |
| `copilot-insight.enableAdvancedAnalysis` | `true` | Enable the advanced analysis worker for deep metrics (true acceptance rate, velocity, model performance) |
| `copilot-insight.cliLogPath` | `""` | Path to the GitHub Copilot CLI session-state directory (leave empty for automatic discovery at `~/.copilot/session-state`) |
| `copilot-insight.cliRoiMinutesPerInteraction` | `30` | Estimated minutes saved per GitHub Copilot CLI interaction (used for ROI calculation) |
| `copilot-insight.cliDefaultModel` | `"Copilot CLI"` | Fallback model name label for CLI interactions when no model name can be detected from the log |

### Requirements

- GitHub Copilot extension must be installed in VS Code and actively used so that local log files are generated.

### Installing from VSIX (local build)

1. Build the extension package:
   ```bash
   npm run package
   ```
2. Install the generated VSIX file in VS Code:
   - Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
   - Run **Extensions: Install from VSIX...**
   - Select the `.vsix` file from the project root

   Or via the command line:
   ```bash
   code --install-extension copilot-insight-<version>.vsix
   ```

### Native Log Parser (optional)

An optional Rust native addon is included under `native-parser/`. Building it is **optional** — the extension works without it using the TypeScript fallback parsers. When the native module is available the bridge (`src/log/nativeBridge.ts`) offloads CPU-heavy log parsing to the compiled Rust code for improved performance.

#### Prerequisites

| Tool | Install guide |
|---|---|
| **Rust toolchain** (rustup, cargo) | <https://rustup.rs/> |
| **@napi-rs/cli** | bundled as a dev dependency (`npm install` installs it automatically) |

#### Build & verify

```bash
# 1. Build the native addon (outputs a .node file in native-parser/)
npm run build:native

# 2. Run the Rust unit tests
cd native-parser && cargo test
```

After `npm run build:native` succeeds, restart the VS Code extension host (or run **Developer: Reload Window**) to let the bridge pick up the native addon.

---

<a name="japanese"></a>

## 日本語

GitHub Copilot のローカルログファイルを解析し、使用統計をリッチなダッシュボードパネルで可視化する VS Code 拡張機能です。

### 機能

- **使用状況ダッシュボード** — 以下を含む詳細パネルを表示:
  - 提案の表示回数 / 受け入れ回数 / 拒否回数
  - 全体の受け入れ率・**真の受け入れ率 (True Acceptance Rate)**・推定**節約時間 (ROI)** (タイピング節約とエージェント節約の2分割表示)
  - クロス言語モデル性能から導出した**ベストモデル**ハイライト
  - 日次使用チャートと受け入れ率のトレンドライン (利用可能なログデータの全期間)
  - 週次トレンド比較 (今週 vs 先週)
  - AIモデル別の使用状況 — Chat vs. インライン補完、モデルごとの受け入れ率
  - 時間帯別のアクティビティヒートマップ
  - 自動生成される **Insights** サマリー (ピーク時間帯・週次トレンド・Chat/Inline 比率)
- **5タブダッシュボード** — コンテンツを目的別の5タブに整理:
  - 📊 **Overview (ROI)**: サマリーカード・Insights・週次トレンド
  - 🔍 **Health (Diagnostics)**: 真の受け入れ率タイムラインチャート (異常値ハイライト付き)・日次使用状況・モデル/レイテンシ/セッション内訳・**Agent Intelligence Overview** (自律アクション数・ループ完了率・モデル別エージェント深度と速度・**Planning & Execution** 統計 — 提案プラン数 / 実行プラン数 / 成功率 / ユーザー選択回数)
  - 🌊 **Flow (Velocity)**: KPM vs 補完受け入れ数の散布図・アクティビティヒートマップ・**コンテキスト効果** (Active File・Workspace・Symbol・Embeddings などのコンテキストソース別の貢献度)
  - 💬 **Prompt Insights**: よく使われる用語のタグクラウド・インテントコマンドのドーナツチャート・プロンプト長の散布図・**ターンチャーン**チャート (マルチターンセッション分布と解決率)・**コンテキストレバレッジ**チャート (参照ファイル数バケット別の受け入れ率)
  - 📂 **Sessions**: Session Intelligence Explorer。論理チャットスレッドごとの推定節約時間、自律実行の強調表示、ユーザー質問・調査・ブラウザ操作・ファイル編集・Memory Refreshed 境界を辿れるドリルダウンタイムライン
- **リアルタイムステータスバー** — VS Code のステータスバーにライブの受け入れ率インジケーターを表示 (`$(copilot) 73% (42/58)`)。コーディング中に 3 秒ごとに更新され、クリックするとダッシュボードが開く
- **MCP サーバー** — 組み込みの Model Context Protocol サーバーにより、外部 AI エージェント (Claude Desktop・VS Code Copilot Chat など) が `get_usage_summary`・`get_model_efficiency`・`get_anomaly_report` ツールを通じて使用統計を照会可能。クラウドや外部ネットワークへのアクセス不要
- **アクティビティバー** — サイドバーに専用ビューとクイックアクセスボタン
- **エクスポート** — 統計を CSV・JSON・Markdown レポート・**PNG チャートスクリーンショット**として書き出し
- **更新** — ワンクリックでログを再解析

### 使い方

1. コマンドパレットを開きます (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. **Copilot Insight: Show Usage** を実行します
3. 使用状況ダッシュボードのパネルが自動的に開きます

または、VS Code 左側のアクティビティバーにある **Copilot Insight** アイコンをクリックしてください。

### 設定

| 設定 | デフォルト | 説明 |
|---|---|---|
| `copilot-insight.maxSessionDirs` | `10` | Copilotログをスキャンする直近の VS Code セッションディレクトリ数 (1〜20) |
| `copilot-insight.defaultDisplayDays` | `14` | 日次使用チャートのデフォルト表示日数 (7・14・30 から選択) |
| `copilot-insight.enableAdvancedAnalysis` | `true` | 高度な分析ワーカーを有効にする (真の受け入れ率・速度・モデル性能)。無効にするとイベントログは継続されるが、メトリクスダッシュボードは利用不可 |
| `copilot-insight.cliLogPath` | `""` | GitHub Copilot CLI セッション状態ディレクトリのパス (空欄の場合は `~/.copilot/session-state` を自動探索) |
| `copilot-insight.cliRoiMinutesPerInteraction` | `30` | GitHub Copilot CLI インタラクション 1 回あたりの推定節約時間 (分)（ROI 計算に使用） |
| `copilot-insight.cliDefaultModel` | `"Copilot CLI"` | CLI ログからモデル名を検出できない場合のフォールバックラベル |

### 要件

- VS Code 内で GitHub Copilot 拡張機能がインストールされ、ローカルのログファイルが生成されるように実際に使用されている必要があります。

### VSIX からのインストール (ローカルビルド)

1. 拡張機能のパッケージ (VSIX) をビルドします:
   ```bash
   npm run package
   ```
2. 生成された VSIX ファイルを VS Code にインストールします:
   - コマンドパレットを開く (`Ctrl+Shift+P` / `Cmd+Shift+P`)
   - **Extensions: Install from VSIX...** を実行する
   - プロジェクトのルートにある `.vsix` ファイルを選択する

   またはコマンドラインから:
   ```bash
   code --install-extension copilot-insight-<version>.vsix
   ```

### ネイティブログパーサー (任意)

`native-parser/` ディレクトリにオプションの Rust ネイティブアドオンが含まれています。
ビルドは**任意**です — アドオンがなくても拡張機能は TypeScript フォールバックパーサーで通常どおり動作します。ネイティブモジュールが利用可能な場合、TypeScript ブリッジ (`src/log/nativeBridge.ts`) が CPU 負荷の高いログ解析処理をコンパイル済みの Rust コードにオフロードし、パフォーマンスを向上させます。

#### 前提条件

| ツール | インストール方法 |
|---|---|
| **Rust ツールチェーン** (rustup, cargo) | <https://rustup.rs/> |
| **@napi-rs/cli** | 開発依存関係として同梱済み (`npm install` で自動インストール) |

#### ビルドと動作確認

```bash
# 1. ネイティブアドオンをビルド (native-parser/ に .node ファイルを出力)
npm run build:native

# 2. Rust ユニットテストを実行
cd native-parser && cargo test
```

`npm run build:native` が成功したら、VS Code の拡張機能ホストを再起動 (**Developer: Reload Window** を実行) すると、ブリッジがネイティブアドオンを読み込みます。
