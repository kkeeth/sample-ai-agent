/**
 * ==================================================================
 * 1ファイル版。docs/04-reference.md の Step 8 まで進めた状態。
 *
 *   bun run src/scratch.ts "経費精算の締め切りはいつ?"
 *
 * 分割前のエージェントは、全部でこれだけです。
 * Step 9 で、このファイルを src/ の5ファイルに切り分けます。
 * ==================================================================
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, relative, dirname } from "node:path";

const client = new Anthropic();
const ROOT = resolve("workspace");
const MAX_TOOL_OUTPUT_CHARS = 8_000;
const MAX_TURNS = 20;
const PRICE = { input: 5.0, output: 25.0 }; // $ / 1M tokens

/** 実行前に人間の承認を挟むツール */
const WRITE_TOOLS = new Set(["write_note"]);

let finished = false;
let totalIn = 0;
let totalOut = 0;

// ---------------------------------------------------------------- 名簿

const tools: Anthropic.Tool[] = [
  {
    name: "read_file",
    description:
      "社内資料の中身を返す。パスが分からないときは推測せず、先に list_files か search_files を使うこと。",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "資料フォルダからの相対パス" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description:
      "社内資料フォルダにあるファイルの一覧を返す。" +
      "どんな資料が存在するのか分からないときに、最初に使うこと。",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "search_files",
    description:
      "社内資料を全文検索し、ヒットした行をファイル名つきで返す。" +
      "探したいキーワードがはっきりしているときは、list_files より先にこれを使うこと。" +
      "キーワードは日本語でよい。複数語ではヒットしないので、1語ずつ試すこと。",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "検索キーワード。必ず1語だけ" },
      },
      required: ["query"],
    },
  },
  {
    name: "write_note",
    description:
      "調べた結果を Markdown ファイルとして out/ に保存する。" +
      "ユーザーが明示的に「まとめて」「保存して」と言ったときだけ使うこと。" +
      "実行前に人間の承認を求めるため、拒否されることがある。",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "拡張子つきのファイル名。例: summary.md" },
        content: { type: "string", description: "保存する Markdown 本文" },
      },
      required: ["filename", "content"],
    },
  },
];

// ---------------------------------------------------------------- ツールの中身

/** workspace/ の外に出ようとしたら止める */
function safePath(p: string): string {
  const abs = resolve(ROOT, p);
  if (relative(ROOT, abs).startsWith("..")) {
    throw new Error(`資料フォルダの外にはアクセスできません: ${p}`);
  }
  return abs;
}

/** 戻り値を切り詰める。外すと以降の全周回のコストが跳ね上がる */
function clip(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  return (
    text.slice(0, MAX_TOOL_OUTPUT_CHARS) +
    `\n\n…（長すぎるため ${MAX_TOOL_OUTPUT_CHARS} 文字で打ち切りました）`
  );
}

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, acc);
    else acc.push(relative(ROOT, full));
  }
  return acc.sort();
}

async function runTool(name: string, rawInput: unknown): Promise<string> {
  const input = (rawInput ?? {}) as Record<string, string>;

  switch (name) {
    case "read_file":
      return clip(await readFile(safePath(input.path ?? ""), "utf-8"));

    case "list_files":
      return (await walk(ROOT)).join("\n") || "資料が1件もありません";

    case "search_files": {
      const query = input.query ?? "";
      if (!query.trim()) return "検索キーワードが空です";

      const hits: string[] = [];
      for (const rel of await walk(ROOT)) {
        const text = await readFile(join(ROOT, rel), "utf-8");
        text.split("\n").forEach((line, i) => {
          if (line.includes(query)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
      }
      if (hits.length === 0) {
        return `「${query}」にヒットする行はありませんでした。別の語で試してください。`;
      }
      return clip(hits.join("\n"));
    }

    case "write_note": {
      const abs = safePath(join("out", input.filename ?? "note.md"));
      const content = input.content ?? "";
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf-8");
      return `保存しました: ${relative(ROOT, abs)} (${content.length} 文字)`;
    }

    default:
      return `不明なツール: ${name}`;
  }
}

// ---------------------------------------------------------------- ループ

const messages: Anthropic.MessageParam[] = [
  { role: "user", content: process.argv[2] ?? "経費精算の締め切りは?" },
];

// while (true) の代わりに、上限つきで回す
for (let turn = 1; turn <= MAX_TURNS; turn++) {
  const res = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    tools,
    messages, // ← 毎回まるごと送っている
  });

  totalIn += res.usage.input_tokens;
  totalOut += res.usage.output_tokens;
  const cost = (totalIn * PRICE.input + totalOut * PRICE.output) / 1_000_000;
  console.log(
    `  [${turn}周目] in ${res.usage.input_tokens} / out ${res.usage.output_tokens}` +
      ` / 累計 $${cost.toFixed(4)}`,
  );

  for (const b of res.content) {
    if (b.type === "text") console.log(b.text);
  }

  messages.push({ role: "assistant", content: res.content });

  if (res.stop_reason !== "tool_use") {
    finished = true;
    break; // モデルが「もう終わり」と言った
  }

  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const b of res.content) {
    if (b.type !== "tool_use") continue;

    // ── 人間を挟む場所 ──────────────────────────────
    if (WRITE_TOOLS.has(b.name)) {
      console.log(`\n⚠ 書き込みの許可を求めています`);
      console.log(`   ${b.name}(${JSON.stringify(b.input).slice(0, 300)})`);
      if (prompt("   実行しますか? [y/N]")?.trim().toLowerCase() !== "y") {
        results.push({
          type: "tool_result",
          tool_use_id: b.id,
          content: "ユーザーが実行を拒否しました。理由を尋ねるか、別の方法を提案してください。",
          is_error: true,
        });
        continue;
      }
    }

    console.log(`  → ${b.name}(${JSON.stringify(b.input)})`);
    try {
      results.push({
        type: "tool_result",
        tool_use_id: b.id,
        content: await runTool(b.name, b.input),
      });
    } catch (e) {
      results.push({
        type: "tool_result",
        tool_use_id: b.id,
        content: `エラー: ${(e as Error).message}`,
        is_error: true,
      });
    }
  }

  // stop_reason が tool_use でも、実行対象が1つも無いことが稀にある。
  // content が空配列の user メッセージは 400 で弾かれるので送らない。
  if (results.length === 0) {
    console.warn(`\n⚠ ツールの実行要求が空でした。ここで打ち切ります。`);
    break;
  }

  messages.push({ role: "user", content: results }); // 必ず1つにまとめる
}

if (!finished) {
  console.warn(`⚠ 最大 ${MAX_TURNS} 周に達したので打ち切りました。`);
  console.warn(`  同じツールを呼び続けていないか、上のログを見てください。`);
}
