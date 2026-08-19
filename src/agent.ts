import Anthropic from "@anthropic-ai/sdk";
import { MODEL, MAX_TOKENS, MAX_TURNS } from "./config.ts";
import { tools, runTool, WRITE_TOOLS } from "./tools.ts";
import { createUsageTracker } from "./usage.ts";

const client = new Anthropic();

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const warn = (s: string) => `\x1b[33m${s}\x1b[0m`;

/**
 * 監督への申し送り。役割と、守ってほしい方針を書く。
 * 手順を細かく書きすぎると、ただのワークフローになってしまうので注意。
 */
const SYSTEM_PROMPT = `あなたは社内資料を調べて質問に答えるアシスタントです。

守ること:
- 答える前に必ず資料を確認する。自分の記憶だけで答えない
- 根拠にしたファイル名を必ず示す
- 資料に書かれていないことは「資料には見当たりません」と答える。推測で埋めない
- 回答は日本語で、簡潔に`;

export type AgentOptions = {
  /** 書き込み系ツールの承認をスキップする */
  autoApprove?: boolean;
  /** モデルの考えを表示する */
  verbose?: boolean;
};

/**
 * ==================================================================
 * エージェントループ本体
 *
 * やっていることは4つだけ:
 *   ① これまでの全履歴 + ツールの名簿 を送る
 *   ② モデルが「このツールを呼べ」と返してくる
 *   ③ こちらで実行して、結果を履歴に足す
 *   ④ ①に戻る。モデルが指示を出さなくなったら終わり
 * ==================================================================
 */
export async function runAgent(userInput: string, opts: AgentOptions = {}) {
  const usage = createUsageTracker();

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userInput },
  ];

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    // ① 毎回まるごと送る。モデルは前回の記憶を持っていない
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools,
      messages,
      thinking: { type: "adaptive", display: "summarized" },
    });

    usage.add(res.usage);
    console.log(dim(`  ${usage.turnLine(res.usage, turn)}`));

    for (const block of res.content) {
      if (block.type === "thinking" && opts.verbose && block.thinking.trim()) {
        console.log(dim(`  [考え中] ${block.thinking.trim().split("\n")[0]}`));
      }
      if (block.type === "text" && block.text.trim()) {
        console.log(`\n${block.text.trim()}\n`);
      }
    }

    // 応答をそのまま履歴に積む（thinking ブロックも欠かさず戻すこと）
    messages.push({ role: "assistant", content: res.content });

    // ④ モデルが「もう終わり」と判断した
    if (res.stop_reason !== "tool_use") {
      return { messages, usage, stoppedBy: res.stop_reason };
    }

    // ② 呼べと言われたツールを集める（同時に複数来ることがある）
    const calls = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    // ③ こちらで実行する。モデルは関数に触れない
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      // ── 人間を挟むならここ ──────────────────────────────
      if (WRITE_TOOLS.has(call.name) && !opts.autoApprove) {
        if (!askApproval(call)) {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: "ユーザーが実行を拒否しました。理由を尋ねるか、別の方法を提案してください。",
            is_error: true,
          });
          continue;
        }
      }

      console.log(dim(`  → ${call.name}(${JSON.stringify(call.input)})`));
      try {
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: await runTool(call.name, call.input),
        });
      } catch (e) {
        // 失敗もモデルに伝える。握りつぶすと、同じ失敗を延々と繰り返す
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `エラー: ${(e as Error).message}`,
          is_error: true,
        });
      }
    }

    // 並列で呼ばれた分も、必ず1つの user メッセージにまとめて返すこと。
    // 分けて送るとモデルが並列呼び出しをやめてしまう。
    messages.push({ role: "user", content: results });
  }

  console.warn(warn(`\n⚠ 最大 ${MAX_TURNS} 周に達したので打ち切りました。`));
  console.warn(warn(`  同じツールを呼び続けていないか、上のログを見てください。`));
  return { messages, usage, stoppedBy: "max_turns" as const };
}

/** 書き込み系ツールの実行許可を対話で取る */
function askApproval(call: Anthropic.ToolUseBlock): boolean {
  const preview = JSON.stringify(call.input);
  console.log(warn(`\n⚠ 書き込みの許可を求めています`));
  console.log(`   ${call.name}(${preview.slice(0, 300)}${preview.length > 300 ? "…" : ""})`);
  return prompt("   実行しますか? [y/N]")?.trim().toLowerCase() === "y";
}
