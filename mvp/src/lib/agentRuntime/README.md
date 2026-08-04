# AgentRuntime

Production runtime for the multi-agent fact-checking pipeline, powered by DAG-driven execution.

## Boundaries

```
agentRuntime/
  AgentRuntime.ts          ← Production runtime (user-facing)
                             - executeDag(): DAG execution engine (new)
                             - runCase(): top-level entry
  agentProviders.ts        ← LLM provider adapters (production)
  events.ts                ← Event types for streaming UI (production)
  memoryStore.ts           ← Agent memory persistence (production)
  memoryCandidateStore.ts  ← Memory candidate store (production)
  memoryCandidateGenerator.ts ← Build memory candidates from run result
  memoryCandidateTypes.ts  ← Memory candidate type definitions
  orchestrateShared.ts     ← Shared orchestration utilities (production)
  types.ts                 ← Production type definitions (production)
  toolRegistry.ts          ← Tool registry (production)

  ../agentConfigs.ts       ← Declarative agent registry + contract (sibling)
  ../agentOrchestrationTypes.ts ← DAG plan and node type definitions (sibling)

  evaluation/              ← INTERNAL TOOLING (developer-only)
    goldenDataset.ts       ← Test data for pre-release benchmarking
    benchmarkRunner.ts     ← Runs AgentRuntime with deterministic mocks
    evaluationMetrics.ts   ← Scoring logic (pure functions)
    evaluationReport.ts    ← Report generation + trend tracking
    run.ts                 ← CLI: npx tsx run.ts

  deepagents-poc/           ← PROOF OF CONCEPT (developer-only) - NOT shipped
    reactAgent.ts          ← Early experiment with React Agent pattern
```

## DAG-Driven Execution Model

The runtime now uses a declarative DAG instead of hardcoded `if-else` branches:

```
buildAdaptiveExecutionPlan(claim, intake)
  -> 按 claimType 生成 DAG (nodes + edges)
  -> topologicalLevels() 分层拓扑排序
  -> 逐层 Promise.all 执行
  -> 无依赖的 agent 节点并行
  -> report 节点收束
```

Four `claimType` patterns:

- `concept`: concept explanation (skip fact-checking) → `concept_extractor` → `semantic_validator` → `context_mapper` → `report_composer`
- `causal`: causal attribution → add `alternative_explanation_searcher` + `counter_evidence_grader` before consensus
- `event`: event verification → standard 4-agent pipeline
- `mixed`: mixed claims → standard pipeline with speculative routing events

Node types:

- `planner`: already executed before DAG (skip in DAG loop)
- `agent`: registered agent (lookup from `AgentRegistry`, execute in parallel if on same level)
- `debate`: consensus debate (aggregates previous agent outputs, emits `consensus_debate_final` event)
- `report`: final compositor (collects all steps, produces final report)

## Dependency Rule

**Evaluation imports production. Production never imports evaluation.**
The `evaluation/` directory is internal tooling. It runs AgentRuntime with mock dependencies to produce deterministic benchmark results. None of the production code should ever import from `evaluation`.

**Production never imports from `deepagents-poc/`**. That directory contains abandoned proof-of-concept experiments.

## What Runs in Production

Everything in this directory EXCEPT `evaluation/` and `deepagents-poc/` ships to users.

- `AgentRuntime.ts` — the core class, instantiated by the server
- `agentProviders.ts` — LLM provider adapters (StepFun / 360 / MiMo / DeepSeek)
- `events.ts` — event constructors for streaming to UI (`agent_start`, `tool_result`, etc.)
- `memoryStore.ts` / `memoryCandidateStore.ts` — persistence layer for Agent Memory
- `toolRegistry.ts` — tool capability registry

## What Does NOT Ship

- `evaluation/` — excluded from production builds (benchmarking tooling)
- `deepagents-poc/` — proof of concept experiments (not maintained, not shipped)

## Logging for Troubleshooting

The DAG engine emits detailed logging through the `deps.log` channel:

- `dag_exec` phase: `plan` (DAG structure), `topo` (topological levels), `level` (current level nodes), `node` (per-node dispatch/skip/complete), `search` (search preparation/result)
- `agent_registry` phase: `get_agent` (lookup result), `can_continue_after_failure` (failure policy)

## Evaluation Artifacts

Stored at `.ship/evaluation/` (gitignored):
- `benchmark-history.jsonl` — append-only run history
- `baseline-report.md` — latest baseline snapshot
