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

交棒回归（同日，`ykt-ff`，班级 {classroom_id}）：目录每轮只点一个未完成条目并交棒；新标签落 ai-workspace 并处理；处理完由 `returnToSource` 把目录导航回目录重扫；约 4 分钟内网页标签数恒为 2，无逐轮增长；`HANDOFF` 后目录未自我重载。工作包 A 完成。

附带发现（不在本工作包范围）：`autoCommentItem` 删除后，`autoComment` 开关不再对应任何发帖实现；开启时讨论子项仍会被交棒，新标签不处理该类型，空转 `maxAttempts` 后被 `FailGate` 跳过而条目永不完成。

## 2026-09-13 工作包 N：AI 拒答时通知来源目录跳过（机主实机提出）

问题：交棒进作业页后 AI 对某题 refuse，脚本只跳过该题；该作业已不可能刷完，但目录看不到，重扫把「进行中」当遗漏继续交棒，同一份作业重复进入 3 轮（FailGate 满）才跳过。

改动：`handoffKey`（`ykt_handoff_key`）交棒前写入 sessionStorage；`FailGate.markRefused/refused` 用哨兵 `-2`，子标签经 `window.opener.sessionStorage` 回写来源目录；`solveExerciseQuestion` refuse 分支调用它；`handleBatch` 扫描时跳过并打 warning；`boot()` 启动即清掉来源那份 key。

验证（待机主实机）：refuse 后目录应在同一轮跳过该子项（日志「…：AI 拒绝作答，已跳过（请人工处理）」），而不是再进 3 轮；无 opener 时退回原行为。

关键实机字段（记入 `OBSERVE.md`）：交棒子标签继承目录 sessionStorage 的拷贝且此后两边独立（同一 key 两边计数 3 / 2）；作业单题提交会回写（`isExerciseTabAnswered` 变真），目录状态则是服务端异步回写，3 轮后才翻成「已完成」；目录条目本身无 id 属性，`__vue__.$props.leaf.id` 与 ai-workspace URL 的 leaf id 一致。

## 2026-09-13 工作包 C：按 SysPmt_Homework.md 重新生成答题 prompt

机主改写了 `SysPmt_Homework.md`（示例 5 改为「访问链接后作答」，新增示例 6「访问链接失败 → refuse」）。按其正文重新生成 `Solver.buildPrompt()`：背景段补回 refuse 规则、Schema 含 `refuse` 且注明不输出 `answers`、示例 1–6 与之逐行对齐。

反向的一处（代码有、md 无）按原计划补回 md：`输出约束` 新增 reasoning / thinking 字段说明。

新增 `tmp/prompt-sync-check.cjs` 作最小自测：断言 md 正文与代码 `system` 数组逐行一致，本次结果 93 行一致；`node --check`、`git diff --check` 通过。

附带提醒（未改）：示例 5 与示例 6 前提都是「题目要求访问链接」，结论相反（5 是能答、6 是不能答），若所用模型没有联网工具，示例 5 可能诱导编造答案。

版本：`@version` 1.3.2 → **1.4.0**（死代码删除 + AI 拒答回写来源目录 + prompt 重建）。

## 2026-09-13 工作包 B：删除失效配置并修 README

删除 `Config.aiMaxOutputTokens`（无读取点）、`Solver.buildSamplingParams()` 与两条 payload 展开（`forceSamplingParams` 从未写进过配置，函数恒返回 `{}`）、`Decipherer.deobfEnabled` / `fontDisabled` 两个常真字段及其分支，并就近注明上游开关未移植、反混淆恒开。

README 按当前 UI 修正：面板按钮改为 `模型设置` / `清除失败记录` / `暂停`，反混淆标为常开且截图答题依赖，「内部强制采样参数开关」一句改为「不发送 `temperature` 与 `top_p`」。另修为同类漂移：日志消息「请在 [AI配置] 中填写有效的 API Key」→「[模型设置]」。

验证：`rg` 五个失效符号在 userscript 与 README 中均无命中；`node --check`、`git diff --check`、`tmp/prompt-sync-check.cjs` 通过；`Decipherer.start()` 仍在 iframe 与主文档两条启动路径上。

待机主定夺（未动）：面板勾选框「自动回复图文与讨论区」（`autoComment`）自工作包 A 删除 `autoCommentItem` 后已无实现，开启只会让讨论子项空转并被 FailGate 跳过。要么按新标签侧接住评论类型实现它，要么连开关一起删。

版本：`@version` 1.4.0 → **1.4.1**（失效配置删除 + README/日志文案同步，无行为变更）。

## 2026-09-13 工作包 O：讨论区自动回复退回框架（机主指示）

删除面板勾选框「自动回复图文与讨论区」、`Store.getFeatureConf()` 的 `autoComment` 及对应的 `ui` 引用与保存逻辑；`handleBatch` 的讨论区分支不再看开关，`taolun` / `forum` 子项一律就地 `FailGate.skip` + warning，不交棒。

框架以注释形式留在该分支上方：未来交棒的新标签读主题与楼层 → `askAI` 生成回复（现有 `askAI` 只吃题目截图，需先扩展文本入参）→ 填入回复框并提交 → 成功后 `returnToSource`。注释同时写明在此之前交棒只会空转。

README 同步：功能列表注明讨论区自动回复尚未实现；「模型设置」一项去掉该开关。

