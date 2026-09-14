#!/usr/bin/env node
// Decipherer 核心纯逻辑自测（不依赖 DOM/GM）：decodeMap + hashCommands。
const fs = require("fs");
const assert = require("assert");
const src = fs.readFileSync(__dirname + "/../yuketang-ComplexAutomation.user.js", "utf8");
// MAP_DATA 的声明跨两行（`const MAP_DATA =` 换行 + 缩进后的字面量），声明换行/缩进变了就要同步这里
const MAP_DATA_MATCH = src.match(/const MAP_DATA =\s*"([A-Za-z0-9+/=]+)"/);
assert(MAP_DATA_MATCH, "未在 userscript 中找到 MAP_DATA 的 base64 字面量");
const MAP_DATA = MAP_DATA_MATCH[1];

// 与脚本 Decipherer.decodeMapData 逐字一致
async function decodeMap(b64) {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const ds = new DecompressionStream("gzip");
  const w = ds.writable.getWriter();
  w.write(bytes);
  w.close();
  const buf = new Uint8Array(await new Response(ds.readable).arrayBuffer());
  const map = {};
  for (let i = 0; i + 10 < buf.length; i += 11) {
    let h = "";
    for (let j = 0; j < 8; j++) h += buf[i + j].toString(16).padStart(2, "0");
    map[h] = ((buf[i + 8] << 16) | (buf[i + 9] << 8) | buf[i + 10]) + 0x3400;
  }
  return map;
}
// 与脚本 Decipherer.hashCommands 逐字一致
async function hashCommands(commands) {
  let s = "";
  for (const c of commands) {
    const sorted = Object.entries(c).sort((a, b) => (a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? -1 : 1));
    for (const kv of sorted) s += kv[0] + kv[1];
  }
  return crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)).then((b) => {
    const x = new Uint8Array(b);
    let h = "";
    for (let i = 0; i < 8; i++) h += x[i].toString(16).padStart(2, "0");
    return h;
  });
}

(async () => {
  let pass = true;
  const map = await decodeMap(MAP_DATA);
  const n = Object.keys(map).length;
  const okCount = n === 30038;
  pass = pass && okCount;
  console.log(`decodeMap: ${n} 条 ${okCount ? "OK" : "FAIL(期望 30038)"}`);
  Object.entries(map).slice(0, 3).forEach(([h, code]) => console.log(`   ${h} -> U+${code.toString(16)} ${String.fromCodePoint(code)}`));
  const args = [{ type: "moveTo", x: 100, y: 200 }, { type: "lineTo", x: 300, y: 400 }];
  const h1 = await hashCommands(args);
  const h2 = await hashCommands(args);
  const okHash = /^[0-9a-f]{16}$/.test(h1) && h1 === h2;
  pass = pass && okHash;
  console.log(`hashCommands: ${h1} 稳定=${h1 === h2} ${okHash ? "OK" : "FAIL"}`);
  console.log(pass ? "SELFTEST PASS" : "SELFTEST FAIL");
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error("SELFTEST ERROR:", e.message);
  process.exit(1);
});
