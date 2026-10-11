/**
 * 验收用网络观察器：不替换状态、标题或正文，只记录真实读取并提供可取消的慢速条件。
 * 仅 NODE_ENV=test 时通过 NODE_OPTIONS --import 加载；正常开发和生产不加载。
 */
import { appendFileSync } from "node:fs";

if (process.env.NODE_ENV === "test" && process.env.E2E_SOURCE_TRACE_FILE) {
  const traceFile = process.env.E2E_SOURCE_TRACE_FILE;
  const nativeFetch = globalThis.fetch;
  let firstReaderAssigned = false;
  const trace = (event, fields = {}) => appendFileSync(traceFile, JSON.stringify({ event, at: Date.now(), ...fields }) + "\n");
  const sourceUrl = (requestUrl) => {
    try {
      const parsed = new URL(requestUrl);
      if (parsed.hostname !== "r.jina.ai") return null;
      const target = new URL(decodeURIComponent(parsed.pathname.slice(1)));
      target.username = ""; target.password = ""; target.search = ""; target.hash = "";
      return target.href;
    } catch { return null; }
  };
  const pause = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal.reason); };
    signal?.addEventListener("abort", abort, { once: true });
  });

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const source = sourceUrl(url);
    const parsed = new URL(url);
    // 仅计调用次数，不记录请求内容、响应、headers 或密钥。
    if (/\/(?:messages|chat\/completions)$/.test(parsed.pathname)) trace("model-start");
    if (!source) return nativeFetch(input, init);
    trace("source-start", { url: source });
    init.signal?.addEventListener("abort", () => trace("source-abort", { url: source }), { once: true });
    const response = await nativeFetch(input, init);
    if (!response.ok || !response.body) return response;
    const body = response.body;
    const delay = firstReaderAssigned ? Number(process.env.E2E_SOURCE_READ_DELAY_MS || 0) : 0;
    firstReaderAssigned = true;
    let text = "";
    const decoder = new TextDecoder();
    const wrappedBody = new Proxy(body, {
      get(target, name) {
        if (name !== "getReader") {
          const value = Reflect.get(target, name, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (...args) => {
          const reader = target.getReader(...args);
          let paced = false;
          return new Proxy(reader, {
            get(current, property) {
              if (property === "read") return async () => {
                if (!paced && delay > 0) {
                  paced = true;
                  trace("source-paced", { url: source });
                  await pause(delay, init.signal);
                }
                const result = await current.read();
                if (result.value && text.length < 64_000) text += decoder.decode(result.value, { stream: true });
                return result;
              };
              if (property === "releaseLock") return () => {
                const content = text.includes("Markdown Content:") ? text.split("Markdown Content:").slice(1).join("Markdown Content:").trim() : "";
                trace("source-read-finished", { url: source, characters: content.length,
                  eligible: content.length >= 200 && content.includes("隔夜") && !/captcha|access denied|sign in to continue|sina visitor system/i.test(content) });
                return current.releaseLock();
              };
              const value = Reflect.get(current, property, current);
              return typeof value === "function" ? value.bind(current) : value;
            },
          });
        };
      },
    });
    return new Proxy(response, {
      get(target, name) {
        if (name === "body") return wrappedBody;
        const value = Reflect.get(target, name, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
}