未跑 Firefox：改动是跳过分支与面板结构，待机主实机确认面板只剩「自动作答作业与题目」、讨论子项日志为「讨论区自动回复尚未实现，跳过」。

## 2026-09-13 工作包 D：Utils.poll() 异常收敛

`Utils.poll()` 的 checker 原先裸调：抛错时那次 tick 直接中断，`clearInterval` 与超时判定都在其后，Promise 永不落定。现在把 `checker()` 包进 `try/catch`，抛错则打印 `[poll] checker 抛错，按未满足返回 false` 并 `clearInterval` + `resolve(false)`，与超时同一语义；未改 reject，未在调用点补 try/catch。

新增 `tmp/poll-selftest.cjs`：从 userscript 正则抽出 `poll` 方法体执行（不与实现写两遍），断言 checker 成功返回 true、超时返回 false、抛错在有限时间内返回 false、抛错后 interval 已清理。旧实现下第三项会因 Promise 悬空而失败。

实机待办：目录页跑一遍基础流程，确认原有等待语义未变（唯一变化分支是 checker 抛错，各调用点拿 false 后走「未确认，本轮不推进」并靠 FailGate 封顶）。

## 2026-09-13 工作包 E：修判断题文本回退

`Solver.parseAIAnswer()` 的非 JSON 判断题回退原先「先肯定后否定」，`不正确` / `不是正确答案` 会先命中「正确」被判成「对」。改为先判否定（`不正确|不对|不是|错误|错|false|no`）再判肯定，未扩成自然语言分类器。

同段代码的第二个坑（自测时发现）：`JSON.parse("true")` / `JSON.parse("false")` 是合法的，但结果不是答案对象，原逻辑会走 JSON 分支返回空 `answers`。现在只有解析结果为对象才走 JSON 分支，其余落到文本回退，于是裸 `true`/`false` 也能判成对/错。

自测 `tmp/parse-answer-selftest.cjs`（从 userscript 抽出方法体执行，`panel` 用桩）：6 例肯定、7 例否定、JSON（围栏 / 无 type / refuse）、其他题型回退，全部通过。

未改但同类：`answerToIndices()` 判 `truefalse` 答案时仍是先肯定后否定，`answers:["不正确"]` 会映射成「对」；属 JSON 路径语义，需单独决定。

补充（同日，机主指示）：判断题的对/错判定统一到两处、同一条规则——否定标记收窄为「不」（`/不|错|false|no/i`，覆盖 不是/不正确/不对/不符合），并先判否定后判肯定。`parseAIAnswer` 的非 JSON 回退照此简化；`answerToIndices()` 的 `truefalse` 分支同样改序，原先 `answers:["不正确"]` 会按「对」去点第一个选项，现在点第二个。`A`/`B`/`对`/`错`/`true`/`false` 的映射不变。

自测扩到两个函数：肯定 6 例、否定 8 例、JSON 三例、其他题型两例、选项映射两组，全部通过。

## 2026-09-13 工作包 F：显式区分答题提交结果

`Solver.autoSelectAndSubmit()` 原先成功路径不返回值（`undefined`），只在拒答时返回 `"refused"`，于是「点了选项但没找到提交按钮」也被调用方当成完成。现在返回三态：`refused` / `incomplete`（缺选项容器、无有效选项、填空无答案、找不到提交按钮）/ `filled`（已填写并点击了提交按钮）。

`filled` 不等于成功：`solveExerciseQuestion(root, label, tab, index)` 新增后两个参数，用实机观测确认会回写的判据复核——`Utils.poll(() => isExerciseQuestionSubmitted(root, tab, index, true), { interval: 500, timeout: 8000 })`；确认到才返回 true，8 秒没回写则 warning + 未推进。`tab`/`index` 由 `handleExercise` 的题号列表循环传入；无题号列表的路径没有 tab，退回纯 DOM 的 `isExerciseAnswered()`。

`handleExercise` 汇总每题结果，有一题没确认成功就返回 false（日志与返回值更诚实，`returnToSource` 与 FailGate 兜底的流程不变）。

验证：`node --check`、`git diff --check` 通过；另三个自测不受影响。实机验证待机主：正常作业不应再出现「提交后未确认到已提交回写」；另需确认无题号列表的单题页面能否被 `isExerciseAnswered()` 确认。

## 2026-09-13 工作包 G / K / L（机主一次性给了决策）

- G（选项字母边界）：按机主指示改为模块级 `OPTION_LETTERS`（A–Z），不再写死 A–F。`answerToIndices` 用 `indexOf` 映射并按实际 `optionCount` 过滤，越界字母打 warning；非 JSON 回退在原文里取字母改用 `\b[A-Z]\b`，避免英文解释的词内字母被当成选项（代价：`AB` 连写不拆分）。
- K（完成度阈值）：机主定「临近完成也算未完成」，`Utils.isProgressDone()` 去掉 98% / 99%，只认 100% / 已完成，与 `V2Runner.getCompletionState()` 一致。两处仍各自实现，只统一判定标准。
- L：机主定「MOOC 与雨课堂切割」，删掉 `start()` 里两处 `gdufemooc.cn` 分支（userscript 本就只匹配 `*.yuketang.cn`，原分支不可达）。
- H / I：机主答复「当前可以正常工作，需要实际检测」，维持现状；另记「大小目录结构因具体课程而异」，不做按单一结构的判定改动。
- J：机主未发现 Pro 用户级入口，但属「未发现」而非「确认没有」，删除面较大（两个 Runner + Pro 分支 + 持久化游标），留待机主定夺。

