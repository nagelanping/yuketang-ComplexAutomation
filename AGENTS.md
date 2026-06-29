# AGENTS.md

This file provides guidance to LLM Agents when working with code in this repository.

## 项目概述

雨课堂复合自动化 userscript（Tampermonkey 等管理器加载）。单文件交付：`yuketang-ComplexAutomation.user.js`。
整个脚本是一个 IIFE，运行在 `*.yuketang.cn` / `*.gdufemooc.cn` 页面，`@run-at document-start`。

无构建系统、无包管理、无测试框架。开发即直接编辑 `.user.js`，验证靠浏览器内实跑。

## 构建 / 测试 / 运行

- 没有 build / lint / test 命令。改完用 `node --check yuketang-ComplexAutomation.user.js` 做语法兜底。
- 验证方式：在 userscript 管理器中安装本文件，进入雨课堂课程目录页，开脚本面板手动跑。
- 调试看浏览器 Console（脚本用 `console.warn`/`console.error`）和面板内 `panel.log(...)` 输出。
- `ref/` 下是参考来源脚本（审计/对照用），**不要**当作本项目源码修改或纳入交付。

## 版本号约定

以文件头部 `// @version      x.x.x` 为唯一版本来源：

- 发布时只维护文件头 `// @version`，userscript 管理器也依赖它判断升级。
- `Config.version` 运行时读取 `GM_info.script.version`；不要在其他位置硬编码第二个版本号。
- `ref/` 内脚本各自的版本号与本项目无关。

## 架构

启动链路：`boot()` → 跳过 iframe → `createPanel()` 建 UI → 读 `pendingAutoStart` 决定是否跨页自动续跑 → `start()` 做路由分发。
（定位用 grep，不要记行号：`grep -n "function boot\|function start\|function createPanel"`。）

### 路由分发（`start()`）

按 URL 选择 Runner，三类页面对应三种主循环：

- `/ai-workspace/lms-graph/*` → `AiWorkspaceRunner`（新版学习空间，主力路径）
- `/v2/web/*` → `V2Runner`（**必须在课程列表页运行**，靠 `.logs-list` 判定；单课件/视频页会拒绝启动以防误触发主循环）
- `/pro/lms/*` → 有 `.btn-next` 用 `ProNewRunner`，否则 `ProOldRunner`（旧版仅转发）

### 执行模型：整页重载 + 自动续跑

这是理解 V2Runner 行为的前提。脚本处理完一个学习项后，`returnToList()` 多数情况执行 `location.href = 课程列表页`，触发**整页重载**；重载后 `boot()` 比对 `pendingAutoStart` 里的 `classroomId`，命中则自动 `panel.start()` 重新进入主循环。也就是说：

> 每处理完一项 → 整页重载 → 主循环重新跑一遍。

启动时把 `{classroomId, returnUrl}` 写入 `pendingAutoStart`（localStorage）是这套续跑的关键，它只记"在哪个课堂续跑"，不记"刷到第几项"。

### V2Runner：纯 DOM 进度驱动遍历

V2Runner **不记忆位置游标**。每次 `run()`（含重载后的重新进入）都：

1. `autoSlide()` 触发懒加载，扫描 `.logs-list` 的全部顶层项；
2. 按 DOM 顺序找**第一个**满足"未完成（`getCompletionState(...) !== 'completed'`）且未被 FailGate 标记跳过/耗尽"的可处理项，分发到对应 handler；
3. handler 处理完调 `returnToList()` 整页重载 → 重新扫描。刚完成的项 DOM 状态已变 `已完成`，自然被跳过，遍历天然推进到下一个未完成项。

`getCompletionState(statusText)` 是三态分类器，对应雨课堂右侧状态列：

- 数字比例 `N/N` → `completed`，`N/M`(N<M) → `in_progress`，`0/M` → `not_started`；
- 百分比 `100%` → `completed`，其余 → `in_progress`；
- 文本 `已完成`/`已读` → `completed`，`进行中` → `in_progress`，余下按 `not_started`。
- 判定顺序是"数字/百分比优先于文本"，因为页面上常有 `1% 进行中`、`3/6 进行中` 这种并存。

批量大章节（`isBatch`）顶层无自身内容，子章节未完成时顶层显示"进行中"。`handleBatch` 接到的是**列表节点**（`.logs-list` 的子项，不是 `section`）：展开按钮在 `section` 内，子项列表 `.leaf_list__wrap` 是列表节点的后代、在 `section` 之外——这点 selector 作用域容易踩坑。批量区同样**每次只推进一个未完成子项就 return**，交回 `run()` 靠重载复查，不在单次调用里连刷多项。

各子 handler（`handleVideo`/`playVideoItem`/`playAudioItem`/`autoCommentItem`/`handleHomework`/`handleClassroom`/`handleCourseware`）只负责"处理一项 + `returnToList()`"，不返回索引、不写任何进度游标。

### FailGate：防死循环安全阀

