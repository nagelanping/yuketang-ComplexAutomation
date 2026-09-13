# 项目审查报告（2026-09-13）

范围：`yuketang-ComplexAutomation.user.js`（v1.3.2，单文件约 5190 行，其中 410KB 的 `MAP_DATA` 与 700 行面板模板占大头）、`SystemPrompt.md`、`README.md`、`AGENTS.md`、`OBSERVE.md`。`ref/` 只作参考，未提出修改。

方法：全文件通读 + 符号引用计数（`rg`）+ `ykt-ff`（marionette）实机核查，并与 `OBSERVE.md` 的实机记录对照。`node --check yuketang-ComplexAutomation.user.js` 通过。文中的页面结论都注明了核对方式；没核对的项标「待验证」。

## 分类口径

本次审查把「历史遗留」与「防御冗余」分开处理，判据是**是否存在真实网页证据**：

- **历史遗留**：被后续重构替代、或全仓库只有定义没有任何调用点，删除不影响任何可达路径。
- **防御冗余**：选择器成组、时长成组、返回格式成组，背后是对同一网站不同版本/不同路由的适配，或有 `OBSERVE.md` 实机记录支撑。**这类一律不建议靠静态阅读收窄**，只有在实机复现误判时才动。
- **待验证遗留**：静态看像废弃，但目标网站是否还走这条路无法从代码判定。这类只列清单，先验证再决定。

## 结论摘要

脚本主体（交棒模型、FailGate、反混淆、AI 答题管线）结构是清楚的，注释也基本跟得上。真正的问题集中在三块：

1. **V2Runner 里躺着一整簇交棒重构前的旧实现**，约 450 行，只有定义没有调用点，其中 `handleHomework` 还是「截图答题」的第二份实现。这是最大、最安全的一刀。
2. **少量配置项和开关永远不会生效**（`Config.aiMaxOutputTokens`、`forceSamplingParams`、`Decipherer` 的两个常真开关、不可达的 `gdufemooc.cn` 分支），使用者改了也不会有任何效果。
3. **`SystemPrompt.md` 与 `Solver.buildPrompt()` 已经双向漂移**，`README.md` 有若干处与实现相反。文档是使用者的操作依据，漂移的代价比代码脏更大。

其余是若干可以从代码直接确认的逻辑边界问题（`Utils.poll` 不收敛、成功/失败返回值不分、课件成功判定漏洞等），逐条列在第三节，其中涉及网页行为的都标注了必须先实机验证。

---

## 一、可直接删除的历史遗留

### 1. `delete:` V2Runner 旧内容处理簇（约 450 行）

`V2Runner.handleVideo`、`playCurrentVideoUntilProgressDone`、`playAudioItem`、`playVideoItem`、`autoCommentItem`、`handleHomework`、`waitForMediaElement` 全仓库引用计数均为「定义 + 0 调用」。

证据链：

- `V2Runner.run()` 现在只分发 `openContentEntry`（交棒）、`handleBatch`、`handleClassroom`、`handleCourseware` 四种结果，`isHomework` 也走 `openContentEntry`。
- `OBSERVE.md`「进入行为」已实测：点击目录条目**必然新开标签、焦点跟随、目录文档里没有 media 元素**。这批旧方法的前提（同文档导航）已被证伪，它们正是历史死循环的成因，不可能再被正确调用。
- `waitForMediaElement` 的两个调用点都在上述死方法内。
- `handleHomework` 与在用的 `AiWorkspaceRunner.handleExercise` + `solveExerciseQuestion` 是同一件事的两份实现，保留只会让后续改动漏改一处。

建议：整段删除，`V2Runner` 收敛为「目录扫描 + 交棒 + 课堂/课件内联路径」。删完后同步更新 `AGENTS.md` 里 V2 执行模型一节，明确 V2Runner 不再持有任何媒体处理代码。

验证方式：删除后必须做一次 `ykt-ff` 实机回归——目录页点开始，观察面板日志与 `ykt-ff tabs` 标签数，确认交棒、回目录、重扫三段仍正常；这批死代码虽无调用点，但它与在用的 `handleBatch` 相邻，误删风险要靠这次回归兜住。

### 2. `yagni:` `Config.aiMaxOutputTokens`

