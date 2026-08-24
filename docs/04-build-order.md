# 作る順番 ── ステップごとの手順と確認方法

このテンプレート（`src/`）を、ゼロから段階的に組み立てるとしたらこの順、という手順書です。

**Step 9 までは 1 ファイル（`scratch.ts`）だけで進みます。** ディレクトリを切るのは最後です。
各ステップの終わりに必ず動作確認があり、**動かない中間状態を作らない**構成にしてあります。

コードは Step 0 以外すべて**差分**で示します。前のステップの `scratch.ts` に、そのまま当ててください。

> ⚠ **差分の読み方** — 行頭が `+` は追加、`-` は削除、**空白は「そのまま」**です。
> `/* ... 中略 ... */` のような省略記号が入っている行は、**そこに既存のコードがある**という意味なので、
> 消したり置き換えたりしないでください。ここを空にすると動かなくなります。

---

## 全体像

| フェーズ | Step | ゴール |
| --- | --- | --- |
| 1. 動かす | 0〜2 | 1ファイルでエージェントが動く |
| 2. エージェントらしくする | 3〜4 | モデルがツールを選ぶようになる |
| 3. 事故を止める | 5〜8 | 他人に渡しても壊れない |
| 4. 配れるようにする | 9〜12 | 初見の人が15分で動かせる |

---

# 何を見ながら書くか

`scratch.ts` の書き方は、3階層のドキュメントに分かれています。**探す場所が違うだけで、全部ちゃんと書いてあります。**

### ① API の仕様 ── 何を送ると何が返るか

言語に関係ない一次情報です。**この手順書のステップと、ほぼ1対1で対応しています。**

| この手順書の | 読むページ |
| --- | --- |
| 全体像を掴む | [Tool use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) |
| **Step 1**（名簿を書く） | [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) |
| **Step 2**（ループを閉じる） | [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls) |
| **Step 4**（description を直す） | [Define tools → Best practices](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) |
| ループを自分で書きたくない | [Tool Runner](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner) |
| 使えるツールの一覧・オプション | [Tool reference](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference) |

そのほか、必要になったときに。

| 見たいもの | URL |
| --- | --- |
| モデルIDと価格 | https://platform.claude.com/docs/en/about-claude/models/overview |
| エラーコードの意味 | https://platform.claude.com/docs/en/api/errors |
| 出力の形を保証する | https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use |
| JSONスキーマで返させる | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| プロンプトキャッシュ | https://platform.claude.com/docs/en/build-with-claude/prompt-caching |
| thinking の設定 | https://platform.claude.com/docs/en/build-with-claude/thinking |
| ツール設計の考え方（読み物） | https://www.anthropic.com/engineering/writing-tools-for-agents |

> 💡 **URLの末尾に `.md` を付けると、生の Markdown が返ります。**
> `https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools.md`
> Claude Code に「このURLを読んで」と渡すときはこちらが速いです。

> **公式も同じことを言っています。** Define tools の Best practices に、
> *"Provide extremely detailed descriptions. **This is by far the most important factor in tool performance.**"*
> とあります。Step 4 でわざと失敗させるのは、これを体で確認するためです。

### ② SDK の使い方 ── TypeScript でどう書くか

```
node_modules/@anthropic-ai/sdk/README.md
```

https://github.com/anthropics/anthropic-sdk-typescript にも同じものがあります。`messages.create()` の呼び方、ストリーミング、エラークラス、リトライ設定などはここ。

### ③ 型定義 ── 実務ではこれがいちばん速い

```
node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts
```

`Anthropic.Tool` にカーソルを置いて **定義ジャンプ**（VS Code なら `F12`）すると、そのまま読めます。

このファイルに、この手順書で使う型が全部あります。

| 型 | 何を表すか |
| --- | --- |
| `Anthropic.Tool` | ツールの定義（名簿の1行） |
| `Anthropic.MessageParam` | `messages` 配列の1要素 |
| `Anthropic.ToolUseBlock` | モデルが返してくる「これを呼べ」 |
| `Anthropic.ToolResultBlockParam` | こちらが返す実行結果 |
| `Anthropic.Message` | API のレスポンス全体 |

**型を見れば「何を書けるか」が分かります。** 「`input_schema` に何が入るのか」「`tool_result` に `is_error` を付けられるのか」といった疑問は、ドキュメントを探すより定義ジャンプのほうが速いことが多いです。

### 迷ったときの探し方

| 症状 | 見るところ |
| --- | --- |
| リクエストの形が分からない | ① の Tool use overview |
| ツール定義の書き方 | ① の Define tools |
| ループの組み方 | ① の Handle tool calls |
| TypeScript での書き方が分からない | ③ の型定義に飛ぶ |
| このプロパティ何が入るんだっけ | ③ の型定義 |
| エラーの意味が分からない | ① の Errors |

---

# フェーズ1 ── まず動かす

## Step 0 ── API を1発叩く

**目的:** 認証・ネットワーク・モデルID という、**自分ではどうにもならない要素**を最初に潰す。

### 作るファイル

```
package.json     (bun init で生成)
.env             (キーを書く)
scratch.ts       (新規)
```

### 手順

