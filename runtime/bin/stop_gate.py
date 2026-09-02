#!/usr/bin/env python3
"""Stop gate: block end_turn when product files changed but active task was not written."""

from __future__ import annotations

import json
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
    write_state_md(root)
    active = active_task_files(root)
    if not active:
        return allow()

    session_id = str(payload.get("sessionId") or "")
    stamp = read_session_stamp(root, session_id)
    started = float(stamp.get("startedAtUnix") or 0)
    start_porc = str(stamp.get("porcelain") or "")
    changed = product_changed_since(start_porc, git_porcelain(root))
    if not changed:
        return allow()

    if started and any(file_updated_since(path, started) for path in active):
        return allow()

    names = ", ".join(
        f"`runtime/tasks/{path.name}`" for path in active
    )
    again = bool(payload.get("stopHookActive"))
    prefix = "仍未写回。" if again else ""
    reason = (
        f"{prefix}本会话改了产品文件，但活动任务还没写回。先更新 {names} "
        "（已验证事实、改动、失败路径、证据位置、下一步），再停。"
        "短问答不需要建任务；若这次不是在做该长任务，不要再改产品文件。"
    )
    return block(reason)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        traceback.print_exc(file=sys.stderr)
        raise SystemExit(0)
