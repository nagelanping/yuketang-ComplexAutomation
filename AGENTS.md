# AGENTS.md

本文件为编码代理提供本仓库的项目专属规则。

先按需阅读以下 `.md` 文档了解具体情况：

- `OBSERVE.md`：雨课堂**实机行为记录**（按路由分节）。涉及网页行为的判断以它为准，新观测回填这里。该文件被 `.gitignore` 忽略，属本地工作笔记。
- `FIREFOX.md`：人机协同的 Firefox 实机检测方法（`ykt-ff` CLI 用法与注意）。
- `AUDIT.md`：阶段性审查报告与修改建议。
- `WORKFLOW.md`：按照 `AUDIT.md` 进行代码修改的流程。需要根据进展进行维护。
- `LOG.md` ：简要记录每次任务，包含目标、结果、关键字段/行为发现记录。
- `AGENTS.md`：本文件。任务完成后按需维护对应区域。

## 项目

雨课堂复合自动化 userscript，单文件交付：

- 主源码：`yuketang-ComplexAutomation.user.js`
- AI 答题的 prompt 源（无需查看）：`SystemPrompt.md`
- 仅作参考的代码：`ref/`

userscript 以 IIFE 形式在 `*.yuketang.cn` 页面以 `@run-at document-start` 运行。
无构建系统、包管理器、测试框架或生成产物。
开发方式就是直接编辑 `.user.js` 文件，并在浏览器 userscript 管理器中验证。

不得把 `ref/` 当作项目源码修改。它只是审计/对比材料。

## 必查项

- JS 编辑后做语法检查：
  `node --check yuketang-ComplexAutomation.user.js`
- 运行时验证靠手动：
  在脚本管理器中安装/更新 userscript，打开雨课堂课程目录页，从脚本面板启动，同时检查浏览器 Console 与面板日志。
- 实机页面检测（agent 驱动）：持久 GUI Firefox profile 位于 `/home/Si/.ykt-firefox`（登录/cookies 跨重启保留），在 `127.0.0.1:2828` 暴露 marionette。用 `ykt-ff-start` 启动，用 `ykt-ff` 驱动（`eval`、`evalf`、`open`、`url`、`title`、`html`）。用户在可见窗口里登录；agent 通过 CLI 读取 DOM/网络状态。
  多标签时 `ykt-ff` 只作用于活动标签，先 `ykt-ff tabs` 看清、再 `ykt-ff tab <idx>` 切换；句柄顺序在不同会话间不稳定，`tab <idx>` 可能落到 `(privileged)` 窗口并报 `ExecuteScript ... not supported for privileged browsing contexts`。细节见 `FIREFOX.md`。

若某次任务只改了文档或 prompt，请说明 `node --check` 是否没有必要。

## 版本管理

唯一对外发布的版本来源是 userscript 头部：

- 关键词：`@version`
- `Config.version` 读取 `GM_info.script.version`
- 不得在其他地方硬编码第二个版本
- `ref/` 内的版本与此无关

## 代码导航

用搜索关键词而非固定行号。

常用锚点：

- 头部/版本/连接：
  `@version|@connect|@require`
- 启动链：
  `function boot|function start|function createPanel`
- 核心单例：
  `const Config|const Utils|const Store|const FailGate|const PauseGate|const StopGate|const Player|const AiWorkspace|const Solver|const Decipherer`
- 路由 runner：
  `class V2Runner|class ProOldRunner|class ProNewRunner|class AiWorkspaceRunner`
- ai-workspace 叶子遍历：
  `autoSelect|handleNext|getAllScourse|_lastAdvanceIndex|nav-item-leaf-box`
- V2 遍历与返回行为：
  `async run\\(\\)|returnToList|openContentEntry|HANDOFF|handleBatch|handleClassroom|handleCourseware`
- 完成状态逻辑：
  `getCompletionState|isProgressDone|statistics-box \\.aside`
- FailGate 用法：
  `FailGate\\.|ykt_fail_counts|clearPendingAutoStart`
- AI 答题管线：
  `captureQuestionImage|askAI|autoSelectAndSubmit|detectQuestionType|getOptionElements|buildPrompt|exerciseFingerprint|exerciseQuestionStillShown|advanceExerciseQuestion|hasExerciseSubmitControl`
- 题目文档与 iframe 跨越：
  `getExerciseDocument|getExerciseQuestionTabs|getExerciseQuestionBody|iframeExerciseId`
- Pro 旧版游标与路由：
  `getProClassCount|setProClassCount|clearProClassCount|pro_lms_classCount`
- 等待原语与本地自测：
  `Utils.poll`、`node tmp/poll-selftest.cjs`、`node tmp/parse-answer-selftest.cjs`、`node tmp/prompt-sync-check.cjs`、`node tmp/failgate-selftest.cjs`、`node tmp/advance-selftest.cjs`、`node tmp/exercise-end-selftest.cjs`、`node tmp/exercise-answered-selftest.cjs`、`node tmp/stop-selftest.cjs`（`tmp/` 被 gitignore，只是本地脚本）

写项目文档或解释时，引用这些关键词/命令，不要引用行号。

代码改动后若出现新的核心符号或路由，在同一次改动中更新上面的锚点列表。

## 架构

启动链：

`boot()` -> 跳过 iframe -> `createPanel()` -> 加载 `pendingAutoStart` -> `start()` 路由分发。

