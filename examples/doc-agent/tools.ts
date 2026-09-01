/**
 * ==================================================================
 * 作例① ローカルのファイルを読む
 *
 *   cp examples/doc-agent/tools.ts src/tools.ts
 *   bun run agent "経費精算の締め切りはいつ?" -v
 *
 * 社内資料（workspace/docs/）を調べて質問に答えるエージェント。
 * 「手元にある情報を横断して答える」形はだいたいこの構造に落ちる。
 * ==================================================================
 */
import type Anthropic from "@anthropic-ai/sdk";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { clip, safePath, WORKSPACE_ROOT as ROOT } from "../../src/guard.ts";

export const SYSTEM_PROMPT = `あなたは社内資料を調べて質問に答えるアシスタントです。

守ること:
- 答える前に必ず資料を確認する。自分の記憶だけで答えない
- 根拠にしたファイル名を必ず示す
- 資料に書かれていないことは「資料には見当たりません」と答える。推測で埋めない
- 日本語で書くこと。最終的な回答だけでなく、ツールを使う前の短い前置きも日本語にする
- 簡潔に`;

/**
 * ------------------------------------------------------------------
 * ① ツールの「名簿」
 *
 * モデルはここに書いた description しか読んでいない。
 * 「何をするか」だけでなく「いつ使うか」まで書くこと。
 * エージェントがツールを呼んでくれないときは、まずここを疑う。
 * ------------------------------------------------------------------
 */
export const tools: Anthropic.Tool[] = [
  {
    name: "list_files",
    description:
      "社内資料フォルダにあるファイルの一覧を返す。" +
      "どんな資料が存在するのか分からないときに、最初に使うこと。",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
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
    name: "read_file",
    description:
      "社内資料の中身を返す。パスが分からないときは、先に list_files か search_files を使うこと。",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "資料フォルダからの相対パス。例: docs/expense-policy.md",
        },
      },
      required: ["path"],
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

/** 実行前に人間の承認を挟むツール。ここに入れた名前は agent.ts でゲートされる */
export const WRITE_TOOLS = new Set(["write_note"]);

/**
 * ------------------------------------------------------------------
 * ② ツールの中身
 *
 * ここはただの関数。AIの知識は一切要らない。
 * 合宿でいちばん時間を使うのもここ。
 * ------------------------------------------------------------------
 */
export async function runTool(name: string, input: unknown): Promise<string> {
  // 空文字の tool_result は API に弾かれるので、必ず何か返す
  return (await dispatch(name, input)) || "（空の結果が返りました）";
}

async function dispatch(name: string, input: unknown): Promise<string> {
  const args = (input ?? {}) as Record<string, string>;

  switch (name) {
    case "list_files":
      return (await walk(ROOT)).join("\n") || "資料が1件もありません";

    case "search_files":
      return await searchFiles(args.query ?? "");

    case "read_file":
      return clip(await readFile(safePath(args.path ?? ""), "utf-8"));

    case "write_note":
      return await writeNote(args.filename ?? "note.md", args.content ?? "");

    default:
      return `不明なツールです: ${name}`;
  }
}

// ---------------------------------------------------------------- helpers

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, acc);
    else acc.push(relative(ROOT, full));
  }
  return acc.sort();
}

async function searchFiles(query: string): Promise<string> {
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

async function writeNote(filename: string, content: string): Promise<string> {
  const abs = safePath(join("out", filename));
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf-8");
  return `保存しました: ${relative(ROOT, abs)} (${content.length} 文字)`;
}
