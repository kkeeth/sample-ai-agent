import Anthropic from '@anthropic-ai/sdk';
import { readFile, readdir, writeFile, mkdir } from   'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';

const client = new Anthropic();
const ROOT = resolve('workspace');
const MAX_TOOL_OUTPUT_CHARS = 8_000;
const MAX_TURNS = 20;
const PRICE = { input: 5.0, output: 25.0 }; // $ / 1M tokens
    // 実行前に人間の承認を挟むツール
    const WRITE_TOOLS = new Set(['write_note']);
let finished = false;
let totalIn = 0;
let totalOut = 0;
      
    t tools: Anthropic.Tool[] = [
    
      me: 'read_file',
    description:
      '社内資料の中身を返す。パスが分からないときは推測せず、その旨を答えること。',
        t_schema: {
        pe: 'object',
      properties: {
        path: { type: 'string', description: '資料フォルダからの相対パス' },
      },
      required: ['path'],
    },
    
    
      me: 'list_files',
      scription:
      '社内資料フォルダにあるファイルの一覧を返す。' +
      'どんな資料が存在するのか分からないときに、最初に使うこと。',
    input_schema: { type: 'object', properties: {}, required: [] },
    
    
      me: 'search_files',
      scription:
      '社内資料を全文検索し、ヒットした行をファイル名つきで返す。' +
      '探したいキーワードがはっきりしているときは、list_files より先にこれを使うこと。' +
      'キーワードは日本語でよい。複数語ではヒットしないので、1語ずつ試すこと。',
      put_schema: {
        pe: 'object',
      properties: {
        query: { type: 'string', description: '検索キーワード。必ず1語だけ' },
      },
      required: ['query'],
    },
    
    
      me: 'write_note',
      scription:
      '調べた結果を Markdown ファイルとして out/ に保存する。' +
      'ユーザーが明示的に「まとめて」「保存して」と言ったときだけ使うこと。' +
      '実行前に人間の承認を求めるため、拒否されることがある。',
      put_schema: {
        pe: 'object',
          erties: {
          lename: {
          type: 'string',
          description: '拡張子つきのファイル名。例: summary.md',
        },
        content: { type: 'string', description: '保存する Markdown 本文' },
      },
      required: ['filename', 'content'],
    },
  },
];

  * workspace/ の外に出ようとしたら止める。ツールを増やすときも必ず通すこと */
  nction safePath(p: string): string {
  const abs = resolve(ROOT, p);
     (relative(ROOT, abs).startsWith('..')) {
      row new Error(`資料フォルダの外にはアクセスできません: ${p}`);
    
  return abs;
  

/** 長い戻り値は以降の全周回で送り直されるので、ここで切る */
function clip(text: string): string {
     (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  return (
    text.slice(0, MAX_TOOL_OUTPUT_CHARS) + '\n\n…（長すぎるため打ち切りました）'
  );
  
    
    c function walk(dir: string, acc: string[] = []): Promise<string[]> {
    r (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, acc);
    else acc.push(relative(ROOT, full));
  }
  return acc.sort();
}

async function searchFiles(query: string): Promise<string> {
  const hits: string[] = [];
    r (const rel of await walk(ROOT)) {
    const text = await readFile(join(ROOT, rel), 'utf-8');
    text.split('\n').forEach((line, i) => {
      if (line.includes(query)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits.length
    ? hits.join('\n')
    : `「${query}」はヒットしませんでした。別の語で試してください。`;
    
  
// ツールの実装。ただの関数
export async function runTool(name: string, input: any): Promise<string> {
  // 空文字の tool_result は API に弾かれるので、必ず何か返す
    turn (await dispatch(name, input)) || '（空の結果が返りました）';
  

async function dispatch(name: string, input: any): Promise<string> {
  switch (name) {
       e 'read_file':
          rn clip(await readFile(safePath(input.path), 'utf-8'));
      se 'list_files':
       eturn (await walk(ROOT)).join('\n');
      se 'search_files':
       eturn clip(await searchFiles(input.query));
    case "write_note": {
      const abs = safePath(join("out", input.filename));
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, input.content, "utf-8");
      return `保存しました: ${relative(ROOT, abs)} (${input.content.length} 文字)`;
    }
    default:
      return `不明なツール: ${name}`;
      
      
  
  nst messages: Anthropic.MessageParam[] = [
  { role: 'user', content: process.argv[2] ?? '経費精算の締め切りは?' },
];

// while (true) {
for (let turn = 1; turn <= MAX_TURNS; turn++) {
  const res = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16000,
    tools,
    messages, // ← 毎回まるごと送っている
  });

                                                       
       Out += res.usage.output_tokens;
  const cost = (totalIn * PRICE.input + totalOut * PRICE.output) / 1_000_000;
         .log(
    `  [${turn}周目] in ${res.usage.input_tokens} / out ${res.usage.output_tokens}` +
      ` / 累計 $${cost.toFixed(4)}`,
  );
   
   or (const b of res.content) {
    if (b.type === 'text') console.log(b.text);
   
   
   essages.push({ role: 'assistant', content: res.content });
   
      res.stop_reason !== 'tool_use') {
    finished = true;
      eak;
       モデルが「もう終わり」と言った
      
        results: Anthropic.ToolResultBlockParam[] = [];
          st b of res.content) {
          type !== 'tool_use') continue;
          
          人間を挟む場所 ──
        WRITE_TOOLS.has(b.name)) {
        nsole.log(`\n⚠ 書き込みの許可を求めています`);
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
        type: 'tool_result',
        tool_use_id: b.id,
        content: await runTool(b.name, b.input),
      });
    } catch (e) {
      results.push({
        type: 'tool_result',
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

  messages.push({ role: 'user', content: results }); // 必ず1つにまとめる
}

if (!finished) {
  console.warn(`⚠ 最大 ${MAX_TURNS} 周に達したので打ち切りました。`);
  console.warn(`  同じツールを呼び続けていないか、上のログを見てください。`);
}