`createPanel()` 里 `invokeStart()` 带一个 `running` 闸门：连点「开始」或在 1.2 秒自动恢复窗口内手点，都只会启动一个 Runner（否则同一目录并发跑两份，同一条目点两次、开两个标签、FailGate 计数双份）。闸门由 `resetStartButton()` 与 `runRoute()` 的 `.finally(() => panel.releaseStart())` 放开——**必须保留后者**：`HANDOFF` 之后目录处于「等新标签回跳」的空闲态，`releaseStart()` 不动按钮文案（仍显示「运行中」）但让用户还能手动再点「开始」恢复，否则一旦新标签没回来（弹窗被拦、标签崩溃、课堂 `waitForEnd` 挂起）用户只能刷新页面。

代价写在明处：**交棒窗口内手动再按「开始」不会被挡**（那时上一轮 Runner 已经结束、闸门已放开），会重扫、重交棒同一条目并多开一个标签、多一次 `FailGate.bump`。这是为了保住手动恢复能力而接受的取舍；要堵这个窗口就得引入「在等新标签」状态 + 超时，属实机验证后再定的事。

`start()` 中的路由分发：

- `/ai-workspace/lms-graph/*` -> `AiWorkspaceRunner`
- `/v2/web/*` -> `V2Runner`，但仅当 `.logs-list` 存在；内容页没有 `V2Runner` 分支——V2 内容页的入口是上面那条 `/ai-workspace/lms-graph/*`（`AiWorkspace.getRoute()` 内部会兜底识别 `v2/web/cloud`、`v2/web/xcloud` 与通用 V2 内容页）。`start()` 里原先还留了一段「检测到 V2 内容页，接管处理」，它在 `start()` 内不可达（`getRoute()` 已经走过并 return），已删除。
- `/pro/lms/*` -> 有 `.btn-next` 用 `ProNewRunner`，否则 `ProOldRunner`

UI 面板在 `createPanel()` 内创建。它负责可见控件、AI 配置表单、功能开关、日志、启动/暂停/终止/重置动作和清除失败动作。

**暂停与终止是两件事**：`PauseGate` 只让 `Utils.sleep` 在计时结束后继续挂起——在途的 AI 请求不受影响，模型返回后流程照样继续选答案、点提交，且 `pendingAutoStart` 还在，刷新页面又会自动续跑；`StopGate` 是硬停：`stop()` 立刻 abort 在途请求（句柄由 `Solver.askAI` 挂在 `StopGate.abortInflight`）、清掉 `pendingAutoStart`、并让面板不再接受「开始」（`invokeStart` 直接返回），恢复只能靠刷新页面（`StopGate` 是模块级对象，随 document 重建）。新增会长时间等待或会继续推进流程的代码时，**必须在入口加 `StopGate.isStopped()` 检查**：当前已覆盖 `Utils.poll`（已终止立刻 resolve(false)）、`Player.waitForEnd` / `observePause`（不再自动恢复播放）、`Solver.askAI`（不发请求、onload/onprogress 丢响应、abort 走 onabort）、`Solver.autoSelectAndSubmit`（不选不提交）、`solveExerciseQuestion`（不截图不重试）、`handleExercise` 两条逐题循环、`handleMedia`、`AiWorkspaceRunner.run`/`autoSelect`/`returnToSource`、`V2Runner.run`/`openContentEntry`/`handleBatch`、两个 Pro Runner 的 `run()`。

## ai-workspace 执行模型

`AiWorkspaceRunner.run()` 处理当前 ai-workspace 知识点，然后调用 `autoSelect()` 决定下一步：

- `getReturnUrl()` 非空时（从 V2/Pro 目录在新标签进入），`autoSelect()` 调用 `returnToSource()`，让目录继续驱动循环。
- 为空时（直接在 `ai-workspace/lms-graph/*` 页面启动），`autoSelect()` 通过 `AiWorkspace.getAllScourse()`（`.nav-item-leaf-box`）读取页面自己的叶子列表，每轮从 DOM 读取 `is-active` 找到当前活动叶子，然后调用 `handleNext(list, activateIndex + 1)` 点击下一个叶子，并通过 `run(false)` 递归。

推进用的是当轮新读到的活动叶子位置，不是存储的索引游标；ai-workspace 导航里没有逐叶子的完成元数据，所以「活动叶子的下一个」是唯一可用信号。`handleNext()` 带一个内存态死循环保护（`_lastAdvanceIndex`，每次启动重置），点击未能推进活动叶子时停止递归，理念同 FailGate 但不持久化进度。

`run()` 中遇到无法识别的路由类型是有意跳过：记日志、等待、继续走 `autoSelect()` 而不是返回，这样未知知识点不会卡死 ai-workspace 循环。`preventScreenCheck()` 只在首次 `run()` 执行（`preventScreenCheckSwitch`）；`handleNext()` 发起的递归 `run(false)` 跳过它。

## V2 执行模型

V2 有意采用 DOM 进度驱动。不要加入持久化索引游标。

页面事实（2026-09-13 复查）：`.logs-list` 与各 `section.studentCard` 都在**主文档**；主文档另有一个隐藏（宽高 0）的 `iframe.tab-pane-content-iframe`，其 `src` 指向 `/pro/lms/{token}/{classroom_id}/studycontent?...`——`/pro/lms/*` 仍被站点引用，但不构成 V2 目录遍历路径。详见 `OBSERVE.md`。

每轮 `V2Runner.run()`：

