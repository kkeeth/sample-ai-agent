// scratch.ts
import Anthropic from "@anthropic-ai/sdk";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const client = new Anthropic();
const ROOT = "workspace";

const tools: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "社内資料の中身を返す。パスが分からないときは推測せず、その旨を答えること。",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "資料フォルダからの相対パス" } },
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
      properties: { query: { type: "string", description: "検索キーワード。必ず1語だけ" } },
      required: ["query"],
    },
  },
];

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, acc);
    else acc.push(full.slice(ROOT.length + 1));
  }
  return acc.sort();
}

async function searchFiles(query: string): Promise<string> {
  const hits: string[] = [];
  for (const rel of await walk(ROOT)) {
    const text = await readFile(join(ROOT, rel), "utf-8");
    text.split("\n").forEach((line, i) => {
      if (line.includes(query)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits.length ? hits.join("\n") : `「${query}」はヒットしませんでした。別の語で試してください。`;
}

// ツールの実装。ただの関数
async function runTool(name: string, input: any): Promise<string> {
  switch (name) {
    case "read_file":    return await readFile(join(ROOT, input.path), "utf-8");
    case "list_files":   return (await walk(ROOT)).join("\n");
    case "search_files": return await searchFiles(input.query);
    default:             return `不明なツール: ${name}`;
  }
}

const messages: Anthropic.MessageParam[] = [
  { role: "user", content: process.argv[2] ?? "経費精算の締め切りは?" },
];

while (true) {
  const res = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    tools,
    messages,                       // ← 毎回まるごと送っている
  });

  for (const b of res.content) {
    if (b.type === "text") console.log(b.text);
  }

  messages.push({ role: "assistant", content: res.content });

  if (res.stop_reason !== "tool_use") break;   // モデルが「もう終わり」と言った

  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const b of res.content) {
    if (b.type !== "tool_use") continue;
    console.log(`  → ${b.name}(${JSON.stringify(b.input)})`);
    results.push({
      type: "tool_result",
      tool_use_id: b.id,
      content: await runTool(b.name, b.input),
    });
  }

  messages.push({ role: "user", content: results });   // 必ず1つにまとめる
}
