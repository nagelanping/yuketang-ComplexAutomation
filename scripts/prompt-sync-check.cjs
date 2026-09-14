// 断言 prompt 源文件与脚本内硬编码的 system 数组逐行一致（两份 prompt 都要过）：
//   Prompt/Homework.md 的 <AI识图作业Prompt> 区块 ↔ Solver.buildPrompt()
//   Prompt/Discussion.md 的 <AI讨论区Prompt> 区块 ↔ Solver.buildForumPrompt()
// 用法：node scripts/prompt-sync-check.cjs（文件路径按脚本所在目录解析，跟 cwd 无关）
const fs = require("fs");
const assert = require("assert");

// 路径一律按脚本所在目录解析：`node scripts/x.cjs` 与 `cd scripts && node x.cjs` 都能跑，不依赖 cwd。
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

// 按标记找 Prompt/ 下的源文件，不写死文件名：改名或换目录都不会让这个守卫失效
// （这份文件名已经改过两次：SysPmt_Discussion → .md → Prompt/Discussion.md）。
const promptFiles = fs
  .readdirSync(repoFile("Prompt"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => "Prompt/" + f);
const fileOfMarker = (marker) => {
  const hits = promptFiles.filter((f) =>
    fs.readFileSync(repoFile(f), "utf8").includes(marker),
  );
  assert.strictEqual(
    hits.length,
    1,
    `Prompt/ 下应恰好有 1 个文件含 ${marker}，实际 ${hits.length} 个：${hits.join("、") || "无"}`,
  );
  return hits[0];
};

const cases = [
  { marker: "<AI识图作业Prompt>", fn: "buildPrompt" },
  { marker: "<AI讨论区Prompt>", fn: "buildForumPrompt" },
].map(({ marker, fn }) => ({
  file: fileOfMarker(marker),
  open: marker,
  close: marker.replace("<", "</"),
  fn,
}));

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
