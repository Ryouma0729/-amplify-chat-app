// React Hooks: 画面の状態、DOMへの参照、描画後の処理を管理する。
import { useState, useRef, useEffect, type FormEvent } from 'react';

// ログイン中のユーザーが持つCognitoトークンを取得する関数。
import { fetchAuthSession } from 'aws-amplify/auth';

// AIのMarkdown形式の回答を、見出しや箇条書きとして描画する。
import ReactMarkdown from 'react-markdown';
import './App.css';

// Amplify Sandboxが生成する、フロントエンドとAWSを接続するための設定。
import outputs from '../amplify_outputs.json';

// amplify/backend.tsがカスタム出力したAgentCore RuntimeのARNを取り出す。
// ARNはAWSリソースを一意に識別する文字列で、呼び出しURLの一部に使う。
const AGENT_ARN = outputs.custom?.agentRuntimeArn;

// チャット画面で扱う1件のメッセージの形をTypeScriptで定義する。
interface Message {
  // Reactが各メッセージを区別するための一意なID。
  id: string;
  // 発言者。ユーザーまたはAIアシスタントのどちらかだけを許可する。
  role: 'user' | 'assistant';
  // 画面へ表示する本文。ストリーミング中は少しずつ長くなる。
  content: string;
  // 以下はRSSなどのツール実行状況を表示するための任意項目。
  isToolUsing?: boolean;
  toolCompleted?: boolean;
  toolName?: string;
}

