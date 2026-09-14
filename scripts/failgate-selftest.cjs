#!/usr/bin/env node
// FailGate 自测：哨兵值语义 + 跨标签（opener）回写。
// 从 userscript 抽出 FailGate 对象执行，sessionStorage / window.opener 用桩：
// 目录标签的 sessionStorage 是"权威"那份，交棒子标签拿到的是拷贝，两边各自独立（见 OBSERVE.md）。
const fs = require("fs");
const assert = require("assert");

const src = fs.readFileSync(__dirname + "/../yuketang-ComplexAutomation.user.js", "utf8");
const m = src.match(/\n {2}const FailGate = \{[\s\S]*?\n {2}\};\n/);
assert(m, "未在 userscript 中找到 FailGate 对象");
const body = m[0].trim().replace(/^const FailGate = /, "").replace(/;$/, "");

// 继承脚本里的真实 key 名（而不是在测试里照样写一遍），否则 clear() 清错 key 也测不出来
const Config = {
  storageKeys: (() => {
    const m = src.match(/failCounts: "([^"]+)"/);
    const w = src.match(/refusedWarned: "([^"]+)"/);
    assert(m && w, "未在 userscript 中找到 failCounts / refusedWarned 的 key");
    return { failCounts: m[1], refusedWarned: w[1] };
  })(),
};
const safeJSONParse = (raw, fallback) => {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const makeStorage = () => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    _map: () => safeJSONParse(data.get(Config.storageKeys.failCounts), {}) || {},
  };
};

const dirStorage = makeStorage();
globalThis.sessionStorage = dirStorage;
globalThis.window = { opener: null };
globalThis.Utils = { safeJSONParse };
const FailGate = eval(`(${body})`);

// 普通失败计数
assert.strictEqual(FailGate.get("a"), 0);
assert.strictEqual(FailGate.bump("a"), 1);
assert.strictEqual(FailGate.bump("a"), 2);
assert.strictEqual(FailGate.bump("a"), 3);
assert.strictEqual(FailGate.exhausted("a"), true, "满 maxAttempts 应判耗尽");
FailGate.reset("a");
assert.strictEqual(FailGate.get("a"), 0);

// 主动跳过哨兵：bump 不得把它变成计数
FailGate.skip("b");
assert.strictEqual(FailGate.skipped("b"), true);
assert.strictEqual(FailGate.bump("b"), -1, "哨兵上 bump 应原样返回");
assert.strictEqual(FailGate.skipped("b"), true, "bump 后仍应是跳过哨兵");
assert.strictEqual(FailGate.exhausted("b"), false);

// 切到子标签视角：自己的 sessionStorage 是拷贝，opener 指向目录那份
const childStorage = makeStorage();
childStorage.setItem(Config.storageKeys.failCounts, JSON.stringify(dirStorage._map()));
globalThis.sessionStorage = childStorage;
globalThis.window = { opener: { sessionStorage: dirStorage } };

assert.strictEqual(FailGate.markRefused(""), false, "没有 key 时不应写");
assert.strictEqual(FailGate.markRefused("c"), true);
assert.strictEqual(dirStorage._map().c, -2, "拒答应写进 opener 的那份");
assert.strictEqual(childStorage._map().c, undefined, "不应只写自己那份（目录看不到）");

// 回到目录视角
globalThis.sessionStorage = dirStorage;
assert.strictEqual(FailGate.refused("c"), true, "目录侧应认出拒答哨兵");
assert.strictEqual(FailGate.skipped("c"), false, "拒答不是主动跳过");
assert.strictEqual(FailGate.bump("c"), -2, "拒答哨兵上 bump 应原样返回（-2+1 会变成 -1）");
assert.strictEqual(FailGate.refused("c"), true, "bump 后仍是拒答哨兵");

// 做成之后的进展回写：清掉目录上的计数
FailGate.bump("d");
FailGate.bump("d");
assert.strictEqual(FailGate.get("d"), 2);
globalThis.sessionStorage = childStorage;
assert.strictEqual(FailGate.markProgress("d"), true);
globalThis.sessionStorage = dirStorage;
assert.strictEqual(FailGate.get("d"), 0, "markProgress 应清掉计数");
assert.strictEqual("d" in dirStorage._map(), false);

// 没有 opener（用户直接在本页启动）时静默失败
globalThis.sessionStorage = childStorage;
globalThis.window = { opener: null };
assert.strictEqual(FailGate.markRefused("e"), false);
assert.strictEqual(FailGate.markProgress("e"), false);

// 拒答提示去重：目录每轮交棒都会整页导航回来、重建实例，标记必须落在 sessionStorage 里
globalThis.sessionStorage = dirStorage;
globalThis.window = { opener: null };
assert.strictEqual(FailGate.warnedRefused("f"), false);
FailGate.markRefusedWarned("f");
assert.strictEqual(FailGate.warnedRefused("f"), true);
FailGate.markRefusedWarned("f");
assert.strictEqual(
  FailGate._readRefusedWarned().filter((k) => k === "f").length,
  1,
  "重复标记不应重复入表",
);
const FailGateAfterReload = eval(`(${body})`); // 模拟整页重载后新建的实例
assert.strictEqual(
  FailGateAfterReload.warnedRefused("f"),
  true,
  "去重标记应存在 sessionStorage 里，跨页面重建仍有效",
);
FailGate.clear();
assert.strictEqual(FailGate.warnedRefused("f"), false, "清除失败记录应一并清掉去重标记");
assert.strictEqual(
  dirStorage.getItem(Config.storageKeys.refusedWarned),
  null,
  "clear() 清的是 refusedWarned 这个 key",
);

// 目录自己标记拒答（批次内只有拒答子项时用），不经过 opener
globalThis.window = { opener: null };
assert.strictEqual(FailGate.markRefusedLocal("g"), true);
assert.strictEqual(FailGate.refused("g"), true, "markRefusedLocal 应写本地那份表");
assert.strictEqual(FailGate.markRefusedLocal(""), false, "没有 key 时不应写");

// 批次收尾把父批次标成 -2 后返回 true，run() 会照常走 `if (advanced && !FailGate.skipped(failKey)) reset(failKey)`：
// reset 若把哨兵删掉，下一轮重扫又进同一批次（章节仍是「进行中」）→ 再标一次 → 再被删一次 → 无限重载。
FailGate.markRefusedLocal("h");
FailGate.reset("h");
assert.strictEqual(FailGate.refused("h"), true, "reset 不得抹掉拒答哨兵");
assert.strictEqual(FailGate.skipped("h"), false, "拒答不是主动跳过");
FailGate.skip("i");
FailGate.reset("i");
assert.strictEqual(FailGate.skipped("i"), true, "reset 不得抹掉跳过哨兵");
FailGate.bump("j");
FailGate.bump("j");
FailGate.reset("j");
assert.strictEqual(FailGate.get("j"), 0, "普通计数仍应被清零")

console.log(
  "OK: FailGate 计数 / 跳过哨兵 / 拒答哨兵 / 进展清零 / 无 opener 静默 / 拒答提示跨重载去重（真 key 名）/ 目录侧拒答标记 / reset 不抹哨兵，八项均通过",
);
