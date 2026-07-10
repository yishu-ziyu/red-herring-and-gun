# React Agent PoC - RumorDetector

This PoC demonstrates the **React Agent loop** pattern (LangChain / deepagents.js)
for the RumorDetector agent in the 红鲱鱼与枪 project.

## Architecture

```
User Claim
    │
    ▼
┌─────────────────────┐
│  System Prompt      │  RumorDetector's instructions
│  (from agentConfigs)│
└─────────┬───────────┘
          │
          ▼
┌─────────────────────────────────────────────┐
│  REACT AGENT LOOP                           │
│                                             │
│  Step 1: LLM → "I need to search" + tool    │
│  Step 2: Execute search_360 tool            │
│  Step 3: LLM → "One more search" + tool     │
│  Step 4: Execute search_360 tool            │
│  Step 5: LLM → Final structured output      │
│                                             │
│  Pattern: LLM → Tool Call → Tool → LLM →   │
│           LLM → Tool Call → Tool → LLM →   │
│           Final Output                       │
└─────────────────────────────────────────────┘
          │
          ▼
  Structured JSON output
  (claimAtoms, rumorTypes, severity, ...)
```

## Files

- `types.ts` — Core types (LLMResponse, ToolCall, RumorDetectorOutput)
- `mockLLM.ts` — Mock LLM that simulates tool-calling behavior
- `reactAgent.ts` — The React Agent loop engine
- `rumorDetectorAgent.ts` — Agent entry point with existing system prompt
- `run.ts` — Runner script

## Run

```bash
cd /Users/mahaoxuan/Desktop/黑客松/红鲱鱼与枪/mvp
npx tsx src/lib/agentRuntime/deepagents-poc/run.ts
```

## What This Proves

1. The React Agent loop works: LLM returns tool calls, tool executes, results feed back to LLM, LLM produces final output
2. RumorDetector's system prompt (from agentConfigs.ts) produces valid structured output
3. The tool interface is clean: each tool has name, description, parameters, and an execute method
4. The loop terminates when the LLM returns text without tool calls

## Next Steps (for real implementation)

1. Replace `mockLLM` with a real LLM provider (OpenAI / Anthropic / MiMo)
2. Add proper tool schema (Zod validation for arguments)
3. Wire to `deepagents.js` LangChain primitives instead of hand-rolled loop
4. Add streaming support for real-time trace display
5. Add the real `search_360` tool implementation