验证：`node --check`、`git diff --check`、`tmp/parse-answer-selftest.cjs`（已扩到 A–Z 映射与越界过滤、非 JSON 取字母）通过。

J（记录）：机主决定「先保留，等确认无 Pro 入口后再删」，因此 AUDIT 15（observePause cleanup）与 AUDIT 17（Pro 持久化游标）也暂不做。

版本：`@version` 1.4.1 → **2.0.0**（F/G/K/L 一批：答题提交结果三态、选项字母 A–Z、完成度阈值统一、MOOC 分支删除）。

## 2026-09-13 工作包 P：子代理审查发现的一批逻辑修正（机主指示一起修）

修 6 条：

1. 拒答哨兵 `-2` 只有 `handleBatch` 会读（工作包 N 的半成品）：`V2Runner.run()` 顶层扫描补上 `refused` 分支（提示一次后 `skip` 降级），`FailGate.bump` 遇负数哨兵原样返回，避免 `-2 + 1 = -1` 把拒答改写成主动跳过。
2. 交棒条目计数只增不减：新增 `FailGate.markProgress(key)`（复用 `_writeToOpener`），`AiWorkspaceRunner.run()` 在 media/exercise 确认做成时清掉来源目录计数；`progressed` 与 `ok` 分开，未知类型分支只算 `ok` 不算进展。
3. `setPendingAutoStart` 跨课堂串味：换课堂且本次无新目录地址时不覆盖旧记录。
4. 「开始」无运行态闸门：`invokeStart` 加 `running`，重复点击只记一条日志，`resetStartButton` 放开。
5. `askAI` 的 `optionCount` / `questionType` 死参数删除（函数体从未读取，prompt 也不接收）。
6. `handleBatch` 内容子项判断里不可达的 `taolun` 条件删除。

未修（结论见 WORKFLOW P）：`handleClassroom` 无超时属工作包 I（机主定保留）；`dispatchUserLikeClick` 双击与 `findPlayButton` 首选提示元素需实机确认；`getSlideReadStatus` / `originalTextSnapshots` / Pro 游标差 1 属疑似或工作包 J。

新增 `tmp/failgate-selftest.cjs`（桩模拟目录那份与子标签拷贝两个 sessionStorage）：计数、跳过哨兵、拒答哨兵、进展清零、无 opener 静默五项通过。`@version` 2.0.0 → 2.0.1。

## 2026-09-13 工作包 P 复查：子代理复看 23c86ce 后的回修

复查结论：6 条修正里 4 条可信，2 条引入新缺陷，1 条只堵了一半根因。已回修：

1. `markProgress` 判据过宽（新引入的无限交棒）：`handleExercise` 在「autoAI 关闭 / 题号列表为空 / 题面读不到」这些什么都没做的路径上也返回 true。改为 `didWork && allSubmitted`，只有真遇到「已提交」或成功作答的题才算进展。
2. `running` 闸门无兜底解锁（新引入的锁死）：`HANDOFF` 后 Runner 已 return、目录空闲等待，用户想手动重开却被挡住。`runRoute()` 加 `.finally(() => panel.releaseStart())`，只放闸门不动按钮文案。
3. `getReturnUrl()` 读侧后门：原先 V2 内容页分支不校验 classroomId。现在只要路由给得出课堂 id 就必须与 pending 一致；`boot()` 的自动恢复判据未动，属同类残留。
4. `_writeToOpener` 的 try 只包了取值：opener 正在导航时 getItem/setItem 抛错会逃出 `AiWorkspaceRunner.run()`。整个读写纳入同一个 try。
5. 拒答标记不再降级成 -1（降级会把「需人工处理」说成「全部完成」）：改用 `refusedWarned` Set 只提示一次，并新增 `refusedSeen` 计入终结日志。

另有两处配平：`AiWorkspaceRunner.run()` 早退路径的 `progressed` 语义、`handleBatch` 里我第一版漏掉的 `continue` 已确认。

验证：`node --check`、四个自测、`git diff --check` 全通过。`@version` 2.0.1 → 2.0.2。

## 2026-09-13 工作包 P 第二轮复查：子代理复看 e27e631 后的回修

复查确认「markProgress 判据收口、getReturnUrl 收紧、_writeToOpener 全包 try」三条成立，但「拒答标记不降级」这一步改出了新缺陷：

1. 顶层拒答项保留 `skippedInPlace++` → 每轮收尾都走「原地跳过→reload」，而拒答标记每轮都会再命中该分支 → 无限重载、永不收尾（且 `refusedSeen` 收尾日志恰好不可达）。改为只计 `refusedSeen`。
2. `refusedWarned` 是模块级 Set，目录整页导航回来即重建 → 警告仍一轮一次。改为 `FailGate.warnedRefused/markRefusedWarned`，落 sessionStorage 的 `ykt_refused_warned`，`clear()` 一并清。
3. `boot()`/`start()` 的 V2 内容页自启动没校验课堂 id（getReturnUrl 收紧后会转而在本页逐叶推进）。两处补上「两边都取得到时必须一致」。

有意保留（记入 AGENTS）：闸门放开后，交棒窗口内手动再按「开始」不会被挡，会重派发同一条目——为保住手动恢复能力付的价。

验证：`node --check`、四个自测（failgate 扩到六项）、`git diff --check` 全通过。`@version` 2.0.2 → 2.0.3。