// チャット画面全体を表すReactコンポーネント。
function App() {
  // useStateは、値を更新したときにReactへ画面の再描画を依頼する。
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // メッセージ一覧の末尾にある空のdivを指す参照。
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // messagesが変わるたびに末尾へスクロールし、最新の回答が見えるようにする。
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 質問フォームが送信されたときに実行される処理。
  const handleSubmit = async (e: FormEvent) => {
    // HTMLフォーム標準のページ再読み込みを止め、React内で送信を処理する。
    e.preventDefault();

    // 空文字や二重送信はAgentCoreへ送らない。
    if (!input.trim() || loading) return;

    // 入力値の前後の空白を除き、画面へ追加するユーザーメッセージを作る。
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: input.trim() };

    // ユーザー発言と、回答待ち表示に使う空のAIメッセージを追加する。
    // prevを使うと、追加直前の最新のmessagesを安全に参照できる。
    setMessages(prev => [...prev, userMessage, { id: crypto.randomUUID(), role: 'assistant', content: '' }]);
    setInput('');
    setLoading(true);

    // Cognitoのログインセッションからアクセストークンを取得する。
    // Runtime側はこのトークンを検証し、認証済みユーザーの呼び出しだけを許可する。
    const session = await fetchAuthSession();
    const accessToken = session.tokens?.accessToken?.toString();

    // Runtime ARNには「/」などが入る可能性があるため、URL用にエンコードする。
    const url = `https://bedrock-agentcore.ap-northeast-1.amazonaws.com/runtimes/${encodeURIComponent(AGENT_ARN)}/invocations?qualifier=DEFAULT`;

    // 質問をJSONにし、CognitoトークンをAuthorizationヘッダーへ付けて送信する。
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: userMessage.content }),
    });

    // レスポンスは一括ではなくSSEで少しずつ届くため、ReadableStreamとして読む。
    // TextDecoderはネットワークから届くバイト列をJavaScriptの文字列に変換する。
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // bufferには、現在表示中のAI回答を継ぎ足していく。
    let buffer = '';
    let isInToolUse = false;
    let toolIdx = -1;

    // doneがtrue（ストリーム終了）になるまで受信を続ける。
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // SSEでは各イベントが `data: {...}` という行で届く。
      for (const line of decoder.decode(value, { stream: true }).split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        // app.pyが返したJSON文字列をJavaScriptのオブジェクトへ戻す。
        const event = JSON.parse(data);

        // RSSなどのツール使用開始イベントを受けたら、進行状況を表示する。
        if (event.type === 'tool_use') {
          isInToolUse = true;
          const savedBuffer = buffer;
          setMessages(prev => {
            const msgs = [...prev];
            if (savedBuffer) {
              // ツール使用前に文章があれば、その文章を現在の吹き出しへ確定する。
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: savedBuffer };
              toolIdx = msgs.length;
              msgs.push({ id: crypto.randomUUID(), role: 'assistant', content: '', isToolUsing: true, toolName: event.tool_name });
            } else {
              // 文章がまだなければ、回答待ち用の吹き出しをツール表示へ変える。
              toolIdx = msgs.length - 1;
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], isToolUsing: true, toolName: event.tool_name };
            }
            return msgs;
          });
          buffer = '';
          continue;
        }

        // AIが生成した回答本文の一部分を受け取る。
        if (event.type === 'text' && event.data) {
          if (isInToolUse && !buffer) {
            // ツール実行後の最初の文章が届いたら、ツール表示を完了状態にする。
            const savedIdx = toolIdx;
            setMessages(prev => {
              const msgs = [...prev];
              if (savedIdx >= 0 && savedIdx < msgs.length) msgs[savedIdx] = { ...msgs[savedIdx], toolCompleted: true };
              // ツール状況とは別の吹き出しで、回答本文の表示を始める。
              msgs.push({ id: crypto.randomUUID(), role: 'assistant', content: event.data });
              return msgs;
            });
            buffer = event.data;
            isInToolUse = false;
            toolIdx = -1;
          } else {
            // 続きの文章をbufferへ足し、最後の吹き出しを更新する。
            buffer += event.data;
            setMessages(prev => {
              const msgs = [...prev];
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: buffer, isToolUsing: false };
              return msgs;
            });
          }
        }
      }
    }

    // 回答がすべて届いたので、入力欄と送信ボタンを再度有効にする。
    setLoading(false);
  };

  // JSXで「ヘッダー」「メッセージ一覧」「入力フォーム」を組み立てる。
  return (
    <div className="container">
      <header className="header">
        <h1 className="title">フルサーバーレスなAIエージェントアプリ</h1>
        <p className="subtitle">AmplifyとAgentCoreで構築しています</p>
      </header>

      <div className="message-area">
        <div className="message-container">
          {messages.map(msg => (
            // roleをCSSクラスにも使い、ユーザーとAIの吹き出し位置・色を分ける。
            <div key={msg.id} className={`message-row ${msg.role}`}>
              <div className={`bubble ${msg.role}`}>
                {/* 空のAIメッセージは、最初のイベントが届くまで「考え中」と表示する。 */}
                {msg.role === 'assistant' && !msg.content && !msg.isToolUsing && (
                  <span className="thinking">考え中…</span>
                )}
                {/* ツール利用中・完了の状態をアイコンと文言で表示する。 */}
                {msg.isToolUsing && (
                  <span className={`tool-status ${msg.toolCompleted ? 'completed' : 'active'}`}>
                    {msg.toolCompleted ? '✓' : '⏳'} {msg.toolName}
                    {msg.toolCompleted ? 'ツールを利用しました' : 'ツールを利用中...'}
                  </span>
                )}
                {/* 通常の回答本文はMarkdownとして描画する。 */}
                {msg.content && !msg.isToolUsing && <ReactMarkdown>{msg.content}</ReactMarkdown>}
              </div>
            </div>
          ))}
          {/* 自動スクロールの移動先。画面には何も表示しない。 */}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="form-wrapper">
        <form onSubmit={handleSubmit} className="form">
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="メッセージを入力..." disabled={loading} className="input" />
          {/* 受信中または入力が空のときは送信できないようにする。 */}
          <button type="submit" disabled={loading || !input.trim()} className="button">
            {loading ? '⌛️' : '送信'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;
