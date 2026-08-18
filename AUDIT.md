# 项目审查报告

范围：仓库根目录源码、文档和元数据；`ref/` 仅作参考，未作为项目源代码提出修改。审查重点是结构、复杂度、可维护性以及能够从代码直接确认的硬伤。脚本已通过 `node --check yuketang-ComplexAutomation.user.js`。

## 结论摘要

主脚本目前是一个 4653 行、约 172 KB 的单文件 userscript，包含面板、存储、播放器、路由识别、三套 Runner、PPT 兼容层和多模态 API 客户端。单文件交付是项目明确约束，因此不能仅因为文件大就建议拆分。代码中相当一部分多选择器、多路由和多重回退是对真实网站差异的适配，不能按普通业务代码直接“整理干净”。

优先处理真正可确认的问题：元数据与代码宣称支持的域名不一致、存在无效配置项、播放器清理函数在一个长循环路径上被丢弃、轮询工具对 checker 异常没有收敛处理。其余复杂部分先保留，必须在真实网站重新验证后再动。

## P0/P1：确认的问题

- `yagni:` `Config.aiMaxOutputTokens` 只有声明，没有任何读取点；运行时实际由 `Solver.getMaxOutputTokens()` 计算 32768/4096 或使用 `saved.maxTokens`。删除该配置，避免使用者误以为修改它能改变请求。 [`yuketang-ComplexAutomation.user.js`：`Config`、`Solver.getMaxOutputTokens`]
- `yagni:` `Solver.buildSamplingParams()` 读取 `conf.forceSamplingParams`，但 `Store.getAIConf()`、面板保存逻辑和默认配置都没有提供该字段，因此该分支在当前产品中永远不会开启。删除死分支，或者真正把它加入配置；二者择一，不要保留假开关。 [`yuketang-ComplexAutomation.user.js`：`buildSamplingParams`、`getAIConf`、面板保存逻辑]
- `native:` userscript 元数据只有 `@match *://*.yuketang.cn/*`，但 `start()` 明确判断并尝试支持 `gdufemooc.cn/v2/web` 和 `gdufemooc.cn/pro/lms`。在当前安装方式下，脚本根本不会在该域名注入，相关分支是不可达代码。若确实要支持该站点，补充精确 `@match` 并真实验证；否则删除这些分支，避免虚假支持。 [`yuketang-ComplexAutomation.user.js`：header、`start`]
- `shrink:` `Utils.poll()` 的 `checker()` 在 `setInterval` 回调中直接调用，checker 抛异常时 Promise 不会 resolve/reject，定时器也不会清理，调用方会永久等待。轮询工具是所有 Runner 共用的边界，建议在工具内部捕获异常并 `clearInterval` 后 `reject`，或统一返回失败；不要在每个调用点分别补 try/catch。 [`yuketang-ComplexAutomation.user.js`：`Utils.poll`]
- `delete:` `ProNewRunner.run()` 调用 `Player.observePause(video)` 但丢弃其返回的清理函数。该函数会注册多个媒体/文档事件、MutationObserver 和 10 秒 watchdog；Pro 新版连续切换课程时这些监听会累积。应保存 cleanup，并在切换到下一视频、异常退出或 Runner 结束时调用。此项属于生命周期硬伤，不是单纯代码风格问题。 [`yuketang-ComplexAutomation.user.js`：`Player.observePause`、`ProNewRunner.run`]
- `shrink:` 完成度判断存在两套口径：`V2Runner.getCompletionState()` 只有 `100%` 才判定百分比完成，而 `Utils.isProgressDone()` 将 `98%`、`99%`、`100%` 都视为完成。两者分别用于目录扫描和内容页确认，可能造成“内容页认为完成、目录页仍认为未完成”的反复重载。不要直接统一阈值；应先确认雨课堂实际回写的最后进度，再把阈值抽成一个有注释的共享策略。 [`yuketang-ComplexAutomation.user.js`：`Utils.isProgressDone`、`V2Runner.getCompletionState`]
- `shrink:` `V2Runner.handleClassroom()` 调用 `Player.waitForEnd(media)` 时使用默认 `timeout = 0`，而 `Player.waitForEnd()` 在该模式下只等待 `ended` 事件。课堂 iframe 的媒体若加载失败、事件未派发或媒体对象被替换，流程会永久挂起且不会进入 `FailGate`。应沿用其他媒体路径的有限超时，并明确超时后的失败返回；这是控制流边界修复，不建议只在调用点加无限重试。 [`yuketang-ComplexAutomation.user.js`：`Player.waitForEnd`、`V2Runner.handleClassroom`]
- `shrink:` 判断题的非 JSON 回退解析先匹配 `正确|对|true|yes`，再匹配 `错误|错|false|no`；模型返回“不正确”或“不是正确答案”时，前一个正则会先命中并误判为“对”。纯 JSON 正常返回时通常不会触发，但应先处理否定词或限制为完整答案词。 [`yuketang-ComplexAutomation.user.js`：`Solver.parseAIAnswer`]
- `yagni:` `Solver.answerToIndices()` 的选项映射只覆盖 A-F，七个及以上选项返回 G/H 等答案时会被静默丢弃。若题面确实可能超过六项，应按选项数量生成字母映射并对越界答案告警；若平台题型已保证最多六项，则至少记录这一边界。 [`yuketang-ComplexAutomation.user.js`：`Solver.answerToIndices`]
- `shrink:` 旧版作业流程前面通过 `AiWorkspace.getExerciseDocument()` 支持同源 iframe，但 `V2Runner.handleHomework()` 取得题面时又直接查询顶层 `document`。如果旧版题目确实在 iframe 中，等待可能成功而 `targetEl` 仍为空，后续题型识别、截图和提交会失败。应先用真实旧版页面确认，再让题面查询贯穿同一个 document。 [`yuketang-ComplexAutomation.user.js`：`V2Runner.handleHomework`、`AiWorkspace.getExerciseDocument`]
- `shrink:` `Solver.autoSelectAndSubmit()` 没有返回提交结果；`AiWorkspaceRunner.solveExerciseQuestion()` 点击/填写后直接返回成功，V2 流程即使状态轮询超时也会把题目标记为继续处理。建议把“已点击提交”与“页面确认已提交”分成两个结果，避免提交失败被当作答题成功。 [`yuketang-ComplexAutomation.user.js`：`Solver.autoSelectAndSubmit`、`AiWorkspaceRunner.solveExerciseQuestion`、`V2Runner.handleHomework`]

