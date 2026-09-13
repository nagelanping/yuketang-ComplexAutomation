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

- 未提交改动属于机主，不覆盖、不还原、不混入本工作包。
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

- 若机主要求发布，由机主确定版本号；只修改 userscript 头部 `@version`。不要增加第二个硬编码版本。
- 若仓库中已有 `LOG.md`，记录目标、结果、验证命令和实机字段。当前仓库没有 `LOG.md` 时，不因单个工作包自行创建，除非机主要求。
- 完成后更新本文末尾的“完成记录”。提交说明用声明式表述。

## 工作包与状态

状态含义：`待办` 可以直接开始；`阻塞` 需要实机样本或机主决定；`可选` 不属于当前缺陷修复范围。

| 工作包                           |   AUDIT 项 | 状态 | 前置条件                                     |
| -------------------------------- | ---------: | ---- | -------------------------------------------- |
| A. 删除 V2Runner 旧内容处理簇    |       1、8 | 待办 | 可用的 V2 目录课程，完成后做交棒回归         |
| B. 删除失效配置并修 README       | 2、3、4、7 | 待办 | 无                                           |
| C. 同步答题 prompt               |          6 | 待办 | 可用的多模态 API 和真实题目用于 refuse 验证  |
| D. 让`Utils.poll()` 异常收敛   |          9 | 待办 | 无                                           |
| E. 修判断题文本回退              |         11 | 待办 | 无                                           |
| F. 显式区分答题提交结果          |         10 | 阻塞 | 先观测提交后的 DOM 回写                      |
| G. 确认七项以上选项边界          |         12 | 阻塞 | 找到选项数 ≥ 7 的真实题目或平台约束证据     |
| H. 修课件推进判定                |         13 | 阻塞 | 先确认课件是同页弹层还是新标签               |
| I. 修课堂媒体等待                |         14 | 阻塞 | 先确认课堂入口、iframe、`ended` 和标签行为 |
| J. 处理 Pro 路径与监听清理       |     15、17 | 阻塞 | 先确认`/pro/lms/*` 是否有用户级入口        |
| K. 确认完成度阈值                |         16 | 阻塞 | 取得临近完成时的目录和内容页状态样本         |
| L. 决定`gdufemooc.cn` 支持范围 |          5 | 阻塞 | 机主决定是否支持该站点                       |
| M. 可读性与仓库卫生              |     第五节 | 可选 | A–L 完成后仍有明确收益再做                  |

推荐顺序：A → B → C → D → E → F。G–L 按实机样本和机主决定解锁。M 不与缺陷修复混做。

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

## D. 让 `Utils.poll()` 异常收敛

### 修改范围

在 `Utils.poll()` 内捕获 `checker()` 抛出的异常，清理 interval，并按现有布尔接口 `resolve(false)`。不要在各调用点重复包 `try/catch`，也不要同时改为 reject，除非先逐个迁移所有调用方。

### 最小自测

至少覆盖三个结果：checker 成功返回 `true`、超时返回 `false`、checker 抛错后在有限时间内返回 `false`。可沿用 `tmp/decipherer-selftest.cjs` 的做法写一个最小 `assert` 自测，不引入测试框架。

再跑一次目录页基础流程，确认现有 `Utils.poll()` 调用没有因返回语义变化而中断。

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

## F. 显式区分答题提交结果

### 前置观测

在真实作业中记录点击提交前后：

- `AiWorkspace.isProblemSubmitted(...)`；
- `AiWorkspace.isExerciseTabAnswered(...)`；
- `AiWorkspace.isExerciseAnswered(...)`；
- 提交按钮是否消失、禁用或改文案；
- 状态回写所需时间；
- 单题与整份作业是否不同。

把结果写入 `OBSERVE.md` 后再设计返回语义。

### 修改范围

删除工作包 A 的死代码后，`autoSelectAndSubmit()` 应只剩当前 ai-workspace 调用链。使用显式结果，例如：