## 2026-09-13 工作包 P 第三轮复查：子代理复看 d762905 后的回修

1. `start()` 里我加的课堂判据是死代码：`getRoute()` 内部已兜底调用 `getGenericV2ContentRoute()`，上面 aiRoute 分支 return 之后，v2 分支里的 `contentRoute` 恒为 null。整段「检测到 V2 内容页，接管处理」删除并留注释。
2. 批次内拒答不进 `refusedSeen`：当它是最后一项时收尾会误报「课程已全部完成」。`handleBatch` 改为统计 `refusedSubs`，有拒答子项时用新增的 `FailGate.markRefusedLocal()` 把父批次 key 标成 -2（目录自己那份，不走 opener）。
3. `warnedRefused` / `_readRefusedWarned` 补 try（sessionStorage 不可用不再打断扫描）。
4. 自测桩改用从源码提取的真实 key 名，并补 `markRefusedLocal` 与 `clear()` 清对 key 的断言（八项）。

未修（结论）：xcloud 页面的 classroom id 解析需实机 URL 样本，已记入 OBSERVE 待验证；`markProgress` 不清「已提示」标记属可接受语义；交棒窗口手动重开为已知取舍。

验证：`node --check`、四个自测、`git diff --check` 全通过。`@version` 2.0.3 → 2.0.4。

## 2026-09-13 修复作业逐题「跳题」（机主实机报告，@version 2.0.5）

实机日志（作业「第三章 示例作业」，无题号列表路径）显示：`正在提交...` 后站点**自己翻到下一题**（机主确认），随后脚本空等 8 秒打 `第 1 题 提交后未确认到已提交回写，本轮记未推进`，再无条件点「下一题」→ 又推进一题 → 第 2 题整题漏答，直接开始问第 3 题。

两处修正：

1. `solveExerciseQuestion` 的提交复核改为「回写判据 **或** 题面指纹变了」二选一（`AiWorkspace.exerciseFingerprint`）。站点提交后自动翻页时，「当前题面」类判据读到的是下一题、永远看不到回写，光靠它会把成功提交判成未推进；而误判会让 `allSubmitted=false` → `progressed=false` → 目录侧失败计数不清零，整份作业 3 轮后被 `maxAttempts` 跳过。靠翻页确认时另打一条 info 日志。
2. `advanceExerciseQuestion(root, previousFingerprint)` 点「下一题」前先比较题面指纹：已经变了就直接算已推进、不点按钮（否则一次提交推进两题）。

新增 `tmp/advance-selftest.cjs`（四项：题面已变不点按钮 / 未变点一次 / 无按钮返回 false / 无基准指纹按按钮推进）。`AGENTS.md` 的提交复核与推进语义、`OBSERVE.md` 的实机观测已同步。验证：`node --check`、五个自测、`git diff --check` 全通过。

## 2026-09-13 作业「答错留页」与「末题收尾」修正（机主实机报告，@version 2.0.6）

机主补充两条站点行为：① 答对自动翻页，**答错留在原页渲染结果、已无法再次提交**；② 末题提交后翻到的是作业概况/结果页（不是题目页）。

1. **v2.0.5 的判据错了**：用「题面文本变了」判断站点是否已翻页，但答错时同一页渲染结果同样会让文本变化 → 答错后既不点「下一题」，下一轮又把带结果的同一页当成新题重新截图问 AI（白问一次，且提交按钮已不可用）。改为 `AiWorkspace.exerciseQuestionStillShown(previousText)`：拿提交前题面前 40 字在**当前**题面里做包含判断，还包含=没翻页（自己点「下一题」），已换掉=站点翻过了（不再点）。`advanceExerciseQuestion` 点完按钮的等待条件也换成「这道题从页面上消失」。
2. **末题收尾**：末题提交后站点翻到的概况页没有逐题提交控件，v2.0.5 会把它当第 6 题截图问 AI 再报「未完成」。新增 `AiWorkspace.hasExerciseSubmitControl()`（只看题面自身与父级，按钮文本不含「作业/交卷」，排除整页的「提交作业」），无题号列表路径在 `i > 0` 时先判它，没有就停手并记「按作业已到最后处理」。
3. 提交确认日志按实际情形措辞：题面仍在本页 → 「结果留在此页，稍后自行点下一题」；否则 → 「站点已自动翻到下一题」。

新增 `tmp/exercise-end-selftest.cjs`（六项）；`tmp/advance-selftest.cjs` 重写为五项（答对不点 / 答错点一次 / 页面未动点一次 / 无按钮 false / 无基准题面按按钮推进）。`AGENTS.md`、`OBSERVE.md` 同步。验证：`node --check`、六个自测、`git diff --check` 全通过。

## 2026-09-13 作业已提交判据改用「已提交」文案（机主补充站点状态机，@version 2.0.7）

机主补充：未作答 → 不可点击的「提交」；已作答未提交 → 「提交」变可点击；**已提交 → 不可点击的「已提交」**；只有第一题没有「上一题」、只有最后一题没有「下一题」。

