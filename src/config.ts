/**
 * 合宿テンプレートの設定。挙動を変えたいときはまずここを見る。
 */

/** 使うモデル。合宿では基本これでよい */
export const MODEL = "claude-opus-5";

/** 1回の応答の上限トークン数 */
export const MAX_TOKENS = 16_000;

/**
 * ループの最大周回数。暴走したときのブレーキ。
 * これを外すとコストが青天井になるので、外さないこと。
 */
export const MAX_TURNS = 20;

/**
 * 100万トークンあたりの USD（Anthropic API の参考単価）。
 * Bedrock / Vertex AI を使う場合は各社の価格表の値に置き換える。
 */
export const PRICE_PER_MTOK = {
  input: 5.0,
  output: 25.0,
  cacheWrite: 6.25, // 通常入力の約 1.25 倍
  cacheRead: 0.5, // 通常入力の約 0.1 倍
} as const;

/** エージェントが触ってよいディレクトリ。ここより外には出させない */
export const WORKSPACE_DIR = "workspace";

/**
 * ツールの戻り値の上限文字数。
 * 長い戻り値は「以降の全周回で送り直される」ので、コストに直結する。
 */
export const MAX_TOOL_OUTPUT_CHARS = 8_000;