```bash
mkdir my-agent && cd my-agent
bun init -y
bun add @anthropic-ai/sdk
echo 'ANTHROPIC_API_KEY=sk-ant-xxxxx' > .env
echo '.env' >> .gitignore
```

```ts
// scratch.ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();   // .env は Bun が自動で読む

const res = await client.messages.create({
  model: "claude-opus-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "「疎通OK」とだけ返してください。" }],
});

console.log(res.content);
```

### 確認

```bash
bun run scratch.ts
```

**成功:** `[ { type: "text", text: "疎通OK" } ]` のような配列が出る。

**失敗したら**

| 症状 | 原因 |
| --- | --- |
| `400` + `credit balance is too low` | **残高不足。キーとネットワークは正常。**「Claude Code は動くのに」は無関係 → 下の囲みを見る |
| `401` | キーが違う。`.env` を確認 |
| `404` | モデルIDが違う |
| `429` | レート上限 |
| タイムアウト・接続不可 | プロキシ / VPN。`HTTPS_PROXY` を設定 |

> ### ⚠ 「Claude Code は動いているのに 400 が返る」
>
> **Claude のプラン（Pro / Max）と API クレジットは別会計です。** Claude Code はプランの OAuth 認証で動いていて、API キーを使っていません。自分のコードから `messages.create()` を叩くには、**API クレジットを別途購入**する必要があります。
>
> Console > Settings > Billing に別々の項目があります。
>
> | | 何に使えるか |
> | --- | --- |
> | **Plans**（Pro / Max） | claude.ai と Claude Code。API では使えない |
> | **Credits**（Credit balance） | Messages API。**必要なのはこちら** |
>
> 「Claude Code の API キー」というものは存在しません。プランをアップグレードしても API は動きません。
>
> **購入直後は反映に数分かかることがあります。** 買ってすぐ落ちても、少し待ってもう一度叩いてみてください。
>
> それでも通らない場合は、**ワークスペースの spend limit** を疑ってください（Console > Settings > Workspaces）。`bun run check` がキーの所属ワークスペースIDを表示します。

> **ここが通らないうちは絶対に先へ進まないこと。** 以降の作業が全部無駄になります。

---

## Step 1 ── ツールを渡して、返ってきたものを眺める

**目的:** 「モデルは実行しない、要求してくるだけ」を**自分の目で見る**。まだ実行しません。

### 触るファイル

```
scratch.ts                          (差分を当てる)
workspace/docs/expense-policy.md    (新規・中身は適当でよい)
```

適当なテキストファイルを 1 本置きます。

```bash
mkdir -p workspace/docs
printf '# 経費精算ルール\n\n締め切りは翌月5営業日以内です。\n' > workspace/docs/expense-policy.md
```

### 差分

```diff
 import Anthropic from "@anthropic-ai/sdk";
 
 const client = new Anthropic();
 
+const tools: Anthropic.Tool[] = [
+  {
+    name: "read_file",
+    description: "社内資料の中身を返す。パスが分からないときは推測せず、その旨を答えること。",
+    input_schema: {
+      type: "object",
+      properties: { path: { type: "string", description: "資料フォルダからの相対パス" } },
+      required: ["path"],
+    },
+  },
+];
+
 const res = await client.messages.create({
   model: "claude-opus-5",
   max_tokens: 1024,
-  messages: [{ role: "user", content: "「疎通OK」とだけ返してください。" }],
+  tools,
+  messages: [{ role: "user", content: "docs/expense-policy.md を読んで要約して" }],
 });
 
-console.log(res.content);
+console.log("stop_reason:", res.stop_reason);
+console.dir(res.content, { depth: null });
```

### 確認

```bash
bun run scratch.ts
```

**成功:** こういう形が出る。

```
stop_reason: tool_use
[
  {
    type: "tool_use",
    id: "toolu_01xxxx",
    name: "read_file",
    input: { path: "docs/expense-policy.md" }
  }
]
```

**ここで確認してほしいこと:**

1. `stop_reason` が `"tool_use"` になっている ＝ モデルは「まだ終わってない」と言っている
2. `input` にパスが入っている ＝ **モデルが引数を決めた**
3. **ファイルは1バイトも読まれていない** ＝ モデルは関数に触れない

3 番が核心です。要約は返ってきません。**「読め」と言われただけ**です。

> **ハマりどころ:** ここで要約が返ってきた場合、モデルがツールを使わずに答えています。ファイル名から中身を推測できてしまっているので、質問を「このファイルの3行目に何と書いてあるか」など、読まないと絶対に答えられないものに変えてください。

---

## Step 2 ── ループを閉じる

**目的:** 要求されたツールを実行して、結果を返して、もう一周する。**ここでエージェントが成立します。**

### 差分

