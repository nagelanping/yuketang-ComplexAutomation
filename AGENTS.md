# AGENTS.md

本文件为编码代理提供本仓库的项目专属规则。

项目根目录还有其他 .md 文档（AI prompt、实机行为记录、协同方法等）。开始工作前先阅读项目里已有的 .md 文件，了解背景与当前状态。

## 项目

雨课堂复合自动化 userscript，单文件交付：

- 主源码：`yuketang-ComplexAutomation.user.js`
- AI 答题的 prompt 源：`SystemPrompt.md`
- 仅作参考的代码：`ref/`

userscript 以 IIFE 形式在 `*.yuketang.cn` 页面以 `@run-at document-start` 运行。
无构建系统、包管理器、测试框架或生成产物。
开发方式就是直接编辑 `.user.js` 文件，并在浏览器 userscript 管理器中验证。

不得把 `ref/` 当作项目源码修改。它只是审计/对比材料。

## 必查项

- JS 编辑后做语法检查：
  `node --check yuketang-ComplexAutomation.user.js`
- 运行时验证靠手动：
  在 Tampermonkey 或兼容管理器中安装/更新 userscript，打开雨课堂课程目录页，从脚本面板启动，同时检查浏览器 Console 与面板日志。
- 实机页面检测（agent 驱动）：持久 GUI Firefox profile 位于 `/home/Si/.ykt-firefox`（登录/cookies 跨重启保留），在 `127.0.0.1:2828` 暴露 marionette。用 `ykt-ff-start` 启动，用 `ykt-ff` 驱动（`eval`、`evalf`、`open`、`url`、`title`、`html`）。用户在可见窗口里登录；agent 通过 CLI 读取 DOM/网络状态。

若某次任务只改了文档或 prompt，请说明 `node --check` 是否没有必要。

## 版本管理

唯一对外发布的版本来源是 userscript 头部：

- 搜索关键词：`@version`
- `Config.version` 读取 `GM_info.script.version`
- 不得在其他地方硬编码第二个版本
- `ref/` 内的版本与此无关

## 代码导航

用搜索关键词而非固定行号。这个单一大文件里行号会漂移。
本地优先用 `rg -n`；文档中写命令时 `grep -n` 也可以。

常用锚点：

- 头部/版本/连接：
  `rg -n "@version|@connect|@require" yuketang-ComplexAutomation.user.js`
- 启动链：
  `rg -n "function boot|function start|function createPanel" yuketang-ComplexAutomation.user.js`
- 核心单例：
  `rg -n "const Config|const Utils|const Store|const FailGate|const PauseGate|const Player|const AiWorkspace|const Solver" yuketang-ComplexAutomation.user.js`
- 路由 runner：
  `rg -n "class V2Runner|class ProOldRunner|class ProNewRunner|class AiWorkspaceRunner" yuketang-ComplexAutomation.user.js`
- ai-workspace 叶子遍历：
  `rg -n "autoSelect|handleNext|getAllScourse|_lastAdvanceIndex|nav-item-leaf-box" yuketang-ComplexAutomation.user.js`
- V2 遍历与返回行为：
  `rg -n "async run\\(\\)|returnToList|handleBatch|handleVideo|handleHomework|handleCourseware" yuketang-ComplexAutomation.user.js`
- 完成状态逻辑：
  `rg -n "getCompletionState|isProgressDone|statistics-box \\.aside" yuketang-ComplexAutomation.user.js`
- FailGate 用法：
  `rg -n "FailGate\\.|ykt_fail_counts|clearPendingAutoStart" yuketang-ComplexAutomation.user.js`
- AI 答题管线：
  `rg -n "captureQuestionImage|askAI|autoSelectAndSubmit|detectQuestionType|getOptionElements|buildPrompt" yuketang-ComplexAutomation.user.js`

写项目文档或解释时，引用这些关键词/命令，不要引用行号。

代码改动后若出现新的核心符号或路由，在同一次改动中更新上面的锚点列表。

## 架构

启动链：

`boot()` -> 跳过 iframe -> `createPanel()` -> 加载 `pendingAutoStart` -> `start()` 路由分发。

`start()` 中的路由分发：

- `/ai-workspace/lms-graph/*` -> `AiWorkspaceRunner`
- `/v2/web/*` -> `V2Runner`，但仅当 `.logs-list` 存在；内容页若识别为 V2 内容路由则交给 `AiWorkspaceRunner`，否则直接拒绝，避免在错误页面上启动目录循环
- `/pro/lms/*` -> 有 `.btn-next` 用 `ProNewRunner`，否则 `ProOldRunner`

UI 面板在 `createPanel()` 内创建。它负责可见控件、AI 配置表单、功能开关、日志、启动/暂停/重置动作和清除失败动作。

## ai-workspace 执行模型

`AiWorkspaceRunner.run()` 处理当前 ai-workspace 知识点，然后调用 `autoSelect()` 决定下一步：

- `getReturnUrl()` 非空时（从 V2/Pro 目录在新标签进入），`autoSelect()` 调用 `returnToSource()`，让目录继续驱动循环。
- 为空时（直接在 `ai-workspace/lms-graph/*` 页面启动），`autoSelect()` 通过 `AiWorkspace.getAllScourse()`（`.nav-item-leaf-box`）读取页面自己的叶子列表，每轮从 DOM 读取 `is-active` 找到当前活动叶子，然后调用 `handleNext(list, activateIndex + 1)` 点击下一个叶子，并通过 `run(false)` 递归。

