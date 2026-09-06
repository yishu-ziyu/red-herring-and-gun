#!/usr/bin/env python3
"""Semantic source-identity gate for Investigation Snapshots (Issue #76).

A role transition is real only when the same claim + same normalized URL +
the same sourceId moves unassessed → support|contradict|context-only.

Same src-N pointing at different URLs is not settling. sourceIdsStable=false
must fail the gate.
"""
from __future__ import annotations

from typing import Any

SETTLED_ROLES = frozenset({"support", "contradict", "context-only"})


def normalize_source_url(url: str) -> str:
    return (url or "").strip()


def source_url_by_id(snapshot: dict[str, Any], source_id: str) -> str:
    for source in snapshot.get("sources") or []:
        if source.get("id") == source_id:
            return normalize_source_url(str(source.get("url") or ""))
    return ""


def source_ids_stable_across(snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    id_to_url: dict[str, str] = {}
    url_to_id: dict[str, str] = {}
    conflicts: list[dict[str, str]] = []
    seen: set[str] = set()

    def add(conflict: dict[str, str]) -> None:
        key = "|".join(conflict.get(k, "") for k in sorted(conflict))
        if key in seen:
            return
        seen.add(key)
        conflicts.append(conflict)

    for snapshot in snapshots:
        for source in snapshot.get("sources") or []:
            source_id = str(source.get("id") or "")
            url = normalize_source_url(str(source.get("url") or ""))
            if not source_id or not url:
                continue
            prev_url = id_to_url.get(source_id)
            if prev_url and prev_url != url:
                add({"kind": "id-reuse", "sourceId": source_id, "beforeUrl": prev_url, "afterUrl": url})
            prev_id = url_to_id.get(url)
            if prev_id and prev_id != source_id:
                add({"kind": "url-reassigned", "url": url, "beforeId": prev_id, "afterId": source_id})
            id_to_url[source_id] = url
            url_to_id[url] = source_id
    return {"stable": len(conflicts) == 0, "conflicts": conflicts}


def find_semantic_role_transition(snapshots: list[dict[str, Any]]) -> dict[str, Any] | None:
    prev: dict[tuple[str, str], tuple[str, str]] = {}
    for snapshot in snapshots:
        for claim in snapshot.get("claims") or []:
            claim_id = str(claim.get("id") or "")
            for link in claim.get("evidence") or []:
                source_id = str(link.get("sourceId") or "")
                role = str(link.get("role") or "")
                url = source_url_by_id(snapshot, source_id)
                if not claim_id or not url:
                    continue
                prior = prev.get((claim_id, url))
                if prior and prior[1] == "unassessed" and role in SETTLED_ROLES and prior[0] == source_id:
                    out = {
                        "claimId": claim_id,
                        "sourceId": source_id,
                        "url": url,
                        "from": prior[1],
                        "to": role,
                    }
                    if snapshot.get("phase"):
                        out["atPhase"] = snapshot.get("phase")
                    return out
                prev[(claim_id, url)] = (source_id, role)
    return None


def evaluate_source_identity_gate(
    snapshots: list[dict[str, Any]],
    *,
    source_ids_stable: bool | None = None,
    require_transition: bool = False,
) -> dict[str, Any]:
    stability = source_ids_stable_across(snapshots)
    transition = find_semantic_role_transition(snapshots)
    errors: list[str] = []
    if not stability["stable"]:
        for conflict in stability["conflicts"]:
            if conflict.get("kind") == "id-reuse":
                errors.append(
                    f"sourceId {conflict['sourceId']} mapped to {conflict['beforeUrl']} then {conflict['afterUrl']}"
                )
            else:
                errors.append(
                    f"url {conflict['url']} changed sourceId {conflict['beforeId']} → {conflict['afterId']}"
                )
    if source_ids_stable is False:
        errors.append("sourceIdsStable=false")
    if require_transition and not transition:
        errors.append("no observable unassessed→role transition for the same URL and sourceId")
    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "transition": transition,
        "sourceIdsStable": stability["stable"],
    }


def _self_test() -> int:
    investigating = {
        "phase": "investigating",
        "sources": [
            {"id": "src-1", "url": "https://other.example/not-x"},
            {"id": "src-3", "url": "https://ltxc.cqnu.edu.cn/info/1140/7130.htm"},
        ],
        "claims": [
            {
                "id": "claim-1",
                "evidence": [
                    {"sourceId": "src-1", "role": "unassessed"},
                    {"sourceId": "src-3", "role": "unassessed"},
                ],
            }
        ],
    }
    judging = {
        "phase": "judging",
        "sources": [
            {"id": "src-1", "url": "https://ltxc.cqnu.edu.cn/info/1140/7130.htm"},
            {"id": "src-2", "url": "https://other.example/not-x"},
        ],
        "claims": [{"id": "claim-1", "evidence": [{"sourceId": "src-1", "role": "support"}]}],
    }
    if find_semantic_role_transition([investigating, judging]) is not None:
        print("FAIL: same src-N different URL reported as transition")
        return 1
    gate = evaluate_source_identity_gate(
        [investigating, judging],
        source_ids_stable=False,
        require_transition=True,
    )
    if gate["ok"] or "sourceIdsStable=false" not in gate["errors"]:
        print("FAIL: sourceIdsStable=false did not fail the gate", gate)
        return 1

    stable_url = "https://stable.example/x"
    stable = [
        {
            "phase": "investigating",
            "sources": [{"id": "src-keep", "url": stable_url}],
            "claims": [{"id": "claim-1", "evidence": [{"sourceId": "src-keep", "role": "unassessed"}]}],
        },
        {
            "phase": "judging",
            "sources": [{"id": "src-keep", "url": stable_url}],
            "claims": [{"id": "claim-1", "evidence": [{"sourceId": "src-keep", "role": "support"}]}],
        },
    ]
    ok = evaluate_source_identity_gate(stable, require_transition=True)
    if not ok["ok"] or ok["transition"] is None:
        print("FAIL: true same-URL transition was rejected", ok)
        return 1
    print("SELF-TEST PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(_self_test())
