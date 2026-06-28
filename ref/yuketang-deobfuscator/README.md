# 雨课堂 字体混淆反混淆

[![License](https://img.shields.io/github/license/novob/yuketang-deobfuscator)](./LICENSE)
[![UserScript](https://img.shields.io/badge/UserScript-Tampermonkey-orange)](https://www.tampermonkey.net/)
[![UserScript](https://img.shields.io/badge/UserScript-ScriptCat-blue)](https://docs.scriptcat.org/docs/use/use/)

实时解析雨课堂字体混淆，还原原始文字的浏览器用户脚本。

> **GLM-5.1** 和 **DeepSeek-V4-Pro** 在 AI 编辑器 [Trae CN](https://www.trae.com.cn/) 中编写。

## 背景

雨课堂使用字体混淆技术保护页面文字：将汉字的 Unicode 码点替换为乱码码点，同时提供混淆字体 `exam_font_*.ttf`，使乱码码点渲染出正确字形。每次刷新页面会随机使用不同的混淆字体，对应不同的码点映射。

反混淆流程：

1. **预生成字形哈希映射表**：基于 Source Han Sans SC VF 2.004R 基准字体，对每个 CJK 字形计算 SHA-1 前 8 字节哈希，建立 `hash → 原码点` 映射
2. **实时解析混淆字体**：截获页面中的 `exam_font_*.ttf`，对每个 CJK 码点的字形计算哈希，查映射表还原原码点
3. **替换文本 + 禁用混淆字体**：将 DOM 中的混淆码点替换为原码点，并禁用混淆字体的 `@font-face` 规则使文本回退到系统字体正常显示

方法来自作者 [SomeBottle](https://github.com/SomeBottle)-[《探探学习平台的字体混淆》](https://www.cnblogs.com/somebottle/p/18503920/font_obfuscation_of_learning_platforms) 。

## 功能

- **反混淆**：将页面中混淆后的文字替换为原始文字，复制即可得到正确文本
- **禁用混淆字体**：禁用混淆字体的 `@font-face` 规则，使文本回退到系统字体正常显示
- 两个功能可独立开关，无需刷新页面
- 开关状态自动持久化，刷新后保持上次设置
- 支持 SPA 路由切换，自动处理动态加载内容

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [ScriptCat](https://docs.scriptcat.org/docs/use/use/) 浏览器扩展
2. 点击安装脚本：
   - [ScriptCat 脚本库](https://scriptcat.org/scripts/code/6533/%E9%9B%A8%E8%AF%BE%E5%A0%82%E5%AD%97%E4%BD%93%E6%B7%B7%E6%B7%86%E5%8F%8D%E6%B7%B7%E6%B7%86.user.js)
   - [GitHub Raw](./yuketang-deobfuscator.user.js) 或 [7ED Service - 私有静态资源加速](https://gh.sevencdn.com/https://github.com/novob/yuketang-deobfuscator/raw/refs/heads/main/yuketang-deobfuscator.user.js)
   
3. 访问雨课堂页面，脚本自动运行

## 使用

脚本加载后，通过脚本管理器菜单控制：

- 点击浏览器工具栏脚本管理器图标 → 选择对应菜单项即可切换
- **反混淆**：控制是否将混淆码点替换为原始码点
- **禁用混淆字体**：控制是否禁用混淆字体的 `@font-face` 规则
- **诊断**：下载字体调试报告，用于排查问题

## 技术细节

- 映射表采用二进制格式（8 字节 SHA-1 哈希 + 3 字节码点偏移）→ gzip → base64 内嵌脚本，约 410 KB
- 使用浏览器原生 `DecompressionStream` API 解压，无需额外依赖
- 使用 `crypto.subtle.digest` 计算 SHA-1 哈希
- 使用 [opentype.js](https://opentype.js.org/) 解析字体
- `MutationObserver` 监听 DOM 变化，处理动态加载的内容
- 拦截 `history.pushState` / `replaceState` 及 `popstate` 事件，适配 SPA 路由变化

## 免责声明

本项目仅供学习、研究和技术交流使用，不得用于任何商业用途或非法目的。

使用者应遵守相关平台的服务条款和适用法律法规。仓库持有者不承担任何因使用本脚本产生的任何直接或间接责任。

本项目不鼓励、不支持、不协助任何形式的学术不端行为。

## License

[MIT](./LICENSE)