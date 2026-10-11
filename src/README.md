# `src` フロントエンド入門ガイド

このディレクトリには、ブラウザで動く React + TypeScript のチャット画面があります。主な役割は、ログイン、質問の送信、AI エージェントから届く回答のリアルタイム表示です。

## ファイルの役割

| ファイル | 役割 |
| --- | --- |
| `main.tsx` | Amplify を初期化し、ログイン画面で `App` を囲んで React を起動する |
| `App.tsx` | チャットの状態管理、Runtime の呼び出し、ストリームの表示を行う |
| `App.css` | チャット画面固有の見た目を定義する |
| `index.css` | ページ全体に共通する見た目を定義する |
| `vite-env.d.ts` | Vite 用の TypeScript 型情報を読み込む |

## 画面が表示されるまで

```text
index.html の <div id="root">
  └─ main.tsx
      ├─ Amplify.configure(outputs)
      ├─ <Authenticator>（ログイン画面）
      └─ App.tsx（チャット画面）
```

### `main.tsx`

ブラウザで最初に実行される TypeScript ファイルです。

1. `amplify_outputs.json` を `Amplify.configure()` に渡す
2. Amplify UI の認証画面を日本語化する
3. HTML の `root` 要素に React アプリを描画する
4. `Authenticator` で `App` を囲み、ログイン後だけチャットを表示する

`amplify_outputs.json` は Amplify Sandbox が生成する接続設定です。Cognito の情報や、カスタム出力した AgentCore Runtime の ARN が入ります。

### `App.tsx`

チャット画面の中心です。React の `useState` で次の状態を管理します。

- `messages`: ユーザーと AI のメッセージ一覧
- `input`: 入力欄に現在入っている文字列
- `loading`: 回答の受信中かどうか

フォームを送信した後は、次の順序で動きます。

```text
質問を入力して送信
  ↓
ユーザーメッセージと空のAIメッセージを画面へ追加
  ↓
fetchAuthSession() で Cognito のアクセストークンを取得
  ↓
AgentCore Runtime へ POST
  ↓
SSE イベントを1行ずつ読み取る
  ├─ tool_use → ツール利用中の表示
  └─ text     → AI の文章を画面へ追加
  ↓
ストリーム終了後、再び送信可能にする
```

## TypeScript / React の用語

### コンポーネント

画面を構成する部品です。`App()` はチャット画面全体を返すコンポーネントです。HTML に似た記法は JSX と呼ばれます。

### State（状態）

画面上で変化するデータです。`setMessages()` や `setInput()` で State を更新すると、React が必要な箇所を再描画します。

### 型

`Message` インターフェースは、メッセージが持つ値とその種類を定義します。たとえば `role` は `'user'` または `'assistant'` だけを許します。誤った値をコンパイル時に見つけやすくするのが TypeScript の利点です。

### Hook

React コンポーネントで状態や副作用を扱う関数です。

- `useState`: 値を保持し、更新時に画面を再描画する
- `useRef`: DOM 要素など、再描画を起こさず保持したい参照を持つ
- `useEffect`: メッセージ更新後の自動スクロールなど、描画に付随する処理を行う

## AgentCore Runtime の呼び出し

Runtime URL は次の情報から組み立てます。

- リージョン: `ap-northeast-1`
- Runtime ARN: `outputs.custom.agentRuntimeArn`
- qualifier: `DEFAULT`

HTTP リクエストの概要は次のとおりです。

```http
POST /runtimes/{URLエンコードしたARN}/invocations?qualifier=DEFAULT
Authorization: Bearer {Cognitoのアクセストークン}
Content-Type: application/json

{"prompt":"ユーザーの質問"}
```

ブラウザのコードに AWS のアクセスキーは置きません。ログイン後に Cognito から取得した短期的なトークンで、ユーザーが認証済みであることを Runtime に伝えます。

## ストリーミング表示の仕組み

通常の API は、すべての処理が終わってからレスポンスを返します。このアプリでは SSE を使い、生成途中のテキストを `data: ...` という行として少しずつ受信します。

`ReadableStream` の `reader.read()` は、ネットワークから届いたデータのかたまりを読みます。`TextDecoder` はバイト列を文字列へ変換します。イベントの `type` によって、ツール表示か回答本文かを判断します。

## 開発コマンド

プロジェクトのルートディレクトリで実行します。

```bash
# 開発サーバーを起動
npm run dev

# TypeScript の確認と本番用ビルド
npm run build

# コード規約の確認
npm run lint
```

## よく変更する場所

- タイトルや説明文: `App.tsx` の `<header>`
- 初期メッセージや表示方法: `App.tsx` の `messages` と JSX
- 色、余白、吹き出し: `App.css`
- ページ全体のフォントや背景: `index.css`
- 認証画面の設定: `main.tsx` の `Authenticator`

## バックエンドとの対応

フロントエンドが期待するイベント形式は、[`../amplify/agent/app.py`](../amplify/agent/app.py) の `convert_event()` で作られています。どちらか一方の `type` やプロパティ名を変更した場合は、もう一方も同時に直してください。

バックエンドの詳しい説明は [`../amplify/agent/README.md`](../amplify/agent/README.md) を参照してください。
