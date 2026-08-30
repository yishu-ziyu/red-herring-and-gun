# AgentRuntime

Not the live claim path. Production orchestrate is `mvp/server/src/lib/casePipeline` (ADR-003). Runtime map: `docs/ARCHITECTURE.md`.

This directory remains temporarily for compatibility while runtime types are extracted. The production eval entry is `mvp/server/eval`; the former client benchmark was retired with the AgentRuntime path. Local HTTP is Express (`mvp/server`). Do not add claim-atom gates here. New product work goes to Case Pipeline (or the future `runAgentLoop`), not this leftover.

## What still imports this

- UI types: `memoryCandidateTypes`, `agentSkills`
- The former client benchmark and its tests are retired; use `mvp/server/eval`.
- leftover client copies of events / stores (not the live claim path)

## Do not add

- A second self-proof / atom-search / verdict path
- New tools only registered here
