# yuketang-ComplexAutomation

雨课堂复合自动化 userscript。项目整合并改造 `/ref` 下的刷课、字体反混淆与多模态 AI 答题脚本，目标是在雨课堂课程目录页自动处理视频、课件、批量章节与作业题目。

## 功能

- 雨课堂路由识别与自动续跑。
- 视频、音频自动播放，支持倍速、静音、后台防暂停与完成后返回目录。
- 批量章节自动展开，逐个处理内部视频、音频、图文、讨论、作业。
- PPT/课件自动翻页与播放。
- 作业使用浏览器内截图能力截取题面，再调用 OpenAI-compatible 多模态模型作答。
- 支持选择题、多选题、判断题、填空题。
- 支持 Chat Completions 与 Responses 风格接口，自动补全 `/chat/completions` 或 `/responses` 后缀。
- 支持 Bearer、`x-api-key`、`api-key` 请求头自动匹配。
- 支持 thinking / CoT、流式传输与自定义 max tokens。
- 可选启用雨课堂字体反混淆补丁。
- 已提交题目会跳过，未提交题目继续处理。

## 文件

- `yuketang-ComplexAutomation.user.js`：主 userscript。
- `SystemPrompt.md`：多模态答题 system prompt 源文本。
- `ref/`：参考脚本来源，保留用于审计和后续对照。

## 安装 & 使用

1. 安装 Tampermonkey 等 userscript 管理器。
2. 打开 `yuketang-ComplexAutomation.user.js` 并安装脚本。
3. 进入雨课堂课程目录页，点击脚本面板中的 `AI配置`。
4. 填入 API URL、API Key、模型名，按需开启 AI 作答、流式传输、thinking。
5. 点击 `开始刷课`。

## AI 接口配置

API URL 可以填写完整端点，也可以只填写域名或基础路径，脚本会按配置自动补全：

- Chat Completions：`/v1/chat/completions`
- Responses：`/v1/responses`
- 兼容 `/chat/completion`、`/chat/completions`、`/response`、`/responses`

默认行为：

- thinking / CoT：开启。
- stream：开启。
- max tokens：thinking 开启时 `32768`，关闭时 `4096`。
- 默认不发送 `temperature` 和 `top_p`，除非内部强制采样参数开关被启用。

## 使用建议

- 在课程目录页启动，不要在单个视频或作业页面直接启动 v2 主循环。
- 首次使用先只开启视频/PPT流程，确认课程目录能正常返回与续跑后，再开启 AI 自动作答。
- AI 自动作答依赖截图识别，题面遮挡、页面未加载完成、模型不支持图片都会导致失败。

## 来源与许可

本项目是综合改造版本，参考并继承了以下本地脚本的设计和部分逻辑：

- `ref/yuketang-jiaoben/` [Niuwh/yuketang-jiaoben](https://github.com/Niuwh/yuketang-jiaoben)
- `ref/yuketang-jiaoben.PR/` [Niuwh/yuketang-jiaoben/PR#38](https://github.com/Niuwh/yuketang-jiaoben/pull/38)
- `ref/雨课堂 MiMo AI 自动刷题 v5.2 (多选支持).js`
- `ref/yuketang-deobfuscator/` [novob/yuketang-deobfuscator](https://github.com/novob/yuketang-deobfuscator)

项目按 GPL-3.0-only 发布（继承自[Niuwh/yuketang-jiaoben](https://github.com/Niuwh/yuketang-jiaoben)，详见 `LICENSE`。`ref/` 下各原始项目保留其原始声明与许可证信息。

## 免责声明

本项目仅供学习、研究和自动化脚本开发参考。使用者应遵守所在学校、课程平台和相关法律法规的要求。脚本运行造成的课程记录、账号风险、费用、数据泄露或其他后果，由使用者自行承担。
