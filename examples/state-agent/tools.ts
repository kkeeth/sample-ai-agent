/**
 * ==================================================================
 * 作例③ 状態を書き換える
 *
 *   cp examples/state-agent/tools.ts src/tools.ts
 *   bun run agent "明日の14時から2時間、6人で打ち合わせしたい。空いてる部屋を押さえて" -v
 *
 * 会議室の予約エージェント。3つの作例のうち、これだけが「読む」で終わらない。
 *
 * 見てほしいのは会議室そのものではなく、次の3つ。
 *
 *   1. 書き込みツールは WRITE_TOOLS に入れる。実行前に人間の承認が入る
 *   2. 書き込みの前に、こちら側で検証する。モデルの判断を信用しない
 *      （空きの確認をモデルに任せると、確認せずに予約を入れてくる）
 *   3. 承認されなかったとき・矛盾したときに、何が起きたかを文章で返す
 *
 * 状態は workspace/state/bookings.json に保存される。実行をまたいで残る。
 * 実務では、ここが DB や社内システムの API になる。
 * ==================================================================
 */
import type Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { safePath } from "../../src/guard.ts";

export const SYSTEM_PROMPT = `あなたは会議室の予約を代行するアシスタントです。

守ること:
- 予約を入れる前に、必ず check_availability で空きを確認する
- 人数が入る部屋だけを候補にする。定員未満の部屋を勧めない
- 希望の時間が埋まっていたら、勝手に別の時間にずらさず、空いている選択肢を示して聞き返す
- 予約が拒否されたら、理由を伝えて次にどうするかを尋ねる。黙って別の部屋に入れ直さない
- 日時は必ず ISO 形式（2026-09-01T14:00）で扱う。今日は ${new Date().toISOString().slice(0, 10)} である
- 日本語で、簡潔に`;

const STORE = "state/bookings.json";

const ROOMS = [
  { id: "A", name: "会議室A（大）", capacity: 12, equipment: "プロジェクタ / ビデオ会議" },
  { id: "B", name: "会議室B（中）", capacity: 6, equipment: "モニタ" },
  { id: "C", name: "会議室C（小）", capacity: 4, equipment: "なし" },
  { id: "D", name: "集中ブース", capacity: 1, equipment: "なし" },
];

export const tools: Anthropic.Tool[] = [
  {
    name: "list_rooms",
    description:
      "会議室の一覧を、定員と設備つきで返す。" +
      "どの部屋があるか分からないときに、最初に使うこと。空き状況は含まない。",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "check_availability",
    description:
      "指定した時間帯に空いている会議室を返す。予約を入れる前に必ずこれを使うこと。" +
      "定員で絞りたいときは min_capacity を指定する。",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string", description: "開始日時。ISO形式。例: 2026-09-01T14:00" },
        end: { type: "string", description: "終了日時。ISO形式。例: 2026-09-01T16:00" },
        min_capacity: { type: "integer", description: "最低限必要な定員。省略時は1" },
      },
      required: ["start", "end"],
    },
  },
  {
    name: "list_bookings",
    description:
      "登録済みの予約を新しい順に返す。予約IDが必要なとき、または既存の予約を確認したいときに使う。",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "book_room",
    description:
      "会議室を予約する。実行前に人間の承認を求めるため、拒否されることがある。" +
      "必ず check_availability で空きを確かめてから呼ぶこと。二重予約はこちら側で弾かれる。",
    input_schema: {
      type: "object",
      properties: {
        room_id: { type: "string", description: "会議室ID。例: A" },
        start: { type: "string", description: "開始日時。ISO形式" },
        end: { type: "string", description: "終了日時。ISO形式" },
        title: { type: "string", description: "会議名。例: 週次定例" },
      },
      required: ["room_id", "start", "end", "title"],
    },
  },
  {
    name: "cancel_booking",
    description:
      "予約を取り消す。実行前に人間の承認を求める。" +
      "予約IDが分からないときは、先に list_bookings で確認すること。",
    input_schema: {
      type: "object",
      properties: {
        booking_id: { type: "string", description: "予約ID。例: bk-3" },
      },
      required: ["booking_id"],
    },
  },
];

/** 状態を変えるツールは、必ずここに入れる */
export const WRITE_TOOLS = new Set(["book_room", "cancel_booking"]);

export async function runTool(name: string, input: unknown): Promise<string> {
  return (await dispatch(name, input)) || "（空の結果が返りました）";
}

