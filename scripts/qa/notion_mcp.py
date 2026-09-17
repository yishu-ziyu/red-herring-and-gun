#!/usr/bin/env python3
"""一次性调用 Notion MCP：拉起 mcp-remote，完成握手，执行 tools/call 后退出。

用法：python3 scripts/qa/notion_mcp.py <tool> '<json-args>'
先 <tool>==__list__ 列出可用工具。
"""
from __future__ import annotations

import json
import subprocess
import sys
import threading
import time

CMD = ["/Users/mahaoxuan/.npm/_npx/705d23756ff7dacc/node_modules/.bin/mcp-remote", "https://mcp.notion.com/mcp"]


class McpClient:
    def __init__(self) -> None:
        self.proc = subprocess.Popen(
            CMD,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        self._id = 0
        self._lock = threading.Lock()
        self._pending: dict[int, dict] = {}
        self._listener = threading.Thread(target=self._pump, daemon=True)
        self._listener.start()

    def _pump(self) -> None:
        # MCP stdio 是换行分隔的 JSON-RPC；mcp-remote 的 [pid] 日志行直接跳过。
        for line in self.proc.stdout:
            stripped = line.strip()
            if not stripped.startswith("{"):
                continue
            try:
                msg = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            msg_id = msg.get("id")
            if isinstance(msg_id, int):
                self._pending[msg_id] = msg

    def call(self, method: str, params: dict | None = None, timeout: float = 60) -> dict:
        with self._lock:
            self._id += 1
            msg_id = self._id
            payload = {"jsonrpc": "2.0", "id": msg_id, "method": method}
            if params is not None:
                payload["params"] = params
            self.proc.stdin.write(json.dumps(payload) + "\n")
            self.proc.stdin.flush()
            deadline = time.time() + timeout
            while time.time() < deadline:
                if msg_id in self._pending:
                    return self._pending.pop(msg_id)
                time.sleep(0.05)
            raise TimeoutError(f"{method} timed out")

    def notify(self, method: str, params: dict | None = None) -> None:
        payload = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()

    def close(self) -> None:
        try:
            self.proc.terminate()
        except Exception:
            pass


def main() -> int:
    tool = sys.argv[1]
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}

    client = McpClient()
    deadline = time.time() + 45
    try:
        init = client.call("initialize", {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "kimi-notion-bridge", "version": "0.1"},
        })
        if "error" in init:
            print(json.dumps(init, ensure_ascii=False))
            return 1
        client.notify("notifications/initialized")

        if tool == "__list__":
            result = client.call("tools/list")
            tools = [t["name"] for t in result.get("result", {}).get("tools", [])]
            print(json.dumps(tools, ensure_ascii=False, indent=1))
            return 0

        result = client.call("tools/call", {"name": tool, "arguments": args})
        content = result.get("result", {}).get("content", [])
        for block in content:
            text = block.get("text", "")
            try:
                parsed = json.loads(text)
                print(json.dumps(parsed, ensure_ascii=False, indent=1)[:8000])
            except (json.JSONDecodeError, TypeError):
                print(text[:8000])
        if "error" in result:
            print(json.dumps(result["error"], ensure_ascii=False))
            return 1
        return 0
    finally:
        client.close()
        if time.time() > deadline:
            print("(slow)", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
