// Coordinator-only browser receipt helper. Connects to the existing ChromeMain CDP
// endpoint; never launches a browser, reads secrets, or modifies stored cases.
import { writeFile } from 'node:fs/promises';

const [tabId, action = 'snapshot', value] = process.argv.slice(2);
const tabs = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = tabs.find((t) => t.id === tabId && t.type === 'page');
if (!target || !target.url.startsWith('http://127.0.0.1:5174/')) {
  throw new Error('Expected an explicitly selected local product tab on port 5174');
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
let seq = 0;
const pending = new Map();
ws.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  clearTimeout(entry.timer);
  message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
});
function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const output = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (output.exceptionDetails) throw new Error(JSON.stringify(output.exceptionDetails));
  return output.result.value;
}
try {
  if (action === 'snapshot') {
    console.log(await evaluate(`JSON.stringify({text:document.body.innerText,controls:[...document.querySelectorAll('button,input,textarea,[contenteditable]')].map(e=>({tag:e.tagName,text:e.innerText,label:e.getAttribute('aria-label'),role:e.getAttribute('role'),editable:e.getAttribute('contenteditable'),disabled:e.disabled})),overflow:document.documentElement.scrollWidth>innerWidth})`));
  } else if (action === 'type') {
    const focused = await evaluate(`(()=>{const e=document.querySelector('[contenteditable="true"]')||document.querySelector('textarea');if(!e)return false;e.focus();return true})()`);
    if (!focused) throw new Error('No editable prompt found');
    await send('Input.insertText', { text: value ?? '' });
  } else if (action === 'click') {
    console.log(await evaluate(`(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>(e.getAttribute('aria-label')||e.innerText.trim())===${JSON.stringify(value)});if(!e)throw new Error('Control not found');if(e.disabled)throw new Error('Control disabled');e.click();return 'clicked'})()`));
  } else if (action === 'reload') {
    await send('Page.reload', { ignoreCache: true });
  } else if (action === 'resize') {
    await send('Emulation.setDeviceMetricsOverride', { width: Number(value), height: 900, deviceScaleFactor: 1, mobile: false });
  } else if (action === 'capture') {
    if (!value?.startsWith('/tmp/rhg-continuity-')) throw new Error('Use a task-scoped screenshot path in /tmp');
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(value, Buffer.from(shot.data, 'base64'));
    console.log(value);
  } else if (action === 'requests') {
    console.log(await evaluate(`JSON.stringify(performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/')).map(e=>({url:e.name,duration:e.duration})))`));
  } else {
    throw new Error('Unknown action');
  }
} finally {
  ws.close();
}
