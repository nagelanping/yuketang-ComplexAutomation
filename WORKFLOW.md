# AUDIT.md 修改落地流程

本文件把 `AUDIT.md` 的审查项拆成可执行工作包。未来 agent 每次只处理一个工作包；先确认审查结论仍适用于当前代码，再修改和验证。

## 资料与判定优先级

1. `OBSERVE.md`：已记录的雨课堂实机行为。涉及路由、DOM、点击结果、播放器或提交回写时，以这里的观测为准。
2. `FIREFOX.md`：`ykt-ff` 的操作方法和多标签限制。
3. `AGENTS.md`：当前架构、不变量、代码导航和文档维护要求。
4. `AUDIT.md`：问题、证据和建议。审查日期之后代码可能变化，不能把旧结论直接当成当前事实。
5. 当前源码：用符号搜索确认调用关系，不引用固定行号。

静态分析与实机观测冲突时，先复现实机结果并更新 `OBSERVE.md`。复现失败时保留原实现，写明“待验证”，不要按推测修改网页行为。

## 每个工作包的固定步骤

### 1. 建立基线

```sh
git status --short
rg -n '<本工作包涉及的符号>' yuketang-ComplexAutomation.user.js
```

- 未提交改动不覆盖、不还原、不混入本工作包。
- 阅读相关函数的所有调用点和相邻控制流。删除函数前确认全仓库只有定义、没有调用。
- `ref/` 只用于对照，不修改。
- 不新增构建系统、依赖或测试框架。主实现继续保持单文件交付。

### 2. 判断是否需要先做实机观测

以下改动必须先按 `FIREFOX.md` 实测：

- DOM 选择器、路由或点击后的导航方式；
- 课程目录、课堂、课件、Pro 页面和 ai-workspace 的推进方式；
- 媒体起播、暂停恢复、结束事件和进度回写；
- 作业提交后的 DOM 状态；
- 完成度阈值和选项数量上限。

观测至少记录：日期、脚本版本、页面路由、目标条目类型、操作前后 DOM/状态文本、是否新开标签、标签数变化。把结果写入 `OBSERVE.md` 对应路由；无法确认的部分仍标“待验证”。

多标签检测先运行 `ykt-ff tabs`。不要跨两次 `ykt-ff` 调用假定活动标签不变。需要“切标签后执行”时，使用 `FIREFOX.md` 规定的一次性 marionette 会话，并在结束后再次核对标签数。

### 3. 修改最小范围

- 优先删除已被现有路径替代的代码，不为假设中的以后保留开关或抽象。
- 共用问题在共用函数中修，不在每个调用点重复加保护。
- 不收窄 `AUDIT.md` 第四节列出的防御性逻辑，除非已有可复现反例。
- 行为、架构、路由、选择器、存储 key、AI 流程或核心符号变化时，同步更新 `AGENTS.md`。
- 新的网页观测同步更新 `OBSERVE.md`。用户操作方式变化时同步更新 `README.md`。
- `SystemPrompt.md` 是 prompt 源文本。修改 prompt 时，同次更新 `Solver.buildPrompt()`，两者不得漂移。

### 4. 验证并收尾

任何 JavaScript 改动都运行：

```sh
node --check yuketang-ComplexAutomation.user.js
git diff --check
```

再执行工作包指定的最小自测或实机回归。未完成必要验证时，不把工作包标为完成。

提交前检查：

```sh
git diff -- yuketang-ComplexAutomation.user.js README.md SystemPrompt.md AGENTS.md OBSERVE.md WORKFLOW.md
rg -n '@version|Config.version' yuketang-ComplexAutomation.user.js
```

- 版本号只修改 userscript 头部 `@version`。不要增加第二个硬编码版本。
- 若仓库中已有 `LOG.md`，记录目标、结果、验证命令和实机字段。当前仓库没有 `LOG.md` 时，不因单个工作包自行创建，除非要求。
- 完成后更新本文末尾的“完成记录”。提交说明用声明式表述。

## 工作包与状态

状态含义：`待办` 可以直接开始；`阻塞` 需要实机样本决定；`可选` 不属于当前缺陷修复范围。

| 工作包                           |   AUDIT 项 | 状态                 | 前置条件                                                |
| -------------------------------- | ---------: | -------------------- | ------------------------------------------------------- |
| A. 删除 V2Runner 旧内容处理簇    |       1、8 | 已完成               | 无                                                      |
| N. AI 拒答时通知来源目录跳过     |   实机提出 | 已改代码，待实机验证 | 需要一道会触发 refuse 的作业                            |
| O. 讨论区自动回复退回框架        |   实机提出 | 已完成               | 无                                                      |
| B. 删除失效配置并修 README       | 2、3、4、7 | 已完成               | 无                                                      |
| C. 同步答题 prompt               |          6 | 已完成               | 无                                                      |
| D. 让`Utils.poll()` 异常收敛   |          9 | 已完成               | 无                                                      |
| E. 修判断题文本回退              |         11 | 已完成               | 无                                                      |
| F. 显式区分答题提交结果          |         10 | 已改代码，待实机验证 | 真实作业跑一次成功提交 + 一次不完整路径                |
| G. 选项字母边界                  |         12 | 已完成               | 无（机主指示：按 A–Z 处理）                             |
| H. 课件推进判定                  |         13 | 保留现状             | 机主：当前可正常工作，需实机样本再改                    |
| I. 课堂媒体等待                  |         14 | 保留现状             | 机主：当前可正常工作，需实机样本再改                    |
| J. 处理 Pro 路径与监听清理       |     15、17 | 保留，待确认         | 机主 2026-09-13 决定：先保留，确认无 Pro 入口后再删      |
| K. 统一完成度阈值                |         16 | 已完成               | 无（机主指示：临近完成也算未完成）                      |
| L. `gdufemooc.cn` 支持范围      |          5 | 已完成               | 无（机主：MOOC 与雨课堂切割，不关注）                   |
| M. 可读性与仓库卫生              |     第五节 | 可选                 | A–L 完成后仍有明确收益再做                             |
| P. 审查发现的逻辑修正            |    审查批 | 已改代码，待实机验证 | 拒答条目在顶层目录的实机确认                            |

