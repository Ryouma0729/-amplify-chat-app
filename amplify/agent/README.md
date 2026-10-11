# `amplify/agent` 入門ガイド

このディレクトリには、ユーザーの質問を受け取り、Amazon Bedrock のモデルと RSS ツールを使って回答を作る **AI エージェント側（バックエンド側）** のコードがあります。

AWS、TypeScript、コンテナ、Python を初めて触る人でも全体像を追えるように、それぞれのファイルの役割と処理の流れを説明します。

## まず全体像

```text
ブラウザ（React）
  │  1. Cognito でログイン
  │  2. アクセストークンと質問を送信
  ▼
Bedrock AgentCore Runtime
  │  3. コンテナ内の app.py を呼び出す
  ▼
Strands Agent
  ├─ Amazon Bedrock のモデルで回答を考える
  └─ 必要に応じて AWS What's New の RSS を取得する
  │  4. 回答を少しずつ返す
  ▼
ブラウザ（React）が回答をリアルタイム表示
```

重要なのは、次の役割分担です。

- **Amplify の組み立て (`backend.ts`)**: Cognito と AgentCore Runtime を接続し、フロントエンドへ ARN を渡します。
- **TypeScript (`resource.ts`)**: AWS 上にどのような実行環境を作るかを定義します。
- **Docker (`Dockerfile`)**: Python アプリをどのような環境で動かすかを定義します。
- **Python (`app.py`)**: 質問を受け取り、AI エージェントを実際に動かします。
- **Python パッケージ (`requirements.txt`)**: Python アプリに必要なライブラリを列挙します。

## ファイル一覧

| ファイル | 役割 |
| --- | --- |
| `backend.ts` | Cognito、AgentCore Runtime、Amplify の出力設定をひとつに組み立てる |
| `resource.ts` | コンテナイメージと AgentCore Runtime を AWS CDK で定義する |
| `Dockerfile` | AgentCore 上で動くコンテナイメージを組み立てる |
| `app.py` | Strands Agent を作り、質問に対する応答をストリーミングする |
| `requirements.txt` | AgentCore、Strands、RSS ツールなどの依存パッケージを指定する |

## 処理の流れ

### 1. `backend.ts` がバックエンドを組み立てる

`backend.ts` は、個別に定義された AWS リソースを組み合わせるファイルです。

1. `defineBackend({ auth })` で Cognito 認証を Amplify バックエンドへ登録する
2. `backend.createStack('AgentCoreStack')` で AgentCore 専用の CloudFormation Stack を作る
3. Cognito の User Pool と App Client を `createAgentCoreRuntime()` へ渡す
4. 作成された Runtime ARN を `backend.addOutput()` でフロントエンドへ公開する

```ts
const { runtime } = createAgentCoreRuntime(
  agentCoreStack,
  backend.auth.resources.userPool,
  backend.auth.resources.userPoolClient
);
```

ここで Cognito リソースを渡すことにより、AgentCore Runtime は「このアプリでログインしたユーザー」のトークンを検証できるようになります。

> **配置について:** Amplify Gen 2 CLI が標準のエントリーポイントとして読み込むのは [`../backend.ts`](../backend.ts) です。現在、ルート側にも同じバックエンド定義があります。`agent/backend.ts` を実際のエントリーポイントとして使いたい場合は、ルート側から読み込む構成へ変更する必要があります。2つの内容を別々に更新すると設定差分が生まれるため、運用時は定義元を1つにまとめるのがおすすめです。

### 2. `resource.ts` が AgentCore Runtime を定義する

`backend.ts` から呼ばれる `createAgentCoreRuntime()` は、次の処理をします。

1. このディレクトリの `Dockerfile` を使って、ARM64 用のコンテナイメージをビルドする
2. イメージを Amazon ECR（コンテナイメージの保管場所）へ登録する
3. そのイメージを動かす Bedrock AgentCore Runtime を作る
4. Cognito でログインしたユーザーだけが呼び出せるようにする
5. Runtime に Bedrock モデルを呼び出す IAM 権限を付ける
6. 作成した Runtime の ARN をフロントエンドへ出力する

`ARN` は AWS リソースを一意に表す ID です。フロントエンドは `amplify_outputs.json` に書き出された `agentRuntimeArn` を使って、呼び出す Runtime を特定します。

### 3. `Dockerfile` が Python の実行環境を作る

コンテナは、アプリ本体と実行に必要なものをひとまとめにした実行単位です。開発PCと AWS 上の環境差を小さくできます。

この `Dockerfile` は、上から順に次のことをしています。

1. Python 3.13 と高速なパッケージ管理ツール `uv` を含むイメージを土台にする
2. 作業ディレクトリを `/app` にする
3. AWS リージョンなどの環境変数を設定する
4. `requirements.txt` のパッケージと OpenTelemetry をインストールする
5. root ではない専用ユーザーでアプリを実行する
6. AgentCore が使うポートを公開する
7. Python ファイルをコンテナへコピーする
8. ヘルスチェックを設定する
9. OpenTelemetry の計測を有効にして `app.py` を起動する

### 4. `app.py` が AI エージェントを動かす

`BedrockAgentCoreApp` の `@app.entrypoint` が、Runtime 呼び出しの入口です。フロントエンドから次のような JSON が届きます。

```json
{
  "prompt": "最近の AWS アップデートを教えて"
}
```

`invoke_agent()` は以下を行います。

