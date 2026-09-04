#!/usr/bin/env python3
"""PreCompact: remind on stderr if an active task was not written this session."""

from __future__ import annotations

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


def main() -> int:
    payload = read_stdin_json()
    if payload.get("subagentType"):
        return 0
    root = workspace_root()
    session_id = str(payload.get("sessionId") or "")
    stamp = read_session_stamp(root, session_id)
    started = float(stamp.get("startedAtUnix") or 0)
    start_porc = str(stamp.get("porcelain") or "")
    changed = product_changed_since(start_porc, git_porcelain(root))
    if not changed:
        return 0
    notes = notes_path(root)
    if started and file_updated_since(notes, started):
        return 0
    print(
        "[runtime] 即将压缩。本会话改了产品文件，docs/NOTES.md 尚未写回当前状态。",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        traceback.print_exc(file=sys.stderr)
        raise SystemExit(0)