- `isExerciseAnswered()` 原判据要求「disabled 且文案匹配 已提交/已完成/…」**且只在题面元素内找**，而提交控件不在题面里 → 已提交的题判不出来（v2.0.6 之前答错留在原页的题会被反复重问）。改为按 容器（`.container-problem`）→ 文档 → 题面 逐层找「已提交 / 已作答 / 已完成 / 回答正确 / 回答错误 / 完成本题」这类专属文案，不要求 disabled、要求可见。
- 明确不拿「提交」是否 disabled 推状态：未作答时它同样是不可点击的。
- 无题号列表路径推进不了时补一条日志「没有可推进的下一题，本轮作业处理结束」（末题本来就没有「下一题」，属正常收尾）。

新增 `tmp/exercise-answered-selftest.cjs`（七项，含「不可点击的提交」不算已提交）。`AGENTS.md`、`OBSERVE.md` 同步。验证：`node --check`、七个自测、`git diff --check` 全通过。

## 2026-09-13 题号列表抓取范围修正（实机看 DOM，@version 2.0.8）

机主截图显示作业页左侧确有 1–5 的题号方块，脚本却报「未找到题号列表」。用 `ykt-ff`（专用 profile，端口 2828）打开作业页（leaf {leaf_id}）抽样 DOM，拿到真实结构：

```
.container-body > .problem-box
  ├── .problems-aside → .aside-body → .list-inline > .subject-item.J_order[data-order] × 5（题号文本 + 空 .status-container）
  └── .container-problem → .el-scrollbar（题面正文）/ .problem-fixedbar（上一题 / 提交 / 下一题）/ .annotation-container
```

- 根因：题号列表是 `getExerciseContainer()`（= `.container-problem`）的**兄弟**节点，`getExerciseQuestionTabs(root)` 只在容器内部找 → 实测老范围命中 1 个且被叶子过滤丢掉（0 个页签），新范围（`.closest(".problem-box")`）命中 5 个页签。
- 同类问题：提交控件在 `.problem-fixedbar`（题面正文的兄弟分支），`hasExerciseSubmitControl()` 的取值范围同样改成 `.closest(".container-problem")`（原先只看题面自身与父级，真实页面上会落空）。
- 走页签路径后新增一处等待：点页签后先 `Utils.poll` 到该页签变成 active 再读状态，避免读到上一题残留的「已提交」而漏答一题；`getExerciseQuestionLabel()` 把纯数字页签文案补成「第 N 题」。

`AGENTS.md`（作业页结构与「不要从题面往下找」的约束）、`OBSERVE.md`（真实 DOM 与坑）同步。验证：`node --check`、七个自测、`git diff --check` 全通过；实机 `evalf` 确认新范围能取到 5 个页签。

## 2026-09-13 新增「终止」硬停按钮（机主实机报告，@version 2.0.9）

机主报告：脚本很难停住——`暂停` 只挂起 `sleep`，在途的 AI 请求返回后仍会继续选答案/提交；而 `pendingAutoStart` 还在，刷新页面又自动续跑，所以只能「暂停 + 清除失败记录」。

- 新增 `StopGate`（模块级，随 document 重建）：`stop()` 立刻 abort 在途 AI 请求（句柄由 `Solver.askAI` 挂在 `StopGate.abortInflight`）、`Store.clearPendingAutoStart()`（刷新不再续跑）、面板不再接受「开始」。
- 接入点：`Utils.poll`（已终止立刻 `resolve(false)`，不启定时器）、`Player.waitForEnd`（1s 轮询叫醒，长视频不用等播完）、`Player.observePause.shouldAttemptResume`（不再自动恢复播放）、`Solver.askAI`（不发请求 / onload、onprogress 丢弃 / 新增 onabort）、`Solver.autoSelectAndSubmit`（不选选项、不点提交）、`solveExerciseQuestion`（不截图、不重试，终止导致的失败不当「答题失败」）、`handleExercise` 两条逐题循环、`handleMedia`、`AiWorkspaceRunner.run/autoSelect/returnToSource`、`V2Runner.run/openContentEntry/handleBatch`、两个 Pro Runner 的 `run()`。
- 面板：新增 `终止` 按钮（开始运行时与 `暂停` 一起出现），点击后按钮收起、启动键文案变「已终止」，再点只提示「需刷新页面才能重新启动」。

`README.md`（按钮说明与暂停/终止的区别）、`AGENTS.md`（两者的语义差异 + 接入点清单 + 锚点）同步。`tmp/poll-selftest.cjs` 扩到五项（新增「已终止立刻 false 且不调 checker」）；新增 `tmp/stop-selftest.cjs`（五项：abort 在途请求 / 清续跑标记 / 幂等 / 已终止立刻返回 / 等待中被叫醒）。验证：`node --check`、八个自测、`git diff --check` 全通过。

## 2026-09-13 prompt 文件改名后的路径维护 + 讨论区实机观测

机主把 `SystemPrompt.md` 改名为 `SysPmt_Homework.md`（正文标记同时改成 `<AI识图作业Prompt>`），并新建占位 `SysPmt_Discussion`。

- 同步引用路径：`AGENTS.md`（文件清单、`Solver` 章节、锚点）、`WORKFLOW.md`（prompt 同步规则 + 历史记录）、`AUDIT.md`、`LOG.md`、`Solver.askAI` 上方注释。
- `tmp/prompt-sync-check.cjs` 改按新标记取名（`<AI识图作业Prompt>` … `</AI识图作业Prompt>`），仍输出 `OK: 93 行 prompt 与 SysPmt_Homework.md 逐行一致`（正文本次只改了标记，内容未动）。
- `AGENTS.md` 增列 `SysPmt_Discussion`（占位，脚本尚未接入）；`WORKFLOW.md` 记下接入时应照作业 prompt 那样带标记 + 同步检查。

