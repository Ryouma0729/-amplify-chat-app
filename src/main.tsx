// React本体と、ReactをブラウザのDOMへ描画するための機能を読み込む。
import React from "react";
import ReactDOM from "react-dom/client";

// Amplify.configure() は、認証先などのAWS接続設定をアプリ全体へ登録する。
import { Amplify } from "aws-amplify";

// Authenticator は、サインアップ・ログイン・ログアウトをまとめて提供するUI部品。
import { Authenticator } from '@aws-amplify/ui-react';

// I18nとtranslationsを使い、Authenticatorの文言を日本語に切り替える。
import { I18n } from 'aws-amplify/utils';
import { translations } from '@aws-amplify/ui-react';

import App from "./App.tsx";

// Amplify Sandboxが生成する設定ファイル。
// Cognitoの認証情報や、バックエンドから出力したAgentCore Runtime ARNを含む。
import outputs from "../amplify_outputs.json";

// Amplify UIの標準スタイルと、このアプリ全体のスタイルを読み込む。
import '@aws-amplify/ui-react/styles.css';
import "./index.css";

// Reactを描画する前にAmplifyを初期化する。
// 以降、fetchAuthSession()などがこの設定を参照できるようになる。
Amplify.configure(outputs);

// Amplify UIが用意している翻訳辞書を登録し、認証画面の表示言語を日本語にする。
I18n.putVocabularies(translations);
I18n.setLanguage('ja');

// index.htmlにある <div id="root"></div> の中へReactアプリを描画する。
// `!` は「root要素は必ず存在する」とTypeScriptへ伝える記号。
ReactDOM.createRoot(document.getElementById("root")!).render(
  // StrictModeは、開発中に問題のある書き方を見つけやすくするための仕組み。
  <React.StrictMode>
    {/* 未ログイン時は認証画面を表示し、ログイン後にだけAppを表示する。 */}
    <Authenticator>
      <App />
    </Authenticator>
  </React.StrictMode>
);
