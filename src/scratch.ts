// scratch.ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();   // .env は Bun が自動で読む

const res = await client.messages.create({
  model: "claude-opus-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "「疎通OK」とだけ返してください。" }],
});

console.log(res.content);
