/**
 * ==================================================================
 * 作例② HTTP を叩く
 *
 *   cp examples/http-agent/tools.ts src/tools.ts
 *   bun run agent "anthropics/anthropic-sdk-typescript の最近の issue を3件教えて" -v
 *
 * GitHub の公開 API を叩くエージェント。認証は要らない（未認証は 60 req/時）。
 *
 * 合宿では、この fetch の中身を自社の API に差し替えるのが出発点になる。
 * 見てほしいのは GitHub の使い方ではなく、次の3つ。
 *
 *   1. JSON をそのまま返さない。モデルが読む形に絞ってから返す
 *   2. 失敗を throw しない。「なぜ失敗したか」を文字列で返してモデルに考えさせる
 *   3. 引数のバリデーションはこちら側でやる。モデルは平気で変な値を入れてくる
 * ==================================================================
 */
import type Anthropic from "@anthropic-ai/sdk";
import { clip } from "../../src/guard.ts";

export const SYSTEM_PROMPT = `あなたは GitHub のリポジトリを調べて質問に答えるアシスタントです。

守ること:
- 答える前に必ず API で実物を確認する。自分の記憶だけで答えない
- リポジトリ名が曖昧なときは、まず search_repos で候補を探してから読む
- 見つからなかったときは、勝手に近そうなものを選ばず、候補を挙げて聞き返す
- 根拠にした URL を示す
- 日本語で、簡潔に`;

const API = "https://api.github.com";

export const tools: Anthropic.Tool[] = [
  {
    name: "search_repos",
    description:
      "GitHub のリポジトリをキーワードで検索し、上位5件を star 数つきで返す。" +
      "ユーザーが挙げたリポジトリの owner/repo が分からないときに、まずこれで特定すること。",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "検索キーワード。例: anthropic sdk typescript" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_repo",
    description:
      "リポジトリの概要（説明・star数・言語・最終更新・open issue 数）を返す。" +
      "owner と repo が確定してから使うこと。分からなければ先に search_repos。",
    input_schema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "オーナー名。例: anthropics" },
        repo: { type: "string", description: "リポジトリ名。例: anthropic-sdk-typescript" },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "list_issues",
    description:
      "リポジトリの issue を新しい順に最大10件返す。タイトル・番号・状態・URL のみで、本文は含まない。" +
      "本文が必要なときは、この一覧で番号を確かめてから read_issue を使うこと。",
    input_schema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "オーナー名" },
        repo: { type: "string", description: "リポジトリ名" },
        state: {
          type: "string",
          enum: ["open", "closed", "all"],
          description: "省略時は open",
        },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "read_issue",
    description:
      "issue 1件の本文を返す。番号が分からないときは、先に list_issues を使うこと。",
    input_schema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "オーナー名" },
        repo: { type: "string", description: "リポジトリ名" },
        number: { type: "integer", description: "issue 番号" },
      },
      required: ["owner", "repo", "number"],
    },
  },
];

/** 読み取りだけなので、承認ゲートに載せるものはない */
export const WRITE_TOOLS = new Set<string>();

export async function runTool(name: string, input: unknown): Promise<string> {
  return (await dispatch(name, input)) || "（空の結果が返りました）";
}

async function dispatch(name: string, input: unknown): Promise<string> {
  const args = (input ?? {}) as Record<string, string & number>;

  switch (name) {
    case "search_repos":
      return await searchRepos(String(args.query ?? ""));

    case "get_repo":
      return await getRepo(String(args.owner ?? ""), String(args.repo ?? ""));

    case "list_issues":
      return await listIssues(
        String(args.owner ?? ""),
        String(args.repo ?? ""),
        String(args.state ?? "open"),
      );

    case "read_issue":
      return await readIssue(
        String(args.owner ?? ""),
        String(args.repo ?? ""),
        Number(args.number),
      );

    default:
      return `不明なツールです: ${name}`;
  }
}

// ---------------------------------------------------------------- helpers

/**
 * ここが要。失敗を throw せず、モデルが次の手を考えられる文章にして返す。
 * 「404 です」ではなく「無いので search_repos で探し直せ」まで書く。
 */
