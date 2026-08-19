#!/usr/bin/env bun
import { runAgent } from "./agent.ts";

const argv = process.argv.slice(2);
const autoApprove = argv.includes("-y") || argv.includes("--yes");
const verbose = argv.includes("-v") || argv.includes("--verbose");
const question = argv.filter((a) => !a.startsWith("-")).join(" ").trim();

if (!question) {
  console.log(`使い方:
  bun run agent "経費精算の締め切りはいつ?"
  bun run agent "リモートワークの申請方法を調べて summary.md にまとめて"

オプション:
  -v, --verbose   モデルが何を考えているかを表示する
  -y, --yes       書き込みの承認を自動でOKにする`);
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY && !process.env.AWS_REGION) {
  console.error("✗ 認証情報が見つかりません。cp env.example .env してキーを貼ってください。");
  process.exit(1);
}

console.log(`\n質問: ${question}\n${"─".repeat(60)}`);

const started = Date.now();
const { usage, stoppedBy } = await runAgent(question, { autoApprove, verbose });
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(`${"─".repeat(60)}`);
console.log(`  ${usage.summary()}`);
console.log(`  所要時間   ${elapsed} 秒`);
console.log(`  終了理由   ${stoppedBy}\n`);