```diff
 import Anthropic from "@anthropic-ai/sdk";
+import { readFile } from "node:fs/promises";
+import { join } from "node:path";
 
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
 
-const res = await client.messages.create({
-  model: "claude-opus-5",
-  max_tokens: 1024,
-  tools,
-  messages: [{ role: "user", content: "docs/expense-policy.md を読んで要約して" }],
-});
-
-console.log("stop_reason:", res.stop_reason);
-console.dir(res.content, { depth: null });
+// ツールの実装。ただの関数
+async function runTool(name: string, input: any): Promise<string> {
+  if (name === "read_file") return await readFile(join("workspace", input.path), "utf-8");
+  return `不明なツール: ${name}`;
+}
+
+const messages: Anthropic.MessageParam[] = [
+  { role: "user", content: "docs/expense-policy.md を読んで要約して" },
+];
+
+while (true) {
+  const res = await client.messages.create({
+    model: "claude-opus-5",
+    max_tokens: 16000,
+    tools,
+    messages,                      // ← 毎回まるごと送っている
+  });
+
+  for (const b of res.content) {
+    if (b.type === "text") console.log(b.text);
+  }
+
+  messages.push({ role: "assistant", content: res.content });
+
+  // モデルが「もう終わり」と言った
+  if (res.stop_reason !== "tool_use") break;
+
+  const results: Anthropic.ToolResultBlockParam[] = [];
+  for (const b of res.content) {
+    if (b.type !== "tool_use") continue;
+    console.log(`  → ${b.name}(${JSON.stringify(b.input)})`);
+    results.push({
+      type: "tool_result",
+      tool_use_id: b.id,
+      content: await runTool(b.name, b.input),
+    });
+  }
+
+  // 並列で呼ばれた分も、必ず1つの user メッセージにまとめる
+  messages.push({ role: "user", content: results });
+}
+
+console.log(`\n(履歴は ${messages.length} 件になりました)`);
```

### 確認

```bash
bun run scratch.ts
```

**成功:** ツール呼び出しのログが出たあと、要約が出て終了する。

```
  → read_file({"path":"docs/expense-policy.md"})
経費精算の締め切りは翌月5営業日以内です。

(履歴は 4 件になりました)
```

**履歴が 4 件**（依頼 / 指示 / 報告 / 回答）になっているのが、「毎回まるごと送っている履歴」の実体です。

> ### ⚠ 「ファイルシステムへのアクセス手段がありません」と返ってきたら
>
> **`tools` 配列が空です。** 上の差分で `const tools = [...]` の中身を省略記号のまま残していないか確認してください。
>
> ```ts
> const tools: Anthropic.Tool[] = [ /* Step 1 と同じ */ ];   // ← これは空配列
> ```
>
> ツールを1つも渡されていないモデルは、ごく普通のチャット相手として振る舞います。「内容を貼り付けてください」「クリップアイコンから添付できます」といった**チャットUIの案内が出てきたら、この症状**です。ツールを持っているモデルは絶対にそう答えません。
>
> 切り分けは1行で済みます。
>
> ```ts
> console.log("tools:", tools.length);   // 0 なら原因はこれ
> ```

> 🎉 **ここで動くものが完成です。** 合宿でいう「初日中に通す最小構成」がここ。100行未満です。

---

# フェーズ2 ── エージェントらしくする

## Step 3 ── ツールを3個に増やす

**目的:** **1個だと選択の余地がない。**3個にして初めて「モデルが選ぶ」が起きる。

### 触るファイル

```
scratch.ts               (差分を当てる)
workspace/docs/*.md      (資料を4〜5本に増やす)
```

資料を増やします。**互いに参照し合う内容にする**のがコツです（「詳細は入社手続きを参照」など）。1回の `read_file` で終わらなくなり、多段の動きが出ます。

### 差分

```diff
 import Anthropic from "@anthropic-ai/sdk";
-import { readFile } from "node:fs/promises";
+import { readFile, readdir } from "node:fs/promises";
 import { join } from "node:path";
 
 const client = new Anthropic();
 
+const ROOT = "workspace";
+
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
+  {
+    name: "list_files",
+    description:
+      "社内資料フォルダにあるファイルの一覧を返す。" +
+      "どんな資料が存在するのか分からないときに、最初に使うこと。",
+    input_schema: { type: "object", properties: {}, required: [] },
+  },
+  {
+    name: "search_files",
+    description:
+      "社内資料を全文検索し、ヒットした行をファイル名つきで返す。" +
+      "探したいキーワードがはっきりしているときは、list_files より先にこれを使うこと。" +
+      "キーワードは日本語でよい。複数語ではヒットしないので、1語ずつ試すこと。",
+    input_schema: {
+      type: "object",
+      properties: { query: { type: "string", description: "検索キーワード。必ず1語だけ" } },
+      required: ["query"],
+    },
+  },
 ];
 
+async function walk(dir: string, acc: string[] = []): Promise<string[]> {
+  for (const e of await readdir(dir, { withFileTypes: true })) {
+    if (e.name.startsWith(".")) continue;
+    const full = join(dir, e.name);
+    if (e.isDirectory()) await walk(full, acc);
+    else acc.push(full.slice(ROOT.length + 1));
+  }
+  return acc.sort();
+}
+
+async function searchFiles(query: string): Promise<string> {
+  const hits: string[] = [];
+  for (const rel of await walk(ROOT)) {
+    const text = await readFile(join(ROOT, rel), "utf-8");
+    text.split("\n").forEach((line, i) => {
+      if (line.includes(query)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
+    });
+  }
+  return hits.length ? hits.join("\n") : `「${query}」はヒットしませんでした。別の語で試してください。`;
+}
+
 async function runTool(name: string, input: any): Promise<string> {
-  if (name === "read_file") return await readFile(join("workspace", input.path), "utf-8");
-  return `不明なツール: ${name}`;
+  switch (name) {
+    case "read_file":    return await readFile(join(ROOT, input.path), "utf-8");
+    case "list_files":   return (await walk(ROOT)).join("\n");
+    case "search_files": return await searchFiles(input.query);
+    default:             return `不明なツール: ${name}`;
+  }
 }
```

