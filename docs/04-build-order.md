# 作る順番 ── ステップごとの手順と確認方法

このテンプレート（`src/`）を、ゼロから段階的に組み立てるとしたらこの順、という手順書です。

**Step 9 までは 1 ファイル（`scratch.ts`）だけで進みます。** ディレクトリを切るのは最後です。
各ステップの終わりに必ず動作確認があり、**動かない中間状態を作らない**構成にしてあります。

合計 6 時間ほど。合宿の初日午前で Step 2 まで、初日夕方で Step 4 まで到達すれば順調です。

---

## 全体像

| フェーズ | Step | ゴール | 累計時間 |
| --- | --- | --- | --- |
| 1. 動かす | 0〜2 | 1ファイルでエージェントが動く | 1時間20分 |
| 2. エージェントらしくする | 3〜4 | モデルがツールを選ぶようになる | 2時間05分 |
| 3. 事故を止める | 5〜8 | 他人に渡しても壊れない | 3時間25分 |
| 4. 配れるようにする | 9〜12 | 初見の人が15分で動かせる | 5時間15分 |

---

# フェーズ1 ── まず動かす

## Step 0 ── API を1発叩く　`10分`

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

## Step 1 ── ツールを渡して、返ってきたものを眺める　`30分`

**目的:** 「モデルは実行しない、要求してくるだけ」を**自分の目で見る**。まだ実行しません。

### 触るファイル

```
scratch.ts       (書き換え)
workspace/docs/expense-policy.md   (新規・中身は適当でよい)
```

### 手順

適当なテキストファイルを 1 本置きます。中身は何でも構いません。

```bash
mkdir -p workspace/docs
printf '# 経費精算ルール\n\n締め切りは翌月5営業日以内です。\n' > workspace/docs/expense-policy.md
```

```ts
// scratch.ts
import Anthropic from "@anthropic-ai/sdk";

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

const res = await client.messages.create({
  model: "claude-opus-5",
  max_tokens: 1024,
  tools,
  messages: [{ role: "user", content: "docs/expense-policy.md を読んで要約して" }],
});

console.log("stop_reason:", res.stop_reason);
console.dir(res.content, { depth: null });
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

> **ハマりどころ:** ここで要約が返ってきた場合、モデルがツールを使わずに答えています。`description` が弱いか、ファイル名から中身を推測できてしまっています。質問を「このファイルの3行目に何と書いてあるか」など、読まないと絶対に答えられないものに変えてください。

---

## Step 2 ── ループを閉じる　`30分`

**目的:** 要求されたツールを実行して、結果を返して、もう一周する。**ここでエージェントが成立します。**

### 触るファイル

```
scratch.ts       (書き換え)
```

```ts
// scratch.ts
import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const client = new Anthropic();

const tools: Anthropic.Tool[] = [ /* Step 1 と同じ */ ];

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
```

### 確認

```bash
bun run scratch.ts
```

**成功:** ツール呼び出しのログが出たあと、要約が出て終了する。

```
  → read_file({"path":"docs/expense-policy.md"})