1. 调用 `autoSlide()` 触发懒加载。
2. 按 DOM 顺序扫描 `.logs-list` 的顶层子项。
3. 就地跳过有意不进入的条目（考试、未知类型、被禁用的顶层作业等）。这些条目不得调用 `returnToList()` 或点击目录项。
4. 选取第一个满足「`getCompletionState(...)` 不是 `completed`，且 FailGate key 既未跳过也未耗尽」的条目。
5. 分发一个 handler：
   - 内容条目（视频 / 顶层作业）：`openContentEntry(course, failKey)` —— 先把 `failKey` 写进 `sessionStorage`（`ykt_handoff_key`，供子标签回写用），再点击目录项；站点**新开标签**（焦点跟随、目录标签原地不动、新标签落在 ai-workspace 路由、`window.opener` 指回目录）处理该知识点。目录标签只点一次、`FailGate.bump` 一次，然后返回特殊值 `HANDOFF`。
   - 批次：`handleBatch` 就地展开（站点在目录内发 XHR 渲染子项，不新开标签），定位第一个未完成子项后同样 `openContentEntry(item, subKey)` 交棒（重置父 key、bump 子 key）。
   - 课堂 / 课件概况（`handleClassroom` / `handleCourseware`）：仍是同页 iframe / 弹层内联处理（未实测确认这类会不会也新开标签，保留原路径）。
6. `run()` 收到 `HANDOFF` 时**直接 return，不调用 `returnToList()` 也不重载目录**——重载会再次点击又开一个新标签（旧死循环根因）。
7. 被交棒的新标签由 `AiWorkspaceRunner` 处理该知识点，`autoSelect()` 见 `returnUrl` 非空即 `returnToSource()`：用 `window.opener` 把目录标签导航回目录 URL，并 `window.close()` 自身。
8. 目录被重载后 `boot()` 看到匹配 `pendingAutoStart`，从 `sessionStorage` 恢复面板日志，重启 `V2Runner.run()` 重扫——该项进度已在服务器端更新，跳过并推进下一项。

`V2Runner.run()` 是单条目循环体，不是长期运行的内存遍历。一次 `run()` 只交棒一个内容条目（`HANDOFF`）或处理一个内联条目（课堂 / 课件），之后要么停下等新标签回目录重载、要么 `returnToList()` 重载目录，绝不继续处理第二个内容条目。进度之所以推进，是因为重载后服务器端 DOM 状态变了，而不是脚本记住了「下一个索引」。

启动时向 `pendingAutoStart` 写入 `{classroomId, returnUrl}`。它记录从哪里恢复，而不是从哪个条目恢复。TTL 4 小时（见 `Store.getPendingAutoStart`），目录每条目重载都会续约 `ts`；须大于单条目播放上界，否则长视频交棒后新标签拿不到 `returnUrl`。

`returnToList()` 重载或导航后抛出 `NavigationStop`；`runRoute(...)` 捕获这个内部控制流异常。保留这个模式，让旧的 async 栈在导航后立即停止，而不是继续改动 FailGate 或 UI 状态。

V2 条目进入有意保持 KISS：目录只负责「点一个未完成条目 → 交棒 → 停手」，实际的媒体播放 / 答题在被打开的新标签里由 `AiWorkspaceRunner` 完成，再回到目录重扫。**不要改回「点击后在当前目录文档里找 `video` / 作业元素并就地处理」**——站点点击目录项会新开标签，目录文档里没有这些元素，旧做法正是「未找到元素 → 重载 → 再点 → 标签无限增长」死循环的根因。也不要为交棒加基于 focus / visibility 的停止逻辑；目录只认 `HANDOFF` 这一种信号。

`V2Runner` 不持有任何媒体播放或答题实现：只做目录扫描、`openContentEntry` / `handleBatch` 交棒，以及课堂 / 课件概况两条内联路径。媒体播放与答题都在交棒后的新标签（`AiWorkspaceRunner`）里。

V2 视频不再在目录文档内就地重放：交棒的新标签 `AiWorkspaceRunner.handleMedia` 负责起播与刷到完成，进度以重载后目录 DOM 的服务器端状态为准。
交棒的可靠性：目录交棒后不再自我重载，完全依赖新标签的 `returnToSource` 把目录重载。因此 `AiWorkspaceRunner.run()` 用 try/catch 兜住知识点处理，任何抛错都要继续走到 `autoSelect()`，否则目录会永久停等。FailGate 在目录侧 `openContentEntry` 里 bump，跨「子标签回目录重载」的多次尝试累计，满 `maxAttempts` 后跳过该项；新标签自身不持有跨重载的闸门（其 `_lastAdvanceIndex` 只在直接在本页启动逐项刷时生效）。

面板日志持久化在 `sessionStorage` 的 `ykt_panel_logs`，目录重载后可以保留运行轨迹。保留数量要有上限。

## 完成状态

`getCompletionState(statusText)` 将状态文本分类为：

- `completed`
- `in_progress`
- `not_started`

判定顺序很重要：

- 先看分数：`N/N` 表示已完成；`N/M`（`N < M`）表示进行中；`0/M` 表示未开始。
- 再看百分比：`100%` 表示已完成；其他百分比表示进行中。
- 最后看文字：`已完成` / `已读` 表示已完成；`进行中` 表示进行中；其他文字默认未开始。

这个优先级用于处理混合 UI 文本，如 `1% 进行中` 或 `3/6 进行中`。

`Utils.isProgressDone` 是内容页自查与 Pro 路径用的口径，**与目录侧取同一个阈值**：只有 `100%` / `已完成` 算完成，`98%` / `99%` 一律按未完成处理（v1.4.2 起，机主定的策略：临近完成也继续等它走到终值）。两套口径仍各有选择器与调用点，但判定标准不再分叉；改其中一处必须同时改另一处。

## 批次数

批次是顶层列表节点，其内容部分位于内层 `section` 之外。

