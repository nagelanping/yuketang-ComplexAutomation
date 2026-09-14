#!/usr/bin/env node
// 终止闸门自测：从 userscript 抽出 StopGate 与 Player.waitForEnd 执行（都只用全局 StopGate/Store）。
// 覆盖机主报的那条路径：「暂停后 AI 返回仍会继续」→ 终止必须能掐掉在途请求，且长视频等待要能被叫醒。
const fs = require("fs");
const assert = require("assert");

const src = fs.readFileSync(
  __dirname + "/../yuketang-ComplexAutomation.user.js",
  "utf8",
);

const extract = (signature) => {
  const start = src.indexOf(signature);
  assert(start > -1, `未在 userscript 中找到 ${signature}`);
  let depth = 0;
  let end = -1;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  assert(end > -1, `未能定位 ${signature} 的方法体`);
  return src.slice(src.indexOf("{", start) + 1, end - 1);
};

// StopGate 的依赖：Store.clearPendingAutoStart
let pendingCleared = false;
globalThis.Store = {
  clearPendingAutoStart: () => {
    pendingCleared = true;
  },
};
// extract 返回的是第一个 { 到配对 } 之间的内容：对对象字面量就是它的属性表
const StopGate = eval(`({${extract("const StopGate = {")}})`);
const Player = {
  waitForEnd: eval(
    `(function waitForEnd(media, timeout = 0) {${extract("waitForEnd(media, timeout = 0) {")}})`,
  ),
};

(async () => {
  // 1. stop()：设置状态、abort 在途请求、清续跑标记、通知界面
  let abortCalls = 0;
  let onStopCalls = 0;
  StopGate.abortInflight = () => abortCalls++;
  StopGate.onStop = () => onStopCalls++;
  StopGate.stop();
  assert.strictEqual(StopGate.isStopped(), true);
  assert.strictEqual(abortCalls, 1, "终止应立刻 abort 在途 AI 请求");
  assert.strictEqual(pendingCleared, true, "终止应清掉 pendingAutoStart（刷新不再续跑）");
  assert.strictEqual(onStopCalls, 1);

  // 2. 幂等：再点一次不再重复 abort / 通知
  StopGate.stop();
  assert.strictEqual(abortCalls, 1);
  assert.strictEqual(onStopCalls, 1);

  // 3. 已终止后 waitForEnd 立刻返回（不挂在视频上等播完）
  const media = {
    ended: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const began = Date.now();
  await Player.waitForEnd(media, 600000);
  assert.ok(Date.now() - began < 200, "已终止时 waitForEnd 应立即返回");

  // 4. 终止发生在等待期间：1 秒内的轮询要把它叫醒
  StopGate.stopped = false;
  const media2 = {
    ended: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const waiting = Player.waitForEnd(media2, 600000);
  setTimeout(() => StopGate.stop(), 300);
  const began2 = Date.now();
  await waiting;
  const waited = Date.now() - began2;
  assert.ok(waited < 3000, `等待中的 waitForEnd 应在终止后很快返回（实际 ${waited}ms）`);

  console.log(
    "OK: 终止闸门（abort 在途请求 / 清续跑标记 / 幂等 / 已终止立刻返回 / 等待中被叫醒）五项均通过",
  );
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
