# LOG

## 2026-09-13 工作包 A：删除 V2Runner 旧内容处理簇（AUDIT 1、8）

目标：删掉交棒重构前留在 `V2Runner` 里的同文档实现，让目录 Runner 只负责扫描、交棒与课堂/课件内联路径。

改动：

- `yuketang-ComplexAutomation.user.js`：删除 `handleVideo`、`playCurrentVideoUntilProgressDone`、`playAudioItem`、`playVideoItem`、`autoCommentItem`、`handleHomework`、`waitForMediaElement`（净减 453 行）。
- `AGENTS.md`：V2 执行模型一节改为「`V2Runner` 只做扫描 / 交棒 / 课堂课件内联」；常见坑里讨论区子项一条补上 `autoCommentItem` 已删除的现状。

验证：

```sh
rg -n 'handleVideo|playCurrentVideoUntilProgressDone|playAudioItem|playVideoItem|autoCommentItem|handleHomework|waitForMediaElement' yuketang-ComplexAutomation.user.js   # 无命中
node --check yuketang-ComplexAutomation.user.js
git diff --check
```

结果：语法检查与空白检查通过；`Utils.isProgressDone`、`Utils.getDDL`、`Player.isNearEnd/applyMediaDefault/playFromStart/startPlayback` 均仍有调用点，未产生新的死代码。

交棒回归（同日，`ykt-ff`，班级 31317597）：目录每轮只点一个未完成条目并交棒；新标签落 ai-workspace 并处理；处理完由 `returnToSource` 把目录导航回目录重扫；约 4 分钟内网页标签数恒为 2，无逐轮增长；`HANDOFF` 后目录未自我重载。工作包 A 完成。

附带发现（不在本工作包范围）：`autoCommentItem` 删除后，`autoComment` 开关不再对应任何发帖实现；开启时讨论子项仍会被交棒，新标签不处理该类型，空转 `maxAttempts` 后被 `FailGate` 跳过而条目永不完成。

## 2026-09-13 工作包 N：AI 拒答时通知来源目录跳过（机主实机提出）

问题：交棒进作业页后 AI 对某题 refuse，脚本只跳过该题；该作业已不可能刷完，但目录看不到，重扫把「进行中」当遗漏继续交棒，同一份作业重复进入 3 轮（FailGate 满）才跳过。

改动：`handoffKey`（`ykt_handoff_key`）交棒前写入 sessionStorage；`FailGate.markRefused/refused` 用哨兵 `-2`，子标签经 `window.opener.sessionStorage` 回写来源目录；`solveExerciseQuestion` refuse 分支调用它；`handleBatch` 扫描时跳过并打 warning；`boot()` 启动即清掉来源那份 key。

验证（待机主实机）：refuse 后目录应在同一轮跳过该子项（日志「…：AI 拒绝作答，已跳过（请人工处理）」），而不是再进 3 轮；无 opener 时退回原行为。

关键实机字段（记入 `OBSERVE.md`）：交棒子标签继承目录 sessionStorage 的拷贝且此后两边独立（同一 key 两边计数 3 / 2）；作业单题提交会回写（`isExerciseTabAnswered` 变真），目录状态则是服务端异步回写，3 轮后才翻成「已完成」；目录条目本身无 id 属性，`__vue__.$props.leaf.id` 与 ai-workspace URL 的 leaf id 一致。

## 2026-09-13 工作包 C：按 SystemPrompt.md 重新生成答题 prompt

机主改写了 `SystemPrompt.md`（示例 5 改为「访问链接后作答」，新增示例 6「访问链接失败 → refuse」）。按其正文重新生成 `Solver.buildPrompt()`：背景段补回 refuse 规则、Schema 含 `refuse` 且注明不输出 `answers`、示例 1–6 与之逐行对齐。

反向的一处（代码有、md 无）按原计划补回 md：`输出约束` 新增 reasoning / thinking 字段说明。

新增 `tmp/prompt-sync-check.cjs` 作最小自测：断言 md 正文与代码 `system` 数组逐行一致，本次结果 93 行一致；`node --check`、`git diff --check` 通过。

附带提醒（未改）：示例 5 与示例 6 前提都是「题目要求访问链接」，结论相反（5 是能答、6 是不能答），若所用模型没有联网工具，示例 5 可能诱导编造答案。

版本：`@version` 1.3.2 → **1.4.0**（死代码删除 + AI 拒答回写来源目录 + prompt 重建）。