推荐顺序：A → B → C → D → E → F。G–L 按实机样本决定解锁。M 不与缺陷修复混做。

## A. 删除 V2Runner 旧内容处理簇

### 修改范围

删除以下无调用方法：

- `V2Runner.handleVideo`
- `V2Runner.playCurrentVideoUntilProgressDone`
- `V2Runner.playAudioItem`
- `V2Runner.playVideoItem`
- `V2Runner.autoCommentItem`
- `V2Runner.handleHomework`
- `V2Runner.waitForMediaElement`

保留 `openContentEntry`、`handleBatch`、`handleClassroom`、`handleCourseware` 和 `HANDOFF` 控制流。不要把媒体或作业处理移回 V2 目录文档。

同步修改 `AGENTS.md`：

- 删除“死代码仍保留”的说明；
- 明确 `V2Runner` 只负责目录扫描、交棒和仍经验证保留的内联课堂/课件路径；
- 从“代码导航”删除已不存在的符号，确认其余锚点仍可搜索。

### 验证

```sh
rg -n 'handleVideo|playCurrentVideoUntilProgressDone|playAudioItem|playVideoItem|autoCommentItem|handleHomework|waitForMediaElement' yuketang-ComplexAutomation.user.js AGENTS.md
node --check yuketang-ComplexAutomation.user.js
```

`rg` 应无旧符号命中。随后在 V2 目录页启动一次完整循环，确认：

1. 目录只点击一个未完成内容条目；
2. 新标签进入 ai-workspace；
3. 内容处理结束后目录标签被导航或重载并自动重扫；
4. `ykt-ff tabs` 显示标签数没有逐轮增长；
5. `HANDOFF` 后目录没有自行调用 `returnToList()`。

### 完成记录（2026-09-13）

已删除七个无调用方法，`yuketang-ComplexAutomation.user.js` 净减 453 行；`node --check`、`git diff --check` 通过，`rg` 对旧符号无命中（`AGENTS.md` 同步更新）。

`OBSERVE.md` 中提及 `playVideoItem`/`playAudioItem`/`autoCommentItem` 的两条旧观测保留原样：它们是带日期的实机记录，描述的是站点行为，不是当前代码。

交棒回归已于同日实机执行（`ykt-ff`，班级 31317597，脚本 v1.3.2）：目录每轮只点一个未完成条目并交棒；新标签落在 ai-workspace 并处理该知识点；处理完由 `returnToSource` 把目录标签导航回目录、重扫续行；连续观察约 4 分钟，网页标签数恒为 2（目录 + 一个执行标签），无逐轮增长；目录未在 `HANDOFF` 后自我重载（FailGate 计数跨重载累计到上限后跳过该子项，正常推进到下一子项）。

附带发现（不在本工作包范围，需决定）：`autoCommentItem` 删除后，`autoComment` 开关已没有任何发帖实现，开启时讨论子项只会空转 `maxAttempts` 轮后被跳过。

## B. 删除失效配置并修 README

### 修改范围

- 删除 `Config.aiMaxOutputTokens`。
- 删除 `Solver.buildSamplingParams()`。
- 删除 Chat Completions 和 Responses payload 中对 `buildSamplingParams()` 的展开。
- 不新增 `forceSamplingParams` 面板字段。
- 删除 `Decipherer.deobfEnabled`、`fontDisabled` 及依赖这两个常真值的条件分支；保留反混淆常开行为。
- 在代码附近保留一条简短注释：上游开关未移植，本脚本恒开反混淆。
- 按当前 UI 文本修正 README 中的 `模型设置`、`清除失败记录`、`开始`。
- README 改为说明反混淆常开且截图答题依赖它。
- 删除 README 中“内部强制采样参数开关”说明。

先搜索当前面板按钮文字，避免按 `AUDIT.md` 的旧快照覆盖后续改名。

### 验证

```sh
rg -n 'aiMaxOutputTokens|forceSamplingParams|buildSamplingParams|deobfEnabled|fontDisabled' yuketang-ComplexAutomation.user.js README.md
node --check yuketang-ComplexAutomation.user.js
```

预期没有上述失效符号。检查 `Decipherer.start()` 仍在顶层文档和 iframe 启动路径执行；不要把反混淆改成可关闭功能。

### 完成记录（2026-09-13）

全部按范围执行，另修一处同类漂移：日志里「请在 [AI配置] 中填写有效的 API Key」改成「[模型设置]」。

```sh
$ rg -n 'aiMaxOutputTokens|forceSamplingParams|buildSamplingParams|deobfEnabled|fontDisabled' yuketang-ComplexAutomation.user.js README.md
# 无输出（exit 1）
$ node --check yuketang-ComplexAutomation.user.js   # 通过
```

