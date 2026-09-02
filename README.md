# sample-ai-agent

開発合宿用の AI エージェント・テンプレート．15 分で疎通し，あとは自分たちのツールを足していくための最小構成です．

薄く作ってあります．抽象化された基底クラスもプラグイン機構もありません．
エージェントのループは `src/agent.ts` に 30 行ほどで生で書いてあるので，まず読んでください．

> 編集するのは `src/tools.ts` の 1 本だけです．
> ループ・コスト計測・承認ゲート・安全装置は動く状態で入っています．触らなくても全部効きます．
> 書き方に詰まったら，丸ごとコピーできる[作例が 3 本](examples/README.md)あります．

---

## セットアップ（15 分）

前提: [Bun](https://bun.sh) 1.3 以上

```bash
bun install
cp env.example .env     # 運営から配られたキーを .env に貼る
bun run check           # 疎通確認
```

`bun run check` が緑になれば準備完了です．ここで 15 分以上かかったら，悩まず運営を呼んでください．

## 動かす

初期状態の `src/tools.ts` には，動作確認用のダミーツール（`get_current_time`）が 1 つだけ入っています．

```bash
bun run agent "今日は何日?" -v      # -v はモデルの考えを表示
```

中身のある例を先に見たいときは，作例を丸ごとコピーしてください．

```bash
cp examples/doc-agent/tools.ts src/tools.ts

bun run agent "経費精算の締め切りはいつ?"
bun run agent "リモートワークは週何日まで?" -v
bun run agent "障害対応の初動をまとめて incident.md に保存して"
```

`workspace/docs/` にダミーの社内資料が入っていて，このエージェントはこれを検索・読解して答えます．

実行するとこんなログが出ます．

```
質問: 経費精算の締め切りはいつ?
────────────────────────────────────────────────────────────
  [1周目] in 1,204 / out 87 / 累計 $0.0082
  → search_files({"query":"経費精算"})
  [2周目] in 1,655 / out 142 / 累計 $0.0154
  → read_file({"path":"docs/expense-policy.md"})
  [3周目] in 3,090 / out 210 / 累計 $0.0311

当月分は翌月5営業日以内です。ただし期末（3月）のみ3月25日必着です。
根拠: docs/expense-policy.md
────────────────────────────────────────────────────────────
  周回数     3
  概算コスト $0.0311
```

周回するごとに `in` が増えていくのが見えます．モデルは記憶を持たないので，毎回それまでの全履歴を送り直しているためです．

---

## ファイル構成

```
src/
  tools.ts    ← ★ここだけ編集する。SYSTEM_PROMPT / tools / runTool
  agent.ts    ← ループ本体（30行）。読むのは自由、書く必要はない
  config.ts   ← モデル、最大ターン数、単価
  guard.ts    ← 安全装置（パス防御・戻り値の切り詰め）
  usage.ts    ← トークン数とコストの集計
  cli.ts      ← エントリポイント
  scratch.ts  ← 1ファイル版（docs/04-reference.md の Step 8 相当）
examples/
  doc-agent/    ← 作例① ローカルのファイルを読む
  http-agent/   ← 作例② HTTP を叩く
  state-agent/  ← 作例③ 状態を書き換える
scripts/
  check.ts    ← 疎通確認
  measure.ts  ← 同じ質問をN回投げて手数のばらつきを測る
workspace/
  docs/       ← エージェントが読む資料（差し替えてよい）
  out/        ← エージェントが書き出す先
docs/         ← 合宿の資料
```

`examples/*/tools.ts` は `src/tools.ts` にそのまま入る形になっています．上書きコピーで切り替えてください．

## 自分のツールを足す

`src/tools.ts` の 2 箇所を触るだけです．

1. `tools` 配列に定義を足す（モデルに見せる「名簿」）
2. `runTool` の `switch` に処理を足す（ただの関数）

```ts
// 1. 名簿に足す
{
  name: "get_weather",
  description:
    "指定した都市の現在の天気を返す。ユーザーが天気や気温を尋ねたときに使うこと。",
  input_schema: {
    type: "object",
    properties: { city: { type: "string", description: "都市名。例: 東京" } },
    required: ["city"],
  },
},

// 2. 処理を足す
case "get_weather":
  return await fetchWeather(args.city ?? "");
```

### description は「プロンプトの一部」です

モデルは `description` しか読んでいません．エージェントがツールを呼んでくれないときは，9 割ここが原因です．

| ✕ | ○ |
| --- | --- |
| `"ファイルを読む"` | `"社内資料の中身を返す。パスが分からないときは先に list_files を使うこと"` |
| `"検索"` | `"全文検索してヒット行を返す。キーワードが明確なときは list_files より先に使う。1語ずつ試すこと"` |

「何をするか」ではなく 「いつ使うか」 を書くのがコツです．

### 書き込み系ツールは必ず承認ゲートを通す

`src/tools.ts` の `WRITE_TOOLS` に名前を入れると，実行前に確認が入ります．

```ts
export const WRITE_TOOLS = new Set(["write_note", "post_slack"]);
```

外部に書き込むツールは必ずここに入れてください． 本番の Slack や GitHub に向けたままループを回すと，止める前に数十件書き込まれます．腕の問題ではなく全員に起こります．

---

## 入っている安全装置

| 仕掛け | 場所 | 理由 |
| --- | --- | --- |
| 最大ターン数の上限（20 周） | `config.ts` の `MAX_TURNS` | 無限ループでコストが飛ぶのを防ぐ |
| ツール戻り値の文字数上限 | `config.ts` の `MAX_TOOL_OUTPUT_CHARS` ／ `guard.ts` の `clip()` | 長い戻り値は以降の全周回で送り直されるため |
| パストラバーサル防御 | `guard.ts` の `safePath()` | `workspace/` の外を触らせない |
| 書き込みの承認ゲート | `agent.ts` の `askApproval()` | 事故の被害範囲を人間が決める |
| コスト表示 | `usage.ts` | 感覚を掴むため．監視ではありません |

どれも外さないでください．特に `MAX_TURNS` は，外した瞬間に事故が起きます．

---

## 困ったら

| 症状 | 見るところ |
| --- | --- |
| `bun install` が固まる | プロキシ設定（`HTTPS_PROXY`） |
| `check` で 400 (credit balance) | 残高不足．キーもネットワークも正常． ①API クレジットを買ったか（claude.ai 側のプランとは別会計）②ワークスペースの spend limit．`check` がワークスペース ID を出すので運営に伝える |
| `check` で 401 | `.env` のキーが違う |
| `check` で 429 | レート上限．運営に連絡 |
| `check` でネットワークエラー | プロキシ / VPN |
| 「ファイルを読む手段がありません」と返る | `tools` が空． チャット UI の案内文が出たらこの症状 |
| 400 `non-empty content` | ツールが空文字を返している，または実行要求が空．`tools.ts` の `runTool` と `agent.ts` の `results.length === 0` を確認 |
| ツールを呼んでくれない | `tools.length` が 0 でないか → `description` に「いつ使うか」が書かれているか |
| 同じツールを呼び続ける | 戻り値が期待と違う．ログの `→` 行を見る |
| 精度が出ない | ①description ②ツールの戻り値 ③システムプロンプト の順に疑う |

同じところで 15 分止まったら，Slack の `#合宿-質問` に投げてください．

### ツール設計の良し悪しを測る

`description` を直したときの効果は，1 回動かしても分かりません．実行ごとにばらつくので，同じ質問を何回か投げて手数を比べます．

```bash
bun run measure "リモートワークの申請方法は?"
bun run measure "出張の宿泊費の上限は?" 10
```

ツール呼び出しの回数・平均・ばらつきが出ます．平均だけでなくばらつきを見てください． 良い `description` は，正解率より先に「回り道の少なさ」として効きます．

---

## 合宿の資料

- [これだけ](docs/00-tldr.md) — 事前に読むのはこの 1 枚（5 分）．キックオフのスライドもここから作る
- [電話越しの現場監督](docs/01-agent-primer.md) — AI エージェントとは何か（10 分）
- [キックオフ台本](docs/02-kickoff-script.md) — 初日朝の説明資料（運営向け）
- [事前課題](docs/03-handson.md) — 合宿前に各自でやる 45 分．ここでレベルを揃える
- [作る順番](docs/04-reference.md) — ゼロから組み立てる全 12 ステップ．詰まったときに引くリファレンス
- [作例 3 本](examples/README.md) — 丸ごとコピーしてよい