讨论区页实机观测（`ykt-ff`，班级 {classroom_id}，leaf {leaf_id}）回填 `OBSERVE.md`：该页**无字体混淆**，教师正文 `.main-text-attachment` 为纯文本（img/a/pre/mjx 全 0），回复控件是普通 `textarea.el-textarea__inner`（Enter 发送），帖子在 `.forum-content > .forum-item > .publish-forum-topic`，完成状态是 `.control-right > div.f12.blue-color` 的「未发言」。

据此定下讨论区输入方式：**复制文本问 AI，不截图**（详见本轮回复）。

## 2026-09-13 讨论区自动回复（@version 2.1.0）

机主先做了一轮手动实测（授权 agent 用 `ykt-ff` 代发一条），再据此写 prompt 并实现。

- 决策：**复制文本问 AI，不截图**。该页 `[class*=encrypted]` 命中 0、无 `exam_font_`，教师正文是纯文本，截图只会多一次 OCR 与 html2canvas 的字体坑；也不喂别人的帖子（示范帖质量低，会带偏输出）。
- `Solver.buildForumPrompt()`（占位被机主改写后同步，34 行）：正文与 `SysPmt_Discussion` 的 `<AI讨论区Prompt>` 区块逐行一致；`askAI(imageDataUrl, { systemPrompt, userText })` 增加纯文本分支，与作业截图共用同一套请求组装 / 流式 / 终止逻辑。
- `AiWorkspace`：`isForumRouteType`、`getForumBodyText/getForumTitle/getForumStatusText`、`getForumReplyBox/getForumSendButton/getForumPostTexts`、`keepLineBreaks`、`normalizeForumReply`。
- `AiWorkspaceRunner.handleForum()`：读正文 → 文本问 AI → 清洗 → 填框（原生 setter + `input`，实测直接赋值对 Vue v-model 无效）→ 等 `.prompt-send-btn` 摘掉 `disabled` → 点发送 → 轮询 `.comment-text` 出现自己的楼层。模型返回 `refuse` 时 `FailGate.markRefused` 标记需人工处理。
- 目录侧：顶层讨论条目与批次里的讨论子项由「一律就地 `FailGate.skip`」改为**交棒**（`autoAI` 关闭时仍是跳过）。
- 实机观测（回填 `OBSERVE.md`）：提交后新楼层立刻出现在列表首位；状态文案「未发言→已发言」、`讨论区（13→14）`、完成度 9.79%→11.26% 都要**整页重载**才更新；列表只渲染最新 10 条（这解释了此前「计数 13 而 DOM 10 条」）。
- 新增 `tmp/forum-selftest.cjs`（六项）；`tmp/prompt-sync-check.cjs` 扩成两份 prompt 都查（93 行 homework + 34 行 discussion）。

## 2026-09-13 修复：讨论区完成标志「已发言」未被识别（@version 2.1.1）

机主实机截图：目录里已发言的讨论显示对勾 + 「已发言」，脚本却仍当未完成。

- 实机观测（`ykt-ff`，班级 {classroom_id}）：讨论是**章节批次的子项**，要展开才渲染；`.statistics-box .aside` 只有「已发言」（`#icon--yiwancheng`）与「未发言」（`#icon--weiwancheng`）两种文案，既无分数也无百分比。该批次 137 个叶子里 23 条是讨论（1 条已发言是我手动发的那条）。
- 根因：`V2Runner.getCompletionState()` 只认「已完成/已读」→ 讨论全被当未开始 → 已发言那条每轮都交棒，`handleForum` 见「已发言」返回 true → `markProgress` 清掉失败计数 → 重扫再选中，反复开标签且永远到不了 `maxAttempts`。
- 修：`getCompletionState()` 与 `Utils.isProgressDone()` 都加「已发言 / 已回复」算 completed；`handleForum` 的「已发言」护栏改用 `Utils.isProgressDone()`，两处口径仍旧一处、同一处改。
- 新增 `tmp/completion-state-selftest.cjs`（14 例：分数/百分比/文字优先级 + 已发言/未发言）。`OBSERVE.md`、`AGENTS.md` 同步。

## 2026-09-13 讨论区拒答 {refuse}：prompt 同步与判定（@version 2.1.2）

机主改了 `SysPmt_Discussion`：新增「场景情况」（要求访问链接时尝试查看；要求去别的网页填写时只看内容再回复；**要求提交附件或超出能力时返回 `{refuse}`**）+ 两条示范（问卷链接→正常作答；要求提交附件→`{refuse}`）。

- `buildForumPrompt()` 按标记重新同步（34 → 62 行，`tmp/prompt-sync-check.cjs` 两项都过）。
- 新增 `Solver.isRefuseReply(raw)`：去围栏/空白/引号后整段是 `{refuse}`（或 `refuse`、`{"type":"refuse"}`）才算拒答；带「CoT Reasoning / Formal Response」两行时只看 Formal Response 那段。只认标记不做语义判断，正文里提到 refuse 不误判。
- `handleForum()` 的拒答分支从 `/^refuse$/` 换成 `Solver.isRefuseReply(raw)`（判 raw，不判清洗后的正文），日志写明原因，`FailGate.markRefused` 标记需人工处理——与作业 refuse 同思路。
- `normalizeForumReply()` 现在会把「Formal Response:」前面的推理行去掉，只发正文。
- `tmp/forum-selftest.cjs` 增拒答用例（6 正 4 负）与 Formal Response 用例。

