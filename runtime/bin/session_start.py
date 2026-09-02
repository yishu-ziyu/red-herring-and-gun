#!/usr/bin/env python3
"""SessionStart: refresh STATE.md and stamp this session. Stdout is discarded."""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import (
    git_porcelain,
    read_stdin_json,
    workspace_root,
    write_session_stamp,
    write_state_md,
)


def main() -> int:
    payload = read_stdin_json()
    root = workspace_root()
    session_id = str(payload.get("sessionId") or "unknown")
    write_state_md(root)
    write_session_stamp(root, session_id, git_porcelain(root))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        traceback.print_exc(file=sys.stderr)
        raise SystemExit(0)
