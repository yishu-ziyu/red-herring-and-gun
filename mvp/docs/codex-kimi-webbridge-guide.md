# Codex + Kimi WebBridge 使用指南

> Kimi WebBridge 是一个本地 HTTP daemon（端口 10086），通过浏览器扩展控制用户的真实浏览器。Codex 可以通过 `curl` 调用它的 API 完成浏览器自动化。

---

## 1. 前置检查

每次使用前，先确认 daemon 状态：

```bash
~/.kimi-webbridge/bin/kimi-webbridge status
```

期望返回：
```json
{"running":true,"extension_connected":true,"port":10086}
```

如果 `extension_connected` 为 `false`，说明浏览器扩展未连接，需要用户检查扩展是否开启。

---

## 2. 基础调用格式

所有操作都通过 `curl` POST 到 `http://127.0.0.1:10086/command`：

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"<动作>","args":{<参数>},"session":"<会话名>"}'
```

**关键点：**
- `-s` 静默模式，只输出响应数据
- `"session"` 用于隔离不同站点的标签页，不同站点用不同 session 名
- 返回值是 JSON，Codex 可以用 `jq` 解析或直接处理

---

## 3. 核心操作速查

### 3.1 打开页面（导航）

```bash
# 新标签页打开
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"navigate","args":{"url":"http://localhost:5173","newTab":true},"session":"hackathon"}'

# 当前标签页跳转（不新建）
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"navigate","args":{"url":"http://localhost:5173","newTab":false},"session":"hackathon"}'
```

### 3.2 获取页面结构（Snapshot）

**最重要！** 用 `snapshot` 代替手动写 CSS 选择器：

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"snapshot","args":{}},"session":"hackathon"}'
```

返回 `tree` 数组，每个可交互元素有 `@e` 引用编号：

```json
{
  "tree": [[[
    {"role":"button","name":"启动真实核查","ref":"@e3"}
  ]]]
}
```

**永远优先用 `@e` 引用**，而不是手写 `class` 或 `id` 选择器。

### 3.3 点击元素

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"click","args":{"selector":"@e3"},"session":"hackathon"}'
```

也支持 CSS 选择器（但不推荐）：
```bash
"selector":".landing-submit-btn"
```

### 3.4 填写输入框

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"fill","args":{"selector":"@e1","value":"吃隔夜菜会致癌"},"session":"hackathon"}'
```

**坑：** React 的受控组件（`useState` + `onChange`）用普通 DOM 操作改 `value` 不会触发更新。

**React 绕过方案：** 通过 `__reactProps$` 直接调用 onChange：

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d '{
    "action":"evaluate",
    "args":{
      "code":"(()=>{const el=document.querySelector(\"input\");const key=Object.keys(el).find(k=>k.startsWith(\"__reactProps\"));const props=el[key];props.onChange({target:{value:\"吃隔夜菜会致癌\"}});return \"ok\";})()"
    },
    "session":"hackathon"
  }'
```

### 3.5 执行 JavaScript

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d '{
    "action":"evaluate",
    "args":{
      "code":"document.title"
    },
    "session":"hackathon"
  }'
```

返回：
```json
{"type":"string","value":"红鲱鱼与枪"}
```

**技巧：** 用 IIFE 包裹代码避免变量重复声明：
```javascript
"code":"(()=>{ const x = ...; return x; })()"
```

### 3.6 截图

```bash
# 截图到默认路径（daemon 自动存到临时目录）
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"screenshot","args":{},"session":"hackathon"}'

# 指定保存路径
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d '{
    "action":"screenshot",
    "args":{"path":"/Users/mahaoxuan/Desktop/screenshot.png"},
    "session":"hackathon"
  }'
```

返回：
```json
{"format":"png","path":"/tmp/...","sizeBytes":434458}
```

### 3.7 查找标签页

```bash
# 找已打开的 localhost 标签页（返回最左边匹配）
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"find_tab","args":{"url":"http://localhost:5173"},"session":"hackathon"}'

# 找用户当前正在看的标签页
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"find_tab","args":{"url":"kimi.com","active":true},"session":"kimi"}'
```

