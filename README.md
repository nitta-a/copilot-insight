# Copilot Insight

> 🇬🇧 [English](#english) | 🇯🇵 [日本語](#japanese)

---

<a name="english"></a>

## English

A VS Code extension that parses GitHub Copilot's local log files and visualizes your usage statistics in a rich dashboard panel.

### Features

- **Usage Dashboard** — opens a detailed panel showing:
  - Total suggestions shown / accepted / declined
  - Overall acceptance rate
  - Breakdown by programming language (top N languages configurable)
  - Daily usage chart with acceptance rate trendline (last 7 / 14 / 30 days)
  - Weekly trend comparison (this week vs. last week)
  - AI model usage breakdown — Chat vs. Inline Completion, with per-model acceptance rate
  - Activity heatmap by hour of day
  - Auto-generated **Insights** summary (best language, peak hour, weekly trend, chat/inline ratio)
- **Activity Bar** — dedicated sidebar view with quick-access buttons
- **Export** — export your statistics as CSV, JSON, or a Markdown report
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
| `copilot-insight.defaultDisplayDays` | `14` | Default date range for the Daily Usage chart (`7`, `14`, or `30` days) |
| `copilot-insight.topLanguagesCount` | `10` | Number of top languages shown in the Language chart (3–30) |

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

### Release Notes

See [CHANGELOG.md](CHANGELOG.md) for the full history.

#### 1.0.1
- 💡 Insights section with auto-generated summary observations
- 📅 Daily acceptance rate trendline
- 🤖 Per-model acceptance rate in the Inline Completion Model chart
- Enhanced CSV/JSON export

#### 1.0.0
- Initial stable release with full usage dashboard, language/date breakdown, weekly trend, Activity Bar view, and CSV/JSON export

---

<a name="japanese"></a>

## 日本語

GitHub Copilot のローカルログファイルを解析し、使用統計をリッチなダッシュボードパネルで可視化する VS Code 拡張機能です。

### 機能

- **使用状況ダッシュボード** — 以下を含む詳細パネルを表示:
  - 提案の表示回数 / 受け入れ回数 / 拒否回数
  - 全体の受け入れ率 (Acceptance Rate)
  - プログラミング言語別の内訳 (表示言語数は設定で変更可能)
  - 日次使用チャートと受け入れ率のトレンドライン (直近 7 / 14 / 30 日)
  - 週次トレンド比較 (今週 vs 先週)
  - AIモデル別の使用状況 — Chat vs. インライン補完、モデルごとの受け入れ率
  - 時間帯別のアクティビティヒートマップ
  - 自動生成される **Insights** サマリー (最も受け入れ率が高い言語・ピーク時間帯・週次トレンド・Chat/Inline 比率)
- **アクティビティバー** — サイドバーに専用ビューとクイックアクセスボタン
- **エクスポート** — 統計を CSV・JSON・Markdown レポートとして書き出し
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
| `copilot-insight.defaultDisplayDays` | `14` | 日次使用チャートのデフォルト表示日数 (`7`・`14`・`30` 日) |
| `copilot-insight.topLanguagesCount` | `10` | 言語チャートに表示するトップ言語数 (3〜30) |

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

### リリースノート

完全な履歴は [CHANGELOG.md](CHANGELOG.md) を参照してください。

#### 1.0.1
- 💡 自動生成される Insights セクション
- 📅 日次受け入れ率トレンドライン
- 🤖 インライン補完モデルチャートにモデルごとの受け入れ率を追加
- CSV / JSON エクスポートの強化

#### 1.0.0
- フル機能の使用状況ダッシュボード、言語/日付別内訳、週次トレンド、アクティビティバービュー、CSV/JSON エクスポートを含む初期安定版リリース