关键选择器规则：

- `handleBatch(listNode, parentFailKey)` 接收的是 `.logs-list` 的子节点。
- 展开按钮在 `section` 内。
- 子列表 `.leaf_list__wrap` 是列表节点的后代，不一定是 `section` 的后代。

批次处理每轮也只推进一个未完成子项，然后把控制权交回重载/重扫模型。除非有意整体重新设计 V2 执行模型，否则不要把它改成多条目内存循环。

## FailGate

`FailGate` 是 sessionStorage 死循环保护，不是进度存储。

- 存储 key：`ykt_fail_counts`
- `key(...parts)` 构建稳定的 课堂/标题/索引 key。
- `bump(key)` 仅在 handler 返回无进展后递增尝试次数。**负数不是计数而是哨兵**（`-1` 跳过 / `-2` 拒答），`bump` 遇到哨兵原样返回——否则 `-2 + 1 = -1` 会把「拒答」悄悄改写成「主动跳过」。
- `exhausted(key)` 在 `maxAttempts` 次后跳过。
- `skip(key)` 标记有意跳过（考试、未知类型、被禁用的作业）。
- `skipped(key)` 检查有意跳过状态。
- `markRefused(key)` / `refused(key)`：哨兵 `-2`，表示「AI 明确拒答，脚本无法完成该条目」。`V2Runner.run()` 与 `handleBatch()` 两处扫描都要处理它，且**提示只打一次**（`warnedRefused` / `markRefusedWarned`，存在 sessionStorage 的 `ykt_refused_warned` 里——目录每轮交棒都会整页导航回来、模块级 Set 会随 document 重建，只有落在 sessionStorage 才真的一次；`clear()` 一并清掉）。
- 拒答项在顶层扫描里**只计入 `refusedSeen`，不计入 `skippedInPlace`**：`skippedInPlace > 0` 会触发「原地跳过→重载」，而拒答标记每轮都会再次命中该分支，计进去就是无限重载；标记也不降级成 `skip(-1)`，否则终结判定分不出「需人工处理」和「已完成」（`refusedSeen` 参与 `遍历结束…请手动检查` 那条日志）。
- `markRefused(key)` 写的是 **opener** 那份（给交棒子标签用）；目录要标自己表里的 key（例如「批次里只剩拒答子项」）用 `markRefusedLocal(key)`。`handleBatch` 收尾时若本批有拒答子项，就把父批次 key 标成 `-2` 而不是 `skip(-1)`，顶层重扫时才会计入 `refusedSeen`——否则收尾会误报「课程已全部完成」。
- `markProgress(key)`：子标签确认本知识点做成了时清掉来源目录上的计数。目录侧只负责交棒、看不到内容页结果，若只在交棒时 `bump`，服务端回写慢的条目（作业实测第 3 轮才翻成已完成）会在做完之前就数满 `maxAttempts` 被跳过。
- 「做成了」的判据必须严：`AiWorkspaceRunner.run()` 里 `progressed` 与 `ok` 分开——未知类型分支（`ok = true`）**不算进展**，否则目录会为它反复交棒、永远到不了 `maxAttempts`；`handleExercise` 也只在真遇到「已提交」或成功作答的题时才返回 true（`didWork && allSubmitted`），题号列表为空、题面读不到、`autoAI` 关闭这些「什么都没做」的路径一律返回 false。
- `markRefused` / `markProgress` 都走内部 `_writeToOpener(key, value)`：写的是 `window.opener.sessionStorage`（子标签只有自己那份拷贝，写自己那份目录读不到），`value === null` 表示删键。整个读写都包在 try 里：拿不到 opener、跨源、窗口正在导航时返回 false，**绝不把异常抛给调用方**（它挂在 `autoSelect()` 之前，抛出去会让目录永久停等）。
- `reset(key)` 在条目或批次子项有进展时清零计数。
- `clear()` 与 `Store.clearPendingAutoStart()` 一起接到面板的清除失败动作上。

`node tmp/failgate-selftest.cjs` 覆盖计数 / 跳过哨兵 / 拒答哨兵 / 进展清零 / 无 opener 静默五项（用桩模拟「目录那份 + 子标签拷贝」两个 sessionStorage）。

有意使用 sessionStorage 语义：关闭标签即清空。不要用 FailGate 跨会话记忆课程进度。

## 功能模式

功能开关在 `Store.getFeatureConf()` 中。

`autoAI === false` 时，V2 顶层作业处理是有意的就地跳过：

- 顶层作业类条目记录「AI 答题已禁用」，把条目标记为跳过，不进入条目继续扫描
- 批次内的作业子项遵循同样的跳过行为
- 媒体、音频、图文课件及相应批次照常运行

不要让被禁用的作业引发进入页面或重载循环。

## Player

`Player` 集中管理视频/音频行为：

- 播放倍速
- 静音/默认媒体设置
- 开始/从头播放辅助
- 暂停观察
- 结束/进度等待

V2 视频启动保留当前模式：`observePause` 在真实暂停信号到来时立即调用 `video.play()`，若仍暂停再点击大的 `.play-btn-tip` 风格 UI。不要用裸 `media.play()` 完全取代，因为站点播放器往往需要 UI 交互。这里的轮询保持低频；暂停恢复应以事件驱动优先。