質問も差し替えられるようにしておくと、次の確認が楽になります。

```diff
 const messages: Anthropic.MessageParam[] = [
-  { role: "user", content: "docs/expense-policy.md を読んで要約して" },
+  { role: "user", content: process.argv[2] ?? "経費精算の締め切りは?" },
 ];
```

### 確認

**質問を変えて、呼ばれるツールが変わることを見ます。**これがエージェントである証拠です。

```bash
bun run scratch.ts "docs/expense-policy.md を要約して"   # パスを教えている
bun run scratch.ts "経費精算の締め切りは?"                # 教えていない
bun run scratch.ts "入社直後の経費はどう精算する?"        # 相互参照が必要
```

**成功:** 3つで**呼ばれるツールの順番が違う**。3つ目は `search_files → read_file → read_file` のように、同じツールが2回出るはずです。

> **この「同じツールが2回」が、ワークフローとの違いそのものです。** 1回読んで情報が足りないとモデルが気づいて、もう1本読みに行っています。

---

## Step 4 ── description を雑にして、手数が増えるのを測る

**目的:** 「`description` はプロンプトの一部」を、読むのではなく**数字で確認する**。

> **1回動かしただけでは判定できません。** LLM の出力は実行ごとにばらつくので、同じ設定でも呼ばれるツールの順番は変わります。**5回ずつ回して手数を比べる**のがこのステップの本体です。

### 質問の選び方

**複合語では0件になるが、分割すればヒットする**質問を選びます。ここを外すと差が出ません。

| 質問 | 複合語のまま | 分割すると |
| --- | --- | --- |
| リモートワークの申請方法は? | 「リモートワーク申請」= **0件** | リモートワーク=1 / 申請=10 |
| 出張の宿泊費の上限は? | 「宿泊上限」= **0件** | 宿泊=1 / 上限=7 |
| 研修はいつまでに受ける? | 「研修受講期限」= **0件** | 研修=2 / 受講=2 |

**「経費精算の締め切りは?」では差が出ません。** 資料に「経費精算」が複合語のまま5箇所あるので、雑な検索でも当たってしまいます。

### 測定ツールを用意する

**作るファイル: `scripts/measure.ts`**

同じ質問を N 回投げて、ツール呼び出しの回数・平均・ばらつきを出すスクリプトです。テンプレートに入っているので、**リポジトリからコピーしてください**（エージェント本体とは関係ない計測ツールなので、写経の対象外です）。

やっていることは3つだけです。

1. `bun run <エントリ> "<質問>"` を N 回 `Bun.spawn` で実行する
2. 出力から `→ ツール名(` の行を数える
3. 平均・最小・最大・標準偏差を出す

### まず現状を測る（description あり）

```bash
bun run scripts/measure.ts "リモートワークの申請方法は?"
```

こう出ます。

```
質問     : リモートワークの申請方法は?
エントリ : scratch.ts（5 回）
────────────────────────────────────────────────────────────────
   1回目   2 回  search_files → read_file
   2回目   2 回  search_files → read_file
   3回目   2 回  search_files → read_file
   4回目   3 回  list_files → search_files → read_file
   5回目   2 回  search_files → read_file
────────────────────────────────────────────────────────────────
  平均 2.2 回 / 最小 2 / 最大 3 / ばらつき ±0.4
```

この数字を控えておきます。

### 差分（一時的な改悪）

```diff
   {
     name: "search_files",
-    description:
-      "社内資料を全文検索し、ヒットした行をファイル名つきで返す。" +
-      "探したいキーワードがはっきりしているときは、list_files より先にこれを使うこと。" +
-      "キーワードは日本語でよい。複数語ではヒットしないので、1語ずつ試すこと。",
+    description: "検索",
     input_schema: {
```

### 同じことをもう一度

```bash
bun run scripts/measure.ts "リモートワークの申請方法は?"
```

> 回数やエントリも変えられます。`bun run scripts/measure.ts "<質問>" 10 src/cli.ts`
> Step 9 でファイルを分割したあとは `bun run measure "<質問>"` と書けます。

### 読み方

| | 手数の目安 | ばらつき |
| --- | --- | --- |
| description あり | 2回前後（search → read） | 小さい。毎回ほぼ同じ |
| description なし | 3回以上 | **大きい。実行ごとに違う道を通る** |

**平均だけでなく、ばらつきを見てください。** description の役割は「正解に辿り着かせること」より **「回り道を減らすこと」** なので、効果はばらつきの縮小として現れます。

具体的には、なし側でこういう回り道が出ます。

- `list_files({})` を先に呼ぶ ← description の「list_files より先に search を使うこと」が消えたため
- `search_files({"query":"リモートワーク申請"})` と複合語で投げて0件を引く
- 0件だったので別の語で投げ直す

**「呼ばれなくなる」ことは稀です。** たいていは呼ばれたうえで遠回りします。手数が増える形で出る、と思っておいてください。

### 元に戻す

