# Domain context (claim verification)

Lazy glossary for agents. Product truth remains `docs/PRODUCT_SPEC.md`.  
用户语言是能信 / 不能信；下表是管线术语，不是产品口号。

## Terms

| Term | Meaning |
|------|---------|
| **claim atom** | Minimal proposition extracted from the user claim; keyed by `claimAtomKey` |
| **self-proof** | Gate: drop atoms not directly supported by the original claim |
| **exclusion / non-verifiable** | Stance/value/normative atoms: never enter `subclaimVerdicts`. Prediction is gray: search present-tense traces (commitment/filing); skip only bare futures |
| **subclaim verdict** | Per verifiable atom: true/false/partial/unverified/exaggerated + sources |
| **per-atom retrieval** | Search each verifiable atom (cap 6), then bind evidence per atom |
| **claimItems** | Server-preordered list for UI: verifiable + stance in original order |
| **Case Pipeline** | Production orchestration module (`mvp/server/src/lib/casePipeline`) — ADR-004 |

## Architecture modules (depth)

- `claimAtom` — key, split, merge, self-proof
- `atomSearch` — select, bundle, bind, `retrieveForAtoms(searchOne)`
- `reportAssembly` — `assembleFinalReport`
- `casePipeline` — runCasePipeline (HTTP/SSE are thin adapters)
- `AgentRuntime` — eval/dev only until migrated (ADR-004)
