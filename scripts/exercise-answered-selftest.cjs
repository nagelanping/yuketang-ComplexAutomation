#!/usr/bin/env node
// 「这道题已作答了吗」自测。站点状态机（2026-09-13 实机）：
//   未作答 → 不可点击的「提交」；已作答未提交 → 「提交」变可点击；已提交 → 不可点击的「已提交」。
// 提交控件不在题面里（在题面所在容器/文档那一层），所以判据要按层级向外找，且不能拿「提交」是否
// disabled 反推（未作答时它同样是 disabled）。
// 从 userscript 抽出 AiWorkspace.isExerciseAnswered 执行（只用 this.isVisibleElement / this.normalizeText）。
const fs = require("fs");
const assert = require("assert");

const src = fs.readFileSync(
  __dirname + "/../yuketang-ComplexAutomation.user.js",
  "utf8",
);
const marker = "isExerciseAnswered(root = this.getExerciseContainer()) {";
const start = src.indexOf(marker);
assert(start > -1, "未在 userscript 中找到 isExerciseAnswered");
let depth = 0;
let end = -1;
for (let i = src.indexOf("{", start); i < src.length; i++) {
  if (src[i] === "{") depth++;
  else if (src[i] === "}" && --depth === 0) {
    end = i + 1;
    break;
  }
}
assert(end > -1, "未能定位 isExerciseAnswered 的方法体");
const body = src.slice(src.indexOf("{", start) + 1, end - 1);
const isExerciseAnswered = eval(
  `(function isExerciseAnswered(root) {${body}})`,
);

const AiWorkspace = {
  isVisibleElement: (el) => el.offsetParent !== null,
  normalizeText: (text) => String(text || "").replace(/\s+/g, " ").trim(),
};
// 桩：题面自身 / 题面所在容器 / 其所属文档，各自带一份元素清单
const btn = (text, visible = true) => ({
  innerText: text,
  offsetParent: visible ? 1 : null,
});
const nodeWith = (buttons, extra = {}) => ({
  querySelectorAll: () => buttons,
  ...extra,
});
const questionBody = ({ statusButtons = [], containerButtons = [], docButtons = [] } = {}) => {
  const doc = nodeWith(docButtons);
  const container = nodeWith(containerButtons, { ownerDocument: doc });
  return nodeWith(statusButtons, {
    ownerDocument: doc,
    closest: (sel) => (sel === ".container-problem" ? container : null),
  });
};

// 1. 未作答：题面所在层只有一个不可点击的「提交」→ 未作答（不能因为 disabled 就当成已提交）
assert.strictEqual(
  isExerciseAnswered.call(AiWorkspace, questionBody({ docButtons: [btn("提交")] })),
  false,
  "不可点击的「提交」表示未作答",
);
// 2. 已作答未提交：「提交」可点击 → 仍未提交
assert.strictEqual(
  isExerciseAnswered.call(AiWorkspace, questionBody({ docButtons: [btn("提交")] })),
  false,
);
// 3. 已提交：文案变成不可点击的「已提交」→ 是（控件在题面之外也要能找到）
assert.strictEqual(
  isExerciseAnswered.call(AiWorkspace, questionBody({ docButtons: [btn("已提交")] })),
  true,
  "「已提交」在题面之外（文档层）也要认出来",
);
// 4. 容器层出现「已提交」→ 是
assert.strictEqual(
  isExerciseAnswered.call(AiWorkspace, questionBody({ containerButtons: [btn("已提交")] })),
  true,
);
// 5. 隐藏的「已提交」（模板残留）不算
assert.strictEqual(
  isExerciseAnswered.call(AiWorkspace, questionBody({ docButtons: [btn("已提交", false)] })),
  false,
);
// 6. 题面内有结果文案（回答错误）→ 是
assert.strictEqual(
  isExerciseAnswered.call(AiWorkspace, questionBody({ statusButtons: [btn("回答错误 正确答案：B")] })),
  true,
);
// 7. 没有题面 → 否
assert.strictEqual(isExerciseAnswered.call(AiWorkspace, null), false);

console.log(
  "OK: 已作答判定（未作答 disabled「提交」/ 可点击「提交」/ 题面外「已提交」/ 容器层「已提交」/ 隐藏不算 / 结果文案 / 无题面）七项均通过",
);