差分を戻して、もう一度5回測ります。手数が元に戻れば確認完了です。

| ✕ | ○ |
| --- | --- |
| `"ファイルを読む"` | `"社内資料の中身を返す。パスが分からないときは先に list_files を使うこと"` |
| `"検索"` | `"全文検索してヒット行を返す。キーワードが明確なときは list_files より先に使う。1語ずつ試すこと"` |

**「何をするか」ではなく「いつ使うか」** を書くのがコツです。

> **教材データが小さいと差は測れません。** いまサンプル資料は5ファイルしかないので、`list_files` が全部返しても探索空間が小さく、雑な戦略でも正解に届いてしまいます。自分たちの題材で試すときは、**実データに近い件数**で測ってください。5件で「うまく動いた」は、ツール設計の良し悪しを何も証明しません。

---

# フェーズ3 ── 事故を止める

> ここから先は「他人に配る」ための作業です。自分だけで使うならフェーズ2で止めても構いません。

## Step 5 ── 最大ターン数の上限

**目的:** 無限ループでコストが飛ぶのを止める。

### 差分

```diff
+const MAX_TURNS = 20;
+let finished = false;
+
-while (true) {
+for (let turn = 1; turn <= MAX_TURNS; turn++) {
   const res = await client.messages.create({
     model: "claude-opus-5",
     max_tokens: 16000,
     tools,
     messages,
   });
 
   for (const b of res.content) {
     if (b.type === "text") console.log(b.text);
   }
 
   messages.push({ role: "assistant", content: res.content });
 
-  if (res.stop_reason !== "tool_use") break;
+  if (res.stop_reason !== "tool_use") { finished = true; break; }
 
   /* ... 中略 ... */
 
   messages.push({ role: "user", content: results });
 }
 
+if (!finished) {
+  console.warn(`⚠ 最大 ${MAX_TURNS} 周に達したので打ち切りました。`);
+  console.warn(`  同じツールを呼び続けていないか、上のログを見てください。`);
+}
```

> **`finished` フラグを忘れないこと。** `break` で抜けても `for` の後ろは実行されるので、フラグなしだと正常終了でも警告が出ます。

### 確認

**わざと `MAX_TURNS = 2` にして動かします。**

```bash
bun run scratch.ts "入社直後の経費はどう精算する?"
```

**成功:** 2周で打ち切りメッセージが出て終了する。正常に終わる質問では警告が出ないことも確認してから、20 に戻す。

---

## Step 6 ── トークン数とコストを表示

**目的:** 見えないものは制御できない。

### 差分

```diff
 const MAX_TURNS = 20;
 let finished = false;
 
+const PRICE = { input: 5.0, output: 25.0 };   // $ / 1M tokens
+let totalIn = 0;
+let totalOut = 0;
+
 for (let turn = 1; turn <= MAX_TURNS; turn++) {
   const res = await client.messages.create({
     model: "claude-opus-5",
     max_tokens: 16000,
     tools,
     messages,
   });
 
+  totalIn += res.usage.input_tokens;
+  totalOut += res.usage.output_tokens;
+  const cost = (totalIn * PRICE.input + totalOut * PRICE.output) / 1_000_000;
+  console.log(
+    `  [${turn}周目] in ${res.usage.input_tokens} / out ${res.usage.output_tokens}` +
+    ` / 累計 $${cost.toFixed(4)}`,
+  );
+
   for (const b of res.content) {
     if (b.type === "text") console.log(b.text);
   }
```

### 確認

```bash
bun run scratch.ts "入社直後の経費はどう精算する?"
```

**成功:** 3周以上まわって、こうなる。

```
  [1周目] in 1204 / out 87 / 累計 $0.0082
  [2周目] in 1655 / out 142 / 累計 $0.0154
  [3周目] in 3090 / out 210 / 累計 $0.0311
```

**注目してほしいのは `in` が毎周増えていくこと。** 会話が伸びているのではなく、**毎回まるごと送り直している**からです。長いファイルを読ませると、ここが一気に膨らみます。

---

## Step 7 ── パス防御と、戻り値の文字数上限

**目的:** ファイルを触るツールを持った時点で必要になる2つ。

### 差分

```diff
 import { readFile, readdir } from "node:fs/promises";
-import { join } from "node:path";
+import { join, resolve, relative } from "node:path";
 
 const client = new Anthropic();
 
-const ROOT = "workspace";
+const ROOT = resolve("workspace");
+const MAX_TOOL_OUTPUT_CHARS = 8_000;
+
+/** workspace/ の外に出ようとしたら止める。ツールを増やすときも必ず通すこと */
+function safePath(p: string): string {
+  const abs = resolve(ROOT, p);
+  if (relative(ROOT, abs).startsWith("..")) {
+    throw new Error(`資料フォルダの外にはアクセスできません: ${p}`);
+  }
+  return abs;
+}
+
+/** 長い戻り値は以降の全周回で送り直されるので、ここで切る */
+function clip(text: string): string {
+  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
+  return text.slice(0, MAX_TOOL_OUTPUT_CHARS) + "\n\n…（長すぎるため打ち切りました）";
+}
```

`ROOT` を絶対パスにしたので、`walk` の切り出しも直します。

```diff
     if (e.isDirectory()) await walk(full, acc);
-    else acc.push(full.slice(ROOT.length + 1));
+    else acc.push(relative(ROOT, full));
```

