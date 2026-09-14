#!/usr/bin/env node
// Utils.poll() 自测：直接从 userscript 抽出 poll 方法体执行，避免与实现写两遍。
// 覆盖：checker 返回 true / 超时返回 false / checker 抛错后有限时间内返回 false。
const fs = require("fs");
const assert = require("assert");

const src = fs.readFileSync(__dirname + "/../yuketang-ComplexAutomation.user.js", "utf8");
const m = src.match(/\n {4}poll\(checker, \{[\s\S]*?\n {4}\},\n/);
assert(m, "未在 userscript 中找到 Utils.poll 方法体");
// poll 现在会查终止闸门：用桩模拟「未终止 / 已终止」两种状态
let stopped = false;
globalThis.StopGate = { isStopped: () => stopped };
const Utils = eval(`({${m[0]}})`);

const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时未落定`)), ms)),
  ]);

(async () => {
  console.warn = () => {}; // 抛错用例是刻意触发的，压掉 poll 内的告警输出
  // 1. checker 第 2 次满足 → true
  let calls = 0;
  const hit = await Utils.poll(() => ++calls >= 2, { interval: 5, timeout: 1000 });
  assert.strictEqual(hit, true, "checker 满足时应 resolve(true)");

  // 2. checker 恒 false → 超时 false
  const miss = await Utils.poll(() => false, { interval: 5, timeout: 30 });
  assert.strictEqual(miss, false, "超时应 resolve(false)");

  // 3. checker 抛错 → 有限时间内 false（修复前这里会永不落定）
  const boom = await withTimeout(
    Utils.poll(() => {
      throw new Error("节点已卸载");
    }, { interval: 5, timeout: 1000 }),
    500,
    "checker 抛错",
  );
  assert.strictEqual(boom, false, "checker 抛错应 resolve(false)");

  // 4. 抛错后定时器已清理：1 秒内不应再有 tick 打到 checker
  let after = 0;
  await Utils.poll(() => {
    after++;
    throw new Error("boom");
  }, { interval: 10, timeout: 1000 });
  const ticksAtThrow = after;
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(after, ticksAtThrow, "抛错后 interval 应已 clearInterval");

  // 5. 已终止 → 立刻 false，且不启动定时器（否则流程会卡在等待里到超时）
  stopped = true;
  let called = 0;
  const stoppedResult = await withTimeout(
    Utils.poll(() => ++called > 0, { interval: 5, timeout: 1000 }),
    200,
    "已终止",
  );
  assert.strictEqual(stoppedResult, false, "已终止应立刻 resolve(false)");
  assert.strictEqual(called, 0, "已终止时不应再调用 checker");
  stopped = false;

  console.log(
    "OK: poll 的 true / 超时 false / 抛错 false + 定时器清理 / 已终止立刻 false 五项均通过",
  );
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