只有声明，没有任何读取点；实际请求的 max tokens 由 `Solver.getMaxOutputTokens()` 计算（`thinkingEnabled` → 32768，否则 4096）或使用面板里的手工值。注释「兼容 CoT 模型，避免 thinking 阶段截断」与今天的默认值已对不上，留着只会让人以为改它能生效。

### 3. `yagni:` `Solver.buildSamplingParams()` 与 `forceSamplingParams`

`Store.getAIConf()`、面板保存逻辑、默认 AI 配置都没有 `forceSamplingParams` 字段，该分支在任何配置下都不会进入，函数恒返回 `{}`；payload 里的两处展开（Chat 与 Responses 两条路径）等于空操作。`README.md` 结尾还写着「除非内部强制采样参数开关被启用」，属于已不存在的开关。

建议：删函数、删两处展开、删 README 那句。若确实需要「部分服务商要求固定温度」的能力，再把它做成真正的面板开关，不要保留假开关。

### 4. `delete:` `Decipherer.deobfEnabled` / `fontDisabled`

两个字段被初始化为 `true` 后再没有人改过，代码里却按「可能为 false」写了四处分支（`main()`、`onRouteChange()`、MutationObserver 提前 return）。这是从 `ref/yuketang-deobfuscator` 移植时留下的菜单开关残骸——上游有 UI 面板可以关它。

建议：既然反混淆是常开且截图答题依赖它，就把分支收敛掉，保留一句注释说明「上游的开关未移植，本脚本恒开」。**不要**顺手把它接成面板开关：截图答题依赖解码，关掉只会产生乱码工单。

### 5. `native:` `gdufemooc.cn` 分支不可达

`start()` 里判断 `matchURL.includes("gdufemooc.cn/v2/web")` 与 `gdufemooc.cn/pro/lms`，但 userscript 元数据只有 `@match *://*.yuketang.cn/*`，脚本在该域名根本不会注入。

这需要机主决定，不是能自行拍板的清理项：

- 若该站点确实在使用范围内 → 补一条精确 `@match`（不要用通配），并实机验证路由与选择器；
- 若不在范围内 → 删掉两处分支，避免「代码宣称支持、实际不注入」的中间状态。

---

## 二、文档与代码漂移

### 6. `shrink:` `SystemPrompt.md` 与 `Solver.buildPrompt()` 已双向不一致

单文件交付决定了 prompt 必须硬编码进脚本，但 `SystemPrompt.md` 被定位为源文本，两者现在各缺一块：

| 位置                 | `SystemPrompt.md`                                    | `Solver.buildPrompt()`                                   |
| -------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| 背景段的 refuse 说明 | 有（「必须如实返回 refuse」）                          | **缺**                                               |
| JSON Schema          | 含`refuse`，并注明「type = refuse 时不输出 answers」 | **缺**（只列四种题型）                               |
| refuse 示例          | 示例 4、示例 5                                         | **缺**                                               |
| 推理字段说明         | 无                                                     | 多一句「模型支持 reasoning / thinking 时可在该字段内推理」 |

后果：`parseAIAnswer` 与 `autoSelectAndSubmit` 的 refuse 分支（跳过、不选不提交、10 秒后继续）依赖模型自发输出 `{"type":"refuse"}`，而当前下发的 prompt 完全没告诉模型可以这样返回。这是行为与文档脱节，不只是文案问题。

建议：以 `SystemPrompt.md` 为准把 refuse 那段回写进 `buildPrompt()`（`SystemPrompt.md` 的 refuse 内容是最近的刻意改动，代码侧是漏同步的一方），并把代码里那句 reasoning 说明补回 md，保持两者逐字一致。改完请在实机题目上验一次乱码/超纲题的返回，确认模型确实走 refuse 分支。

### 7. `shrink:` `README.md` 已与实现相反

- 「可选启用雨课堂字体反混淆补丁（**默认关闭**）」——实现是 `boot()` 内无条件 `Decipherer.start()`，且 `Decipherer` 的开关恒真。应是「常开，截图答题依赖」。
- 面板按钮名为 `模型设置` / `清除失败记录` / `开始`，README 写的是 `AI配置` / `开始刷课`。
- 「默认不发送 temperature 和 top_p，除非内部强制采样参数开关被启用」——该开关不存在（见第 3 条）。

`README.md` 是给使用者看的操作依据，这几条会直接误导操作。建议与第 3、4 条一并修。

### 8. `shrink:` AGENTS.md 里关于死代码的说明与代码强耦合