ai-workspace 视频（`AiWorkspaceRunner.handleMedia`）中，xt 播放器真正的播放/暂停控件是 `xt-playbutton.xt_video_player_play_btn`（控制条）或 `xt-bigbutton.xt_video_player_big_play_layer`（中央）。`.play-btn-tip` 只是提示，`.xt_video_player_common_icon` 是音量图标——都不是播放控件，`findPlayButton` 不得返回它们（它跳过带 `tip` class 的节点，且不再列出 `.play-btn-tip`/`xt_video_player_common_icon`）。播放器在暂停状态会回退裸 `video.play()`，所以恢复播放需要点击一次真正的播放按钮。`handleMedia` 保持 `startPlayback` 为 `{ allowClick: false }`（快速点击切换按钮会导致播放/暂停闪烁），由带保护、低频的 `observePause` 通过正确按钮点击开始/恢复。

起播静音与「解除静音看门狗」：网站播放器有解除静音看门狗（`timeupdate.volume` 起 1s 定时器，见 `muted` 即强制 `video.muted=false`）。仅设 `media.muted=true` 会在 1 秒内被还原，随后无用户激活的有声播放被浏览器暂停 → 视频卡住。`Player.prepareMedia` 的做法是先真实静音（媒体内部 `muted` 置真，自动播放策略查真实状态而非 JS getter），再用 `Object.defineProperty(media,'muted',{get:()=>true,set:()=>{}})` 冻结属性，令看门狗的赋值变 no-op（`OBSERVE.md` 已实测此序列可连续播放，`freezeMuted` 幂等、`__yktMutedFrozen` 只冻结一次）。副作用：脚本接管的媒体全程静音。`AiWorkspace.keepAlive` 也走 `Player.prepareMedia` 以获得同样冻结，勿再手动逐个赋值 `muted/volume`。

## Decipherer（字体反混淆）

雨课堂用**子集字体做字形置换**：DOM 文本是 CJK 基本区的码点，页面用混淆字体（CSS 名 `exam-data-decrypt-font`）把这些码点渲染成**另一套字形**——看着是正常汉字，实际是错字。因此**复制文本得到的是错字**，`html2canvas` 截图同样渲染成错字。`Solver` 截图答题依赖反混淆。

实测依据（2026-09-13，见 `OBSERVE.md` 作业页章节）：`buildMapping()` 只处理 `0x4e00–0x9fff` 的字形码点；实机 `exam_font_{hash}.ttf` 的 cmap 882 个码点全落在该区、PUA 计数为 0；字体按页面用字子集化，URL 每次加载都不同。
（早期文档写的「PUA 混淆码点」与当前实现不符：`buildMapping` 的码点过滤、实测 cmap 都不支持 PUA 形态。）

`Decipherer`（移植自 `ref/yuketang-deobfuscator`，保留其原设计、去除调试/菜单/持久化）在 `boot` 时常开（`Decipherer.start()`），把 DOM 文本还原为真实中文，截图/复制随之正常：

- 内嵌 gzip base64 映射表 `MAP_DATA`：字形 SHA-1 前 8 字节 -> 真实 CJK 码点（解码基址 `0x3400`，实测落点在 CJK 基本区）。
- 从页面 `<style>`/`CSSFontFaceRule` 取混淆字体 URL（`https://fe-static-yuketang.yuketang.cn/fe_font/product/exam_font_{hash}.ttf`，每次加载不同），`GM_xmlhttpRequest` 下载、`opentype.parse` 解析。
- 对字体里每个 CJK 字形（码点限 `0x4e00–0x9fff`）算 `SHA-1(path.commands)` 查表，建「（被置换的）错位码点 -> 真实码点」映射。
- 仅替换 `.xuetangx-com-encrypted-font`（或 computed font-family 命中）元素内文本节点；`disableObfuscatedFont` 注入覆盖 `@font-face` + 禁用相关 `<style>` + `document.fonts.delete`，令其回退系统字体。
- `MutationObserver`（childList/attributes/characterData）对 SPA 新内容实时解码；`history.pushState/replaceState`/`popstate` 触发重扫；字体 URL 未出现时 `startFontUrlRetry` 轮询（≤30 次）。

依赖 `@require opentype.js`（1.3.4）。无手动开关：截图答题依赖解码，常开。

题目实际跑在 iframe（`/v2/web/iframe-exercise/{classroom_id}/{leaf_id}?noLeftMenu=1…`，`#iframeExerciseId`）里，所以 `boot()` 在 `Utils.inIframe()` 分支也调用 `Decipherer.start()` 后再早退——否则反混淆在 iframe 内不执行，题目文本仍是错字（复制/截图都不对）。主文档既没有题目 DOM，也没有那个混淆字体。

`html2canvas` 不信任浏览器字体回退：它自行扫描 `@font-face` 并加载 `exam-data-decrypt-font`，用混淆字形渲染已解码的真实码点（表现为部分汉字与标点乱码）。因此解码后 `stripFontFamily` 把该字体从混淆元素（及 characterData 路径的父元素）的 `font-family` 中移除，断掉 html2canvas 的字体来源。页面另有一条跨域 CSS 里（JS 读不到 `cssRules`）的 `!important` font-family 规则强制 exam 字体，普通 inline 压不过，所以 `stripFontFamily` 必须用 inline `!important`（`setProperty(..., "important")`）。

截图乱码的真正根因：`html2canvas` 用 canvas 渲染文本，而 **Firefox canvas 对通用族 `sans-serif`（以及不含 CJK 字体名的字体栈）的 CJK 回退会命中页面加载的雨课堂混淆字体**，把已解码的真实码点渲染成混淆字形；浏览器 DOM 走 fontconfig 回退所以显示正常——两条路径不同，这解释了「页面显示/复制正常、但脚本截图乱码，且字体文件每次刷新都变而错字固定」。修复：`Solver.captureQuestionImage` 在 html2canvas 的 `onclone` 里，对每个元素移除通用族与 `exam-data-decrypt-font`、追加显式 CJK 字体（`"Microsoft YaHei", "PingFang SC", …`），并跳过 MathJax/KaTeX 元素以保护公式。注意 CJK 字体名必须排在通用族之前，否则仍会命中异常回退。