ツール本体に適用します。

```diff
 async function runTool(name: string, input: any): Promise<string> {
   switch (name) {
-    case "read_file":    return await readFile(join(ROOT, input.path), "utf-8");
+    case "read_file":    return clip(await readFile(safePath(input.path), "utf-8"));
     case "list_files":   return (await walk(ROOT)).join("\n");
-    case "search_files": return await searchFiles(input.query);
+    case "search_files": return clip(await searchFiles(input.query));
     default:             return `不明なツール: ${name}`;
   }
 }
```

失敗もモデルに返します。

```diff
     console.log(`  → ${b.name}(${JSON.stringify(b.input)})`);
-    results.push({
-      type: "tool_result",
-      tool_use_id: b.id,
-      content: await runTool(b.name, b.input),
-    });
+    try {
+      results.push({
+        type: "tool_result",
+        tool_use_id: b.id,
+        content: await runTool(b.name, b.input),
+      });
+    } catch (e) {
+      results.push({
+        type: "tool_result",
+        tool_use_id: b.id,
+        content: `エラー: ${(e as Error).message}`,
+        is_error: true,
+      });
+    }
```

### 確認

```bash
bun run scratch.ts "../package.json の中身を教えて"
```

**成功:** エラーがモデルに返り、モデルが「そのファイルにはアクセスできません」と答えて終了する。**プロセスが落ちない**のが大事です。

> **エラーを握りつぶさないこと。** `catch` で無視すると、モデルは何が起きたか分からず**同じ失敗を延々と繰り返します**。`is_error: true` を付けて返せば、モデルが自分で方針を変えます。

### 「空」を送らないガードを2つ入れる

ここで一緒に塞いでおきます。**どちらも API から 400 が返る**のに、原因がループのバグだと気づきにくい種類の失敗です。

```
400 messages.4: user messages must have non-empty content
```

**再現が「たまに」なので、当日は「たまたま落ちた」ようにしか見えません。** ツールを増やすほど踏みやすくなるので、先に塞ぎます。

#### ガード① 空の `results` を送らない

`stop_reason` が `tool_use` なのに、`tool_use` ブロックが1つも入っていないことが稀にあります。そのまま進むと `content: []` の user メッセージができて弾かれます。

```diff
+    // stop_reason が tool_use でも、実行対象が1つも無いことが稀にある。
+    // content が空配列の user メッセージは 400 で弾かれるので送らない。
+    if (results.length === 0) {
+      console.warn(`\n⚠ ツールの実行要求が空でした。ここで打ち切ります。`);
+      break;
+    }
+
     messages.push({ role: "user", content: results });
```

#### ガード② 空文字の `tool_result` を作らない

`read_file` で中身が空のファイルを読むと `""` が返ります。これも `tool_result` の中身として不正です。

**ツールごとに直すのではなく、入口1箇所で塞ぎます。** こうしておけば、あとからツールを増やしても自動で守られます。

```diff
-async function runTool(name: string, input: any): Promise<string> {
+export async function runTool(name: string, input: any): Promise<string> {
+  // 空文字の tool_result は API に弾かれるので、必ず何か返す
+  return (await dispatch(name, input)) || "（空の結果が返りました）";
+}
+
+async function dispatch(name: string, input: any): Promise<string> {
   switch (name) {
     case "read_file":    return clip(await readFile(safePath(input.path), "utf-8"));
     case "list_files":   return (await walk(ROOT)).join("\n");
     case "search_files": return clip(await searchFiles(input.query));
     default:             return `不明なツール: ${name}`;
   }
 }
```

#### 確認

空のファイルを置いて、読ませます。

```bash
touch workspace/docs/empty.md
bun run scratch.ts "empty.md には何が書いてある?"
```

**成功:** 400 にならず、モデルが「空のようです」と答えて終了する。確認できたら `rm workspace/docs/empty.md` で消しておきます。

> **「空」は例外より厄介です。** エラーなら `catch` で拾えますが、空文字は正常な戻り値として素通りして、API の入口で初めて弾かれます。**ツールの戻り値は「必ず1文字以上」を不変条件にしておく**のが安全です。

---

## Step 8 ── 書き込みツールと承認ゲート

**目的:** 副作用のあるツールを、安全装置と**同時に**足す。

### 差分

```diff
-import { readFile, readdir } from "node:fs/promises";
+import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
-import { join, resolve, relative } from "node:path";
+import { join, resolve, relative, dirname } from "node:path";
```

```diff
+/** 実行前に人間の承認を挟むツール */
+const WRITE_TOOLS = new Set(["write_note"]);
+
 const tools: Anthropic.Tool[] = [
   /* ... 既存の3つ ... */
+  {
+    name: "write_note",
+    description:
+      "調べた結果を Markdown ファイルとして out/ に保存する。" +
+      "ユーザーが明示的に「まとめて」「保存して」と言ったときだけ使うこと。" +
+      "実行前に人間の承認を求めるため、拒否されることがある。",
+    input_schema: {
+      type: "object",
+      properties: {
+        filename: { type: "string", description: "拡張子つきのファイル名。例: summary.md" },
+        content: { type: "string", description: "保存する Markdown 本文" },
+      },
+      required: ["filename", "content"],
+    },
+  },
 ];
```

