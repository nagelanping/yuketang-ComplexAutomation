#!/usr/bin/env node
// 用法: node bi.mjs <cmd> [args]
//   url                列出所有标签页 url
//   eval <js>          在活动的非空白标签页执行 JS, 打印 JSON.stringify(结果)
//   html               打印整页 outerHTML
//   goto <url>         活动标签页跳转
//   shot [file.png]    活动标签页截图 (默认 shot.png)
import { readFileSync, writeFileSync } from 'node:fs';

const LOG = process.env.FF_LOG || `${process.env.HOME}/.local/share/ykt-ff/ff.log`;
const urls = readFileSync(LOG, 'utf8').match(/ws:\/\/[^\s]+/g) || [];
if (!urls.length) { console.error('log 里没找到 ws url, 先跑 launch.sh'); process.exit(1); }
const wsUrl = urls[urls.length - 1];

const ws = new WebSocket(wsUrl);
let seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout: ' + method)); } }, 15000);
});
ws.onmessage = (e) => {
  const m = JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString());
  if (!m.id) return;
  const p = pending.get(m.id); if (!p) return;
  pending.delete(m.id);
  m.error ? p.rej(new Error(m.error + ' ' + (m.message || ''))) : p.res(m.result);
};
await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws 连接失败: ' + wsUrl)); });

async function topContext() {
  const { contexts } = await send('browsingContext.getTree');
  const c = contexts.find(x => x.url && !/^(about:|chrome:)/.test(x.url)) || contexts[0];
  return c.contextId;
}
async function pageEval(expression) {
  const context = await topContext();
  const r = await send('script.evaluate', { expression, realm: { type: 'context', contextId: context }, await: false });
  const v = r.value;
  if (v && typeof v === 'object' && 'value' in v) return v.value;
  return v;
}

const [cmd, ...args] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'url': {
      const { contexts } = await send('browsingContext.getTree');
      console.log(contexts.map(c => `${c.contextId}\t${c.url}`).join('\n'));
      break;
    }
    case 'eval': {
      const out = await pageEval('JSON.stringify((' + args.join(' ') + '))');
      console.log(typeof out === 'string' ? out : JSON.stringify(out));
      break;
    }
    case 'html':
      console.log(await pageEval('document.documentElement.outerHTML'));
      break;
    case 'goto':
      await send('browsingContext.navigate', { context: await topContext(), url: args[0] });
      console.log('navigating: ' + args[0]);
      break;
    case 'shot': {
      const file = args[0] || 'shot.png';
      const r = await send('browsingContext.captureScreenshot', { context: await topContext() });
      writeFileSync(file, Buffer.from(r.data, 'base64'));
      console.log('saved ' + file);
      break;
    }
    default:
      console.error('unknown cmd: ' + cmd); process.exit(2);
  }
} catch (e) {
  console.error('ERROR: ' + e.message);
  process.exit(1);
}
ws.close();