1. `payload` から `prompt` を取り出す
2. Bedrock のモデル、システムプロンプト、RSS ツールを指定して `Agent` を作る
3. `agent.stream_async(prompt)` で回答生成を始める
4. Strands 固有のイベントを `convert_event()` で画面向けの単純な JSON に変換する
5. `yield` でイベントをひとつずつフロントエンドへ返す

返却するイベントは主に2種類です。

```json
{"type": "tool_use", "tool_name": "rss"}
```

```json
{"type": "text", "data": "AWS の最新情報は…"}
```

`tool_use` は「RSS ツールを使い始めた」ことを画面に知らせます。`text` は回答本文の一部分です。文章をまとめて待つのではなく少しずつ返すため、チャット画面にリアルタイムで表示できます。

### 5. フロントエンドがイベントを表示する

[`../../src/App.tsx`](../../src/App.tsx) は Runtime のレスポンスを SSE（Server-Sent Events）形式として読みます。

- `tool_use` を受け取ると「ツールを利用中」と表示する
- `text` を受け取るたびに回答へ文字列を追加する
- ストリームが終了すると送信可能な状態へ戻す

## `resource.ts` の要点

### コンテナイメージのビルド

```ts
const agentImage = new ContainerImageBuild(stack, 'AgentImage', {
  directory: path.dirname(fileURLToPath(import.meta.url)),
  platform: Platform.LINUX_ARM64,
});
```

`directory` はこの `agent` ディレクトリです。デプロイ時に `Dockerfile` が読み込まれます。`LINUX_ARM64` は AgentCore で動かす CPU アーキテクチャの指定です。

### Cognito による認証

```ts
authorizerConfiguration:
  agentcore.RuntimeAuthorizerConfiguration.usingCognito(
    userPool,
    [userPoolClient],
  ),
```

Amplify Auth が作る Cognito User Pool と App Client を Runtime の認証設定に渡しています。そのため、フロントエンドはログイン時に取得したトークンを `Authorization: Bearer ...` ヘッダーへ入れて呼び出します。

### IAM 権限

```ts
actions: [
  'bedrock:InvokeModel',
  'bedrock:InvokeModelWithResponseStream',
]
```

Runtime の IAM ロールに、Bedrock モデルを通常呼び出し・ストリーミング呼び出しする権限を追加しています。IAM は「誰が、どの AWS 操作をしてよいか」を管理する仕組みです。

## `app.py` の要点

### システムプロンプトとユーザーの質問

- `system_prompt`: エージェントが常に従う基本指示
- `prompt`: チャット画面から送られる、その都度のユーザー質問

現在のシステムプロンプトは、AWS What's New の RSS URL を取得対象として指定しています。

### ツールとは

AI モデル単体は、最新の情報を自動でインターネットから取得するわけではありません。`tools=[rss]` とすることで、エージェントは必要なときに RSS を読み、その結果を回答作成に利用できます。

### `async` と `yield`

- `async`: ネットワーク応答を待つ間も、効率よく別の処理を進めるための仕組み
- `async for`: 非同期で順番に届くイベントをひとつずつ受け取る構文
- `yield`: 関数を終了せず、途中の結果を呼び出し元へ返す構文

この3つを組み合わせて、完成した回答を一括返却するのではなく、生成途中の回答を順次返しています。

## 開発時によく確認する場所

- モデルを変更する: `app.py` の `model`
- AI の基本指示を変更する: `app.py` の `system_prompt`
- 利用ツールを追加・変更する: `app.py` の `tools`
- Python ライブラリを追加する: `requirements.txt`
- リージョンやコンテナ設定を変更する: `Dockerfile`
- Runtime の認証・ネットワーク・IAM を変更する: `resource.ts`
- Cognito と Runtime の接続やフロントエンド出力を変更する: `backend.ts`

## デプロイと動作確認

プロジェクトのルートディレクトリで実行します。

```bash
# Amplify の開発用 Sandbox を起動する
npx ampx sandbox

# 別のターミナルでフロントエンドを起動する
npm run dev
```

初回デプロイやコンテナの変更後は、イメージのビルドと AWS リソースの更新に時間がかかることがあります。`amplify_outputs.json` は Sandbox が生成するため、手作業で ARN を書き込む必要はありません。

## トラブルシューティング

### 認証エラーになる

- ブラウザでログインが完了しているか確認する
- `amplify_outputs.json` に Cognito と `custom.agentRuntimeArn` の設定があるか確認する
- Sandbox が正常にデプロイされているか確認する

### モデル呼び出しが失敗する

- `Dockerfile` のリージョンと、利用する Bedrock モデルのリージョンが一致しているか確認する
- 対象モデルまたは inference profile が利用可能か確認する
- AgentCore Runtime の IAM ロールに必要な Bedrock 権限があるか確認する

### コンテナが起動しない

- `requirements.txt` のパッケージ名やバージョンに問題がないか確認する
- AgentCore Runtime のログで Python の例外やヘルスチェック失敗を確認する
- ローカルでビルドする場合は ARM64 イメージを扱える Docker 環境か確認する

## セキュリティ上の注意

- AWS のアクセスキーやトークンをソースコードへ直接書かないでください。
- フロントエンドへ渡す値はユーザーから見える前提で扱ってください。
- IAM の対象リソースは、本番運用では必要なモデルや inference profile に絞ることを検討してください。
- `usingPublicNetwork()` は Runtime から外部 RSS へアクセスするために使っています。ネットワーク要件を変更するときは、RSS へ到達できるかも確認してください。