## P1：权限、生命周期和边界风险

- `native:` `@connect *` 允许向任意用户输入的 API 域名发起跨域请求；这是“支持任意 OpenAI-compatible 服务”的最宽实现，但权限面明显大于当前列出的 OpenAI、DashScope、MiMo 等已知服务。若必须保留，至少在 README 明确该授权范围和 API Key 外发边界。 [`yuketang-ComplexAutomation.user.js`：userscript header、`Solver.askAI`]
- `delete:` `preventScreenCheck()` 全局改写 `window.addEventListener`、`document.addEventListener`、可见性属性和 focus API。它不是局部防暂停，而是对宿主页面公共 API 的全局补丁，可能影响雨课堂自身组件和其他用户脚本。由于它很可能是针对真实站点反切屏逻辑试错后的结果，不建议仅凭静态审查删除或改写；如需调整，必须在目标站点逐个验证播放、切页、交卷和页面恢复。 [`yuketang-ComplexAutomation.user.js`：`preventScreenCheck`]
- `shrink:` `Player.findPlayButton()` 先使用多组精确 selector，再扫描所有 `button, [role="button"], div, span` 并做文本/类名启发式匹配。这个全量扫描看起来昂贵且容易误点，但它明显是在兼容多种播放器 DOM。只指出，不建议主动收窄；只有拿到真实页面误选案例后才应删 selector 或增加限定范围。 [`yuketang-ComplexAutomation.user.js`：`Player.findPlayButton`]
- `yagni:` `AiWorkspace` 的路由解析包含 `lms-graph`、cloud、xcloud、generic V2 四套格式及多轮 fallback。代码情况复杂、诡异，可能是在应对不同学校/版本的真实 URL 逻辑；这里只指出维护成本，不建议抽象成“更漂亮”的统一路由器或删掉看似重复的分支，必须先基于真实网站路由样本确认。 [`yuketang-ComplexAutomation.user.js`：`AiWorkspace.getRoute`、`getGenericV2ContentRoute`]

