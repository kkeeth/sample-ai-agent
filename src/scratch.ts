// scratch.ts
import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const client = new Anthropic();

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
];

// ツールの実装。ただの関数
async function runTool(name: string, input: any): Promise<string> {
  if (name === "read_file") return await readFile(join("workspace", input.path), "utf-8");
  return `不明なツール: ${name}`;
}

const messages: Anthropic.MessageParam[] = [
  { role: "user", content: "docs/expense-policy.md を読んで要約して" },
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
