#!/usr/bin/env node
// 讨论区相关纯逻辑自测：从 userscript 抽出方法体执行（不碰真实 DOM，必要时用桩）。
// 覆盖：换行保留 / 回复正文清洗 / 拒答标记识别 / 路由类型判定 / 回复框写入（含「拿错对象要报错」）。
const fs = require("fs");
const assert = require("assert");

const src = fs.readFileSync(
  __dirname + "/../yuketang-ComplexAutomation.user.js",
  "utf8",
);

// 取「签名到配对右括号」之间的方法体
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

const method = (signature) =>
  eval(`(function ${signature}${bodyOf(signature)}})`);

// fillForumReplyBox 要用 panel / HTMLTextAreaElement / Event，先摆桩
const logs = [];
globalThis.panel = { log: (msg) => logs.push(msg) };
globalThis.Event = class Event {
  constructor(type, opts) {
    this.type = type;
    this.bubbles = Boolean(opts?.bubbles);
  }
};
globalThis.HTMLTextAreaElement = function HTMLTextAreaElement() {};
Object.defineProperty(globalThis.HTMLTextAreaElement.prototype, "value", {
  get() {
    return this._v || "";
  },
  set(next) {
    this._v = next;
  },
});

const AiWorkspace = {
  keepLineBreaks: method('keepLineBreaks(text = "") {'),
  normalizeForumReply: method('normalizeForumReply(raw = "") {'),
  isForumRouteType: method('isForumRouteType(type = "") {'),
};
const Solver = { isRefuseReply: method('isRefuseReply(raw = "") {') };
const fillForumReplyBox = method("fillForumReplyBox(box, text) {");

// 1. 换行必须保留（normalizeText 会把换行压成空格，讨论区正文不能走它）
assert.strictEqual(
  AiWorkspace.keepLineBreaks("  a\r\nb\n\nc  "),
  "a\nb\n\nc",
  "keepLineBreaks 应统一换行、去掉首尾空白、保留段落",
);

// 2. 干净文本原样返回
const plain = "第一件好事。\n原因：天气好。\n\n第二件好事。\n原因：饭好吃。";
assert.strictEqual(AiWorkspace.normalizeForumReply(plain), plain);

// 3. 代码块围栏
assert.strictEqual(
  AiWorkspace.normalizeForumReply("```\n" + plain + "\n```"),
  plain,
);
assert.strictEqual(
  AiWorkspace.normalizeForumReply("```text\n" + plain + "\n```"),
  plain,
);

// 4. 「回复：」前缀与整体引号
assert.strictEqual(AiWorkspace.normalizeForumReply("回复：" + plain), plain);
assert.strictEqual(AiWorkspace.normalizeForumReply("“" + plain + "”"), plain);
assert.strictEqual(AiWorkspace.normalizeForumReply("「" + plain + "」"), plain);

// 5. 照抄 prompt 示范的两行格式时，只取 Formal Response 后面的正文
assert.strictEqual(
  AiWorkspace.normalizeForumReply("CoT Reasoning: 我先想想。\nFormal Response: " + plain),
  plain,
);
assert.strictEqual(
  AiWorkspace.normalizeForumReply("Formal Response: {refuse}"),
  "{refuse}",
);

// 6. 拒答标记：prompt 约定 {refuse}，也要认得作业那种 {"type":"refuse"} 与裸 refuse
for (const raw of [
  "{refuse}",
  "refuse",
  "```\n{refuse}\n```",
  '{"type":"refuse"}',
  '{"type": "refuse"}',
  "CoT Reasoning: 无法提交附件。\nFormal Response: {refuse}",
]) {
  assert.ok(Solver.isRefuseReply(raw), `应判为拒答：${JSON.stringify(raw)}`);
}
for (const raw of [
  plain,
  "我查阅了链接内容，没有发现需要 refuse 的地方。",
  "type: 说明", // 只有 type 没有 refuse
  "",
]) {
  assert.ok(!Solver.isRefuseReply(raw), `不该判为拒答：${JSON.stringify(raw)}`);
}

// 7. 路由类型
assert.ok(AiWorkspace.isForumRouteType("forum"));
assert.ok(AiWorkspace.isForumRouteType("taolun"));
assert.ok(!AiWorkspace.isForumRouteType("video"));
assert.ok(!AiWorkspace.isForumRouteType("exercise"));

// 8. 写入回复框：成功要返回 true 并补 input 事件；失败要返回 false 且打出原因
const makeBox = () => {
  const box = Object.create(globalThis.HTMLTextAreaElement.prototype);
  box.events = [];
  box.dispatchEvent = (ev) => box.events.push(ev.type);
  return box;
};

const box = makeBox();
assert.strictEqual(fillForumReplyBox(box, "abc"), true, "正常写入应成功");
assert.strictEqual(box.value, "abc");
assert.deepStrictEqual(
  box.events,
  ["input"],
  "写完要补一个 input 事件（Vue 的 v-model 靠它）",
);

// 回归 v2.1.3 的真因：`box` 拿到的是 Utils.poll 的 `true`（不是元素），于是 box.xxx 全不是函数。
// 这种「拿错对象」必须返回 false 并打出原因——不能像 v2.1.2 那样静默 return false。
logs.length = 0;
assert.strictEqual(
  fillForumReplyBox(true, "abc"),
  false,
  "拿到的不是 textarea 时应返回 false",
);
assert.ok(
  logs.some((l) => /回复框写入失败/.test(l)),
  "写入失败必须打日志",
);

console.log(
  "OK: 讨论区清洗（换行 / 代码块 / Formal Response / 前缀 / 引号）、拒答标记识别、路由类型、" +
    "回复框写入（成功 + 拿错对象必须报错）均通过",
);