`AGENTS.md` 的「V2 执行模型」逐名列出了 `handleVideo`、`playVideoItem` 等交棒前的遗留方法，并写明「全仓库没有任何调用点，不要照抄」。这段说明与第 1 条的死代码同生共死：删除死代码时必须在同一次改动里把这段、以及「ai-workspace 叶子遍历」锚点里对已删符号的引用一并改掉，否则文档会指向不存在的符号。

---

## 三、可从代码确认的逻辑缺陷

按修复价值排序。前两条属共用基础设施，改动小、收益明确。

### 9. `shrink:` `Utils.poll()` 的 checker 抛异常会让 Promise 永不落定

`poll()` 在 `setInterval` 回调里直接调用 `checker()`。checker 抛错时该次 tick 直接中断，`clearInterval` 与超时判定都在其后面，永远执行不到——调用方会永久挂起（既非完成也非超时）。`poll` 是所有 Runner 共用的等待边界，`handleMedia`、`handleExercise`、`returnToList` 等都在用。

建议：在工具内部包一层 `try/catch`，捕获后清理定时器并 `resolve(false)`（或统一 reject），不要在十几个调用点各补一次。

验证方式：这条改动不依赖网页行为，改完在浏览器 Console 里塞一个必抛的 checker 确认会返回 `false` 即可；随后跑一次完整目录页回归确认原有等待语义没变。

### 10. `shrink:` `Solver.autoSelectAndSubmit()` 成功与失败返回值不分

该函数在成功路径上不返回值（`undefined`），只在 refuse 时返回 `"refused"`。以下分支都返回 `undefined`，调用方一律当作提交成功：

- 未找到选项容器 / 未提取到有效选项；
- 填空题未提取到答案 / 未找到填空输入框；
- **未找到提交按钮**（只打了 warning 日志）。

调用方 `AiWorkspaceRunner.solveExerciseQuestion` 之后直接 `return true`，`isExerciseAnswered` 也只被用来跳过已答题目。这样「点了选项但没提交成功」会被计为完成，`FailGate` 也不会介入。

建议：把返回值显式化（例如 `"submitted" | "refused" | "incomplete"`），调用方据此决定重试、继续下一题还是让 `FailGate` 计数。注意删除死代码后调用方只剩 `AiWorkspaceRunner` 一处，改动面很小。

需要实机确认的一点：提交后页面是否有可靠的成功回写（`isExerciseAnswered` / `isProblemSubmitted` 是否在点击后变真）。`OBSERVE.md` 没有作业提交回写的记录；脚本里唯一提到「提交状态未及时回写」的日志（`rg -n "提交状态未及时回写"`）落在第 1 条拟删除的 `handleHomework` 里，说明旧实现在这条路径上就遇到过观测不到回写的情况，但那不是当前活路径的证据。**请先用 `ykt-ff` 在一个真实作业上观察点击提交后的 DOM 变化**，再决定 `"incomplete"` 的判据是「点了提交按钮」还是「页面回写已答」。

### 11. `shrink:` `Solver.parseAIAnswer()` 判断题的否定词误判

非 JSON 回退路径先匹配 `/正确|对|true|yes/`，再匹配 `/错误|错|false|no/`。模型返回「不正确」「不是正确答案」时会先命中前一条，判成「对」。纯 JSON 返回时通常不触发，但这条回退路径存在的意义就是兜住非 JSON 输出，方向正好相反。

建议：先判否定（`不正确|不对|错误|不是`），或用锚定的完整答案词匹配。不需要实机验证，但请补一个最小的自测用例（做法见第五节最后一条）。

### 12. `yagni:` `Solver.answerToIndices()` 只映射 A–F

答案含 G/H（七项以上选项）时会被静默过滤，最终走到「未提取到有效选项，请人工检查」。若雨课堂题型保证最多六项，这属于已知边界，建议补一行注释说明；若不保证，按 `optionCount` 生成字母表并越界告警。判定依据需要一次实机样本：找一个选项数 ≥ 7 的题目看目录/题号是否可能出现。**没有样本时不要改**，也不要扩大字母范围去猜。

### 13. `shrink:` `V2Runner.handleCourseware()` 的「已查看课件」判定可能放过未推进的项