`Decipherer.start()` 仍在 `boot()` 的 iframe 分支与主文档分支各调用一次；`Decipherer` 少了两个常真字段后，
`main()` / `onRouteChange()` / MutationObserver 里的条件直接写死为常开，没有新增开关。

README 同步：反混淆标为常开且截图答题依赖（第 7 条）、面板按钮改为 `模型设置` / `清除失败记录` / `暂停`、
「默认不发送 temperature 和 top_p，除非内部强制采样参数开关被启用」改为「不发送 `temperature` 与 `top_p`，由服务商默认值决定」。

实机验证：纯删除 + 文案改动，反混淆与截图路径的实机表现不变；未单独跑 Firefox 复验。

## C. 同步答题 prompt

### 修改范围

以 `SystemPrompt.md` 为源：

- 把背景段的 `refuse` 规则写入 `Solver.buildPrompt()`；
- JSON Schema 加入 `refuse`，并注明 `type = refuse` 时不输出 `answers`；
- 把 refuse 示例写入代码 prompt；
- 把代码中 reasoning / thinking 字段说明补回 `SystemPrompt.md`；
- 核对现有示例文字，不顺手改写未涉及内容。

目标是两份 prompt 的有效正文逐字一致。`SystemPrompt.md` 外层的说明和 HTML 注释不属于下发正文。

### 验证

- 用当前多模态 API 跑一个可控的不可作答样本，例如明确乱码或要求访问不可用文件的题面。
- 期望模型最终返回 `{"type":"refuse"}`。
- 期望脚本记 error 日志，等待 10 秒，不选择、不提交，然后继续既定题目流程。
- 若服务商仍不返回 refuse，只记录实际响应和模型信息，不宣称 prompt 修复无效，也不扩大解析器规则猜测意图。

### 完成记录（2026-09-13）

已按 `SystemPrompt.md` 的正文重新生成 `Solver.buildPrompt()`：

- 背景段补回「无法作答时必须如实返回 refuse 结果」；
- JSON Schema 改为含 `refuse`，并加「type = refuse 时不输出 answers」；
- 补齐示例 4 / 5 / 6（本轮改写的新正文）；
- 原有示例 1 的 CoT 文字与 md 对齐；

方向相反的那一处，按原计划把代码里的说明补回了 md：`SystemPrompt.md` 的「输出约束」新增
「如果模型或服务端支持 reasoning / thinking 字段，可以在该字段内部推理；最终 content 仍必须只包含 JSON 对象。」
（若不需要这行，删 md 后同步删代码同位置即可）。

新增最小自测 `tmp/prompt-sync-check.cjs`：断言 md 正文（`<AI识图Prompt>` 区块内）与代码 `system` 数组逐行一致，
本次输出 `OK: 93 行 prompt 与 SystemPrompt.md 逐行一致`。改完 prompt 后跑一次即可拦住再次漂移。

模型实测（真实 refuse 返回）在自己的 API 与题目上做；脚本侧处理 refuse 的路径未改动。

## D. 让 `Utils.poll()` 异常收敛

### 修改范围

在 `Utils.poll()` 内捕获 `checker()` 抛出的异常，清理 interval，并按现有布尔接口 `resolve(false)`。不要在各调用点重复包 `try/catch`，也不要同时改为 reject，除非先逐个迁移所有调用方。

### 最小自测

至少覆盖三个结果：checker 成功返回 `true`、超时返回 `false`、checker 抛错后在有限时间内返回 `false`。可沿用 `tmp/decipherer-selftest.cjs` 的做法写一个最小 `assert` 自测，不引入测试框架。

再跑一次目录页基础流程，确认现有 `Utils.poll()` 调用没有因返回语义变化而中断。

### 完成记录（2026-09-13）

`Utils.poll()` 的 `setInterval` 回调里先把 `checker()` 包进 `try/catch`：`checker` 抛错时打印
`[poll] checker 抛错，按未满足返回 false: <err>`，`clearInterval` 后 `resolve(false)`，之后才走原有的
`if (done)` 与超时判定。没有改 reject，也没有在调用点补 `try/catch`。

最小自测 `tmp/poll-selftest.cjs`：直接从 userscript 抽出 `poll` 方法体执行（不与实现写两遍），覆盖四项——

```sh
$ node tmp/poll-selftest.cjs
OK: poll 的 true / 超时 false / 抛错 false + 定时器清理四项均通过
```

第四项额外断言抛错后 interval 已清理（100 ms 内不再有 tick），避免「已 resolve 但定时器仍在跑」。

语义变化的唯一分支是「checker 抛错」：原先 Promise 永不落定，现在立刻按未满足返回。各调用点拿到 `false` 后
走的都是「未确认…，本轮不推进」路径，靠 `FailGate` 封顶，不会形成新的重载循环。

目录页基础流程的实机复验（确认原有等待语义未变）由用户做。

## E. 修判断题文本回退

### 修改范围

只改 `Solver.parseAIAnswer()` 的非 JSON 判断题回退。先匹配明确否定，再匹配肯定；避免“不正确”“不是正确答案”命中“正确”。纯 JSON 路径保持不变。

### 最小自测

用 `assert` 覆盖：

- `正确`、`对`、`true`、`yes` → `对`；
- `错误`、`错`、`false`、`no` → `错`；
- `不正确`、`不对`、`不是正确答案` → `错`；
- 标准 JSON 输入不受影响。

