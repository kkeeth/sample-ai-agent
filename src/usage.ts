import { PRICE_PER_MTOK } from "./config.ts";

/** SDK の usage オブジェクトのうち、こちらで使う部分だけ */
type UsageLike = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/**
 * トークン数とコストを積み上げる。
 * 「1周まわすといくらか」を体感するための仕掛けなので、消さないでほしい。
 */
export function createUsageTracker() {
  const total = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, turns: 0 };

  const costOf = (t: typeof total) =>
    (t.input * PRICE_PER_MTOK.input +
      t.output * PRICE_PER_MTOK.output +
      t.cacheWrite * PRICE_PER_MTOK.cacheWrite +
      t.cacheRead * PRICE_PER_MTOK.cacheRead) /
    1_000_000;

  return {
    add(usage: UsageLike) {
      total.turns += 1;
      total.input += usage.input_tokens;
      total.output += usage.output_tokens;
      total.cacheWrite += usage.cache_creation_input_tokens ?? 0;
      total.cacheRead += usage.cache_read_input_tokens ?? 0;
    },

    /** 1周ごとの行。入力が周回ごとに増えていくのが見える */
    turnLine(usage: UsageLike, turn: number) {
      const n = (v: number) => v.toLocaleString("en-US");
      const cached = usage.cache_read_input_tokens
        ? ` / cache ${n(usage.cache_read_input_tokens)}`
        : "";
      return `[${turn}周目] in ${n(usage.input_tokens)}${cached} / out ${n(
        usage.output_tokens,
      )} / 累計 $${costOf(total).toFixed(4)}`;
    },

    summary() {
      const n = (v: number) => v.toLocaleString("en-US");
      return [
        `周回数     ${total.turns}`,
        `入力       ${n(total.input)} tokens`,
        `キャッシュ ${n(total.cacheRead)} tokens (読み) / ${n(total.cacheWrite)} tokens (書き)`,
        `出力       ${n(total.output)} tokens`,
        `概算コスト $${costOf(total).toFixed(4)}`,
      ].join("\n  ");
    },

    costUSD: () => costOf(total),
    total,
  };
}