```diff
 async function runTool(name: string, input: any): Promise<string> {
   switch (name) {
     case "read_file":    return clip(await readFile(safePath(input.path), "utf-8"));
     case "list_files":   return (await walk(ROOT)).join("\n");
     case "search_files": return clip(await searchFiles(input.query));
+    case "write_note": {
+      const abs = safePath(join("out", input.filename));
+      await mkdir(dirname(abs), { recursive: true });
+      await writeFile(abs, input.content, "utf-8");
+      return `保存しました: ${relative(ROOT, abs)} (${input.content.length} 文字)`;
+    }
     default:             return `不明なツール: ${name}`;
   }
 }
```

ツール実行の直前にゲートを置きます。

```diff
   for (const b of res.content) {
     if (b.type !== "tool_use") continue;
+
+    // ── 人間を挟む場所 ──
+    if (WRITE_TOOLS.has(b.name)) {
+      console.log(`\n⚠ 書き込みの許可を求めています`);
+      console.log(`   ${b.name}(${JSON.stringify(b.input).slice(0, 300)})`);
+      if (prompt("   実行しますか? [y/N]")?.trim().toLowerCase() !== "y") {
+        results.push({
+          type: "tool_result",
+          tool_use_id: b.id,
+          content: "ユーザーが実行を拒否しました。理由を尋ねるか、別の方法を提案してください。",
+          is_error: true,
+        });
+        continue;
+      }
+    }
+
     console.log(`  → ${b.name}(${JSON.stringify(b.input)})`);
```

### 確認

```bash
bun run scratch.ts "経費精算のルールをまとめて summary.md に保存して"
```

**2パターン試します。**

1. `y` と答える → `workspace/out/summary.md` ができている
2. `n` と答える → **モデルが「保存を取りやめました」と答えて終了する**

2 のほうが重要です。拒否をきちんと言葉で返しているので、モデルが状況を理解して引き下がっています。

> **「あとでゲートを付けよう」は必ず忘れます。** 書き込みツールを書く手と同じ手で `WRITE_TOOLS` に名前を入れる、という運用にしてください。

---

# フェーズ4 ── 配れるようにする

## Step 9 ── ファイルを分割する

**目的:** 300行を超えて読みづらくなった。**なってから割る。**

### 割り方の基準

レイヤーでも機能でもなく、**「誰がどれくらいの頻度で触るか」**で割ります。テンプレートは「触る場所が一目で分かる」ことが最優先だからです。

| 移す先 | `scratch.ts` のどこを移すか | 触る頻度 |
| --- | --- | --- |
| `src/tools.ts` | `tools` 配列、`runTool`、`walk` / `searchFiles`、`safePath` / `clip`、`WRITE_TOOLS` | **毎日触る** |
| `src/config.ts` | `MODEL`、`MAX_TURNS`、`PRICE`、`ROOT`、`MAX_TOOL_OUTPUT_CHARS` | たまに触る |
| `src/agent.ts` | ループ本体、承認ゲート、システムプロンプト | ほぼ触らない（読むだけ） |
| `src/usage.ts` | `totalIn` / `totalOut` とコスト計算 | 触らない |
| `src/cli.ts` | `process.argv` の処理、結果表示 | 触らない |
| `scripts/measure.ts` | （移動しない。Step 4 で作った計測ツールのまま） | 触らない |

```bash
mkdir src
# scratch.ts の内容を上の5ファイルに切り分ける
rm scratch.ts
```

`package.json` にスクリプトを足します。

```diff
 "scripts": {
+  "agent": "bun run src/cli.ts",
+  "check": "bun run scripts/check.ts",
+  "measure": "bun run scripts/measure.ts",
+  "typecheck": "tsc --noEmit"
 }
```

### 確認

```bash
bun run typecheck
bun run agent "入社直後の経費はどう精算する?"
```

**成功:** Step 8 とまったく同じ結果が出る。**挙動が1ミリも変わらないこと**が、分割が正しく終わった証拠です。

---

## Step 10 ── 疎通スクリプトを書く

**目的:** 初見の人が最初に叩くものを用意する。

### 作るファイル

```
scripts/check.ts     (新規)
```

やることは3つだけです。

1. `.env` に認証情報があるか
2. API を 1 回叩いて応答が返るか
3. かかった時間とコストを表示

**エラー分岐は、ここまでに自分が実際に踏んだものだけ書きます。**

```ts
const err = e as Error & { status?: number; headers?: Headers };

// どの組織・どのワークスペースのキーだったかを出す。切り分けにいちばん効く
const ws = err.headers?.get("anthropic-workspace-id");
if (ws) console.error(`  workspace: ${ws}`);

if (err.status === 400 && /credit balance/i.test(err.message)) {
  console.error("  → 残高不足。Claude のプランと API クレジットは別会計です。");
  console.error("     Console > Settings > Billing の Credit balance を確認。");
  console.error("     ※ キーもネットワークも正常です。認証は通っています。");
}
if (err.status === 401) console.error("  → キーが違います。.env を確認してください。");
if (err.status === 404) console.error("  → モデルIDが違います。config.ts を確認してください。");
if (err.status === 429) console.error("  → レート上限です。少し待つか、運営に連絡してください。");
if (!err.status)        console.error("  → ネットワークに届いていません。プロキシ / VPN を確認してください。");
```

