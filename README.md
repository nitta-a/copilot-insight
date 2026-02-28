# GitHub Copilot Usage Dashboard

GitHub Copilot のローカルログファイルを解析し、使用統計をパネルに表示するVS Code拡張機能です。

## 機能

- **Show GitHub Copilot Usage** コマンド: Copilotのログファイルを解析し、以下を表示します:
  - 提案の表示回数 / 受け入れ回数 / 拒否回数
  - 全体の受け入れ率 (Acceptance Rate)
  - 言語別の内訳
  - 日付別の内訳
  - AIモデルの使用状況 (Chat / Inline)
  - 時間帯別のアクティビティ

## 使い方

1. コマンドパレットを開きます (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. **Show GitHub Copilot Usage** を実行します
3. Copilotの使用統計を示すパネルが開きます

## ローカルへのインストール

開発やテストの目的で、ローカル環境にこの拡張機能をインストールする手順です:

1. 拡張機能のパッケージ（VSIX）をビルドします:
   ```bash
   npm run package
   ```

2. 生成されたVSIXファイルをVS Codeにインストールします:
   - VS Code を開く
   - コマンドパレットを開く (`Ctrl+Shift+P` / `Cmd+Shift+P`)
   - **Extensions: Install from VSIX...** を実行する
   - プロジェクトのルートディレクトリにある `copilot-insight-0.1.0.vsix` を選択する

または、コマンドラインから以下のコマンドでインストールすることも可能です:
```bash
code --install-extension copilot-insight-0.1.0.vsix
```

## 要件

- VS Code 内で GitHub Copilot 拡張機能がインストールされ、ログファイルが生成されるように実際に使用されている必要があります。

## リリースノート

### 0.1.0

初期プレリリース版。
