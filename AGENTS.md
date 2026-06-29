# AGENTS.md

This file provides guidance to LLM Agents when working with code in this repository.

## 项目概述

雨课堂复合自动化 userscript（Tampermonkey 等管理器加载）。单文件交付：
`yuketang-ComplexAutomation.user.js`。整个脚本是一个 IIFE，运行在
`*.yuketang.cn` / `*.gdufemooc.cn` 页面，`@run-at document-start`。

无构建系统、无包管理、无测试框架。开发即直接编辑 `.user.js`，验证靠浏览器内实跑。

## 构建 / 测试 / 运行

- 没有 build / lint / test 命令。
- 验证方式：在 userscript 管理器中安装本文件，进入雨课堂课程目录页，开脚本面板手动跑。
- 调试看浏览器 Console（脚本用 `console.warn`/`console.error`）和面板内 `panel.log(...)` 输出。
- `ref/` 下是参考来源脚本（审计/对照用），**不要**当作本项目源码修改或纳入交付。

## 版本号约定

以文件头部 `// @version      x.x.x` 为唯一版本来源：
- 发布时只维护文件头 `// @version`，userscript 管理器也依赖它判断升级。
- `Config.version` 运行时读取 `GM_info.script.version`；不要在其他位置硬编码第二个版本号。
- `ref/` 内脚本各自的版本号与本项目无关。

## 架构

启动链路：`boot()` → 跳过 iframe → `createPanel()` 建 UI →
读 `pendingAutoStart` 决定是否跨页自动续跑 → `start()` 做路由分发。
（定位用 grep，不要记行号：`grep -n "function boot\|function start\|function createPanel"`。）

### 路由分发（`start()`）

按 URL 选择 Runner，三类页面对应三种主循环：
- `/ai-workspace/lms-graph/*` → `AiWorkspaceRunner`（新版学习空间，主力路径）
- `/v2/web/*` → `V2Runner`（**必须在课程列表页运行**，靠 `.logs-list` 判定；单课件/视频页会拒绝启动以防误触发主循环）
- `/pro/lms/*` → 有 `.btn-next` 用 `ProNewRunner`，否则 `ProOldRunner`（旧版仅转发）

跨页续跑机制：启动时把 `{classroomId, returnUrl}` 写入 `pendingAutoStart`，页面跳转后 `boot()` 比对 `classroomId` 命中则自动 `panel.start()`。这是脚本能连续处理多个章节/跳转页面的关键。

### 核心模块（均为单文件内的对象/类，按需 `grep -n "const Config\|const Solver"` 等定位）

- `Config`：用户可调参数 + `storageKeys`（localStorage 键名，标注"勿动"）。
- `Utils`：`sleep`/`poll`/`inIframe`/路由解析（`getCurrentClassroomId` 用多组正则从 path/query 提取）。
- `Store`：localStorage 读写层，所有持久化（进度、AI 配置、功能开关、续跑标记）走这里。
- `createPanel()`：UI 面板 + AI 配置表单 + 日志区，约 500 行，含所有 DOM 字符串。
- `FontPatch`：雨课堂字体反混淆补丁，**默认关闭**，源自 `ref/yuketang-deobfuscator`。
- `Player`：视频/音频自动播放（倍速、静音、防暂停 `observePause`、等待结束 `waitForEnd`）。
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
   - 支持 thinking/CoT、stream、自定义 max tokens。
4. system prompt 源文本在 `SystemPrompt.md`，要求模型只输出纯 JSON：
   `{"type":"choice|multiple|truefalse|fillblank","answers":[...]}`。修改答题行为应同步看这个文件。

## 约束与注意

- GPL-3.0-only（继承自 Niuwh/yuketang-jiaoben），文件头有 SPDX 标识，新增文件需保持许可一致。
- `@connect` 已列白名单域名 + `*`；新增 AI 服务商域名时按需在头部补 `@connect`。
- 改 DOM selector 前先确认是哪一类页面（v2 旧版 vs pro vs ai-workspace 结构差异大，selector 不通用）。