async function dispatch(name: string, input: unknown): Promise<string> {
  const a = (input ?? {}) as Record<string, string & number>;

  switch (name) {
    case "list_rooms":
      return ROOMS.map(
        (r) => `${r.id}: ${r.name}  定員${r.capacity}名  設備: ${r.equipment}`,
      ).join("\n");

    case "check_availability":
      return await checkAvailability(
        String(a.start ?? ""),
        String(a.end ?? ""),
        Number(a.min_capacity ?? 1),
      );

    case "list_bookings":
      return await listBookings();

    case "book_room":
      return await bookRoom(
        String(a.room_id ?? ""),
        String(a.start ?? ""),
        String(a.end ?? ""),
        String(a.title ?? ""),
      );

    case "cancel_booking":
      return await cancelBooking(String(a.booking_id ?? ""));

    default:
      return `不明なツールです: ${name}`;
  }
}

// ---------------------------------------------------------------- 状態

type Booking = { id: string; room_id: string; start: string; end: string; title: string };

async function load(): Promise<Booking[]> {
  try {
    return JSON.parse(await readFile(safePath(STORE), "utf-8"));
  } catch {
    return []; // 初回は空
  }
}

async function save(bookings: Booking[]): Promise<void> {
  const abs = safePath(STORE);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify(bookings, null, 2), "utf-8");
}

// ---------------------------------------------------------------- 中身

/**
 * 日時のパース。モデルは「明日の14時」「9/1 14:00」など好き勝手な形で渡してくる。
 * 何が悪かったかを文章で返すと、次の周回で直してくる。
 */
function parseRange(start: string, end: string): { s: Date; e: Date } | string {
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    return `日時を解釈できませんでした（start=${start} / end=${end}）。ISO形式（2026-09-01T14:00）で渡し直してください。`;
  }
  if (e <= s) return "終了時刻が開始時刻以前になっています。";
  return { s, e };
}

const overlaps = (a: { s: Date; e: Date }, b: Booking) =>
  a.s < new Date(b.end) && new Date(b.start) < a.e;

async function checkAvailability(start: string, end: string, minCapacity: number): Promise<string> {
  const range = parseRange(start, end);
  if (typeof range === "string") return range;

  const bookings = await load();
  const free = ROOMS.filter(
    (r) =>
      r.capacity >= minCapacity &&
      !bookings.some((b) => b.room_id === r.id && overlaps(range, b)),
  );

  if (free.length === 0) {
    const taken = bookings.filter((b) => overlaps(range, b));
    return [
      `${start} 〜 ${end} に、定員${minCapacity}名以上で空いている部屋はありません。`,
      taken.length ? "この時間帯の予約:" : "",
      ...taken.map((b) => `  ${b.room_id} ${b.start}〜${b.end} ${b.title}`),
      "時間をずらすか、人数を分けるかをユーザーに確認してください。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `${start} 〜 ${end} に空いている部屋:`,
    ...free.map((r) => `  ${r.id}: ${r.name}  定員${r.capacity}名  ${r.equipment}`),
  ].join("\n");
}

async function listBookings(): Promise<string> {
  const bookings = await load();
  if (bookings.length === 0) return "予約は1件もありません。";
  return [...bookings]
    .sort((a, b) => b.start.localeCompare(a.start))
    .map((b) => `${b.id}  ${b.room_id}  ${b.start}〜${b.end}  ${b.title}`)
    .join("\n");
}

async function bookRoom(roomId: string, start: string, end: string, title: string): Promise<string> {
  const room = ROOMS.find((r) => r.id === roomId.toUpperCase());
  if (!room) {
    return `会議室 ${roomId} は存在しません。list_rooms で一覧を確認してください。`;
  }

  const range = parseRange(start, end);
  if (typeof range === "string") return range;

  const bookings = await load();

  // ここが肝。モデルが空きを確認したと言っていても、こちらで必ず検証する
  const conflict = bookings.find((b) => b.room_id === room.id && overlaps(range, b));
  if (conflict) {
    return `二重予約になるので登録しませんでした。${room.id} は ${conflict.start}〜${conflict.end} に「${conflict.title}」が入っています。check_availability で空きを取り直してください。`;
  }

  // 取り消した後でもIDがぶつからないように、既存の最大値から採番する
  const nextId =
    Math.max(0, ...bookings.map((b) => Number(b.id.replace("bk-", "")) || 0)) + 1;

  const booking: Booking = {
    id: `bk-${nextId}`,
    room_id: room.id,
    start,
    end,
    title,
  };
  await save([...bookings, booking]);

  return `予約しました。${booking.id} / ${room.name} / ${start}〜${end} / ${title}`;
}

async function cancelBooking(bookingId: string): Promise<string> {
  const bookings = await load();
  const target = bookings.find((b) => b.id === bookingId);
  if (!target) {
    return `予約 ${bookingId} は見つかりません。list_bookings で予約IDを確認してください。`;
  }

  await save(bookings.filter((b) => b.id !== bookingId));
  return `取り消しました。${target.id} / ${target.room_id} / ${target.start}〜${target.end} / ${target.title}`;
}