経費精算の締め切りは翌月5営業日以内です。
```

**さらに確認:** `messages.length` を最後に出してみてください。**4 になっている**はずです（依頼 / 指示 / 報告 / 回答）。これが「毎回まるごと送っている履歴」の実体です。

> 🎉 **ここで動くものが完成です。** 合宿でいう「初日中に通す最小構成」がここ。100行未満です。

---

# フェーズ2 ── エージェントらしくする

## Step 3 ── ツールを3個に増やす　`30分`

**目的:** **1個だと選択の余地がない。**3個にして初めて「モデルが選ぶ」が起きる。

### 触るファイル

```
scratch.ts                        (ツール2個追加)
workspace/docs/*.md               (資料を4〜5本に増やす)
```

資料を増やします。**互いに参照し合う内容にする**のがコツです（「詳細は入社手続きを参照」など）。1回の `read_file` で終わらなくなり、多段の動きが出ます。

追加するツール:

```ts
{
  name: "list_files",
  description: "社内資料フォルダにあるファイルの一覧を返す。" +
    "どんな資料が存在するのか分からないときに、最初に使うこと。",
  input_schema: { type: "object", properties: {}, required: [] },
},
{
  name: "search_files",
  description: "社内資料を全文検索し、ヒットした行をファイル名つきで返す。" +
    "探したいキーワードがはっきりしているときは、list_files より先にこれを使うこと。" +
    "キーワードは日本語でよい。複数語ではヒットしないので、1語ずつ試すこと。",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "検索キーワード。必ず1語だけ" } },
    required: ["query"],
  },
},
```

### 確認

**質問を変えて、呼ばれるツールが変わることを見ます。**これがエージェントである証拠です。

```bash
# パスを教えている → read_file だけ
bun run scratch.ts   # 質問: "docs/expense-policy.md を要約して"

# パスを教えていない → search_files か list_files から始まる
bun run scratch.ts   # 質問: "経費精算の締め切りは?"

# 相互参照が必要 → 3周以上まわる
bun run scratch.ts   # 質問: "入社直後の経費はどう精算する?"
```

**成功:** 3つで**呼ばれるツールの順番が違う**。3つ目は `search_files → read_file → read_file` のように、同じツールが2回出るはずです。

> **この「同じツールが2回」が、ワークフローとの違いそのものです。** 1回読んで情報が足りないとモデルが気づいて、もう1本読みに行っています。

---

## Step 4 ── わざと description を雑にして、呼ばれないのを見る　`15分`

**目的:** 「`description` はプロンプトの一部」を、読むのではなく**体で覚える**。

### 手順

`search_files` の description を、一時的にこう書き換えます。

```ts
description: "検索",
```

### 確認

```bash
bun run scratch.ts   # 質問: "経費精算の締め切りは?"
```

**観察されること:** `search_files` が呼ばれなくなるか、呼ばれても変な使い方（複数語を渡すなど）をします。モデルは**名簿の説明文しか読んでいない**からです。

元に戻して、もう一度動かして直ることを確認したら終了。

| ✕ | ○ |
| --- | --- |
| `"ファイルを読む"` | `"社内資料の中身を返す。パスが分からないときは先に list_files を使うこと"` |
| `"検索"` | `"全文検索してヒット行を返す。キーワードが明確なときは list_files より先に使う。1語ずつ試すこと"` |

**「何をするか」ではなく「いつ使うか」**を書くのがコツです。

---

# フェーズ3 ── 事故を止める

> ここから先は「他人に配る」ための作業です。自分だけで使うならフェーズ2で止めても構いません。

## Step 5 ── 最大ターン数の上限　`10分`

**目的:** 無限ループでコストが飛ぶのを止める。

### 手順

`while (true)` を差し替えます。

```ts
const MAX_TURNS = 20;

for (let turn = 1; turn <= MAX_TURNS; turn++) {
  // ... 中身は同じ ...
}
console.warn(`⚠ 最大 ${MAX_TURNS} 周に達したので打ち切りました。`);
```

### 確認

**わざと `MAX_TURNS = 2` にして動かします。**

```bash
bun run scratch.ts   # 質問: "入社直後の経費はどう精算する?"
```

**成功:** 2周で打ち切りメッセージが出て終了する。終わったら 20 に戻す。

> **なぜこのタイミングか:** Step 3 まででたいてい一度は「同じツールを呼び続ける」を経験しています。**事故を見てから入れると、外そうと思わなくなります。**先に入れると意味の分からないおまじないになって、邪魔になった瞬間に外されます。

---

## Step 6 ── トークン数とコストを表示　`20分`

**目的:** 見えないものは制御できない。

### 手順

ループの中、API 呼び出しの直後に足します。

```ts
const PRICE = { input: 5.0, output: 25.0 };   // $ / 1M tokens
let totalIn = 0, totalOut = 0;

// ... ループ内 ...
totalIn += res.usage.input_tokens;
totalOut += res.usage.output_tokens;
const cost = (totalIn * PRICE.input + totalOut * PRICE.output) / 1_000_000;
console.log(`  [${turn}周目] in ${res.usage.input_tokens} / out ${res.usage.output_tokens} / 累計 $${cost.toFixed(4)}`);
```

### 確認

```bash
bun run scratch.ts   # 質問: "入社直後の経費はどう精算する?"
```

**成功:** 3周以上まわって、こうなる。

```
  [1周目] in 1,204 / out 87 / 累計 $0.0082
  [2周目] in 1,655 / out 142 / 累計 $0.0154
  [3周目] in 3,090 / out 210 / 累計 $0.0311
```

**注目してほしいのは `in` が毎周増えていくこと。** 会話が伸びているのではなく、**毎回まるごと送り直している**からです。長いファイルを読ませると、ここが一気に膨らみます。

---

## Step 7 ── パス防御と、戻り値の文字数上限　`20分`

**目的:** ファイルを触るツールを持った時点で必要になる2つ。

### 手順

```ts
import { resolve, relative } from "node:path";

const ROOT = resolve("workspace");
const MAX_TOOL_OUTPUT_CHARS = 8_000;

function safePath(p: string): string {
  const abs = resolve(ROOT, p);
  if (relative(ROOT, abs).startsWith("..")) {
    throw new Error(`資料フォルダの外にはアクセスできません: ${p}`);
  }
  return abs;
}

function clip(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  return text.slice(0, MAX_TOOL_OUTPUT_CHARS) + "\n\n…（長すぎるため打ち切りました）";
}
```

さらに、`runTool` の呼び出しを try/catch で包み、**失敗もモデルに返します**。

```ts
try {
  results.push({ type: "tool_result", tool_use_id: b.id, content: await runTool(b.name, b.input) });
} catch (e) {
  results.push({
    type: "tool_result", tool_use_id: b.id,
    content: `エラー: ${(e as Error).message}`,
    is_error: true,
  });
}
```

### 確認

```bash
bun run scratch.ts   # 質問: "../package.json の中身を教えて"
```

**成功:** エラーがモデルに返り、モデルが「そのファイルにはアクセスできません」と答えて終了する。**プロセスが落ちない**のが大事です。

> **エラーを握りつぶさないこと。** `catch` で無視すると、モデルは何が起きたか分からず**同じ失敗を延々と繰り返します**。`is_error: true` を付けて返せば、モデルが自分で方針を変えます。

---

## Step 8 ── 書き込みツールと承認ゲート　`30分`

**目的:** 副作用のあるツールを、安全装置と**同時に**足す。

### 手順

```ts
const WRITE_TOOLS = new Set(["write_note"]);

// tools に追加
{
  name: "write_note",
  description: "調べた結果を Markdown ファイルとして out/ に保存する。" +
    "ユーザーが明示的に「まとめて」「保存して」と言ったときだけ使うこと。" +
    "実行前に人間の承認を求めるため、拒否されることがある。",
  input_schema: {
    type: "object",
    properties: {
      filename: { type: "string" },
      content: { type: "string" },
    },
    required: ["filename", "content"],
  },
},
```

ツール実行の直前にゲートを置きます。

```ts
if (WRITE_TOOLS.has(b.name)) {
  console.log(`\n⚠ 書き込みの許可を求めています`);
  console.log(`   ${b.name}(${JSON.stringify(b.input).slice(0, 300)})`);
  if (prompt("   実行しますか? [y/N]")?.trim().toLowerCase() !== "y") {
    results.push({
      type: "tool_result", tool_use_id: b.id,
      content: "ユーザーが実行を拒否しました。理由を尋ねるか、別の方法を提案してください。",
      is_error: true,
    });
    continue;
  }
}
```

### 確認

```bash
bun run scratch.ts   # 質問: "経費精算のルールをまとめて summary.md に保存して"
```

**2パターン試します。**

1. `y` と答える → `workspace/out/summary.md` ができている
2. `n` と答える → **モデルが「保存を取りやめました」と答えて終了する**

2 のほうが重要です。拒否をきちんと言葉で返しているので、モデルが状況を理解して引き下がっています。

> **「あとでゲートを付けよう」は必ず忘れます。** 書き込みツールを書く手と同じ手で `WRITE_TOOLS` に名前を入れる、という運用にしてください。

---

# フェーズ4 ── 配れるようにする

## Step 9 ── ファイルを分割する　`20分`

**目的:** 300行を超えて読みづらくなった。**なってから割る。**

### 割り方の基準

レイヤーでも機能でもなく、**「誰がどれくらいの頻度で触るか」**で割ります。テンプレートは「触る場所が一目で分かる」ことが最優先だからです。

| ファイル | 中身 | 触る頻度 |
| --- | --- | --- |
| `src/tools.ts` | ツールの定義と実装、`safePath` / `clip` | **毎日触る** |
| `src/config.ts` | モデル、`MAX_TURNS`、単価 | たまに触る |
| `src/agent.ts` | ループ本体、承認ゲート | ほぼ触らない（読むだけ） |
| `src/usage.ts` | トークン集計 | 触らない |
| `src/cli.ts` | 引数処理、エントリ | 触らない |

`scratch.ts` は削除します。

```bash
mkdir src
# scratch.ts の内容を上の5ファイルに切り分ける
rm scratch.ts
```

`package.json` にスクリプトを足します。

```json
"scripts": {
  "agent": "bun run src/cli.ts",
  "check": "bun run scripts/check.ts",
  "typecheck": "tsc --noEmit"
}
```

### 確認

```bash
bun run typecheck
bun run agent "入社直後の経費はどう精算する?"
```

**成功:** Step 8 とまったく同じ結果が出る。**挙動が1ミリも変わらないこと**が、分割が正しく終わった証拠です。

---

## Step 10 ── 疎通スクリプトを書く　`20分`

**目的:** 初見の人が最初に叩くものを用意する。

### 作るファイル

```
scripts/check.ts
```

やることは3つだけです。

1. `.env` に認証情報があるか
2. API を 1 回叩いて応答が返るか
3. かかった時間とコストを表示

**エラー分岐は、ここまでに自分が実際に踏んだものだけ書きます。**

```ts
if (err.status === 400 && /credit balance/i.test(err.message)) {
  console.error("  → 残高不足です。Console の Plans & Billing でクレジットを購入してください。");
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
# キーを外す
env -u ANTHROPIC_API_KEY bun run check     # → 「cp env.example .env」の案内が出る

# キーを壊す
ANTHROPIC_API_KEY=sk-ant-broken bun run check   # → 401 の案内が出る

# 正常
bun run check                               # → 緑のチェックと所要時間・コスト
```

> **想像でエラー分岐を書くと当たりません。** 実際に踏んだものだけ書く。踏んでいないエラーは、汎用のメッセージに任せるほうが親切です。

---

## Step 11 ── サンプルデータを整える　`20分`

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

## Step 12 ── README を書く　`30分`

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
| 2. ツール単体 | ツール関数を直接呼ぶ | 普通のプログラミングのバグ |
| 3. モデルがツールを選ぶ | ログの `→` 行が出るか | `description` に「いつ使うか」があるか |
| 4. モデルの回答品質 | 最終出力 | ツールの戻り値 → システムプロンプト の順 |

**3 の層で止まっている人が一番多い**です。ログに `→` が出ていなければ、コードのバグではなく `description` の問題です。

ツール単体のテストはこう書けます（SDK も API キーも不要）。

```bash
bun -e 'const {runTool} = await import("./src/tools.ts");
        console.log(await runTool("search_files", {query:"締め切り"}))'
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
