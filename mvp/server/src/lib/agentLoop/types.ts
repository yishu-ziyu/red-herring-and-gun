/**
 * ReAct execution types. Judgment rules live in domain modules, not here.
 */

export type LoopRole = "user" | "assistant";

export type LoopMessage = {
  role: LoopRole;
  content: string;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

export type LoopTool = ToolSpec & {
  execute: ToolHandler;
};

export type LlmTurn = {
  text: string;
  thinking?: string;
  toolCalls?: ToolCall[];
};

export type LoopLlm = (input: {
  systemPrompt: string;
  messages: LoopMessage[];
  tools: ToolSpec[];
  onThinking?: (accumulated: string) => void;
}) => Promise<LlmTurn>;

export type LoopObserver = {
  onLoopStart?: () => void;
  onThinking?: (text: string, turn: number) => void | Promise<void>;
  onToolStart?: (call: ToolCall) => void;
  onToolResult?: (call: ToolCall, result: unknown) => void;
  onToolError?: (call: ToolCall, error: string) => void;
  onLoopEnd?: (result: AgentLoopResult) => void;
};

export type AgentLoopResult = {
  messages: LoopMessage[];
  turns: number;
  stopReason: "submit_verdict" | "no_tool" | "max_turns" | "llm_error";
  terminalArgs?: Record<string, unknown>;
  toolTrace: Array<{ name: string; arguments: Record<string, unknown>; result: unknown }>;
  lastText: string;
  error?: string;
};

export type TodoStatus = "pending" | "active" | "done" | "error";

export type LoopTodo = {
  id: string;
  label: string;
  status: TodoStatus;
};