函数末尾是 `if (!hasCheckBtn && !isPPT && !videoBox) return false;`。也就是说：只要匹配到了「查看课件」按钮（`hasCheckBtn` 为真），即使点击后既没找到 PPT 也没找到 `.video-box`，仍然 `return true`。`run()` 收到 `true` 会 `FailGate.reset(failKey)` 并重载目录——若课件实际是在**新标签**里打开的，就会形成「重置计数 → 重载 → 再点 → 再开一个标签」的循环。这与 AGENTS.md 已记录的「V2 目录条目点击会新开标签 + 目录文档找不到元素」是同一类根因。

同一页面上还有一个放大因素：`isPPT` 的判据包含 `document.querySelector(".el-card__header")?.innerText.includes("PPT")`，概况页卡片标题很容易命中；一旦 `isPPT` 为真就会进 `playPPTSlides`，而 `resolveSlides` 找不到幻灯片时转 `playPPTByNavigation`。后者的退出条件是「页码指示器连续 3 轮不变」，当页面上**既没有指示器也没有翻页按钮**时 `currentPage` 恒为空串，`sameCount` 永远是 0，循环会一路跑到 `maxPages = 200`（每轮 `pptInterval` 3 秒，约 10 分钟），最后仍返回「已播放完毕」→ `handleCourseware` 返回 `true`。

这两处叠加，就是「课件项看起来处理成功、实际上什么都没做，而且可能每轮多开一个标签」的风险。

建议（**必须先实机验证再改**）：

1. 用 `ykt-ff` 打开一个真实的课件（概况）项，确认「查看课件」点击后是**同页弹层**还是**新标签**。`AGENTS.md` 明确写着这条路径「未实测确认这类会不会也新开标签」，所以现在两种可能都成立。
2. 若确认同页弹层：问题在检测时机，应把 `isPPT` 判定改成「点击后轮询等待弹层出现」，而不是在固定 2 秒后一次性判断，也不要动成功判据。
3. 若确认新标签：`handleCourseware` 应改走 `HANDOFF`（与 `openContentEntry` 同样处理），绝不能再用 `return true`。
4. 无论哪种结论，`playPPTByNavigation` 都建议加一条「既无指示器又无翻页按钮 → 记录日志后直接退出」的收敛条件——它在当前任何分支下都推不动页面，跑满 200 轮只会白等。这条同样建议在实机 PPT 页面上验证一次正常翻页路径未被破坏。

### 14. `shrink:` `V2Runner.handleClassroom()` 的 `Player.waitForEnd(media)` 没有超时

调用处不传 `timeout`，`Player.waitForEnd` 在该模式下只等 `ended` 事件。课堂 iframe 的 media 若加载失败、事件未派发或被替换，`run()` 会永久停在这一轮：面板显示运行中，但既没有 `FailGate` 计数也没有任何后续动作。

建议：沿用其他媒体路径的做法，用 `Utils.getDDL(media)` 生成有限超时，并在超时后如实返回未推进。

**这条必须实机验证**：`handleClassroom` 依赖 `iframe.lesson-report-mobile`，而该选择器目前没有任何 `OBSERVE.md` 记录；同时课堂条目是否也「点击开新标签」同样未验证。请先用 `ykt-ff` 打开一个真实课堂条目，记录 iframe 是否存在、media 是否派发 `ended`、点击后目录标签是否原地不动，再动这段代码。

### 15. `delete:` `ProNewRunner.run()` 丢弃 `Player.observePause()` 的清理函数

`observePause` 会注册 `pause`/`timeupdate`/`playing`/`waiting`/`stalled`、`visibilitychange`、`focus` 监听，以及一个 10 秒 watchdog 和一个 MutationObserver，并返回清理函数。其余的调用点（`playPPTSlides`、`AiWorkspaceRunner.handleMedia`，以及第 1 条拟删除的 `playCurrentVideoUntilProgressDone`）都保存并调用了它，只有 `ProNewRunner` 直接丢弃。Pro 新版连续切课时这些监听会累积。

建议：保存 cleanup，在切到下一集前、异常退出时或循环结束时调用。这条依赖 Pro 页面，如果第 17 条的验证结论是「Pro 路由已废弃」，随整条 Runner 一起删除即可。

### 16. `shrink:` 完成度存在两套口径

`Utils.isProgressDone()` 把 `98%`、`99%`、`100%`、`已完成` 都视为完成，`V2Runner.getCompletionState()` 对百分比只在 `>= 100` 时判 `completed`。两者一个用于内容页自查、一个用于目录扫描。删除死代码后 `isProgressDone` 只剩 Pro 新版与课件路径在用，冲突面变小，但仍存在「内容页认为完成、目录页认为未完成 → 再点一次」的可能。