推进用的是当轮新读到的活动叶子位置，不是存储的索引游标；ai-workspace 导航里没有逐叶子的完成元数据，所以「活动叶子的下一个」是唯一可用信号。`handleNext()` 带一个内存态死循环保护（`_lastAdvanceIndex`，每次启动重置），点击未能推进活动叶子时停止递归，理念同 FailGate 但不持久化进度。

`run()` 中遇到无法识别的路由类型是有意跳过：记日志、等待、继续走 `autoSelect()` 而不是返回，这样未知知识点不会卡死 ai-workspace 循环。`preventScreenCheck()` 只在首次 `run()` 执行（`preventScreenCheckSwitch`）；`handleNext()` 发起的递归 `run(false)` 跳过它。

## V2 执行模型

V2 有意采用 DOM 进度驱动。不要加入持久化索引游标。

每轮 `V2Runner.run()`：

1. 调用 `autoSlide()` 触发懒加载。
2. 按 DOM 顺序扫描 `.logs-list` 的顶层子项。
3. 就地跳过有意不进入的条目（考试、未知类型、被禁用的顶层作业等）。这些条目不得调用 `returnToList()` 或点击目录项。
4. 选取第一个满足「`getCompletionState(...)` 不是 `completed`，且 FailGate key 既未跳过也未耗尽」的条目。
5. 分发一个 handler。
6. handler 处理一个条目，并返回本轮是否有进展。
7. `returnToList()` 先用站点自身的历史栈返回目录并等待 `.logs-list`；目录可见后重载目录页，使下一轮扫描读到最新的服务器端进度。
8. `boot()` 看到匹配的 `pendingAutoStart`，从 `sessionStorage` 恢复面板日志，并启动下一个单条目循环。

`V2Runner.run()` 是单条目循环体，不是长期运行的内存遍历。handler 返回目录或重载目录后，不得继续处理第二个内容条目。也就是说：进度之所以推进，是因为重载后服务器端 DOM 状态变了，而不是脚本记住了「下一个索引」。

启动时向 `pendingAutoStart` 写入 `{classroomId, returnUrl}`。它记录从哪里恢复，而不是从哪个条目恢复。

`returnToList()` 重载或导航后抛出 `NavigationStop`；`runRoute(...)` 捕获这个内部控制流异常。保留这个模式，让旧的 async 栈在导航后立即停止，而不是继续改动 FailGate 或 UI 状态。

V2 条目进入有意保持 KISS：通过站点 UI 点击目录项，处理随后产生的站点内页面状态，返回目录，然后重扫服务器端 DOM 进度。不要为 V2 目录项加「新页面交接」状态或基于 focus/visibility 的停止逻辑；雨课堂经常在同一 web app/历史栈内切换视图，强制 URL 导航可能破坏其返回行为。

V2 视频每轮都从头重放。视频轮次只有在页面进度文本确认完成后才算进展。若播放到结尾但进度文本未更新，返回目录重新扫描，但仍让 FailGate 为这轮未确认计数，这样服务器端状态永久不更新也不会无限循环。

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
- `bump(key)` 仅在 handler 返回无进展后递增尝试次数。
- `exhausted(key)` 在 `maxAttempts` 次后跳过。
- `skip(key)` 标记有意跳过（考试、未知类型、被禁用的作业）。
- `skipped(key)` 检查有意跳过状态。
- `reset(key)` 在条目或批次子项有进展时清零计数。
- `clear()` 与 `Store.clearPendingAutoStart()` 一起接到面板的清除失败动作上。

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

## Solver

`Solver` 负责基于截图的多模态答题。

主流程：

1. 用 `html2canvas` 截取题目图片。
2. 必要时回退到 SVG `foreignObject` 截取。
3. 检测题型。
4. 通过分层选择器解析可见的选项容器/元素。
5. 通过 `GM_xmlhttpRequest` 调用 OpenAI 兼容的多模态 API。
6. 解析模型响应并选择/提交答案。

API 行为：

- endpoint 归一化支持 `/chat/completions` 与 `/responses`。
- 鉴权头选择支持 `auto`、`bearer`、`x-api-key`、`api-key`。
- 思考/推理选项与流式均可配置。
- 手动 max tokens 被遵守；启用思考时自动 max tokens 更大。

标准答题 prompt 是 `SystemPrompt.md`。若答题行为变化，检查并按需更新该文件。期望的最终模型输出是纯 JSON，如：

`{"type":"choice|multiple|truefalse|fillblank","answers":["A"]}`

## 编辑规则

- 除非用户明确要求结构性变更，保持项目单文件。
- 注释保持简洁有用。
- 新增源文件时保留 GPL-3.0-only 头与 SPDX 标识。
- 新增 AI provider 域名时，检查 `@connect` 附近的 userscript 元数据；当前元数据已含通配 `@connect *`。
- 修改 DOM 选择器前先确定目标路由：V2、Pro、ai-workspace 结构各不相同。
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
