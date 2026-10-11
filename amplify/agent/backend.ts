// Amplify Gen 2のバックエンド全体を定義する関数。
import { defineBackend } from '@aws-amplify/backend';

// このファイルはamplify/agent配下にあるため、認証リソースは1階層上から読み込む。
import { auth } from '../auth/resource';

// AgentCore Runtimeを作成する処理は、同じディレクトリのresource.tsに分離している。
import { createAgentCoreRuntime } from './resource';

// Amplifyが管理する標準リソースを登録する。
// 現在はメールアドレスでログインするCognito認証だけを登録している。
const backend = defineBackend({
  auth,
});

// AgentCoreはAmplify標準カテゴリではなくCDKで追加するため、専用Stackを作る。
const agentCoreStack = backend.createStack('AgentCoreStack');

// CognitoのUser PoolとApp Clientを渡し、認証付きのAgentCore Runtimeを作成する。
const { runtime } = createAgentCoreRuntime(
  agentCoreStack,
  backend.auth.resources.userPool,
  backend.auth.resources.userPoolClient
);

// 作成したRuntimeのARNをamplify_outputs.jsonのcustom領域へ出力する。
// フロントエンドのsrc/App.tsxは、この値を使って呼び出し先URLを組み立てる。
backend.addOutput({
  custom: {
    agentRuntimeArn: runtime.agentRuntimeArn,
  },
});
