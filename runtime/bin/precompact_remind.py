#!/usr/bin/env python3
"""PreCompact: remind on stderr if an active task was not written this session."""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import (
    active_task_files,
    file_updated_since,
    git_porcelain,
    product_changed_since,
    read_session_stamp,
    read_stdin_json,
    workspace_root,
    write_state_md,
)


def main() -> int:
    payload = read_stdin_json()
    if payload.get("subagentType"):
        return 0
    root = workspace_root()
    write_state_md(root)
    active = active_task_files(root)
    if not active:
        return 0
    session_id = str(payload.get("sessionId") or "")
    stamp = read_session_stamp(root, session_id)
    started = float(stamp.get("startedAtUnix") or 0)
    if started and all(file_updated_since(path, started) for path in active):
        return 0
    start_porc = str(stamp.get("porcelain") or "")
    changed = product_changed_since(start_porc, git_porcelain(root))
    if not changed and started:
        return 0
    ids = ", ".join(path.stem for path in active)
    print(
        f"[runtime] 即将压缩。活动任务 {ids} 本会话尚未写回。先更新任务页再继续。",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        traceback.print_exc(file=sys.stderr)
        raise SystemExit(0)