不要扩大成自然语言分类器。发现无法可靠分类的新表达时记录样本，再补最小规则。

### 完成记录（2026-09-13）

`parseAIAnswer` 的判断题回退改为先否定后肯定，肯定词集合不变，否定侧随后按机主指示收敛为 `/不|错|false|no/i`。没有扩成分类器。

自测过程中发现同一段代码的第二个坑：裸 `true` / `false` 也是合法 JSON，`JSON.parse` 会成功但不带 `answers`，于是走 JSON 分支返回空 `answers`（原先表现为「未提取到答案」）。同一处收口：只有解析结果是对象时才走 JSON 分支，其余落到文本回退。这样「纯 JSON 路径」对真正的答案对象保持不变，裸布尔值改由文本回退判成对/错。

```sh
$ node tmp/parse-answer-selftest.cjs
OK: 判断题回退 6 例肯定 / 8 例否定均正确，JSON 与其他题型回退未变
```

自测覆盖四组：肯定（`正确`/`对`/`true`/`yes`/`TRUE`/`答案为：正确`）、否定（`错误`/`错`/`false`/`no`/`不正确`/`不对`/`不是正确答案`）、JSON（含 ``` 围栏、无 `type` 时沿用传入题型、`refuse`）、其他题型回退（choice 取字母、fillblank 切分）。

### 追加（2026-09-13）

两处按同一规则收口：

1. 否定标记统一为「不」（`/不|错|false|no/i`），不再逐个列举 `不正确` / `不对` / `不是`——凡是句子里出现「不」都按否定处理。
2. `answerToIndices()` 的 `truefalse` 分支同样改为先否定后肯定：原先 `answers:["不正确"]` 会命中「对」映射到选项 0，现在映射到 1。该函数是 JSON 路径上的选项映射，本次改动只影响「答案文本含否定词」这一种输入，`A` / `B` / `对` / `错` 的映射不变。

自测同时覆盖两个函数：`parseAIAnswer` 的肯定 / 否定 / JSON / 其他题型，`answerToIndices` 的选项映射（肯定与否定各一组）。

## F. 显式区分答题提交结果

### 前置观测

在真实作业中记录点击提交前后：

- `AiWorkspace.isProblemSubmitted(...)`；
- `AiWorkspace.isExerciseTabAnswered(...)`；
- `AiWorkspace.isExerciseAnswered(...)`；
- 提交按钮是否消失、禁用或改文案；
- 状态回写所需时间；
- 单题与整份作业是否不同。

前置观测已于 2026-09-13 完成，结论记在 `OBSERVE.md` 作业页的「提交回写、目录状态与跨标签会话」一节：单题提交后 `isProblemSubmitted` / `isExerciseTabAnswered` 会变真（脚本随后几轮日志里的「已提交，跳过」即由此而来），而**整份作业的目录状态是服务端异步回写**，会晚于内容页，窗口期内目录仍显示「进行中」。因此 `submitted` 的判据用现有谓词（轮询已答/已提交）是可行的，但不要用它去断言「目录已翻成完成」。

### 修改范围

删除工作包 A 的死代码后，`autoSelectAndSubmit()` 应只剩当前 ai-workspace 调用链。使用显式结果，例如：

- `submitted`：达到实机确认的提交成功判据；
- `refused`：AI 明确拒答，保持不选、不提交和 10 秒等待；
- `incomplete`：缺选项、缺答案、缺输入框、缺提交按钮或提交后未达到确认条件。

调用方必须按结果决定继续、停止当前题目或返回未推进。不要把“找到并点击提交按钮”直接等同于“提交成功”，除非实机观测证明这是唯一可靠判据。不要恢复已删除的 V2 作业调用链。

### 验证

真实作业至少覆盖一次成功提交和一次人为制造的不完整路径。确认不完整路径不会被记成完成，成功路径不会重复提交，refuse 路径不选择答案。

### 改动记录（2026-09-13，待机主实机验证）

结果词表照文档实现，第三态取名为 `filled`（选中/填好并**点了**提交），把「点了提交 = 提交成功」这个断言留到调用方用实机判据复核：

```
Solver.autoSelectAndSubmit() ->  refused    AI 拒答（不选、不提交、等 10 秒）
                                incomplete 缺选项容器 / 无有效选项 / 填空无答案 / 找不到提交按钮
                                filled    已填写并点击提交按钮
