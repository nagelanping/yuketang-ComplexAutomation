#!/usr/bin/env node
// V2Runner.getCompletionState() 自测：从 userscript 抽出方法体执行（只用 String 与正则，不碰 DOM）。
// 覆盖分数 / 百分比 / 文本三类判据的优先级，以及讨论区的「已发言」标志。
const fs = require("fs");
const assert = require("assert");

const src = fs.readFileSync(
  __dirname + "/../yuketang-ComplexAutomation.user.js",
  "utf8",
);

const bodyOf = (signature) => {
  const start = src.indexOf(signature);
  assert(start > -1, `未在 userscript 中找到 ${signature}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      return src.slice(src.indexOf("{", start) + 1, i);
    }
  }
  throw new Error(`未能定位 ${signature} 的方法体`);
};

const getCompletionState = eval(
  `(function getCompletionState(statusText) {${bodyOf("getCompletionState(statusText) {")}})`,
);

const cases = [
  // 讨论区：目录里讨论叶子只有这一个标志（实测 DOM：对勾 + 已发言 / 空心 + 未发言）
  ["已发言", "completed"],
  ["未发言", "not_started"],
  ["已回复", "completed"],
  // 分数优先于文字
  ["6/6 已完成", "completed"],
  ["3/6 进行中", "in_progress"],
  ["0/5 未开始", "not_started"],
  // 百分比优先于文字
  ["100%", "completed"],
  ["1% 进行中", "in_progress"],
  // 纯文字
  ["已完成", "completed"],
  ["已读", "completed"],
  ["进行中", "in_progress"],
  ["未开始", "not_started"],
  ["未读", "not_started"],
  ["", "not_started"],
];

for (const [text, expected] of cases) {
  assert.strictEqual(
    getCompletionState(text),
    expected,
    `getCompletionState(${JSON.stringify(text)}) 应为 ${expected}`,
  );
}

// 讨论区实机取到的整段状态文本（.statistics-box .aside 的 innerText）也要判成完成
assert.strictEqual(
  getCompletionState("已发言"),
  "completed",
  "讨论叶子的 statusText 判完成——漏掉它会对同一条讨论反复交棒",
);

console.log(
  `OK: 完成状态判定 ${cases.length} 例（分数/百分比/文字优先级 + 已发言/未发言）均通过`,
);