建议：不要为了「统一」直接把阈值改成同一个数。先确认雨课堂实际回写的最后进度值（`OBSERVE.md` 里有 `75% 进行中`、`3% 进行中` 的记录，缺临近完成时的样本），拿到样本后再把阈值抽成一个带注释的共享策略。

### 17. `yagni:` `ProNewRunner` 的持久化索引游标与架构约束相悖

`Store.getProClassCount()/setProClassCount()` 把「刷到第几集」写进 localStorage（`pro_lms_classCount`），而 `AGENTS.md` 对 V2 明确要求「不要加入持久化索引游标」，理由是目录刷新后索引会失效、漏掉中间未完成项。Pro 这条链路用的是相反的模型，属于尚未重构的历史分支。

可达性现状（2026-09-13 实机）：V2 目录页主文档里挂着一个隐藏（宽高 0）的 `iframe.tab-pane-content-iframe`，`src` 指向 `/pro/lms/{token}/{classroom_id}/studycontent?...`——站点**仍在引用** `/pro/lms/*`；但没有观测到用户级入口（V2 目录条目点进去落的是 ai-workspace 路由），所以不能据此断定 `start()` 的 pro/lms 分支已不可达。

处理方式：

- 在拿到「该路由已无用户入口」的实机证据之前，保留 `ProOldRunner` / `ProNewRunner`，并补上第 15 条的 cleanup；
- 若确认无入口，再整簇删除：两个 Runner、`start()` 的 pro/lms 分支、`Store` 的 `proClassCount` 三个方法与 storage key 一并清理；
- 无论去留，都应在代码注释与 `AGENTS.md` 里写清「Pro 旧版是游标模型，与 V2 的 DOM 进度模型有意不同」，避免后来者当成漏改。

---

## 四、明确不建议收窄的防御性冗余

以下内容看起来重复、绕、启发式很重，但都有明确的存在理由，**不建议在没有实机反例的情况下清理**。列出以区分「防御」与「遗留」：

- `FailGate` 的 `-1` 哨兵与 `maxAttempts` 计数、`PauseGate`、`NavigationStop`、`HANDOFF`：分别是防死循环、统一暂停、导航后终止旧 async 栈、交棒信号，四者职责不同，不要合并。
- `AiWorkspaceRunner.returnToSource()` 的 `window.opener` 优先 + 失败回退导航：AGENTS.md 已记录 `window.close()` 可能被浏览器拒绝，且明确警告「close 失败就自己也跳目录」会产生两个自动续跑的目录标签。这段逻辑保持原样。
- `Player.observePause()` 的多路径（pause 事件、MutationObserver、visibilitychange/focus、10 秒 watchdog）：站点播放器可能只在其中一条路径暴露暂停，AGENTS.md 已记录不要单独删除 watchdog 或 UI click 回退。
- `Player.prepareMedia()` + `freezeMuted()`：`OBSERVE.md` 有完整的「解除静音看门狗」实机结论（含必须先真实静音再冻结属性的原因），是实测序列，不要简化。
- `Player.findPlayButton()` 的长选择器表与文本启发式、`Solver.getOptionElements()` 的分组降级、`Solver.getOptionContainer()` 的一串 `[class*=]`：都是在兼容未知 DOM 变体，只有拿到误选/漏选的真实页面再收窄。
- `AiWorkspace.getRoute()` / `getGenericV2ContentRoute()` 的四套路由与多轮 fallback：AGENTS.md 明确说明不要抽象成「更统一的」路由器。
- `AiWorkspace.getExerciseDocument()` 的多文档探测、`getExerciseProblems()` 读 Vue 私有 `__vue__`：访问私有字段不优雅，但这是当前页面唯一拿到题目提交状态的途径；只有在确认更稳的数据源后才替换。
- `Solver` 的 SSE 解析、`extractAIText()` 多格式回退、`normalizeEndpoint()` / `inferAuthMethod()` 的多服务商适配：服务商响应格式不稳定，先修可复现样本，不做大规模统一解析器。
- `preventScreenCheck()`：全局改写 `window.addEventListener` 等宿主 API，副作用面大，但它是试错后的结果，且 `OBSERVE.md` 记录的失焦暂停行为变化说明这条路径确实需要处理。**不建议凭静态阅读改写**，需要调就必须逐项验证播放、切页、交卷、页面恢复。
- `Solver.captureQuestionImage()` 的 `onclone` 字体改写与 `Decipherer.stripFontFamily()`：有 `OBSERVE.md`/AGENTS.md 的实测根因链（canvas 的 CJK 回退命中混淆字体），删任何一条都会复现截图乱码。