```

`AiWorkspaceRunner.solveExerciseQuestion(root, label, tab, index)` 按结果分流：

- `refused`：原样（error 日志 + 10 秒 + `FailGate.markRefused`），返回 `false`；
- `incomplete`：打 warning「未能填写或提交（…），本轮记未推进」，返回 `false`（不再当成完成）；
- `filled`：用实机观测确认的判据复核——`Utils.poll(() => this.isExerciseQuestionSubmitted(root, tab, index, true), { interval: 500, timeout: 8000 })`。确认到才返回 `true`；8 秒内没等到回写则打 warning「提交后未确认到已提交回写，本轮记未推进」并返回 `false`。

`tab` / `index` 由 `handleExercise` 的题号列表循环传入；无题号列表的那条路径没有 tab，退回 `isExerciseAnswered()` 这个纯 DOM 判据（`OBSERVE.md` 只确认了 `isProblemSubmitted` / `isExerciseTabAnswered` 会回写，DOM 判据未单独抽样）。

`handleExercise` 现在收集每题结果：只要有一题没确认提交成功，就返回 `false`（日志变成「当前项未能确认完成，仍继续下一项」，后续流程不变，仍会 `returnToSource` 重载目录，由目录重扫 + FailGate 兜底）。

待实机确认两点：

1. 正常作业逐题提交后不再出现「提交后未确认到已提交回写」；出现即说明 8 秒窗口或判据选得不对，需按 `OBSERVE.md` 补样本。
2. 无题号列表的单题页面提交后是否也能被 `isExerciseAnswered()` 确认；确认不到会退化成每题都报未推进（不误标完成，但日志会变吵）。

## G–K. 由实机样本解锁的工作包

### G. 选项字母边界

原计划：没有真实样本时不改 `answerToIndices()` 的 A–F 边界。

**机主指示（2026-09-13）：直接按 A–Z 处理**，不要求先取证最多几项。已改为模块级 `OPTION_LETTERS`（A–Z），
映射按实际 `optionCount` 过滤，越界字母打 warning。非 JSON 回退取字母改用 `\b[A-Z]\b`，
避免把英文解释里的词内字母当成选项（`AB` 连写不再拆分，多选走 JSON 数组）。

### H. 课件推进

先确认“查看课件”打开同页弹层还是新标签：

- 同页弹层：点击后轮询等待真实课件容器，再判断 PPT 或视频；只有确认出现并推进后才返回成功。
- 新标签：改走现有 `HANDOFF` 模型，不在目录文档查找媒体。

无论是哪种模式，`playPPTByNavigation()` 在既无页码指示器又无翻页按钮时都应立即记录 warning 并退出，不能运行到 `maxPages = 200`。在真实 PPT 上复测正常翻页路径。

**机主答复（2026-09-13）：当前实现可以正常工作，先不动。** 需要实际检测才能定更细的推进判据；另外大小目录结构因具体课程而异，不能按单一结构改判定。维持现状，等真出现课件不推进的实机样本再开工。

### I. 课堂媒体等待

先确认 `iframe.lesson-report-mobile`、媒体元素、`ended` 事件和标签行为。若确认仍是同页媒体，为 `Player.waitForEnd(media)` 传入 `Utils.getDDL(media)` 产生的有限超时，超时返回未推进。若点击后新开标签，改用 `HANDOFF`，不要只给旧内联路径加超时。

**机主答复（2026-09-13）：当前实现可以正常工作，先不动**，同样需要实机检测才能定。

### J. Pro 路径

- 有用户级入口：保留 `ProOldRunner` / `ProNewRunner`，保存 `Player.observePause()` 返回的 cleanup，并在切集、异常和循环结束时调用。`AGENTS.md` 继续说明 Pro 的持久化游标模型与 V2 的 DOM 进度模型有意不同。
- 确认无用户级入口：删除两个 Pro Runner、`start()` 的 Pro 分支、`Store.getProClassCount()` / `setProClassCount()` / `clearProClassCount()` 及 `pro_lms_classCount` key。隐藏 iframe 引用本身不足以证明有用户级入口。

不要在证据不足时把 Pro 改成 V2 模型。

**机主答复（2026-09-13）：雨课堂的迭代比较奇怪，目前没发现 Pro 路径的入口；最近一次迭代新增的是 ai-workspace。**
这仍是「未发现」而非「确认没有」，`OBSERVE.md` 里 V2 页面也确实还藏着指向 `/pro/lms/*/studycontent` 的隐藏 iframe。
**机主决定（2026-09-13）：先保留，等确认无入口后再删。** Pro 路径与 `pro_lms_classCount` 游标原样留着，
本工作包的 cleanup 修复（AUDIT 15）与游标模型（AUDIT 17）也暂不做；等哪天在实机确认 `/pro/lms/*` 没有用户级入口，再一次性删除。

### K. 完成度阈值

采集视频临近完成时内容页与目录页的状态，至少包含 `98%`、`99%` 或平台实际终值。样本不足时保持 `Utils.isProgressDone()` 与 `V2Runner.getCompletionState()` 两套口径。只有证据显示需要统一时，才抽取带原因注释的共享策略。

**机主指示（2026-09-13）：临近完成也当作未完成。** 据此统一阈值——`Utils.isProgressDone()` 去掉 `98%` / `99%`，
只留 `100%` / `已完成`，与 `V2Runner.getCompletionState()`（原本就只认 100%）一致。没有为「统一」新抽共享策略：
两处选择器与调用点仍分开，只统一判定标准。

## L. `gdufemooc.cn` 支持范围

该项必须由机主决定：

- 需要支持：增加精确 `@match`，再分别验证 V2 与 Pro 路由、选择器和跨标签流程。
- 不支持：删除 `start()` 中两个 `gdufemooc.cn` 分支。

不要保留“路由分支存在但 userscript 不注入”的中间状态，也不要使用宽泛域名通配代替精确 `@match`。

**机主决定（2026-09-13）：MOOC 与雨课堂切割，不关注 MOOC。** 已删除 `start()` 里两处 `gdufemooc.cn` 分支，
`start()` 现在只认 `yuketang.cn/v2/web`、`yuketang.cn/pro/lms` 与 ai-workspace 路由；未加任何 `@match`。

## M. 可选整理

以下项目不是当前缺陷修复的前置条件，不与 A–L 混做：

- 将 `createPanel()` 内 CSS/HTML 提为同文件模块级常量；
- 让 `Solver.buildPrompt()` 直接返回字符串；
- 合并面板和 `Store.getAIConf()` 的重复默认 AI 配置；
- 清理 `.gitignore` 中确认不再使用的 `tmp/` 产物和空目录。

只有在能减少当前维护成本、且不扩大交付文件数量时再做。不要为整理新增模块系统或依赖。

## N. AI 拒答时通知来源目录跳过（机主实机提出）

### 背景

实机观察：交棒进作业页后 AI 对某题返回 `refuse`，脚本按设计只跳过该题（不选、不提交、继续下一题）。
该作业因此不可能被脚本刷完，但目录侧看不到这一点，重扫时仍把「进行中」当作遗漏，继续交棒，同一份作业被重复进入 3 轮（FailGate 满 `maxAttempts`）才跳过。

### 修改范围

- `Config.storageKeys.handoffKey`：新增 `ykt_handoff_key`。
- `V2Runner.openContentEntry()`：点击前把本次条目的 FailGate key 写入 sessionStorage，供子标签继承。
- `FailGate.markRefused(key)` / `refused(key)`：哨兵 `-2`（与 `skip` 的 `-1`、失败计数的正数区分）。
  子标签经 `window.opener.sessionStorage` 回写来源目录（sessionStorage 是拷贝，写自己那份目录读不到）。
- `AiWorkspaceRunner.solveExerciseQuestion()`：refuse 分支调用 `markRefused`，并记一条「已通知来源目录」日志。
- `V2Runner.handleBatch()`：扫描时对 `refused` 的子项打 warning 并跳过。
- `boot()`：子标签启动即清掉来源目录那份 `ykt_handoff_key`，避免之后从目录手动打开的标签误用上一个 key。

### 验证（机主实机）

1. 目录页启动，交棒进一道**会触发 refuse** 的作业；子标签日志出现「无法作答，已跳过并继续下一题」与「已通知来源目录跳过该条目」。
2. 子标签返回目录后，目录**同一轮**即打「`{标题}：AI 拒绝作答，已跳过（请人工处理）」并推进到下一子项，而不是再进同一作业 3 轮。
3. 反例：用户直接在本页启动（无 opener）时，refuse 只跳过当前题目，目录行为保持原样。

## 回归清单

涉及 V2、ai-workspace、Player、FailGate 或答题流程时，按改动范围选择检查：

- V2 目录只处理第一个未完成项，`HANDOFF` 后立即停止目录 runner。
- 新标签完成后回到原目录，目录重载并按服务器 DOM 重扫。
- 多轮后标签数近似稳定，没有每轮新增残留标签。
- `pendingAutoStart` 仍只记录恢复来源，TTL 仍大于单条目播放上界。
- `autoAI === false` 时作业被有意跳过，媒体继续处理。
- `FailGate.bump/reset/skip/exhausted` 的职责未混用。
- ai-workspace 未知路由仍跳过并继续 `autoSelect()`。
- 媒体继续通过 `Player.prepareMedia()` 执行“真实静音后冻结”，`findPlayButton()` 不重新包含提示或音量图标。
- iframe 中仍启动 `Decipherer`，截图 `onclone` 仍使用显式 CJK 字体并跳过 MathJax/KaTeX。
- AI refuse 仍不选、不提交，记录 error 并等待 10 秒；随后经 `window.opener.sessionStorage` 把来源目录里该条目标成 `-2`（目录重扫时跳过，见工作包 N）。

## O. 讨论区自动回复退回框架（机主实机提出）

机主指示：自动回复图文与讨论区的具体代码删掉，只留框架并注释，未来结合 `askAI` 做回复。

### 修改范围

- 删除 `Store.getFeatureConf()` 的 `autoComment`、面板勾选框「自动回复图文与讨论区」及其读取/保存/`ui` 引用。
- `V2Runner.handleBatch` 的讨论区分支去掉开关条件：`taolun` / `forum` 子项一律就地 `FailGate.skip` 并记日志，不交棒。
- 在该分支上方留注释写清未来接 `askAI` 的流程（新标签读主题与楼层 → `askAI` 生成回复 → 填框提交 → `returnToSource`），并注明 `askAI` 目前只吃题目截图、需先扩展文本入参。
- `README.md` 同步：功能列表说明讨论区自动回复尚未实现，「模型设置」不再列该开关。

### 验证

```sh
rg -n 'autoComment|feature_auto_comment|featureAutoComment' yuketang-ComplexAutomation.user.js README.md
node --check yuketang-ComplexAutomation.user.js
```

预期 userscript 与 README 无命中；`node --check` 通过；面板「自动化功能」只剩「自动作答作业与题目」，HTML 结构仍闭合。

### 完成记录（2026-09-13）

按范围执行：开关、面板勾选框与 `ui` 引用全部删除，讨论区分支改为无条件跳过，框架注释落在该分支上方。

```sh
$ rg -n 'autoComment|feature_auto_comment|featureAutoComment' yuketang-ComplexAutomation.user.js README.md
# 无输出（exit 1）
$ node --check yuketang-ComplexAutomation.user.js   # 通过
```

开关删除后，讨论区子项的行为不再取决于用户配置：一律 `FailGate.skip` + warning 日志，`handleBatch` 的返回语义（`return true`）与 v1.2.3 的关闭态一致。

未跑 Firefox 复验：改的是跳过分支与面板结构，需机主在实机确认面板显示与讨论子项日志。

## P. 子代理审查发现的一批逻辑修正（机主指示：一起修）

审查范围：全文静态审查（高/中/低共 12 条）。本次修其中 6 条机械性缺陷，其余 6 条按结论保留或待实机。

### 修改范围

1. **拒答哨兵只有批次路径会读（高，工作包 N 的半成品）**：`V2Runner.run()` 的顶层扫描补上 `refused(-2)` 分支——打 `{标题}：AI 拒绝作答，已跳过（请人工处理）` 后 `skip(key)` 降级，`skippedInPlace++` 后 `continue`。`FailGate.bump` 遇到负数哨兵原样返回，避免 `openContentEntry` 的 `bump` 把 `-2` 加成 `-1`（把「拒答」改写成「主动跳过」）。`handleBatch` 的同类分支也补 `skip` 降级与 `continue`。
2. **交棒条目计数只增不减（中）**：新增 `FailGate.markProgress(key)`（走与 `markRefused` 同一个 `_writeToOpener`），`AiWorkspaceRunner.run()` 在 `handleMedia` / `handleExercise` 确认做成时清掉来源目录的计数；`progressed` 与 `ok` 分开，未知类型分支只 `ok = true`、不报进展，否则目录会为它反复交棒。
3. **跨课堂的 `pendingAutoStart` 串味（中）**：`Store.setPendingAutoStart` 在换课堂且本次没有新目录地址时直接返回，不覆盖旧记录。
4. **「开始」没有运行态闸门（中）**：`invokeStart()` 加 `running` 标志，重复点击只打一条「已在运行中，忽略重复启动」；`resetStartButton()` 放开。
5. **`askAI` 的两个死参数（中）**：签名改回 `askAI(imageDataUrl)`，去掉调用点的 `optionCount` / `questionType` 实参（函数体从未读取，prompt 也不接收）。
6. **`handleBatch` 里不可达的 `taolun` 条件（低）**：内容子项判断里删掉 `tagHref.includes("taolun")`（讨论区已在前面拦截并 return）。

### 未修（结论）

- **`handleClassroom` 的 `waitForEnd` 无超时（高）**：属工作包 I，机主已定「当前可正常工作，需实机检测」。
- **`dispatchUserLikeClick` 连发两次 click（中，疑似）** 与 **`findPlayButton` 首选 `.play-btn-tip`（中，疑似）**：要先在实机确认站点播放键是不是 toggle、`.play-btn-tip` 在 ai-workspace 里是否 `xt-tip`，不能按静态推断改。
- **`isProgressDone` 与 `getCompletionState` 差一个「已读」（低偏中）**：口径按机主指示统一为「只认 100% / 已完成」，「已读」是图文类状态文案，视频路径不会出现；保持现状并记在文档里。
- **`getSlideReadStatus` 子串匹配未读（低，疑似）** 与 **`originalTextSnapshots` 只写不清（低，疑似）**：需实机样本，暂不动。
- **两个 Pro Runner 对 `pro_lms_classCount` 差 1（低，疑似）**：属工作包 J，机主已定先保留。

### 验证

```sh
node --check yuketang-ComplexAutomation.user.js
node tmp/failgate-selftest.cjs   # 新增：计数 / 跳过哨兵 / 拒答哨兵 / 进展清零 / 无 opener 静默
node tmp/parse-answer-selftest.cjs
node tmp/poll-selftest.cjs
node tmp/prompt-sync-check.cjs
git diff --check
```

实机待验（机主）：拒答条目在**顶层**（不是批次内）也应只被提示一次并跳过；长作业在服务端状态回写期间不再被 `maxAttempts` 提前跳过。

### 复查与回修（2026-09-13，子代理复看 `23c86ce`）

复查结论：上面 6 条里 4 条可信（拒答链、`bump` 守卫、`ts` 续约、两处清理），有 2 条引入了新缺陷，另 1 条只堵了一半根因。已回修：

1. **`markProgress` 判据过宽（新引入，会造成无限交棒）**：`progressed = ok`，而 `handleExercise` 在「`autoAI` 关闭」「题号列表为空」「题面读不到」这些**什么都没做**的路径上也返回 true，于是目录计数被清掉、`exhausted` 永不成立。现在 `handleExercise` 用 `didWork && allSubmitted` 收口（只有真遇到「已提交」或成功作答的题才算），`!autoAI` 直接返回 false。
2. **`running` 闸门无兜底解锁（新引入，会把用户锁在面板上）**：早期只有 `resetStartButton()` 放开闸门，而 `HANDOFF` 之后 Runner 已经 `return`、目录只是空闲等待，用户想手动重开却被「已在运行中」挡住（`handleClassroom` 的 `waitForEnd` 挂起时尤其致命）。现在 `runRoute()` 加了 `.finally(() => panel.releaseStart())`：这一轮 Runner 结束就放开闸门，但不动按钮文案（仍是「运行中」）。
3. **`getReturnUrl()` 的读侧后门**：写侧成对之后，读侧仍有一条「V2 内容页直接返回 `pending.returnUrl`、不校验 classroomId」的分支。现在只要路由给得出课堂 id 就必须与 `pending` 一致。`boot()` 里 `isV2ContinuationPage` 的自动恢复判据没动，属同一类问题的残留（需实机样本再定）。
4. **`_writeToOpener` 只把取值包在 try 里**：`markProgress` 挂在 `autoSelect()` 之前，opener 正在导航时 `getItem/setItem` 抛错会逃出 `run()`、目录永久停等。现在整个读写都在同一个 try 内。
5. **拒答标记不再降级成 `-1`**：降级会丢掉信息，导致终结日志把「有题目需人工处理」说成「课程已全部完成」。改为模块级 `refusedWarned` Set 保证只提示一次，并新增 `refusedSeen` 计入 `遍历结束：…请手动检查`。

回修后 `node --check`、`tmp/failgate-selftest.cjs`、`tmp/parse-answer-selftest.cjs`、`tmp/poll-selftest.cjs`、`tmp/prompt-sync-check.cjs`、`git diff --check` 全部通过。

### 第二轮复查与回修（2026-09-13，子代理复看 `e27e631`）

复查确认「`markProgress` 判据收口、`getReturnUrl` 收紧、`_writeToOpener` 全包 try」三条成立，但上一轮「拒答标记不降级」改出了第三轮缺陷，已回修：

1. **顶层拒答项把目录打进无限重载（严重）**：该分支保留了 `skippedInPlace++`，于是每轮收尾都走「原地跳过 N 项 → `location.reload()`」，而拒答标记每轮都会再次命中同一分支——循环重载、永不收尾，且收尾那条 `refusedSeen` 日志恰好因此不可达。现在拒答项**只计入 `refusedSeen`**，不再计 `skippedInPlace`。
2. **提示去重只在单页有效（中）**：`refusedWarned` 是模块级 Set，目录每轮交棒都会整页导航回来、Set 随 document 重建，警告仍会一轮刷一次。改为 `FailGate.warnedRefused()` / `markRefusedWarned()`，落在 sessionStorage 的 `ykt_refused_warned`（`clear()` 一并清掉）。
3. **`boot()` / `start()` 的 V2 内容页自启动仍不校验课堂（中）**：`getReturnUrl()` 收紧后，跨课堂的脏 pending 会让本页自己起 Runner，而 `getReturnUrl()` 返回空 → 它转而在本页逐叶推进。两处判据都补上「课堂 id 两边都取得到时必须一致」。

另有一处**有意保留**并写进 `AGENTS.md`：闸门放开后，交棒窗口内手动再按「开始」不会被挡（会重派发同一条目）。这是为保住手动恢复能力付的价，要堵它需要「在等新标签」状态 + 超时，属实机验证后再定。

`tmp/failgate-selftest.cjs` 扩到六项：新增「拒答提示跨页面重建仍去重、重复标记不重复入表、`clear()` 一并清掉」。

### 第三轮复查与回修（2026-09-13，子代理复看 `d762905`）

复查确认核心方向（拒答不计 `skippedInPlace`、去重落 sessionStorage）成立，又找出四处：

1. **`start()` 里我加的课堂判据是死代码（高）**：`start()` 开头已经 `const aiRoute = AiWorkspace.getRoute(); if (aiRoute) {…return;}`，而 `AiWorkspace.getRoute()` 内部就兜底调用了 `getGenericV2ContentRoute()`；两次调用之间没有 await/DOM 变更，所以后面 v2 分支里的 `contentRoute` 恒为 null——整段「检测到 V2 内容页，接管处理」都不可达。已整段删除并留注释说明真正的入口是上面的 `aiRoute` 分支。
2. **批次内拒答不进 `refusedSeen`（高）**：`handleBatch` 的拒答子项只打 warning + `continue`，父批次仍被 `skip(-1)`；当它是最后一项时收尾会打「课程已全部完成」，与同一轮刚打的「AI 拒绝作答」自相矛盾。现在 `handleBatch` 统计 `refusedSubs`，收尾时把父批次 key 用新增的 `FailGate.markRefusedLocal()` 标成 `-2`（目录自己那份表，不走 opener），顶层重扫即计入 `refusedSeen`。
3. **`warnedRefused` 未包 try（中低）**：sessionStorage 不可用时异常会冒泡、整轮目录扫描停摆；现在读、写各自包 try（最坏只是提示重复）。
4. **自测没覆盖真实 key 名（低）**：桩里写死了 `failCounts`，`refusedWarned` 缺失导致实际读写字面量 `"undefined"`。现在从源码里正则取真实 key 名，并补 `markRefusedLocal` 与 `clear()` 清对 key 的断言。

### 第三轮未修（结论）

- **`boot()` 判据在「本页取不到课堂 id」时失效**（`/v2/web/xcloud/...` 的 id 只在路径里，`getCurrentClassroomId()` 不覆盖，而 `getRoute()` 的 xcloud 分支只读 query）：此时 `sameClassroom` 为真、`getReturnUrl()` 的校验也被跳过，理论上仍可能导航去别的课堂的目录。**不按猜测补正则**——`{id}` 是否等于 classroom id 没有实机样本，猜错会把合法续跑挡掉（比现在的风险更大）。留待实机取一条 xcloud URL 样本，见 `OBSERVE.md` 待验证清单。
- **`markProgress` 不清「已提示」标记**：同一 key 先拒答（提示过）→ 后来进展 → 再拒答时不再提示。属可接受语义（提示过一次即知情），且子标签不该代写目录的提示表。
- **交棒窗口内手动再按「开始」会重派发**：与第二轮同一取舍，已写进 `AGENTS.md`。
## 完成维护

完成任务后维护该文档，在已完成的对应条目下进行简要说明。
