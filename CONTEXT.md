# Domain context (claim verification)

Lazy glossary for agents. Product truth remains `docs/PRODUCT_SPEC.md`.  
用户语言是能信 / 不能信；下表是管线术语，不是产品口号。

## Terms

| Term | Meaning |
|------|---------|
| **claim atom** | Minimal proposition extracted from the user claim; keyed by `claimAtomKey` |
| **self-proof** | Gate: drop atoms not directly supported by the original claim |
| **exclusion / non-verifiable** | Stance/value/normative atoms: never enter `subclaimVerdicts`; UI copy is 「立场型 / 不适用真/假判断」, never 「灰」. Prediction: search present-tense traces (commitment/filing); skip only bare futures |
| **type gate** | Same MiniMax-M3 as the rest of the pipeline, RumorDetector job sheet only: write `type` + `verifiable`, must not verdict. Code routes on those two fields. Circulating-claim lookalikes forced checkable (`forceCheckableAtomTypes`). No second LLM on the label (unlike crossExam). See PRODUCT_SPEC §四「类型谁标」 |
| **subclaim verdict** | Per verifiable atom: true/false/partial/unverified/exaggerated + sources. No http(s) or related-only true/false → unverified |
| **per-atom retrieval** | Search verifiable atoms (cap 6, causal/numeric first), bind evidence per atom. Unselected atoms stay in `claimItems` as unverified |
| **evidence loop** | Post fact-check targeted re-search for unverified/conflicted atoms; 2 strategy rounds, explicit stop reasons; new evidence → fact_checker re-run once — ADR-004 |
| **evidence pursuit** | Search policy inside the loop and first retrieve: query portfolio, evidence gap, RRF across queries, information gain stop — ADR-005. Product copy: 证据追索 |
| **claimItems** | Server-preordered list for UI: verifiable + stance in original order |
| **Case Pipeline** | Production orchestration module (`mvp/server/src/lib/casePipeline`) — ADR-003 |

## Architecture modules (depth)

- `claimAtom` — key, split, merge, self-proof
- `atomSearch` — select, bundle, bind, `retrieveForAtoms(searchOne)`
- `evidenceLoop` — trigger, rewrite fallback, bundle merge, budget & stop reasons (ADR-004)
- `evidencePursuit` — query portfolio, discriminability, evidence gap, RRF, information gain (ADR-005); used by atomSearchQuery + evidenceLoop
- `reportAssembly` — `assembleFinalReport`
- `casePipeline` — runCasePipeline (HTTP/SSE are thin adapters)
- `AgentRuntime` — eval/dev only until migrated (ADR-003)
