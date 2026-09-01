/**
 * 安全装置。ここは触らなくてよい。
 *
 * 自分でツールを足すときも、外部から来た文字列（モデルが決めたパス、
 * API の応答）は必ずこの2つを通してから使うこと。
 */
import { resolve, relative } from "node:path";
import { WORKSPACE_DIR, MAX_TOOL_OUTPUT_CHARS } from "./config.ts";

const ROOT = resolve(WORKSPACE_DIR);

/**
 * 戻り値を切り詰める。
 * ここを外すと、長いファイルを読ませた瞬間に以降の全周回のコストが跳ね上がる。
 */
export function clip(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  return (
    text.slice(0, MAX_TOOL_OUTPUT_CHARS) +
    `\n\n…（長すぎるため ${MAX_TOOL_OUTPUT_CHARS} 文字で打ち切りました）`
  );
}

/**
 * workspace/ の外に出ようとしたら止める。
 * ファイルを触るツールを足すときは、必ずこれを通すこと。
 */
export function safePath(p: string, root: string = ROOT): string {
  const abs = resolve(root, p);
  if (relative(root, abs).startsWith("..")) {
    throw new Error(`作業フォルダの外にはアクセスできません: ${p}`);
  }
  return abs;
}

export { ROOT as WORKSPACE_ROOT };