## Solver

`Solver` 负责基于截图的多模态答题。

主流程：

1. 用 `html2canvas` 截取题目图片。
2. 必要时回退到 SVG `foreignObject` 截取。
3. 检测题型。
4. 通过分层选择器解析可见的选项容器/元素。
5. 通过 `GM_xmlhttpRequest` 调用 OpenAI 兼容的多模态 API。
   `askAI(imageDataUrl)` 只吃截图：题型与选项数都不下发给模型（prompt 是固定 system 文本，见 `buildPrompt()` 与 `SystemPrompt.md`），模型自己从图里判题型。别再给 `askAI` 加回「把题型/选项数喂给模型」的参数——那是死参数，没人读；真要下发就得先改 prompt。
6. 解析模型响应并选择/提交答案。

API 行为：

- endpoint 归一化支持 `/chat/completions` 与 `/responses`。
- 鉴权头选择支持 `auto`、`bearer`、`x-api-key`、`api-key`。
- 思考/推理选项与流式均可配置。
- 手动 max tokens 被遵守；启用思考时自动 max tokens 更大。

标准答题 prompt 是 `SystemPrompt.md`。若答题行为变化，检查并按需更新该文件。期望的最终模型输出是纯 JSON，如：

`{"type":"choice|multiple|truefalse|fillblank|refuse","answers":["A"]}`

`type: "refuse"` 表示 AI 判定无法作答（题面乱码，或要求联网/访问文件等它做不到的事），此时不带 `answers`。`parseAIAnswer` 把它归一为 `type: "refuse"`，`autoSelectAndSubmit` 记 **error** 日志、提示需要人工介入、**暂停 10 秒**后返回 `"refused"`，且**不选选项、不点提交**；调用方据此跳过该题并继续下一题（`solveExerciseQuestion` 返回 false）。

`autoSelectAndSubmit()` 的返回值是显式的三态，调用方必须分流，**不得把「点了提交按钮」当成提交成功**：

- `"refused"`：AI 拒答（见上）；
- `"incomplete"`：缺选项容器 / 无有效选项 / 填空无答案 / 找不到提交按钮——本轮记未推进；
- `"filled"`：已选中或填好并点击了提交按钮。**它还不是成功**：`solveExerciseQuestion` 接着 `Utils.poll` 复核判据，**两条命中任一条即算确认**：
  - ① 实机观测到会回写的判据（`isProblemSubmitted` / `isExerciseTabAnswered` / 当前题面 `isExerciseAnswered`），interval 500 / timeout 8000；
  - ② 题面指纹变了（`AiWorkspace.exerciseFingerprint`）——**站点提交成功会自己翻到下一题**（2026-09-13 实机观测，见 `OBSERVE.md`），此时 ① 里的「当前题面」判据读到的是下一题、永远看不到回写，光靠 ① 会把已成功的提交判成未推进（进而 `allSubmitted=false`、`progressed=false`、目录侧失败计数不清零，整份作业被 `maxAttempts` 跳过）。靠 ② 确认时另打一条 info 日志写明是靠翻页推断的。
  两条都不中则打 warning 并返回 `false`。

`solveExerciseQuestion(root, label, tab, index)` 的后两个参数就是给这次复核用的，由 `handleExercise` 的题号列表循环传入；无题号列表的路径没有 tab，只能退回纯 DOM 的 `isExerciseAnswered()`。`handleExercise` 会汇总每题结果：有一题没确认成功就返回 `false`（只是日志与返回值更诚实，流程不变——仍 `returnToSource` 重载目录，由目录重扫 + FailGate 兜底）。

**正因为站点提交后会自己翻页**，无题号列表路径的 `advanceExerciseQuestion(root, previousFingerprint)` 必须先看题面指纹有没有变：变了就直接算已推进、**不再点「下一题」**（否则一次提交推进两题，新翻到的那题整题漏答——2026-09-13 实机 bug）。

作业页的真实结构（2026-09-13 实机，见 `OBSERVE.md`）：`.container-body > .problem-box` 下有**兄弟**两棵：`.problems-aside`（题号列表 `.subject-item.J_order[data-order]`）与 `.container-problem`（题面正文在 `.el-scrollbar` 里、提交栏在 `.problem-fixedbar` 里）。`getExerciseContainer()` 取的是后者，所以**题号列表与提交控件都不在它的元素层级内**：`getExerciseQuestionTabs()` 必须从 `.container-problem` 往上用 `.closest(".problem-box")` 取范围，找提交/已提交状态要用 `.closest(".container-problem")`。一律不要用「从题面往下找」的写法（这正是「题号列表找不到、已提交读不到」的根因）。

题面的作答状态由**提交控件的文案**表达（2026-09-13 实机）：未作答 → 不可点击的「提交」；已作答未提交 → 「提交」变可点击；已提交 → 不可点击的「已提交」。因此「已提交」是可直接用的判据，**不要**拿「提交」是否 disabled 反推（未作答时它同样 disabled）。该控件不在题面里，`isExerciseAnswered()` 按 容器（`.container-problem`）→ 文档 → 题面 逐层找这个专属文案。另：只有第一题没有「上一题」、只有最后一题没有「下一题」。

