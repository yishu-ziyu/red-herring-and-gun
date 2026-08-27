# AgentRuntime

Not the live claim path. Production orchestrate is `mvp/server/src/lib/casePipeline` (ADR-003). Runtime map: `docs/ARCHITECTURE.md`.

This directory remains for eval / tests. Local HTTP is Express (`mvp/server`). Do not add claim-atom gates here. New product work goes to Case Pipeline (or the future `runAgentLoop`), not this leftover.

## What still imports this

- UI types: `memoryCandidateTypes`, `agentSkills`
- `evaluation/` — developer benchmark CLI / tests
- leftover client copies of events / stores (not the live claim path)

## Do not add

- A second self-proof / atom-search / verdict path
- New tools only registered here
