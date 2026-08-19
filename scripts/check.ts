#!/usr/bin/env bun
/**
 * 疎通確認。合宿初日の朝、まずこれを通すこと。
 * ここが通れば、あとはツールを足していくだけ。
 */
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, PRICE_PER_MTOK } from "../src/config.ts";

const ok = (s: string) => console.log(`\x1b[32m✓\x1b[0m ${s}`);
const ng = (s: string) => console.error(`\x1b[31m✗\x1b[0m ${s}`);

// ---- 1. 認証情報 -------------------------------------------------
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
const hasAws = Boolean(process.env.AWS_REGION && process.env.ANTHROPIC_AWS_WORKSPACE_ID);

if (!hasKey && !hasAws) {
  ng("認証情報が見つかりません");
  console.error(`
  次の手順で設定してください:
    1. cp env.example .env
    2. .env を開いて、運営から配られたキーを貼る
    3. bun run check をもう一度
`);
  process.exit(1);
}
ok(`認証情報を読み込みました（${hasKey ? "ANTHROPIC_API_KEY" : "AWS"}）`);

// ---- 2. API を1回叩く --------------------------------------------
const client = new Anthropic();
const started = Date.now();

try {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 64,
    messages: [{ role: "user", content: "「疎通OK」とだけ返してください。" }],
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const text = res.content.find((b) => b.type === "text");
  const cost =
    (res.usage.input_tokens * PRICE_PER_MTOK.input +
      res.usage.output_tokens * PRICE_PER_MTOK.output) /
    1_000_000;

  ok(`${MODEL} から応答がありました（${elapsed} 秒）`);
  console.log(`  応答     : ${text?.type === "text" ? text.text.trim() : "(テキストなし)"}`);
  console.log(`  トークン : in ${res.usage.input_tokens} / out ${res.usage.output_tokens}`);
  console.log(`  コスト   : $${cost.toFixed(6)}`);
  console.log(`\n準備完了です。次はこれを試してください:\n  bun run agent "経費精算の締め切りはいつ?"\n`);
} catch (e) {
  const err = e as Error & { status?: number; headers?: Headers };
  ng(`API 呼び出しに失敗しました（${err.status ?? "不明"}）`);
  console.error(`  ${err.message}\n`);

  // どの組織・どのワークスペースのキーだったかを出す。切り分けにいちばん効く
  const org = err.headers?.get("anthropic-organization-id");
  const ws = err.headers?.get("anthropic-workspace-id");
  if (org || ws) {
    console.error("  このキーの所属:");
    if (org) console.error(`    organization : ${org}`);
    if (ws) console.error(`    workspace    : ${ws}`);
    console.error("");
  }

  if (err.status === 400 && /credit balance/i.test(err.message)) {
    console.error("  → 残高が足りません。次の順で確認してください。");
    console.error("");
    console.error("     ① 買ったのが「API クレジット」か");
    console.error("        Claude Pro / Max などのプランと API の残高は別会計です。");
    console.error("        Console > Settings > Billing の Credit balance を見る");
    console.error("        https://console.anthropic.com/settings/billing");
    console.error("");
    console.error("     ② ワークスペースの spend limit");
    console.error("        組織に残高があっても、ワークスペース単位の上限で弾かれます。");
    console.error("        Console > Settings > Workspaces > 該当ワークスペース > Spend limit");
    if (ws) console.error(`        （このキーのワークスペース: ${ws}）`);
    console.error("");
    console.error("     ③ 切り分け: Default workspace のキーで試す");
    console.error("        通れば ② が原因、通らなければ ① が原因");
    console.error("");
    console.error("     ※ キーもネットワークも正常です。認証は通っています。");
  } else if (err.status === 400) {
    console.error("  → リクエストが不正です。config.ts のモデルIDを確認してください。");
  }
  if (err.status === 401) console.error("  → キーが違います。.env を確認してください。");
  if (err.status === 403) console.error("  → 権限がありません。運営に連絡してください。");
  if (err.status === 404) console.error("  → モデルIDが違います。config.ts の MODEL を確認してください。");
  if (err.status === 429) console.error("  → レート上限です。少し待つか、運営に連絡してください。");
  if (!err.status) console.error("  → ネットワークに届いていません。プロキシ / VPN を確認してください。");
  process.exit(1);
}
