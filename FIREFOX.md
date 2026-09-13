# FIREFOX.md — 人机协同 Firefox 实机检测

用于和 agent 一起实机检测雨课堂网页行为。人在 GUI 窗口里登录/观察，agent 通过 CLI 读写页面。

## 组成

| 组件         | 位置                          | 说明                                                                 |
| ------------ | ----------------------------- | -------------------------------------------------------------------- |
| 持久 profile | `/home/Si/.ykt-firefox`     | cookies/登录态跨重启保留；`user.js` 里开了 marionette（端口 2828） |
| 启动器       | `~/.local/bin/ykt-ff-start` | 启动带 marionette 的 GUI Firefox；已在跑则直接返回                   |
| 控制 CLI     | `~/.local/bin/ykt-ff`       | 约 100 行 Node 脚本，无依赖                                          |

## 两种模式

1. **专用 profile**（`ykt-ff-start`）：干净环境，需手动登录、重装扩展。适合与主浏览器隔离的测试。
2. **正常 profile**（`ykt-ff-start-main`）：用机主日常 Firefox（`i77vm44z.default-release`，含 Tampermonkey + 脚本 + 登录态），直接进入 agent 状态。
   - 前置：先关闭正在运行的 Firefox（marionette 只在启动时启用，同一 profile 单实例）。
   - 脚本会自动先关掉专用 profile 的浏览器以释放 2828 端口。
   - 日常使用不受影响；marionette 只在以 `MOZ_MARIONETTE=1` 启动时监听 `127.0.0.1:2828`。

## 用法

```sh
ykt-ff-start                      # 启动浏览器（窗口里完成登录）
ykt-ff-start-main                 # 以 agent 模式启动你的正常 Firefox（需先关闭正在运行的 Firefox）
ykt-ff url                        # 当前 URL
ykt-ff title                      # 当前标题
ykt-ff html                       # 整个 document 的 outerHTML
ykt-ff eval "document.title"      # 在 active tab 执行 JS 表达式
ykt-ff evalf /tmp/probe.js        # 执行文件里的 JS（函数体，需显式 return）
ykt-ff open <url>                 # 导航 active tab
ykt-ff tabs                       # 列出所有窗口/标签（含 (privileged) 浏览器级窗口）
ykt-ff tab <idx>                  # 切到 tabs 列出的第 idx 个窗口
ykt-ff closetab <idx>             # 关闭第 idx 个窗口（拒绝关最后一个窗口）
```

`evalf` 的文件被当作函数体执行：最后一个值不会自动返回，需要 `return`；
也可以直接写 `function(){...}` 整体。

## 注意

- marionette 走裸 TCP + 长度前缀 JSON 帧（FF 155 已无 WebSocket/旧 remote-debug 协议），
  `ykt-ff` 按此实现；**不要**用 curl 打 2828 端口，会把单连接搞坏（症状：`ykt-ff` 连不上，重启浏览器即恢复）。
- 会话按连接计：每次 `ykt-ff` 调用新建连接和 session，调用结束自动清理；页面内的
  `window` 全局变量（如探针装的 hook）跨调用保留，页面导航后消失。
- 只操作 active tab。多标签时先在 `tabs` 输出里找到目标，再用 `tab <idx>` 切换。
- `tabs` 里的 `(privileged)` 是浏览器级窗口（不是网页），对它执行会报
  `ExecuteScript and ExecuteAsyncScript are not supported for privileged browsing contexts`；
  窗口句柄的**排列顺序在不同会话之间不稳定**，所以 `tab 1` 这次是网页、下次可能是 privileged——不要记 idx，每次先 `tabs` 确认。
- `ykt-ff tab` 与随后的 `ykt-ff evalf` 是**两次连接、两个会话**，切换结果不共享；
  「切到某标签再执行」必须在同一次连接里完成（见下条）。
- 需要「新标签打开 → 执行 → 关闭」时，写一次性 marionette 脚本在同会话内做
  `WebDriver:NewWindow` → `Navigate` → `ExecuteScript` → `CloseWindow`；
  **必须确认 CloseWindow 返回成功**。残留的雨课堂页面会因 localStorage 里的 `pendingAutoStart` 自动续跑，
  等于多开一个执行体（已在作业页实测踩到）。
- 日志：`/tmp/ykt-ff.log`（marionette INFO/ERROR）。

## 典型工作流（实机检测）

1. `ykt-ff url` / `ykt-ff title` 确认当前页面。
2. 需要抓网络时先 `evalf` 安装 fetch/XHR hook（写入 `window.__yktNet`），再触发交互，再读回。
3. DOM 大时把结果重定向到临时文件（`ykt-ff html > /tmp/page.html`）再看。
4. 观察结论记入 `OBSERVE.md`，按路由分节。
5. 跨标签读数据（例如读 iframe 内的题目 DOM）用上一条的一次性会话脚本：同一会话里切到目标标签再 `ExecuteScript`；
   结束后核对 `ykt-ff tabs`，确认没有留下自己开的标签。