提交后站点的行为分两种（2026-09-13 实机）：**答对自动翻到下一题；答错留在原页、只把结果渲染上去**（提交按钮随即不可用）。判据是 `AiWorkspace.exerciseQuestionStillShown(previousText)`——拿提交前题面的前 40 字在当前题面里做包含判断：还包含就是没翻页（该自己点「下一题」），已经换掉就是站点翻过了（再点会漏答一题）。**不要用「题面文本变了」当已翻页的判据**：答错时同一页渲染结果也会让文本变化。同理，`advanceExerciseQuestion` 点完「下一题」要等的是「刚才那道题从页面上消失」，不是「文本变了」。

末题提交后站点翻到的是**作业概况/结果页**（没有逐题提交按钮）。无题号列表路径每轮翻页后会先用 `AiWorkspace.hasExerciseSubmitControl()` 确认这一页还是不是一道待作答的题：不是就停手（`break`），不截图、不问 AI、也不把它记成一道「未推进」的题。该判据只看题面自身与它的父级、并要求按钮文本不含「作业/交卷」——整页可能有个「提交作业」按钮，那是交整份作业的，不是某道题的作答提交；首题（`i === 0`）不设这个门槛，因为真实题目在选中答案前，提交按钮通常只是 disabled、不是不存在。

`solveExerciseQuestion` 的 refuse 分支还会调用 `FailGate.markRefused(...)`，把来源目录里本次交棒条目的 key 标成 `-2`：这一题既然脚本答不了，那份作业就不可能靠脚本刷完，目录重扫时应当直接跳过，而不是再交棒重试到 FailGate 满 3 次。key 由目录在交棒前写入 `sessionStorage`（`ykt_handoff_key`），子标签继承的是拷贝，因此回写目标是 `window.opener.sessionStorage`；拿不到 opener（用户直接在本页启动、窗口已关）时静默退回原来的重试行为。

判断题的「对 / 错」判定在 `Solver` 里有两处，**都以「不」为否定标记**（`/不|错|false|no/i`，`不` 覆盖不是 / 不正确 / 不对 / 不符合），且都是**先判否定再判肯定**：

- `parseAIAnswer()` 的非 JSON 回退（模型没按 Schema 输出时的兜底）：否定优先，否则「不正确」会先命中「正确」被判成对。同一处还只把**对象**形态的 JSON 当答案对象——裸 `true` / `false` 也是合法 JSON 但没有 `answers`，放行会得到空答案，现在它们落到文本回退。
- `answerToIndices()` 的选项映射（0 = 对/第一个选项，1 = 错/第二个选项）：否定优先，否则 `answers:["不正确"]` 会去点「对」。

选项字母表是模块级 `OPTION_LETTERS = "A"–"Z"`（v1.4.2 起，不再写死 A–F）：平台题目选项没有确认的上限，映射时按实际 `optionCount` 过滤，被丢掉的越界字母会打一条 warning。非 JSON 回退在原始文本里取字母时用 `\b[A-Z]\b`，只认独立成词的单个字母——模型用英文解释时词内字母（`The` 里的 `e`）不该被当成选项；代价是 `AB` 这种连写不做拆分，多选请让它走 JSON 数组。

改这里跑 `node tmp/parse-answer-selftest.cjs`（从脚本抽出方法体执行，覆盖肯定 / 否定 / JSON / 其他题型回退 / 选项映射）。遇到无法可靠分类的新表达先记样本再补最小规则，不要扩成自然语言分类器。

不要给肯定/否定加「整句语义判断」：`不` 是刻意选的宽标记，句子里出现「不」就按否定处理，宁可判错也不要判反。

## 编辑规则

- 除非用户明确要求结构性变更，保持项目单文件。
- 注释保持简洁有用。
- 新增源文件时保留 GPL-3.0-only 头与 SPDX 标识。
- 新增 AI provider 域名时，检查 `@connect` 附近的 userscript 元数据；当前元数据已含通配 `@connect *`。
- 修改 DOM 选择器前先确定目标路由：V2、Pro、ai-workspace 结构各不相同。
- 涉及网页行为的改动（选择器、路由、点击后的页面跳转、媒体/播放器行为）必须先按 `FIREFOX.md` 实机验证，再把观测回填 `OBSERVE.md`；验证不到的部分在文档里标「待验证」，不要用静态推断替代观测。
- 保持 V2 不变量：handler 要么回到目录/重载流程，要么显式继续扫描。不要引入 localStorage 进度游标。
- 当改动涉及行为、架构、验证、路由、存储 key、AI 流程、选择器或本文件描述的其他内容时，在同一次改动中更新对应的 `AGENTS.md` 章节。
- 交付中不编辑 `ref/`。
- 发现新的坑时，补入「常见坑」章节（确有再补）。
- 完成一整个大任务的改动后，起一个子代理审查改动，按需修改后再提交。
- commit 说明使用声明式表述：描述改动后的系统状态/能力（如「V2 入口经新标签交接驱动播放」），不用动作式（如「修复视频死循环」）。

## 常见坑