## 2026-09-13 修「未能写入回复框」：根因是 `Utils.poll` 的返回被当成元素（@version 2.1.4）

> 中间有一版 2.1.3 只在本机浏览器跑过一次、**没有提交**：当时误判成「用户脚本沙箱 / 跨 realm」，
> 写了四段降级写入。机主回贴的日志把真因暴露了，那版已废弃，下面的实现才是最终版。

机主实机日志：讨论区走到 `拟发表（164 字）` 后打 `未能写入回复框，本轮记未推进`。

- 复现：在测试浏览器（无用户脚本管理器）打开同一条讨论（示例作业 leaf {leaf_id}），同一串操作写值成功 → 页面结构从来不是原因。
- **真因**（机主回贴的日志）：四种写法分别报「原型链上没有 value setter」「`box.setRangeText is not a function`」「`box.focus is not a function`」「父元素上没有 `__vue__`」——`box` 根本不是元素。因为 `const box = await Utils.poll(() => AiWorkspace.getForumReplyBox(), …)`：**`Utils.poll()` 只 resolve `true`/`false`**，于是 `box === true`。项目里别处都写 `const ready = await Utils.poll(...); const el = get...()`，只有这一处破了例。
- 修：改成 poll 判就绪 + 另读一次 DOM（`boxReady` / `box` 分开）；`fillForumReplyBox` 退回最小实现（`HTMLTextAreaElement.prototype` 的 value setter + `input` 事件），但**加了回读校验**（`box.value !== text` 即失败）并**把失败原因打出来**——那次之所以查不动，就是因为它在 `catch` 里静默 `return false`。
- 顺带修 `returnToSource()` 的日志文案（原写「媒体播放完成」，这条路径现在也服务作业与讨论区）。
- `tmp/forum-selftest.cjs` 重写为 8 组断言，新增「拿错对象（`true`）必须返回 false 并打日志」这条回归用例。
- 复现/清理记录：调试时往 {leaf_id} 的回复框写过「测试文本 123」，事后已清空，没有发送。

## 2026-09-14 修章节重载死循环：`FailGate.reset()` 抹掉了父批次的拒答哨兵（机主实机报告，@version 2.1.5）

机主报告：章节里有被跳过的作业/讨论时，脚本反复「进入章节 → 发现除跳过项外都完成 → 刷新 → 章节仍是进行中 → 再进入」，死循环。

实机取证（`ykt-ff` 接管机主正常 profile，课堂 {classroom_id}）：

- 目录顶层 2 张卡：公告「已读」+ 批次卡「第一章 示例章节 等」（{N} 个学习单元，默认**不展开**、状态「进行中」）。展开后统计：视频 {N} 已完成 / 讨论 {N} 已发言 / 作业 {N} 已完成 / 图文 {N} 已读，唯一未完成的是 leaf {leaf_id}「第十五章 积极身心--homework」，目录文案 `5/6 进行中`。
- 该作业跑在 `#iframeExerciseId`（`/v2/web/iframe-exercise/{classroom_id}/{leaf_id}`）。题号页签 6 个，页签 class 里 `primary` = 已作答；第 1 题（要求真实完成运动的“勾选已做”）无状态图标，提交栏是「提交」= 未作答。机主补充：该题 AI 返回 `refuse`（要求实际活动，模型拒答）。
- `exerciseList.problems`（`container.__vue__.exerciseList`）是 6 个条目、与页签同序；`user.submit_time / is_right / answer` 都在 `user` 里。题 2–6 的 `submit_time` 完全相同（`2026-09-14 08:38`，一次批量提交），第 1 题是机主 11:51 手答的；08:38 那次推测是脚本自己答的（子标签 `handleExercise` 一次遍历答完 6 题）。
- 根因（代码路径 + 终点状态互证）：子标签拒答 → `FailGate.markRefused(subKey)` 写 `-2` 到 opener(目录)；下一轮批次收尾 `FailGate.markRefusedLocal(parentFailKey)` 把**父批次**也标成 `-2` 并 `return true`；`run()` 紧接着 `if (advanced && !FailGate.skipped(failKey)) FailGate.reset(failKey)` —— `skipped` 只认 `-1`，于是 `reset` 把 `-2` **删掉** → 下一轮重扫又进同一章节（它永远停在「进行中」）→ 再标一次、再删一次：整页重载死循环。机主手动补完那道题后章节变「已完成」，循环随之消失，与推断一致。
- 修：`FailGate.reset()` 遇到哨兵（`< 0`）直接返回，与 `bump` 同一规矩；普通计数照旧清零。这不是「顺手」，哨兵是扫描判据，不能被「有进展就清零」抹掉。
- 验证：`tmp/failgate-selftest.cjs` 增 3 组断言（`-2` / `-1` 保留、普通计数仍清零），把该守卫删掉后自测立刻报 `reset 不得抹掉拒答哨兵`（已验证 pre-fix 失败 / post-fix 通过）；`node --check` 与其余八个自测照旧通过。
- **未实机复现修复后的行为**：该课堂已 100%（批次卡「已完成」、{N} 项全绿），不再存在「进行中且只剩拒答子项」的章节，无法在实机上跑出这条分支；修复靠代码路径 + 自测守住，实机复核留待下次遇到同类章节。