## 五、结构性建议（低优先，非必须）

- `createPanel()` 约 700 行，其中 `doc.write` 的模板字符串约 400 行（CSS 约 300 行）。单文件交付是硬约束，但可以**在同文件内**把 CSS/HTML 提为模块级常量（例如 `PANEL_CSS`、`PANEL_HTML`），让 `createPanel()` 只剩挂载、拖拽、日志与事件绑定。收益是可读性，不是行数。
- `Solver.buildPrompt()` 返回 `{ system }` 单字段对象，调用处又解构一次；直接返回字符串即可。
- 面板里的 `defaultAI` 与 `Store.getAIConf()` 各维护了一份默认值（url/model/apiFormat/authMethod 等），已存在漂移风险。保留一处即可。
- 仓库卫生：`tmp/` 下约 2.8MB 的探针产物（`MAP_DATA.js`、`opentype.min.js`、`html2canvas.js`、多份 `h2c-out*.txt`）与空目录 `遗言/` 均在 `.gitignore` 中，属于本地草稿。建议清理掉已不再需要的副本，只留 `tmp/decipherer-selftest.cjs` 这类仍要复用的自测脚本。
- 建议补的最小自测：`tmp/decipherer-selftest.cjs` 是很好的样板（把纯逻辑抽出来逐字比对断言）。`Solver.parseAIAnswer()` 的回退解析（含第 11 条的否定词用例）、`V2Runner.getCompletionState()` 的混合状态串分类，都是同样性质、目前完全没有测试的纯逻辑，值得各补一个最小 `assert` 检查。不要把整个 `Solver` 拆出来测，只测这两个函数。

## 六、建议的修改顺序

1. **删死代码**：V2Runner 旧内容处理簇（第 1 条）→ 随后必须做一次 `ykt-ff` 目录页全流程回归（交棒 / 回目录 / 重扫 / 标签数稳定）。
2. **清死配置**：`aiMaxOutputTokens`、`forceSamplingParams`、`Decipherer` 两个常真开关（第 2–4 条），顺带修 README 对应段落（第 7 条）。
3. **同步 prompt**：`SystemPrompt.md` ↔ `Solver.buildPrompt()`（第 6 条），并在一个真实题目上验证 refuse 分支。
4. **修共用基础设施**：`Utils.poll()` 异常收敛、`autoSelectAndSubmit()` 返回值显式化（第 9–10 条）。第 10 条改前需先观察作业提交回写。
5. **实机验证后再动**：课件（第 13 条）、课堂（第 14 条）、Pro 路由存废（第 15、17 条）、完成度阈值（第 16 条）。这四项只记录结论、不预改代码；清单与 `OBSERVE.md` 文末的「仍待实机验证」保持同一份。
6. **最后**：删死代码时同步删掉 `AGENTS.md` 里那段死代码说明（第 8 条），并核对「代码导航」里的锚点仍能命中。

## 附：本次审查使用的核查命令

```sh
rg -n "^  (const|let|class|function|async function) " yuketang-ComplexAutomation.user.js
rg -n "handleVideo|playCurrentVideoUntilProgressDone|playAudioItem|playVideoItem|autoCommentItem|handleHomework|waitForMediaElement" yuketang-ComplexAutomation.user.js
rg -n "aiMaxOutputTokens|forceSamplingParams|deobfEnabled|fontDisabled|gdufemooc" yuketang-ComplexAutomation.user.js
rg -n "buildPrompt|^function boot|Decipherer.start" yuketang-ComplexAutomation.user.js
node --check yuketang-ComplexAutomation.user.js

# 实机核查（marionette）。注意 ykt-ff 每次调用都是新会话，
# 「切标签 + 执行」必须在同一次连接内完成，做法与陷阱见 FIREFOX.md
ykt-ff tabs
```

---

net: 可删除约 470 行（死方法簇 + 死配置 + 死分支），无新增依赖；另有约 4 处需先做 `ykt-ff` 实机验证才能决定去留。
