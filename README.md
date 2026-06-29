# yuketang-ComplexAutomation

雨课堂复合自动化 userscript。项目整合 `ref/` 下的刷课、字体反混淆与多模态 AI 答题脚本并进行大幅度重构和改造，在雨课堂课程目录页自动遍历并处理视频、音频、课件、批量章节与作业题目。

## 工作方式

脚本以网页实际进度为准驱动遍历：

- 每轮扫描课程目录，按顺序定位第一个未完成的学习项并处理；
- 处理完整页重载、自动续跑，重新扫描——已完成的项自然跳过，推进到下一个未完成项；
- 中途清缓存、刷新、换设备都不影响：重新进入目录页即可接着刷。

这样的好处是不会因为某次记错位置而漏掉中间未完成的小节。配套的安全阀（同一项反复推不动满 3 次则跳过并告警）避免在已过截止、AI 答不全等场景下死循环。

## 功能

- 雨课堂路由识别与跨页自动续跑。
- 视频、音频自动播放，支持倍速、静音、后台防暂停、断点续播与完成后返回目录。
- 批量章节自动展开，逐个处理内部视频、音频、图文、讨论、作业。
- PPT/课件自动翻页与播放。
- 作业使用浏览器内截图能力截取题面，再通过 OpenAI-compatible API 调用多模态模型作答。
- 支持选择题、多选题、判断题、填空题。
- 支持 Chat Completions 与 Responses 风格接口，自动补全 `/chat/completions` 或 `/responses` 后缀。
- 支持 Bearer、`x-api-key`、`api-key` 请求头自动匹配。
- 支持 thinking / CoT、流式传输与自定义 max tokens。
- 可选启用雨课堂字体反混淆补丁（默认关闭）。
- 已完成 / 已提交的项自动跳过，未完成的继续处理。

## 文件

- `yuketang-ComplexAutomation.user.js`：主 userscript。
- `SystemPrompt.md`：多模态 LLM 答题的 system prompt 源文本。
- `AGENTS.md`：面向 LLM Agent 的架构说明（开发者也可参考）。
- `ref/`：参考脚本来源，保留用于审计和对照。

## 安装 & 使用

1. 安装 Tampermonkey 等 userscript 管理器。
2. 打开 `yuketang-ComplexAutomation.user.js` 并安装脚本。
3. 进入雨课堂课程目录页，点击脚本面板中的 `AI配置`。
4. 填入 API URL、API Key、模型名，按需开启 AI 作答、流式传输、thinking。
5. 点击 `开始刷课`。

面板按钮：

- `开始刷课`：在课程目录页启动遍历。
- `清除失败记录`：清空本会话记住的"反复推不动"章节计数与续跑标记。仅在某些项被安全阀跳过、想重新尝试时使用。

## 纯刷视频模式

不开启 AI 自动作答时，脚本进入纯刷视频模式：作业类项被直接无视，只刷视频、音频、课件。需要自动答题时再在 `AI配置` 里开启。

## AI 接口配置

API URL 可以填写完整端点，也可以只填写域名或基础路径，脚本会按配置自动补全：

- Chat Completions：`/v1/chat/completions`
- Responses：`/v1/responses`
- 兼容 `/chat/completion`、`/chat/completions`、`/response`、`/responses`

默认行为：

- thinking / CoT：开启。
- stream：开启。
- max tokens：留空自动选择，thinking 开启时 `32768`，关闭时 `4096`。
- 默认不发送 `temperature` 和 `top_p`，除非内部强制采样参数开关被启用。

## 使用补充

- 在课程目录页启动，不要在单个视频或作业页面直接启动（脚本会拒绝以防误触发）。
- 首次使用先只开启视频/PPT流程，确认课程目录能正常返回与续跑后，再开启 AI 自动作答。
- AI 自动作答依赖截图识别，浏览器窗口大小调整、题面遮挡、页面未加载完成、模型不支持图片都会导致失败。
- 若日志提示某项"尝试 3 次仍未完成，跳过"，多为该项已过截止或模型答不全；确认无误后可点 `清除失败记录` 重试。

## 来源与许可

本项目是综合改造版本，参考并继承了以下本地脚本的设计和部分逻辑：

- `ref/yuketang-jiaoben/` [Niuwh/yuketang-jiaoben](https://github.com/Niuwh/yuketang-jiaoben)（以及可能未合并的 PR 的内容）
- `ref/yuketang-deobfuscator/` [novob/yuketang-deobfuscator](https://github.com/novob/yuketang-deobfuscator)
- `ref/雨课堂 MiMo AI 自动刷题 v5.2 (多选支持).js`

项目按 GPL-3.0 license 发布。`ref/` 下各原始项目保留其原始声明与许可证信息。

## 免责声明

本项目仅供学习、研究和自动化脚本开发参考。使用者应遵守所在学校、课程平台和相关法律法规的要求。脚本运行造成的课程记录、账号风险、费用、数据泄露或其他后果，由使用者自行承担。
