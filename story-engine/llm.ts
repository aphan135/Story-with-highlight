/**
 * The only file that talks to Anthropic. Kept apart so the engine can be
 * tested without an API key or the SDK installed.
 *
 * Non-streaming on purpose — see HANDOFF §3. `temperature` is rejected by
 * claude-haiku-5-5, so it is not set.
 */

import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

export async function completeOwl(system: string, user: string): Promise<string> {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const res = await client.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 400, // generous: only what follows LINE: is ever spoken
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = res.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (!text.trim()) {
    console.log(
      `[raw-empty] stop=${res.stop_reason} blocks=${JSON.stringify(res.content.map((b) => b.type))}`
    );
  }
  return text;
}