## 2026-09-14 顺带修两处自测脚本失修（脚本后随仓库结构整理移入 `scripts/`，入库）

- `prompt-sync-check.cjs`：读的文件名漏了扩展名（`SysPmt_Discussion` → 实际是 `SysPmt_Discussion.md`，上一提交 `chore(SysPmt_Discussion): rename` 漏改），于是作业那份通过、讨论区那份 ENOENT —— 讨论区 prompt 的同步守卫其实一直没在跑。改成 `.md`，并把三处路径统一成 `__dirname + "/../"`（原先用 cwd 相对名，只有「在仓库根目录跑」才对；现在仓库根、脚本所在目录、绝对路径三种跑法结果相同）。
- `decipherer-selftest.cjs`：按旧的单行写法抓 `MAP_DATA`（`const MAP_DATA = "..."`），而现在脚本里是 `const MAP_DATA =` 换行 + 缩进字面量，正则不匹配就报 `Cannot read properties of null`。正则改成 `const MAP_DATA =\s*"([A-Za-z0-9+/=]+)"`，并补一条带说明的 `assert`（声明形式再变时报清楚的话，而不是 TypeError）。
- 验证：三个跑法（仓库根、脚本所在目录、绝对路径）下两份都过 —— `OK: 93 行 prompt 与 SysPmt_Homework.md 逐行一致` / `OK: 62 行 prompt 与 SysPmt_Discussion.md 逐行一致` / `decodeMap: 30038 条 OK` + `SELFTEST PASS`。
- 文档同步：`AGENTS.md`（文件清单、`Solver` 章节）、`WORKFLOW.md`（prompt 源规则）里的 `SysPmt_Discussion` → `SysPmt_Discussion.md`；`LOG.md` 的历史条目按原样保留（那是当时的记录）。

## 2026-09-14 仓库结构整理：检查脚本移出 `tmp/`，`tmp/` 按用途分目录（机主指示）

机主定的约定：根分区 `/tmp` 是 tmpfs（断电即失），只放一次性中间产物；仓库 `./tmp/` 是普通文件，放值得留档的诊断产物与抓取；脚本不该躺在 `tmp/` 里，移到 `scripts/` 并入库。

改动：

- `scripts/`（新建，入库）：10 个 `*-selftest.cjs` + `prompt-sync-check.cjs` + `ykt-inspect/`（原先在仓库根、且被 `.gitignore` 忽略）。这些脚本本来就按 `__dirname` 找主源码，换目录后无需改路径；`ykt-inspect` 自带 `launch.sh`/`bi.mjs`，内部不依赖仓库相对路径。
- `tmp/`（仍 gitignore）按来源分了 7 个子目录：`ai-captures/`（10 份 AI 请求抓取 + `llama-swap_run_capture.cjs`）、`dom-samples/`（原 `samples/`）、`site-bundles/`（原 `yktjs/`，75 个站点 chunk）、`font/`（字体与 html2canvas 排查：`exam_font.ttf`、`MAP_DATA.*`、`opentype.min.js`、`html2canvas.js`、`font-*.cjs`、截图与 `h2c-out*.txt`）、`probes/`（原 `probes/` + 28 个 `diag*.js` + `verify.js`）、`firefox-marionette/`（原 `ffj/`，从 omni.ja 摘出的 marionette 协议源码）、`attic/`（两份旧提交草稿）。空目录 `ffj/` 的其余部分清理掉。
- `tmp/font/font-*.cjs` 的素材路径改成 `__dirname` 相对（原先读 `./MAP_DATA.txt`、`./exam_font.ttf`，只有在该目录下跑才对）。顺带修 `font-unicode.cjs` 的一处旧 bug：`charToGlyphIndex` 要的是字符，传码点数字会在 `codePointAt` 上抛 TypeError → 改 `String.fromCodePoint(cp)`，输出与 `OBSERVE.md` 记录的 882 个基本区码点一致。
- `.gitignore` 去掉 `ykt-inspect/` 条目；`README.md` 的「文件」补 `scripts/`、`tmp/` 两条；`AGENTS.md` 新增「仓库结构」章节并写明 `/tmp` 与 `./tmp/` 的分工，`node tmp/*.cjs` 全部改 `node scripts/*.cjs`（必查项另补一条自测/prompt 同步要求）；`WORKFLOW.md`、`OBSERVE.md` 内引用同步。
- 删掉 `AUDIT.md`「仓库卫生」点名的那类冗余副本里的两份：`tmp/font/MAP_DATA.js`（脚本读的是 `MAP_DATA.txt`，这份只是 JS 包裹的重复数据）与 `tmp/font/html2canvas.js`（截图库的本地副本，没有任何脚本引用）。**`opentype.min.js` 保留**——`font-match.cjs` / `font-unicode.cjs` 用 `require('./opentype.min.js')`，删了这两个诊断就跑不起来；它不是重复副本，是这两支脚本的依赖。
- 未动 `AUDIT.md`（阶段性报告，其「仓库卫生」建议现在落实：自测已移出、`tmp/` 已分类、冗余副本按上面两条处理）。`LOG.md` 早前条目里的 `tmp/*.cjs` 按当时状态保留。

验证：11 个检查脚本在仓库根 / `scripts/` 内 / 绝对路径三种跑法全部 PASS；`tmp/font/font-unicode.cjs`、`font-match.cjs` 从 `/` 跑也正常；`node --check`、`git diff --check` 通过。
