# Copilot Insight

> 🇬🇧 [English](#english) | 🇯🇵 [日本語](#japanese)

---

<a name="english"></a>

## English

A VS Code extension that parses GitHub Copilot's local log files and visualizes your usage statistics in a rich dashboard panel.

### Features

- **Usage Dashboard** — opens a detailed panel showing:
  - Total suggestions shown / accepted / declined
  - Overall acceptance rate, **True Acceptance Rate**, and estimated **minutes saved (ROI)**
  - **Best model** highlight derived from cross-language model performance
  - Breakdown by programming language (top N languages configurable)
  - Daily usage chart with acceptance rate trendline (full span of available log data)
  - Weekly trend comparison (this week vs. last week)
  - AI model usage breakdown — Chat vs. Inline Completion, with per-model acceptance rate
  - Activity heatmap by hour of day
  - Auto-generated **Insights** summary (best language, peak hour, weekly trend, chat/inline ratio)
- **Three-tab dashboard** — content is organised into focused tabs:
  - 📊 **Overview (ROI)**: summary cards, Insights, and Weekly Trend
  - 🔍 **Health (Diagnostics)**: True Acceptance Rate Timeline chart with anomaly highlighting, daily usage, model/latency/session breakdown
  - 🌊 **Flow (Velocity)**: KPM vs completions scatter plot, activity heatmaps, context-source insights
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
| `copilot-insight.maxSessionDirs` | `5` | Number of recent VS Code session directories to scan for Copilot logs (1–20) |
| `copilot-insight.topLanguagesCount` | `10` | Number of top languages shown in the Language chart (3–30) |
| `copilot-insight.enableAdvancedAnalysis` | `true` | Enable the advanced analysis worker for deep metrics (true acceptance rate, velocity, model performance) |

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

---

<a name="japanese"></a>

## 日本語

GitHub Copilot のローカルログファイルを解析し、使用統計をリッチなダッシュボードパネルで可視化する VS Code 拡張機能です。

### 機能

- **使用状況ダッシュボード** — 以下を含む詳細パネルを表示:
  - 提案の表示回数 / 受け入れ回数 / 拒否回数
  - 全体の受け入れ率・**真の受け入れ率 (True Acceptance Rate)**・推定**節約時間 (ROI)**
  - クロス言語モデル性能から導出した**ベストモデル**ハイライト
  - プログラミング言語別の内訳 (表示言語数は設定で変更可能)
  - 日次使用チャートと受け入れ率のトレンドライン (利用可能なログデータの全期間)
  - 週次トレンド比較 (今週 vs 先週)
  - AIモデル別の使用状況 — Chat vs. インライン補完、モデルごとの受け入れ率
  - 時間帯別のアクティビティヒートマップ
  - 自動生成される **Insights** サマリー (最も受け入れ率が高い言語・ピーク時間帯・週次トレンド・Chat/Inline 比率)
- **3タブダッシュボード** — コンテンツを目的別の3タブに整理:
  - 📊 **Overview (ROI)**: サマリーカード・Insights・週次トレンド
  - 🔍 **Health (Diagnostics)**: 真の受け入れ率タイムラインチャート (異常値ハイライト付き)・日次使用状況・モデル/レイテンシ/セッション内訳
  - 🌊 **Flow (Velocity)**: KPM vs 補完受け入れ数の散布図・アクティビティヒートマップ・コンテキストソースインサイト
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
| `copilot-insight.maxSessionDirs` | `5` | Copilotログをスキャンする直近の VS Code セッションディレクトリ数 (1〜20) |
| `copilot-insight.topLanguagesCount` | `10` | 言語チャートに表示するトップ言語数 (3〜30) |
| `copilot-insight.enableAdvancedAnalysis` | `true` | 高度な分析ワーカーを有効にする (真の受け入れ率・速度・モデル性能)。無効にするとイベントログは継続されるが、メトリクスダッシュボードは利用不可 |

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