### 3.8 关闭会话（清理所有标签页）

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"close_session","args":{},"session":"hackathon"}'
```

---

## 4. 完整工作流示例

**场景：** 打开本地开发服务器，填写表单，点击按钮，验证结果。

```bash
#!/bin/bash
set -e

SESSION="hackathon"
BASE="http://127.0.0.1:10086/command"

call() {
  curl -s -X POST "$BASE" -H 'Content-Type: application/json' -d "$1"
  echo
}

# 1. 导航到首页
call '{"action":"navigate","args":{"url":"http://localhost:5173","newTab":true},"session":"'$SESSION'"}'

# 2. 用 React 绕过方式填写输入框
call '{
  "action":"evaluate",
  "args":{
    "code":"(()=>{const el=document.querySelector(\"input\");const k=Object.keys(el).find(k=>k.startsWith(\"__reactProps\"));el[k].onChange({target:{value:\"测试文本\"}});return \"filled\";})()"
  },
  "session":"'$SESSION'"
}'

# 3. 点击提交按钮（先 snapshot 获取 @e 引用）
SNAPSHOT=$(call '{"action":"snapshot","args":{},"session":"'$SESSION'"}')
# 解析出按钮的 @e 编号... 这里省略解析逻辑
# call '{"action":"click","args":{"selector":"@e3"},"session":"'$SESSION'"}'

# 4. 等待 2 秒后截图
call '{
  "action":"screenshot",
  "args":{"path":"/Users/mahaoxuan/Desktop/result.png"},
  "session":"'$SESSION'"
}'
```

---

## 5. 常见坑与解决方案

| 坑 | 原因 | 解决 |
|---|---|---|
| `fill` 后值变了但按钮仍禁用 | React 受控组件没触发 onChange | 用 `evaluate` + `__reactProps$` 调用 onChange |
| `click` 没反应 | 元素被遮挡或需要 hover | 先 `snapshot` 确认元素可见 |
| JSON 解析错误 | `code` 里有未转义的双引号 | 外层用单引号包裹整个 JSON，或转义 `"` |
| `fill: Uncaught` | 扩展内部错误 | 换用 `evaluate` 直接操作 DOM |
| 找不到元素 | `snapshot` 没更新 | 等待页面加载完成后再 snapshot |

---

## 6. 和 Playwright MCP 的区别

| 特性 | Kimi WebBridge | Playwright MCP |
|---|---|---|
| 浏览器 | 用户真实浏览器（带登录态） | 独立 Chromium |
| 截图 | 保存到文件，用 `Read` 查看 | 直接返回 base64 |
| 选择器 | `@e` 语义引用（抗 class 变化） | CSS/XPath |
| React 支持 | 需手动绕过合成事件 | 自动处理 |
| 适用场景 | 需要登录态、真实环境验收 | 纯自动化测试、CI |

**你的偏好：优先用 Kimi WebBridge**，只有在需要纯自动化测试或 CI 集成时才用 Playwright MCP。

---

## 7. 速查卡片

```bash
# 状态检查
~/.kimi-webbridge/bin/kimi-webbridge status

# 导航
curl -s -X POST http://127.0.0.1:10086/command -d '{"action":"navigate","args":{"url":"URL","newTab":true},"session":"NAME"}'

# Snapshot
curl -s -X POST http://127.0.0.1:10086/command -d '{"action":"snapshot","args":{},"session":"NAME"}'

# 点击
curl -s -X POST http://127.0.0.1:10086/command -d '{"action":"click","args":{"selector":"@eN"},"session":"NAME"}'

# 截图
curl -s -X POST http://127.0.0.1:10086/command -d '{"action":"screenshot","args":{"path":"/path/to.png"},"session":"NAME"}'

# JS 执行
curl -s -X POST http://127.0.0.1:10086/command -d '{"action":"evaluate","args":{"code":"JS_CODE"},"session":"NAME"}'
```
