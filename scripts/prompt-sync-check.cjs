// 断言 prompt 源文件与脚本内硬编码的 system 数组逐行一致（两份 prompt 都要过）：
//   SysPmt_Homework.md 的 <AI识图作业Prompt> 区块 ↔ Solver.buildPrompt()
//   SysPmt_Discussion.md 的 <AI讨论区Prompt> 区块 ↔ Solver.buildForumPrompt()
// 用法：node tmp/prompt-sync-check.cjs（文件路径按脚本所在目录解析，跟 cwd 无关）
const fs = require("fs");
const assert = require("assert");

// 路径一律按脚本所在目录解析：`node tmp/prompt-sync-check.cjs` 与 `cd tmp && node prompt-sync-check.cjs` 都能跑，
// 不依赖 cwd（其它自测也是 `__dirname + "/../"` 这个写法）。
const repoFile = (name) => __dirname + "/../" + name;
const js = fs.readFileSync(repoFile("yuketang-ComplexAutomation.user.js"), "utf8");

// 从脚本里取某个 build*Prompt() 的 system 数组（eval 成真正的字符串数组，与运行时同一份内容）
const codeLinesOf = (fnName) => {
  const m = js.match(
    new RegExp(
      `${fnName}\\(\\)\\s*\\{\\s*const system = \\[([\\s\\S]*?)\\]\\.join\\("\\\\n"\\);`,
    ),
  );
  assert(m, `未在 userscript 中找到 ${fnName}() 的 system 数组`);
  return eval("[" + m[1] + "]");
};

// 从 md 里取标记之间的正文，丢掉末尾空行
const mdBodyOf = (file, openTag, closeTag) => {
  const lines = fs.readFileSync(repoFile(file), "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => l.includes(openTag));
  const end = lines.findIndex((l, i) => i > start && l.includes(closeTag));
  assert(start >= 0 && end > start, `${file} 缺少 ${openTag} 区块`);
  const body = lines.slice(start + 1, end);
  while (body.length && body[body.length - 1].trim() === "") body.pop();
  return body;
};

const cases = [
  {
    file: "SysPmt_Homework.md",
    open: "<AI识图作业Prompt>",
    close: "</AI识图作业Prompt>",
    fn: "buildPrompt",
  },
  {
    file: "SysPmt_Discussion.md",
    open: "<AI讨论区Prompt>",
    close: "</AI讨论区Prompt>",
    fn: "buildForumPrompt",
  },
];

for (const c of cases) {
  const codeLines = codeLinesOf(c.fn);
  const mdBody = mdBodyOf(c.file, c.open, c.close);
  assert.deepStrictEqual(
    codeLines,
    mdBody,
    `${c.fn}() 与 ${c.file} 漂移：代码 ${codeLines.length} 行 / md ${mdBody.length} 行`,
  );
  console.log(`OK: ${codeLines.length} 行 prompt 与 ${c.file} 逐行一致`);
}
