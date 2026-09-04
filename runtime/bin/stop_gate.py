#!/usr/bin/env python3
"""Stop gate: block end_turn when product files changed but NOTES.md was not written."""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import (
    file_updated_since,
    git_porcelain,
    notes_path,
    product_changed_since,
    read_session_stamp,
    read_stdin_json,
    workspace_root,
)


def allow() -> int:
    return 0


def block(reason: str) -> int:
    sys.stdout.write(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))
    sys.stdout.write("\n")
    return 0


def main() -> int:
    payload = read_stdin_json()
    if payload.get("subagentType"):
        return allow()
    if payload.get("reason") != "end_turn":
        return allow()

    root = workspace_root()
    session_id = str(payload.get("sessionId") or "")
    stamp = read_session_stamp(root, session_id)
    started = float(stamp.get("startedAtUnix") or 0)
    start_porc = str(stamp.get("porcelain") or "")
    changed = product_changed_since(start_porc, git_porcelain(root))
    if not changed:
        return allow()

    notes = notes_path(root)
    if started and file_updated_since(notes, started):
        return allow()

    again = bool(payload.get("stopHookActive"))
    prefix = "仍未写回。" if again else ""
    reason = (
        f"{prefix}本会话改了产品文件，但 docs/NOTES.md 还没写回当前状态。"
        "先更新 NOTES 头部，再停。"
    )
    return block(reason)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        traceback.print_exc(file=sys.stderr)
        raise SystemExit(0)
