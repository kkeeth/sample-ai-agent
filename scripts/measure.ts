#!/usr/bin/env bun
/**
 * ツール呼び出しの回数を N 回測って、平均とばらつきを出す。
 *
 *   bun run measure "リモートワークの申請方法は?"
 *   bun run measure "リモートワークの申請方法は?" 10
 *   bun run measure "リモートワークの申請方法は?" 5 src/scratch.ts
 *
 * description を変える前と後で走らせて、数字を比べるために使う。
 * 1回の実行では判定できない（実行ごとにばらつくため）。
 */

const [question, countArg, entryArg] = process.argv.slice(2);

if (!question) {
  console.log(`使い方:
  bun run measure "<質問>" [回数] [エントリ]

  回数     省略時 5
  エントリ 省略時 src/cli.ts（1ファイル版を測るなら src/scratch.ts）

例:
  bun run measure "リモートワークの申請方法は?"
  bun run measure "出張の宿泊費の上限は?" 10 src/scratch.ts`);
  process.exit(1);
}

const runs = Number(countArg ?? 5);
const entry = entryArg ?? "src/cli.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

console.log(`\n質問     : ${question}`);
console.log(`エントリ : ${entry}（${runs} 回）`);
console.log("─".repeat(64));

const counts: number[] = [];

for (let i = 1; i <= runs; i++) {
  const proc = Bun.spawn(["bun", "run", entry, question], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;

  if (code !== 0) {
    console.error(`  ${i}回目  \x1b[31m失敗\x1b[0m (exit ${code})`);
    console.error(dim("  " + (err.trim().split("\n")[0] ?? "")));
    continue;
  }

  // "  → search_files({...})" の行からツール名を拾う
  const tools = [...out.matchAll(/→\s*([a-zA-Z0-9_]+)\(/g)].map((m) => m[1]);
  counts.push(tools.length);

  console.log(
    `  ${String(i).padStart(2)}回目  ${String(tools.length).padStart(2)} 回  ` +
      dim(tools.join(" → ") || "(ツール未使用)"),
  );
}

console.log("─".repeat(64));

if (counts.length === 0) {
  console.error("すべて失敗しました。まず bun run check を通してください。\n");
  process.exit(1);
}

const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
const min = Math.min(...counts);
const max = Math.max(...counts);
const sd = Math.sqrt(
  counts.reduce((a, b) => a + (b - avg) ** 2, 0) / counts.length,
);

console.log(`  平均 ${avg.toFixed(1)} 回 / 最小 ${min} / 最大 ${max} / ばらつき ±${sd.toFixed(1)}`);
console.log(dim("  ばらつきが大きいほど、モデルが毎回違う道を通っている\n"));