async function api(path: string): Promise<unknown | string> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "sample-ai-agent",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return `GitHub に接続できませんでした（${(e as Error).message}）。ネットワークかプロキシの問題なので、リトライしても直りません。ユーザーにその旨を伝えてください。`;
  }

  if (res.status === 404) {
    return "そのリポジトリまたは issue は存在しません。名前を思い込みで補わず、search_repos で正しい owner/repo を探し直してください。";
  }
  if (res.status === 403 || res.status === 429) {
    return "GitHub API のレート上限に達しました（未認証は60回/時）。これ以上 API を呼ばず、ここまでに分かったことだけでユーザーに答えてください。";
  }
  if (!res.ok) {
    return `GitHub API がエラーを返しました（${res.status}）。同じ引数で呼び直さないでください。`;
  }

  return await res.json();
}

const fail = (v: unknown): v is string => typeof v === "string";

async function searchRepos(query: string): Promise<string> {
  if (!query.trim()) return "検索キーワードが空です。何を探すか指定してください。";

  const data = await api(`/search/repositories?q=${encodeURIComponent(query)}&per_page=5`);
  if (fail(data)) return data;

  const items = (data as { items?: Repo[] }).items ?? [];
  if (items.length === 0) {
    return `「${query}」に一致するリポジトリはありませんでした。語を減らして試してください。`;
  }

  // JSON をそのまま返さない。1件1行にして、要る列だけ残す
  return items
    .map((r) => `${r.full_name}  ★${r.stargazers_count}  ${r.description ?? "(説明なし)"}`)
    .join("\n");
}

async function getRepo(owner: string, repo: string): Promise<string> {
  if (!owner || !repo) return "owner と repo の両方が要ります。";

  const r = await api(`/repos/${enc(owner)}/${enc(repo)}`);
  if (fail(r)) return r;

  const d = r as Repo;
  return [
    `リポジトリ   ${d.full_name}`,
    `説明         ${d.description ?? "(なし)"}`,
    `star         ${d.stargazers_count}`,
    `言語         ${d.language ?? "(不明)"}`,
    `open issue   ${d.open_issues_count}`,
    `最終更新     ${d.pushed_at}`,
    `URL          ${d.html_url}`,
  ].join("\n");
}

async function listIssues(owner: string, repo: string, state: string): Promise<string> {
  if (!owner || !repo) return "owner と repo の両方が要ります。";
  if (!["open", "closed", "all"].includes(state)) {
    return `state は open / closed / all のどれかです（受け取った値: ${state}）。`;
  }

  const r = await api(`/repos/${enc(owner)}/${enc(repo)}/issues?state=${state}&per_page=10`);
  if (fail(r)) return r;

  // GitHub の issue API は PR も混ぜて返してくる。ここで落とす
  const issues = (r as Issue[]).filter((i) => !i.pull_request);
  if (issues.length === 0) return `${state} な issue はありません。`;

  return issues
    .map((i) => `#${i.number} [${i.state}] ${i.title}\n  ${i.html_url}`)
    .join("\n");
}

async function readIssue(owner: string, repo: string, number: number): Promise<string> {
  if (!owner || !repo) return "owner と repo の両方が要ります。";
  if (!Number.isInteger(number) || number <= 0) {
    return `issue 番号が不正です（受け取った値: ${number}）。list_issues で番号を確認してください。`;
  }

  const r = await api(`/repos/${enc(owner)}/${enc(repo)}/issues/${number}`);
  if (fail(r)) return r;

  const d = r as Issue;
  // 本文は長い。clip を通さないと、以降の全周回でこれを送り続けることになる
  return clip(
    [`#${d.number} [${d.state}] ${d.title}`, d.html_url, "", d.body ?? "(本文なし)"].join("\n"),
  );
}

const enc = (s: string) => encodeURIComponent(s.trim());

type Repo = {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  open_issues_count: number;
  pushed_at: string;
  html_url: string;
};

type Issue = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
  pull_request?: unknown;
};
