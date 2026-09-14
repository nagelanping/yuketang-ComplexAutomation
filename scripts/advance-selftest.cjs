#!/usr/bin/env node
// 作业逐题推进自测。站点提交后有两种行为（2026-09-13 实机）：
//   答对 → 自己翻到下一题；答错 → 留在原页只把结果渲染上去（提交按钮随即不可用）。
// 分界是「刚才那道题还留在页面上吗」：还留着就得自己点「下一题」；已换掉就是站点翻过了，再点会漏答一题。
// 从 userscript 抽出 advanceExerciseQuestion + exerciseQuestionStillShown 执行（两者都不用 this）。
const fs = require("fs");
const assert = require("assert");

const src = fs.readFileSync(
  __dirname + "/../yuketang-ComplexAutomation.user.js",
  "utf8",
);

// 按大括号配对抽出方法体，包成普通函数（方法体里不出现方法名本身）
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

const advanceExerciseQuestion = eval(
  `(async function advanceExerciseQuestion(root, previousFingerprint = "") {${extract('async advanceExerciseQuestion(root, previousFingerprint = "") {')}})`,
);

// 可调桩：题面文本用队列控制「调用时页面上显示的是什么」，按钮点击计数
let fingerprints = [];
let clickCount = 0;
let hasNextBtn = true;
globalThis.AiWorkspace = {
  getExerciseContainer: () => ({}),
  normalizeText: (text) => String(text || "").replace(/\s+/g, " ").trim(),
  exerciseFingerprint: () => fingerprints.shift() ?? "",
  getExerciseActionButton: () =>
    hasNextBtn ? { click: () => clickCount++ } : null,
};
// 用源码里真实的实现，避免测试和实现各写一份
globalThis.AiWorkspace.exerciseQuestionStillShown = eval(
  `(function exerciseQuestionStillShown(previousText) {${extract("exerciseQuestionStillShown(previousText) {")}})`,
);
globalThis.Utils = {
  poll: async (checker) => Promise.resolve(Boolean(checker())),
};

(async () => {
  // 1. 答对：站点已翻页，上一题题面不在页面上 → 不能点「下一题」（点就漏答一题）
  fingerprints = ["题目二：以下哪项属于品格优势"];
  clickCount = 0;
  assert.strictEqual(
    await advanceExerciseQuestion({}, "题目一：习得性乐观的核心观点是什么"),
    true,
    "站点已翻页时应直接算已推进",
  );
  assert.strictEqual(clickCount, 0, "站点已翻页时不得再点「下一题」");

  // 2. 答错：留在原页、题面后面渲染了结果 → 必须自己点「下一题」
  fingerprints = [
    "题目一：习得性乐观的核心观点是什么 回答错误 正确答案：B 解析……",
    "题目二：以下哪项属于品格优势",
  ];
  clickCount = 0;
  assert.strictEqual(
    await advanceExerciseQuestion({}, "题目一：习得性乐观的核心观点是什么"),
    true,
  );
  assert.strictEqual(clickCount, 1, "答错留在原页时应点一次「下一题」");

  // 3. 未提交/页面没动：同一题仍在页面上 → 点「下一题」
  fingerprints = ["题目一：习得性乐观的核心观点是什么", "题目二：以下哪项属于品格优势"];
  clickCount = 0;
  assert.strictEqual(
    await advanceExerciseQuestion({}, "题目一：习得性乐观的核心观点是什么"),
    true,
  );
  assert.strictEqual(clickCount, 1);

  // 4. 页面上没有「下一题」按钮 → 返回 false（由调用方决定是否继续）
  fingerprints = ["题目一：习得性乐观的核心观点是什么"];
  clickCount = 0;
  hasNextBtn = false;
  assert.strictEqual(
    await advanceExerciseQuestion({}, "题目一：习得性乐观的核心观点是什么"),
    false,
  );
  assert.strictEqual(clickCount, 0);
  hasNextBtn = true;

  // 5. 没有基准题面（首次调用）→ 不比较，按按钮推进
  fingerprints = ["题目一：习得性乐观的核心观点是什么", "题目二：以下哪项属于品格优势"];
  clickCount = 0;
  assert.strictEqual(await advanceExerciseQuestion({}, ""), true);
  assert.strictEqual(clickCount, 1, "没有基准题面时应点按钮推进");

  console.log(
    "OK: 作业推进（答对不点 / 答错点一次 / 页面未动点一次 / 无按钮返回 false / 无基准题面按按钮推进）五项均通过",
  );
})();
