/**
 * ==================================================================
 * ★ 合宿中、編集するのはこのファイルだけです。
 *
 * ここには3つしかありません。この3つがエージェントの中身の全部です。
 *
 *   ① SYSTEM_PROMPT … 役割と、守ってほしい方針
 *   ② tools          … ツールの「名簿」。モデルが読むのはここだけ
 *   ③ runTool        … ツールの中身。ただの関数。AIの知識は要らない
 *
 * ループ本体（src/agent.ts）、コスト計測、承認ゲート、安全装置は
 * すでに動いています。触らなくてよいし、触らなくても全部効きます。
 *
 * 書き方に詰まったら、動く作例が3つあります。丸ごとコピーして始めてOK。
 *
 *   cp examples/doc-agent/tools.ts   src/tools.ts   # ローカルのファイルを読む
 *   cp examples/http-agent/tools.ts  src/tools.ts   # HTTP を叩く
 *   cp examples/state-agent/tools.ts src/tools.ts   # 状態を書き換える
 * ==================================================================
 */
import type Anthropic from "@anthropic-ai/sdk";

/**
 * ① 朝礼の申し送り。役割と、守ってほしい方針を書く。
 *
 * 手順を1手ずつ書くと、ただのワークフローになってしまう。
 * 「何をする人か」と「やってはいけないこと」を書いて、順番はモデルに決めさせる。
 */
export const SYSTEM_PROMPT = `あなたは（ここに役割を書く）アシスタントです。

守ること:
- 答える前に必ずツールで実物を確認する。自分の記憶だけで答えない
- 分からないことは分からないと言う。推測で埋めない
- 日本語で、簡潔に`;

/**
 * ② ツールの名簿。
 *
 * モデルはここに書いた description しか読んでいない。実装は見えていない。
 * 「何をするか」だけでなく「いつ使うか」まで書くこと。
 * ツールを呼んでくれないときは、まずここを疑う。
 *
 * 下の get_current_time は動作確認用のダミーです。消して自分のものに置き換えてください。
 */
export const tools: Anthropic.Tool[] = [
  {
    name: "get_current_time",
    description:
      "今の日時を返す。「今日」「明日」「今から」のように現在時刻を基準にした質問が来たときに、" +
      "まずこれを使って基準日を確定させること。モデルは現在時刻を知らない。",
    input_schema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "IANA のタイムゾーン名。省略時は Asia/Tokyo。例: America/New_York",
        },
      },
      required: [],
    },
  },
];

/**
 * 実行前に人間の承認を挟むツールの名前。
 *
 * ファイルを書く・API に POST する・通知を送るなど、
 * 取り消せないことをするツールは必ずここに入れる。名前を足すだけで効く。
 */
export const WRITE_TOOLS = new Set<string>();

/**
 * ③ ツールの中身。ここはただの関数。
 *
 * 大事なのは戻り値の設計。モデルはこの文字列しか見ていない。
 *   - JSON をそのまま返さない。要る情報だけに絞って、読める形にする
 *   - 失敗も文字列で返す。「なぜ駄目か」「次に何をすべきか」まで書くと、自分で直してくる
 *   - 長いものは src/guard.ts の clip() を通す（通さないと以降の全周回のコストが増える）
 */
export async function runTool(name: string, input: unknown): Promise<string> {
  // 空文字の tool_result は API に弾かれるので、必ず何か返す
  return (await dispatch(name, input)) || "（空の結果が返りました）";
}

async function dispatch(name: string, input: unknown): Promise<string> {
  const args = (input ?? {}) as Record<string, string>;

  switch (name) {
    case "get_current_time": {
      const tz = args.timezone || "Asia/Tokyo";
      try {
        return `${new Date().toLocaleString("ja-JP", { timeZone: tz })}（${tz}）`;
      } catch {
        return `タイムゾーン ${tz} は認識できません。IANA の名前（例: Asia/Tokyo）で指定してください。`;
      }
    }

    default:
      return `不明なツールです: ${name}`;
  }
}