- `submitted`：达到实机确认的提交成功判据；
- `refused`：AI 明确拒答，保持不选、不提交和 10 秒等待；
- `incomplete`：缺选项、缺答案、缺输入框、缺提交按钮或提交后未达到确认条件。

调用方必须按结果决定继续、停止当前题目或返回未推进。不要把“找到并点击提交按钮”直接等同于“提交成功”，除非实机观测证明这是唯一可靠判据。不要恢复已删除的 V2 作业调用链。

### 验证

真实作业至少覆盖一次成功提交和一次人为制造的不完整路径。确认不完整路径不会被记成完成，成功路径不会重复提交，refuse 路径不选择答案。

## G–K. 由实机样本解锁的工作包

### G. 七项以上选项

没有真实样本时不改 `answerToIndices()` 的 A–F 边界。若确认平台允许七项以上选项，按实际 `optionCount` 生成可用字母并对越界值记 warning；若确认最多六项，只补一行边界注释。两种结论都写入 `OBSERVE.md`。

### H. 课件推进

先确认“查看课件”打开同页弹层还是新标签：

- 同页弹层：点击后轮询等待真实课件容器，再判断 PPT 或视频；只有确认出现并推进后才返回成功。
- 新标签：改走现有 `HANDOFF` 模型，不在目录文档查找媒体。

无论是哪种模式，`playPPTByNavigation()` 在既无页码指示器又无翻页按钮时都应立即记录 warning 并退出，不能运行到 `maxPages = 200`。在真实 PPT 上复测正常翻页路径。

### I. 课堂媒体等待

先确认 `iframe.lesson-report-mobile`、媒体元素、`ended` 事件和标签行为。若确认仍是同页媒体，为 `Player.waitForEnd(media)` 传入 `Utils.getDDL(media)` 产生的有限超时，超时返回未推进。若点击后新开标签，改用 `HANDOFF`，不要只给旧内联路径加超时。

### J. Pro 路径

- 有用户级入口：保留 `ProOldRunner` / `ProNewRunner`，保存 `Player.observePause()` 返回的 cleanup，并在切集、异常和循环结束时调用。`AGENTS.md` 继续说明 Pro 的持久化游标模型与 V2 的 DOM 进度模型有意不同。
- 确认无用户级入口：删除两个 Pro Runner、`start()` 的 Pro 分支、`Store.getProClassCount()` / `setProClassCount()` / `clearProClassCount()` 及 `pro_lms_classCount` key。隐藏 iframe 引用本身不足以证明有用户级入口。

不要在证据不足时把 Pro 改成 V2 模型。

### K. 完成度阈值

采集视频临近完成时内容页与目录页的状态，至少包含 `98%`、`99%` 或平台实际终值。样本不足时保持 `Utils.isProgressDone()` 与 `V2Runner.getCompletionState()` 两套口径。只有证据显示需要统一时，才抽取带原因注释的共享策略。

## L. `gdufemooc.cn` 支持范围

该项必须由机主决定：

- 需要支持：增加精确 `@match`，再分别验证 V2 与 Pro 路由、选择器和跨标签流程。
- 不支持：删除 `start()` 中两个 `gdufemooc.cn` 分支。

不要保留“路由分支存在但 userscript 不注入”的中间状态，也不要使用宽泛域名通配代替精确 `@match`。

## M. 可选整理

以下项目不是当前缺陷修复的前置条件，不与 A–L 混做：

- 将 `createPanel()` 内 CSS/HTML 提为同文件模块级常量；
- 让 `Solver.buildPrompt()` 直接返回字符串；
- 合并面板和 `Store.getAIConf()` 的重复默认 AI 配置；
- 清理 `.gitignore` 中确认不再使用的 `tmp/` 产物和空目录。

只有在能减少当前维护成本、且不扩大交付文件数量时再做。不要为整理新增模块系统或依赖。

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
- AI refuse 仍不选、不提交，记录 error 并等待 10 秒。

## 完成维护

完成任务后维护该文档，在已完成的对应条目下进行简要说明。
