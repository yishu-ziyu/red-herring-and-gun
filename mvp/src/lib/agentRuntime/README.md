# AgentRuntime

Production runtime for the multi-agent fact-checking pipeline.

## Boundaries

```
agentRuntime/
  AgentRuntime.ts          ← Production runtime (user-facing)
  agentProviders.ts        ← LLM provider adapters (production)
  events.ts                ← Event types for streaming UI (production)
  memoryStore.ts           ← Agent memory persistence (production)
  memoryCandidateStore.ts  ← Memory candidate store (production)
  orchestrateShared.ts     ← Shared orchestration utilities (production)
  types.ts                 ← Production type definitions (production)
  toolRegistry.ts          ← Tool registry (production)

  evaluation/              ← INTERNAL TOOLING (developer-only)
    goldenDataset.ts       ← Test data for pre-release benchmarking
    benchmarkRunner.ts     ← Runs AgentRuntime with deterministic mocks
    evaluationMetrics.ts   ← Scoring logic (pure functions)
    evaluationReport.ts    ← Report generation + trend tracking
    run.ts                 ← CLI: npx tsx run.ts
```

## Dependency Rule

**Evaluation imports production. Production never imports evaluation.**

The `evaluation/` directory is internal tooling. It runs AgentRuntime with mock dependencies to produce deterministic benchmark results. None of the production code should ever import from `evaluation/`.

## What Runs in Production

Everything in this directory EXCEPT `evaluation/` ships to users.

- `AgentRuntime.ts` — the core class, instantiated by the server
- `agentConfigs.ts` — agent definitions (sibling to this directory)
- `memoryStore.ts` / `memoryCandidateStore.ts` — persistence layer
- `events.ts` — event types streamed to the UI

## What Does NOT Ship

- `evaluation/` — excluded from production builds
- `deepagents-poc/` — proof of concept, not shipped

## Evaluation Artifacts

Stored at `.ship/evaluation/` (gitignored):
- `benchmark-history.jsonl` — append-only run history
- `baseline-report.md` — latest baseline snapshot
