import { describe, expect, it } from "vitest";
import {
  describeEmptyAnthropic,
  extractAnthropicContent,
  extractAnthropicText,
  parseAnthropicSseDataLine,
} from "./anthropicParse.js";

describe("anthropicParse MiniMax thinking-only", () => {
  it("does not treat thinking blocks as agent JSON text", () => {
    const raw = JSON.stringify({
      stop_reason: "max_tokens",
      content: [{ type: "thinking", thinking: "先拆命题……" }],
    });
    expect(extractAnthropicText(raw)).toBe("");
    expect(describeEmptyAnthropic(raw)).toContain("content_types=thinking");
    expect(describeEmptyAnthropic(raw)).toContain("stop_reason=max_tokens");
  });

  it("reads text blocks and string content", () => {
    expect(
      extractAnthropicText(
        JSON.stringify({
          content: [
            { type: "thinking", thinking: "ignore" },
            { type: "text", text: '{"severity":"low"}' },
          ],
        })
      )
    ).toBe('{"severity":"low"}');
    expect(extractAnthropicContent({ content: '{"ok":true}' })).toBe('{"ok":true}');
  });

  it("parses Anthropic thinking_delta SSE lines", () => {
    expect(
      parseAnthropicSseDataLine(
        JSON.stringify({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "先拆" } })
      )
    ).toEqual({ thinkingChunk: "先拆" });
    expect(
      parseAnthropicSseDataLine(
        JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: '{"a":1}' } })
      )
    ).toEqual({ textChunk: '{"a":1}' });
  });
});
