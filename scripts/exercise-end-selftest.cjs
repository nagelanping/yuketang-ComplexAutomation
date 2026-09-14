#!/usr/bin/env node
// 末题收尾自测：末题提交后站点会翻到作业概况/结果页，判定「这一页还有没有逐题提交控件」。
// 从 userscript 抽出 AiWorkspace.hasExerciseSubmitControl 执行（方法不用 this，可用桩跑）。
const fs = require("fs");
const assert = require("assert");

const src = fs.readFileSync(
  __dirname + "/../yuketang-ComplexAutomation.user.js",
  "utf8",
);
const marker = "hasExerciseSubmitControl(itemBodyElement) {";
const start = src.indexOf(marker);
assert(start > -1, "未在 userscript 中找到 hasExerciseSubmitControl");
let depth = 0;
let end = -1;
for (let i = src.indexOf("{", start); i < src.length; i++) {
  if (src[i] === "{") depth++;
  else if (src[i] === "}" && --depth === 0) {
    end = i + 1;
    break;
  }
}
assert(end > -1, "未能定位 hasExerciseSubmitControl 的方法体");
const body = src.slice(src.indexOf("{", start) + 1, end - 1);
const hasExerciseSubmitControl = eval(
  `(function hasExerciseSubmitControl(itemBodyElement) {${body}})`,
);

// 极简 DOM 桩：提交控件在题面容器 `.container-problem`（实测在 `.problem-fixedbar` 里），
// 题面正文只是它的后代，所以按 closest(".container-problem") 取范围。
const btn = (text, visible = true) => ({ innerText: text, offsetParent: visible ? 1 : null });
const nodeWith = (buttons) => ({ querySelectorAll: () => buttons });
const bodyIn = (containerButtons) => {
  const el = nodeWith([]);
  el.parentElement = null;
  el.closest = (sel) => (sel === ".container-problem" ? nodeWith(containerButtons) : null);
  return el;
};

// 1. 题面容器里有逐题「提交」按钮 → 是待作答的题
assert.strictEqual(hasExerciseSubmitControl(bodyIn([btn("提交")])), true);
// 2. 按钮在题面自身、没有容器（其它题型/页面结构）→ 也要认
assert.strictEqual(
  hasExerciseSubmitControl((() => { const el = nodeWith([btn("提交答案")]); el.closest = () => null; el.parentElement = null; return el; })()),
  true,
);
// 3. 「提交作业」是交整份作业的按钮，不算逐题作答 → 否
assert.strictEqual(hasExerciseSubmitControl(bodyIn([btn("提交作业")])), false);
// 4. 隐藏的按钮不算 → 否
assert.strictEqual(hasExerciseSubmitControl(bodyIn([btn("提交", false)])), false);
// 5. 结果页/概况页没有任何提交控件 → 否
assert.strictEqual(hasExerciseSubmitControl(bodyIn([btn("下一题"), btn("查看解析")])), false);
// 6. 没有题面（容器都没找到）→ 否
assert.strictEqual(hasExerciseSubmitControl(null), false);

console.log(
  "OK: 末题收尾判定（容器里的逐题提交按钮 / 题面自身按钮 / 排除提交作业 / 隐藏不算 / 结果页无控件 / 无题面）六项均通过",
);
