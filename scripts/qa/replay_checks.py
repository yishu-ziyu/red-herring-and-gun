"""Independent frozen UI-fidelity measurements; never a medical semantic oracle."""
from pathlib import Path
import copy

PROFILES = ("desktop", "mobile390", "keyboardReduced")
SNAPSHOT_SHA256 = "8cfd748d60a39ffd4eb81fcac00e49e51cf06517d834db4da12df8711b81e4dd"


def _text(value):
    return " ".join(value.split()) if isinstance(value, str) else None


def expected_target(snapshot):
    source_id = snapshot["conclusion"]["sourceIds"][0]
    source = next(s for s in snapshot["sources"] if s["id"] == source_id)
    claim = next(c for c in snapshot["claims"] if any(e["sourceId"] == source_id for e in c["evidence"]))
    return claim, source


def check_profiles(record, snapshot):
    """Return flat {profile.check: PASS|FAIL}; missing observations always fail."""
    claim, source = expected_target(snapshot)
    rows = record.get("profiles", [])
    checks = {}
    for name in PROFILES:
        matches = [p for p in rows if p.get("name") == name]
        p = matches[0] if len(matches) == 1 else {}
        conditions = {
            "original_claim": p.get("originalClaimVisible") is True and _text(p.get("originalClaimText")) == _text(snapshot["originalClaim"]),
            "direct_answer": p.get("directAnswerVisible") is True and _text(p.get("directAnswerText")) == _text(snapshot["conclusion"]["directAnswer"]),
            "claim_decomposition": all(_text(c["text"]) in [_text(t) for t in p.get("claimTextsVisible", [])] for c in snapshot["claims"]),
            "citation_binding": p.get("openedClaimId") == claim["id"] and p.get("selectedSourceId") == source["id"] and p.get("drawerVisible") is True and p.get("drawerHref") == source["url"] and _text(p.get("drawerTitle")) == _text(source["title"]),
            "source_navigation": p.get("sourceNavigationAttempted") is True and p.get("openedSourceUrl") == source["url"] and p.get("sourcePageClosedReturned") is True,
            "close_return": p.get("closedReturned") is True,
            "no_horizontal_overflow": type(p.get("overflowPx")) in (int, float) and 0 <= p["overflowPx"] <= 1,
            "artifacts": all(isinstance(p.get("artifacts", {}).get(k), str) and Path(p["artifacts"][k]).is_file() and Path(p["artifacts"][k]).stat().st_size > 0 for k in ("screenshot", "trace")),
        }
        if name == "mobile390":
            conditions["viewport"] = p.get("viewport", {}).get("width") == 390
        if name == "keyboardReduced":
            conditions["focus_return"] = p.get("focusReturned") is True
            conditions["reduced_motion"] = p.get("reducedMotion") is True
        checks.update({f"{name}.{key}": "PASS" if ok else "FAIL" for key, ok in conditions.items()})
    return checks


def self_test(snapshot):
    """Synthetic positive/negative instrument calibration, not execution evidence."""
    import tempfile
    claim, source = expected_target(snapshot)
    with tempfile.TemporaryDirectory() as directory:
        artifact = Path(directory) / "synthetic.txt"
        artifact.write_text("SYNTHETIC INSTRUMENT CALIBRATION ONLY")
        record = {"profiles": [{"name": name, "viewport": {"width": 390 if name == "mobile390" else 1440}, "originalClaimVisible": True, "originalClaimText": snapshot["originalClaim"], "directAnswerVisible": True, "directAnswerText": snapshot["conclusion"]["directAnswer"], "claimTextsVisible": [c["text"] for c in snapshot["claims"]], "openedClaimId": claim["id"], "selectedSourceId": source["id"], "drawerVisible": True, "drawerHref": source["url"], "drawerTitle": source["title"], "sourceNavigationAttempted": True, "openedSourceUrl": source["url"], "sourcePageClosedReturned": True, "closedReturned": True, "overflowPx": 0, "focusReturned": True, "reducedMotion": True, "artifacts": {"screenshot": str(artifact), "trace": str(artifact)}} for name in PROFILES]}
        assert set(check_profiles(record, snapshot).values()) == {"PASS"}
        wrong = copy.deepcopy(record)
        wrong["profiles"][0]["drawerHref"] = "https://example.invalid/wrong-source"
        assert check_profiles(wrong, snapshot)["desktop.citation_binding"] == "FAIL"
        hidden = copy.deepcopy(record)
        hidden["profiles"][0]["directAnswerVisible"] = False
        assert check_profiles(hidden, snapshot)["desktop.direct_answer"] == "FAIL"
        assert set(check_profiles({}, snapshot).values()) == {"FAIL"}
    return {"synthetic_positive": "PASS", "wrong_href_detected": "PASS", "hidden_answer_detected": "PASS", "missing_observations_rejected": "PASS"}


if __name__ == "__main__":
    import json
    import sys
    snapshot = json.loads(Path(sys.argv[1]).read_text())
    print(json.dumps(self_test(snapshot), ensure_ascii=False, indent=2))
