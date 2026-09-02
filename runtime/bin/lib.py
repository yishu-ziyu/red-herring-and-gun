"""Shared helpers for the phase-1 runtime loop. Fail open; never throw past main()."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

TASK_FIELD = re.compile(r"^- ([^:]+):\s*(.*)$")
SKIP_STATUS_PREFIXES = ("runtime/", ".grok/", ".agents/")
ACTIVE_STATUSES = {"active", "blocked"}


def workspace_root() -> Path:
    env = os.environ.get("GROK_WORKSPACE_ROOT") or os.environ.get("CLAUDE_PROJECT_DIR")
    if env:
        return Path(env).resolve()
    cwd = Path.cwd().resolve()
    for candidate in (cwd, *cwd.parents):
        if (candidate / "runtime" / "bin" / "lib.py").is_file():
            return candidate
    return cwd


def runtime_dir(root: Path | None = None) -> Path:
    return (root or workspace_root()) / "runtime"


def read_stdin_json() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def parse_task_file(path: Path) -> dict:
    fields: dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return fields
    for line in text.splitlines():
        match = TASK_FIELD.match(line.strip())
        if not match:
            continue
        key = match.group(1).strip()
        fields[key] = match.group(2).strip()
    return fields


def iter_task_files(root: Path | None = None) -> list[Path]:
    tasks = runtime_dir(root) / "tasks"
    if not tasks.is_dir():
        return []
    return sorted(
        path
        for path in tasks.glob("*.md")
        if path.name != "TEMPLATE.md" and path.is_file()
    )


def task_status(fields: dict) -> str:
    raw = fields.get("Status", "")
    return raw.split("/")[0].strip().lower()


def render_state_md(root: Path | None = None) -> str:
    rows = []
    for path in iter_task_files(root):
        fields = parse_task_file(path)
        task_id = fields.get("Task ID") or path.stem
        status = task_status(fields) or "active"
        updated = fields.get("Updated at") or ""
        nxt = fields.get("Next action") or ""
        rel = path.relative_to(root or workspace_root()).as_posix()
        rows.append(f"| {task_id} | {rel} | {status} | {updated} | {nxt} |")
    table = [
        "# Runtime",
        "",
        "新会话先读本页。短索引，不承载完整历史。完整工作集在对应任务文件。",
        "",
        "| Task ID | 状态文件 | 状态 | 更新 | 下一步 |",
        "| --- | --- | --- | --- | --- |",
    ]
    table.extend(rows)
    table.extend(
        [
            "",
            "无活动任务时表体为空。不要把本表的任务行提交进产品 PR。",
            "",
        ]
    )
    return "\n".join(table)


def write_state_md(root: Path | None = None) -> Path:
    root = root or workspace_root()
    path = runtime_dir(root) / "STATE.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_state_md(root), encoding="utf-8")
    return path


def active_task_files(root: Path | None = None) -> list[Path]:
    root = root or workspace_root()
    found = []
    for path in iter_task_files(root):
        status = task_status(parse_task_file(path))
        if status in ACTIVE_STATUSES:
            found.append(path)
    return found


def git_porcelain(root: Path) -> str:
    try:
        proc = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return ""
    if proc.returncode != 0:
        return ""
    return proc.stdout


def porcelain_product_paths(porcelain: str) -> set[str]:
    paths: set[str] = set()
    for line in porcelain.splitlines():
        if len(line) < 4:
            continue
        rest = line[3:]
        if " -> " in rest:
            rest = rest.split(" -> ", 1)[1]
        rest = rest.strip().strip('"')
        if any(rest.startswith(prefix) for prefix in SKIP_STATUS_PREFIXES):
            continue
        paths.add(rest)
    return paths


def product_changed_since(start_porcelain: str, now_porcelain: str) -> set[str]:
    start = porcelain_product_paths(start_porcelain)
    now = porcelain_product_paths(now_porcelain)
    return now - start


def session_stamp_path(root: Path, session_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", session_id or "unknown")
    return runtime_dir(root) / ".session" / f"{safe}.json"


def write_session_stamp(root: Path, session_id: str, porcelain: str) -> Path:
    path = session_stamp_path(root, session_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "sessionId": session_id,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "startedAtUnix": datetime.now(timezone.utc).timestamp(),
        "porcelain": porcelain,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    current = path.parent / "current"
    current.write_text(path.name + "\n", encoding="utf-8")
    return path


def read_session_stamp(root: Path, session_id: str) -> dict:
    path = session_stamp_path(root, session_id)
    if not path.is_file():
        current = runtime_dir(root) / ".session" / "current"
        if current.is_file():
            name = current.read_text(encoding="utf-8").strip()
            path = runtime_dir(root) / ".session" / name
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def file_updated_since(path: Path, started_at_unix: float) -> bool:
    try:
        return path.stat().st_mtime + 1 >= started_at_unix
    except OSError:
        return False
