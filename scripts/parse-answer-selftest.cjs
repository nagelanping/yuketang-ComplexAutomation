#!/usr/bin/env node
// Solver 判分自测：parseAIAnswer() 的非 JSON 回退 + answerToIndices() 的选项映射（A–Z）。
// 直接从 userscript 抽出方法体与字母表执行（不与实现写两遍），panel 用桩。
const fs = require("fs");
const assert = require("assert");

const src = fs.readFileSync(__dirname + "/../yuketang-ComplexAutomation.user.js", "utf8");
const grab = (name, args) => {
  const m = src.match(
    new RegExp(`\\n {4}${name}\\(${args}\\) \\{[\\s\\S]*?\\n {4}\\},\\n`),
  );
  assert(m, `未在 userscript 中找到 ${name} 方法体`);
  return m[0];
};
const lettersMatch = src.match(/const OPTION_LETTERS = "([A-Z]+)"/);
assert(lettersMatch, "未在 userscript 中找到 OPTION_LETTERS");
globalThis.panel = { log: () => {} };
const Solver = eval(
  `(() => { const OPTION_LETTERS = "${lettersMatch[1]}"; return {${grab("parseAIAnswer", "aiResponse, questionType")}${grab("answerToIndices", "parsed, optionCount")}}; })()`,
);

const yes = ["正确", "对", "true", "yes", "TRUE", "答案为：正确"];
const no = ["错误", "错", "false", "no", "不正确", "不对", "不是正确答案", "不符合题意"];

for (const raw of yes) {
  assert.deepStrictEqual(
    Solver.parseAIAnswer(raw, "truefalse").answers,
    ["对"],
    `「${raw}」应判为对`,
  );
}
for (const raw of no) {
  assert.deepStrictEqual(
    Solver.parseAIAnswer(raw, "truefalse").answers,
    ["错"],
    `「${raw}」应判为错`,
  );
}

// answerToIndices：判断题答案 -> 选项下标（0=对/第一个，1=错/第二个）
const indices = (answer) => Solver.answerToIndices({ type: "truefalse", answers: [answer] }, 2);
for (const answer of ["对", "正确", "A", "true"])
  assert.deepStrictEqual(indices(answer), [0], `「${answer}」应映射到选项 0`);
for (const answer of [...no, "B"])
  assert.deepStrictEqual(indices(answer), [1], `「${answer}」应映射到选项 1`);

// 选择题：字母表覆盖 A–Z，越界值按 optionCount 过滤
const pick = (answer, count, type = "choice") =>
  Solver.answerToIndices({ type, answers: [answer] }, count);
assert.deepStrictEqual(pick("A", 4), [0]);
assert.deepStrictEqual(pick("F", 6), [5]);
assert.deepStrictEqual(pick("J", 10), [9], "第 10 个选项应是 J");
assert.deepStrictEqual(pick("Z", 26), [25], "第 26 个选项应是 Z");
assert.deepStrictEqual(pick("AB", 4, "multiple"), [0, 1]);
assert.deepStrictEqual(pick("J", 4), [], "超出现有选项数应被过滤");
assert.deepStrictEqual(pick("a", 4), [0], "小写答案同样识别");

// 非 JSON 回退取字母：只认独立成词的单个字母，别把英文词里的字母当选项
assert.deepStrictEqual(Solver.parseAIAnswer("选 A", "choice").answers, ["A"]);
assert.deepStrictEqual(Solver.parseAIAnswer("答案：J", "choice").answers, ["J"]);
assert.deepStrictEqual(Solver.parseAIAnswer("The answer is B", "choice").answers, ["B"]);
assert.deepStrictEqual(Solver.parseAIAnswer("A and C", "multiple").answers, ["A", "C"]);

// 纯 JSON 路径不受影响
assert.deepStrictEqual(Solver.parseAIAnswer('{"type":"truefalse","answers":["错"]}', "truefalse"), {
  type: "truefalse",
  answers: ["错"],
  raw: '{"type":"truefalse","answers":["错"]}',
});
assert.deepStrictEqual(
  Solver.parseAIAnswer('```json\n{"type":"truefalse","answers":["对"]}\n```', "truefalse").answers,
  ["对"],
);
assert.strictEqual(Solver.parseAIAnswer('{"type":"refuse"}', "truefalse").type, "refuse");
// JSON 没写 type 时沿用传入题型
assert.deepStrictEqual(Solver.parseAIAnswer('{"answers":["B"]}', "choice"), {
  type: "choice",
  answers: ["B"],
  raw: '{"answers":["B"]}',
});
// 其他题型回退照旧
assert.deepStrictEqual(Solver.parseAIAnswer("选 A", "choice").answers, ["A"]);
assert.deepStrictEqual(Solver.parseAIAnswer("答案：苹果；重力", "fillblank").answers, ["苹果", "重力"]);

console.log(
  `OK: 判断题回退 ${yes.length} 例肯定 / ${no.length} 例否定、JSON 与其他题型回退、A–Z 选项映射（含越界过滤）均通过`,
);