纯 DOM 驱动的代价是：若某项 DOM 永远不显示完成（已过截止的视频、AI 答不全的作业、服务端进度回写延迟），就会无限重载重试。`FailGate`（sessionStorage，键 `ykt_fail_counts`）是兜底闸门：

- `key(...parts)`：`classroomId` + 各级标题/序号拼成稳定键。
- `bump(key)`：进入处理前自增一次尝试；`exhausted(key)`：达 `maxAttempts`（默认 3）即跳过并告警。
- `skip(key)` / `skipped(key)`：哨兵值标记**主动跳过**（考试、未知类型、功能关闭的作业）， 与"失败耗尽"区分——主动跳过静默略过、**不**报"尝试 N 次仍未完成"。
- `reset(key)`：批量子项有实际进展时重置父项计数，避免多子项的正常推进误触顶层上限。
- 用 sessionStorage：关标签页即清，绝不跨会话残留——它只防死循环，**不**承担"记忆刷课进度"职责。

面板「清除失败记录」按钮调 `FailGate.clear()` + `Store.clearPendingAutoStart()`。

### 纯刷视频模式

关闭 AI 作答（`feature.autoAI === false`）时，作业类项在**扫描阶段**就被直接无视
（不进入、不重载），脚本只刷视频/音频/课件。注意大章节（`isBatch`）顶层仍需进入，
以处理其中的视频子项，作业子项在子项层跳过。

### 核心模块（均为单文件内的对象/类，按需 `grep -n "const Config\|const Solver"` 等定位）

- `Config`：用户可调参数（倍速、PPT 翻页间隔、AI 超时等）+ `storageKeys`（标注"勿动"）。
- `Utils`：`sleep`/`poll`/`inIframe`/`getCompletionState` 用到的状态文本，以及路由解析
  （`getCurrentClassroomId` 用多组正则从 path/query 提取）。
- `Store`：localStorage 读写层，持久化 AI 配置、功能开关、跨页续跑标记 `pendingAutoStart`、
  pro 路线计数。**不再有刷课进度游标**（旧 `getProgress/setProgress/removeProgress` 已删除）。
- `FailGate`：sessionStorage 失败计数闸门，见上。
- `PauseGate`：暂停闸门，所有 Runner 主循环都经由 `Utils.sleep` 推进，暂停时让 sleep 挂起，
  从而统一暂停整条自动化流程。
- `createPanel()`：UI 面板 + AI 配置表单 + 日志区，约 500 行，含所有 DOM 字符串。
- `FontPatch`：雨课堂字体反混淆补丁，**默认关闭**，源自 `ref/yuketang-deobfuscator`。
- `Player`：视频/音频自动播放（倍速、静音、防暂停 `observePause`、等待结束 `waitForEnd`）。 v2 视频起播靠 `observePause` 点 `.play-btn-tip` 大按钮 + `video.play()`，而非裸 `media.play()`。
- `AiWorkspace`：ai-workspace 路由专用工具。
- `preventScreenCheck()`：防切屏检测。
- `Solver`：截图 + 多模态答题，见下。
- 四个 Runner（`V2Runner`/`ProOldRunner`/`ProNewRunner`/`AiWorkspaceRunner`）：各自的页面遍历主循环。

### Solver（截图答题核心）

1. 截图：`html2canvas`（`@require` CDN 引入）截题面，失败回退到 SVG `foreignObject` 方案（`captureQuestionImageBySVG`）。
2. 选项解析：`getOptionContainer` / `getOptionElements` 用多组层叠 selector 兜底匹配各种 DOM 结构（旧版 li、el-radio、role=radio 等），靠 `offsetParent !== null` 过滤隐藏项。
3. 请求：经 `GM_xmlhttpRequest` 调用 OpenAI-compatible 多模态接口。
   - API URL 自动补全：兼容 `/chat/completions` 与 `/responses` 两种风格。
   - 鉴权 header 自动匹配：`auto` / `bearer` / `x-api-key` / `api-key`。
   - 支持 thinking/CoT、stream、自定义 max tokens（留空自动：CoT 开 32768，否则 4096）。
4. system prompt 源文本在 `SystemPrompt.md`，要求模型只输出纯 JSON：`{"type":"choice|multiple|truefalse|fillblank","answers":[...]}`。修改答题行为应同步看这个文件。

## 约束与注意

- GPL-3.0 LICENSE，文件头有 SPDX 标识，新增文件需保持许可一致。
- `@connect` 已列白名单域名 + `*`；新增 AI 服务商域名时按需在头部补 `@connect`。
- 改 DOM selector 前先确认是哪一类页面（v2 旧版 vs pro vs ai-workspace 结构差异大，selector 不通用）。
- 改 V2Runner 遍历逻辑时，记住"整页重载 + 重新扫描"是行为前提：handler 末尾必须 `returnToList()` 或显式 `continue` 回到扫描；任何"记住第几项"的游标式改法都与现架构冲突，应改用 DOM 状态 + FailGate。