- 在内容页上启动 `V2Runner` 会造成错误循环。`.logs-list` 守卫是有意为之。
- 批次子项选择器如果只限定在 `section` 下会漏掉 `.leaf_list__wrap`。
- 不先检查分数/百分比就把 `进行中` 当作未完成，会误判混合状态字符串。
- 不使用 FailGate 直接重试条目会造成无限重载循环。
- 把跳过的条目标记为失败会产生噪声式误报；有意跳过用 `FailGate.skip()`。
- V2 目录条目点击会**新开标签**（不是同标签导航）；在目录文档里找 `video`/作业元素必然「未找到 → 重载 → 再点 → 标签无限增长」。交棒用 `HANDOFF`，且 `run()` 收到 `HANDOFF` 时不得 `returnToList()`。
- 仅 `media.muted=true` 会被网站「解除静音看门狗」1 秒内还原、无用户激活的有声播放被浏览器暂停；起播要走 `Player.prepareMedia`（真实静音后冻结 `muted` 属性）。
- 交棒后目录无自我重载定时器：若新标签因弹窗被拦 / 落地路由不认识（既非 ai-workspace 也非 `/v2/web`）/ 整个标签崩溃而没回到目录，目录会静默停等（面板仍显示运行中）。目前靠人工重新点「开始」恢复，未加自动超时重载——超时若短于长视频播放会误触发、又开一个标签。需要自愈再加，取值必须 > 单条目最长播放时间。
- `pendingAutoStart` TTL 为 4 小时（`Store.getPendingAutoStart`），必须 > 单条目播放上界（`getDDL = 时长*3`），否则长视频播到一半过期、`getReturnUrl` 变空、目录永不重载。目录每条目重载会续约 `ts`。
- `pendingAutoStart` 的 `classroomId` 与 `returnUrl` 必须成对，读写两侧都管：`Store.setPendingAutoStart` 在**换课堂且这次没有新目录地址**时直接返回、不覆盖旧记录；`AiWorkspaceRunner.getReturnUrl()` **只要路由给得出课堂 id 就必须与 pending 对得上**（V2 内容页也不例外，别再给那条分支开后门）。两侧缺一都会留下「课堂 B 的 id + 课堂 A 的目录地址」，把标签导航去另一个课堂。
- 讨论（`taolun`/`forum`）子项**一律**在 `handleBatch` 里就地 `FailGate.skip`（v1.4.1 起，不再看用户开关）：发帖内容得先由模型生成，脚本没有实现，交棒进论坛页的 `AiWorkspaceRunner` 也不处理该类型，交棒只会得到「开标签→不处理→关标签→再交棒」空转、满 `maxAttempts` 才跳过。`autoComment` 开关与面板勾选框已删除；未来接 `askAI` 的流程写在 `handleBatch` 该分支上方的注释里（新标签读主题与楼层 → askAI 生成回复 → 填框提交 → `returnToSource`）。
- `returnToSource` 结尾的 `window.close()` 关的是被 `target=_blank` 打开的标签，浏览器可能拒绝（只允许关自己 `open` 的窗口）。修复后必须用 `ykt-ff tabs` 复验每轮标签数是否 ≈ 常数；若持续增长，改为 close 后按 `window.closed` 决定后续，**切勿「close 失败就自己也跳目录」**（会产生两个都会 auto-resume 的目录标签、每轮开 2 个，更糟）。
- `handleCourseware` 现会在同页「无查看课件按钮 / 非 PPT / 无 `.video-box`」时返回 `false`，让 FailGate 对课件项封顶；但它的判据是 `if (!hasCheckBtn && !isPPT && !videoBox)`——**匹配到「查看课件」按钮就算成功**，即使点击后什么也没找到也会 `return true` 并重置 FailGate。若课件其实是在新标签打开的，这里会变成「重置计数 → 重载 → 再点 → 再开标签」。同页 `isPPT` 判据含 `.el-card__header` 文本含 `PPT`，概况页很容易命中并进了 `playPPTSlides`；`playPPTByNavigation` 在既无页码指示器又无翻页按钮时 `sameCount` 恒为 0，会一路跑满 `maxPages = 200`。动这条路径前先按 `OBSERVE.md` 的待验证清单确认课件到底是同页弹层还是新标签（见 `AUDIT.md` 第 13 条）。
- `html2canvas` 截图把中文渲染成错字，根因是页面加载的混淆字体（DOM 文本被该字体做了字形置换），不是截图代码或图片本身；修复靠 `Decipherer` 先把 DOM 还原为真实中文，再在截图 `onclone` 里换掉字体栈。只改 `@font-face` 不管用。
- 题目（exercise）跑在 `#iframeExerciseId` iframe（`/v2/web/iframe-exercise/…`）内，主文档既没有题目 DOM 也没有混淆字体；若在 iframe 分支直接 `return`，`Decipherer` 不会在 iframe 内运行，反混淆失效（DOM 仍是错字，复制与截图都不对）。反混淆必须在 iframe 分支里先启动。
- 仅禁用/覆盖 `@font-face` 不足以让 html2canvas 用系统字体：它自己解析 CSS 加载混淆字体，会把已解码的真实码点渲染成混淆字形（复制正常但截图部分乱码）。必须用 `stripFontFamily` 从元素 `font-family` 里移除 `exam-data-decrypt-font` 引用。
- `Utils.poll()` 的 checker 抛错不再让 Promise 悬空（v1.4.1 起）：内部 `try/catch` 收口，打印 `[poll] checker 抛错，按未满足返回 false` 后 `clearInterval` 并 `resolve(false)`，与超时同语义。写 checker 时仍应避免访问可能已卸载节点的属性——抛错现在会**立刻**返回 `false`（而不是等到超时），调用方会当成一次未推进，靠 FailGate 兜底。
- 交棒子标签拿到的是来源目录 sessionStorage 的**拷贝**：子标签自己写 `ykt_fail_counts`，目录读不到（实测同一 key 两边计数不同）。跨标签回写只能写 `window.opener.sessionStorage`，且 `openContentEntry` 必须在点击**之前**写好 `ykt_handoff_key`，因为拷贝是在新标签创建那一刻生成的。