### 確認

**わざと壊して、メッセージが役に立つか見ます。**

```bash
env -u ANTHROPIC_API_KEY bun run check          # → 「cp env.example .env」の案内
env ANTHROPIC_API_KEY=sk-ant-broken bun run check   # → 401 の案内
bun run check                                   # → 緑のチェックと所要時間・コスト
```

> **想像でエラー分岐を書くと当たりません。** 実際に踏んだものだけ書く。踏んでいないエラーは、汎用のメッセージに任せるほうが親切です。

---

## Step 11 ── サンプルデータを整える

**目的:** 初見の人が、自分のデータを用意しなくても動かせるようにする。

### 作るファイル

```
workspace/docs/expense-policy.md      経費精算ルール
workspace/docs/remote-work.md         リモートワーク規程
workspace/docs/dev-setup.md           開発環境セットアップ
workspace/docs/onboarding.md          入社手続きチェックリスト
workspace/docs/incident-response.md   障害対応フロー
workspace/out/.gitkeep
```

### 設計の工夫

**資料同士を相互参照させます。**

- `expense-policy.md` →「アカウントの発行方法は**入社手続きチェックリスト**を参照」
- `onboarding.md` →「締め切りの扱いは**経費精算ルール**を参照」

こうすると「入社直後の経費はどう精算する?」という質問に、**1回の `read_file` では答えられなくなります。**エージェントらしい多段の動きが自然に発生し、デモが映えます。

教材としては正当な工夫です。

### 確認

```bash
bun run agent "入社直後の経費はどう精算する?" -v
```

**成功:** 3周以上まわり、`search_files → read_file → read_file` のように**複数の資料を辿って**答える。

---

## Step 12 ── README を書く

**目的:** 15分で疎通するまでの手順だけを書く。

### 作るファイル

```
README.md
env.example
.gitignore
```

### 書く内容

| 節 | 中身 |
| --- | --- |
| セットアップ | `bun install` → `cp env.example .env` → `bun run check` の3行だけ |
| 動かす | 実行例と、**出力サンプル** |
| ファイル構成 | どこを触ればいいか |
| 自分のツールを足す | `tools.ts` の2箇所を触るだけ、と明示 |
| `description` の書き方 | ✕/○ の対比表 |
| 入っている安全装置 | 一覧と、**外さない理由** |
| 困ったら | **自分が踏んだ躓きの一覧** |

**トラブルシューティング表は、Step 0〜11 で自分が踏んだものをそのまま書きます。** 先に書くと想像で書くことになって当たりません。

### 確認 ── セルフテスト

**別のディレクトリに clone して、README だけを見ながら15分で動かせるか自分で試します。**

```bash
cd /tmp
git clone <自分のリポジトリ> test-clone
cd test-clone
# ここから先は README しか見ない
```

詰まった箇所があれば、それは README の不足です。直してから配ってください。

---

# 詰まったときの切り分け

**上から順に潰します。** 下の層を疑う前に、必ず上を確認してください。

| 層 | 確認方法 | 通らないときに見るところ |
| --- | --- | --- |
| 1. 認証・回線 | `bun run check` | `.env` / 残高 / プロキシ |
| 1.5 リクエストの組み立て | 400 が返るか | `non-empty content` なら Step 7 のガード2つ |
| 2. ツール単体 | ツール関数を直接呼ぶ | 普通のプログラミングのバグ |
| 3. モデルがツールを選ぶ | ログの `→` 行が出るか | まず `tools.length` が 0 でないか。次に `description` に「いつ使うか」があるか |
| 4. モデルの回答品質 | 最終出力 | ツールの戻り値 → システムプロンプト の順 |

**3 の層で止まっている人が一番多い**です。ログに `→` が出ていなければ、順に2つを疑います。

1. **`tools` が空** — モデルが「ファイルを読む手段がありません」「内容を貼り付けてください」と答えるのが目印
2. **`description` が弱い** — ツールは渡っているが、いつ使うかが書かれていない

ツール単体のテストはこう書けます（SDK も API キーも不要）。

```bash
bun -e 'const {runTool} = await import("./src/tools.ts"); console.log(await runTool("search_files", {query:"締め切り"}))'
```

---

# 合宿のタイムテーブルへの対応

この手順書は、そのまま参加者への進行指示になります。

| 合宿の時刻 | 到達目標 | 判定 |
| --- | --- | --- |
| 初日 10:00 | **Step 0** | `bun run check` が緑 |
| 初日 13:00 | **Step 2** | ツール1個でループが1周でも回る |
| 初日 16:00（中間チェック） | **Step 3〜4** | 質問を変えると呼ばれるツールが変わる |
| 2日目 12:00 | **Step 5〜8** | 安全装置が入っている |
| 2日目 15:00（コードフリーズ） | **Step 9 以降は任意** | デモが通ればよい |

**中間チェックで見るのは Step 3 到達だけ**です。設計の良し悪しには触れません。触れると手戻りが発生します。

---

*関連： [運営ランブック](01-runbook.md) ／ [電話越しの現場監督](02-agent-primer.md) ／ [キックオフ台本](03-kickoff-script.md)*