## P2：结构与维护问题

- `yagni:` 面板、配置表单、日志持久化和 CSS 全部嵌在 `createPanel()` 中，单个函数承担 DOM、样式、交互、存储和拖拽生命周期。正常工程会拆分，但本项目明确要求单文件交付；建议暂不拆文件。若后续仍在同一函数增加功能，最低限度是在文件内按职责拆成几个局部函数，而不是引入组件框架。
- `shrink:` V2、旧 Pro、新 Pro、ai-workspace 各自重复“点击入口—等待—播放/处理—确认进度”的模式。它们的 DOM 和返回机制不同，不能直接合并；可考虑只提取已经稳定且不含站点 selector 的公共等待/清理逻辑。当前不建议为了减少重复而做跨路线大重构。
- `yagni:` `ProOldRunner` 基本是转发/兼容层，`ProNewRunner` 才承载主要逻辑。这不是必须删除的死代码，因为 `start()` 通过 `.btn-next` 在运行时区分新旧页面；应保留，但在注释中明确它是旧版兼容入口，避免后来误以为它是第二套完整实现。
- `shrink:` `README.md`、`AGENTS.md` 和实际实现都维护了路由、完成度、续跑和 AI 配置说明。`AGENTS.md` 详细描述了架构约束，README 面向使用者；两者职责可以保留，但每次行为变更都要检查三处是否同步，否则文档会比代码更早失真。

## 复杂但暂不建议改动的部分

以下代码从普通 JavaScript 结构看确实绕、重复或启发式很重，但项目说明已经表明它经过目标网站真实场景验证。代码情况复杂/诡异，可能是应对网站某个隐藏逻辑、异步渲染或不同版本 DOM 的结果；这里只指出，必须在真实网站逻辑理解的基础上才尝试修改：

1. `V2Runner.returnToList()` 的 `history.back()`、等待目录、再 reload，以及随后抛出 `NavigationStop` 的组合。它是跨页/同页路由状态机，不要改成简单 `location.href` 或删除异常控制流。
2. `V2Runner.run()` 每轮只处理一个项目、依赖服务端 DOM 进度而不保存索引。看起来低效，但它规避了目录刷新后索引失效，不能改成内存游标。
3. `handleBatch()` 中 `.leaf_list__wrap` 不在 `section` 内，以及只处理一个子项后返回重扫。selector 范围看起来反直觉，但可能正是页面结构事实。
4. `Player.observePause()` 同时使用 pause 事件、MutationObserver、事件信号和低频 watchdog。逻辑较长，但站点播放器可能只在其中一条路径上暴露暂停；不要单独删除 watchdog 或 UI click fallback，除非真实验证覆盖所有暂停场景。
5. `Solver` 的多层截图、选项 selector、SSE 解析和模型响应 fallback。它们有明显重复，但服务商响应格式与雨课堂题型 DOM 不稳定；先修复可复现样本，不要做大规模统一解析器。
6. `AiWorkspace` 访问 `iframe.contentDocument`、Vue 私有 `__vue__` 数据和多种题目状态标记。访问私有字段不优雅，但可能是当前页面唯一可得到题目提交状态的途径；只能在确认替代数据源后修改。

## 建议的最小修改顺序

1. 先修 `Utils.poll()` 异常不收敛和 `ProNewRunner` 播放监听 cleanup；这两项属于共用基础设施/生命周期问题，改动小，收益明确。
2. 清理两个无效配置点：`aiMaxOutputTokens`、`forceSamplingParams`，并决定 `SystemPrompt.md` 与 `Solver.buildPrompt()` 的唯一来源。
3. 决定 `gdufemooc.cn` 是正式支持还是删除不可达分支；不要保持“代码说支持、元数据不注入”的中间状态。
4. 对完成度 98/99 阈值和所有复杂 selector 做真实站点回归后再调整。没有真实页面证据时，只记录，不重构。

## 其他检查

- 主脚本语法检查：通过。
- 项目无构建系统、测试框架或自动化运行时测试；浏览器安装 userscript 后的真实目录页回归仍是必要验证。
- 本报告未修改 `ref/`，也未修改主脚本。

net: 删除确认的死配置和工作区配置约 5–15 行，暂无必要新增依赖；其余建议以小范围修复为主。
