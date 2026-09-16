# FIREFOX.md — 人机协同 Firefox 实机检测

用于和 agent 一起实机检测雨课堂网页行为。人在 GUI 窗口里登录/观察，agent 通过 CLI 读写页面。

## 组成

| 组件         | 位置                          | 说明                                                                 |
| ------------ | ----------------------------- | -------------------------------------------------------------------- |
| 持久 profile | `/home/Si/.ykt-firefox`     | cookies/登录态跨重启保留；`user.js` 里开了 marionette（端口 2828） |
| 启动器       | `scripts/ykt-ff/ykt-ff-start` | 启动带 marionette 的 GUI Firefox；已在跑则直接返回                   |
| 控制 CLI     | `scripts/ykt-ff/ykt-ff`       | 约 100 行 Node 脚本，无依赖                                          |

## 两种模式

1. **专用 profile**（`ykt-ff-start`）：干净环境，需手动登录、重装扩展。适合与主浏览器隔离的测试。
2. **正常 profile**（`ykt-ff-start-main`）：用机主日常 Firefox（`i77vm44z.default-release`，含 Tampermonkey + 脚本 + 登录态），直接进入 agent 状态。
   - 前置：先关闭正在运行的 Firefox（marionette 只在启动时启用，同一 profile 单实例）。
   - 脚本会自动先关掉专用 profile 的浏览器以释放 2828 端口。
   - **注意：`MOZ_MARIONETTE=1` 会把这个 profile 改脏**——实测会写入约 104 条自动化 pref（含 `focusmanager.testmode`、`browser.newtabpage.activity-stream.testing.shouldInitializeFeeds=false` 等），症状是新标签页没有搜索框、fcitx5 中文输入失效。详见文末「profile 污染」。
   - marionette 只在以 `MOZ_MARIONETTE=1` 启动时监听 `127.0.0.1:2828`。

## 用法

脚本在 `scripts/ykt-ff/`，不在 PATH 上，从仓库根目录调用。

```sh
scripts/ykt-ff/ykt-ff-start             # 启动浏览器（窗口里完成登录）
scripts/ykt-ff/ykt-ff-start-main        # 以 agent 模式启动你的正常 Firefox（需先关闭正在运行的 Firefox）
scripts/ykt-ff/ykt-ff url               # 当前 URL
scripts/ykt-ff/ykt-ff title             # 当前标题
scripts/ykt-ff/ykt-ff html              # 整个 document 的 outerHTML
scripts/ykt-ff/ykt-ff eval "document.title"   # 在 active tab 执行 JS 表达式
scripts/ykt-ff/ykt-ff evalf /tmp/probe.js     # 执行文件里的 JS（函数体，需显式 return）
scripts/ykt-ff/ykt-ff open <url>        # 导航 active tab
scripts/ykt-ff/ykt-ff tabs              # 列出所有窗口/标签（含 (privileged) 浏览器级窗口）
scripts/ykt-ff/ykt-ff tab <idx>         # 切到 tabs 列出的第 idx 个窗口
scripts/ykt-ff/ykt-ff closetab <idx>    # 关闭第 idx 个窗口（拒绝关最后一个窗口）
```

`evalf` 的文件被当作函数体执行：最后一个值不会自动返回，需要 `return`；
也可以直接写 `function(){...}` 整体。

下文再提到 `ykt-ff` / `ykt-ff-start` 时，都指 `scripts/ykt-ff/` 下的同名脚本。

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

## profile 污染：MOZ_MARIONETTE=1 会写入自动化 pref

实测（FF 155 / 154，两个全新 profile 对照，各跑 40 秒后正常退出）：

| 启动方式 | `prefs.js` 条数 | 自动化 pref |
| --- | --- | --- |
| `firefox --profile <新 profile>` | 168 | 无 |
| `MOZ_MARIONETTE=1 firefox --profile <新 profile>` | 247 | 有（多出 104 条） |

多出的 104 条是 Firefox 的自动化/测试 pref（其中 `remote.prefs.recommended.applied=true` 就是这一步留下的），
会影响机主日常使用的至少这几条：

- `browser.newtabpage.activity-stream.testing.shouldInitializeFeeds=false`
- `focusmanager.testmode=true`
- `dom.input_events.security.minNumTicks=0`、`dom.input_events.security.minTimeElapsedInMS=0`
- `dom.permissions.testing.enabled=true`
- `app.update.disabledForTesting=true`
- `browser.dom.window.dump.enabled=true`
- `browser.sessionstore.resume_from_crash=false`
- `security.fileuri.strict_origin_policy=false`

这些 pref **会写进 profile 并长期保留**：之后用普通方式启动同一个 profile，它们照样还在。

### 已实测到的两个后果

1. **新标签页没有搜索框**（FF 155 只剩 Firefox 徽标，FF 154 整页空白）。
   原因已确认：`shouldInitializeFeeds=false` 时 newtab 不初始化 feed，搜索框就是其中一个 feed
   （newtab 源码注释：`For tests/automation: when false, newtab won't initialize select feeds in this session.`）。
   只把这一条从 `prefs.js` 删掉，搜索框就回来。
2. **fcitx5 在 Firefox 里失效**：候选框出现在页面左上角、选词不上屏，或切换键（`Super+Space`、单按左 Shift）
   完全没反应、面板图标不动。
   实测：把这批里的 9 条（上面 8 条 + `shouldInitializeFeeds`）从 profile 副本删掉后，中文输入立即恢复正常。
   **没有逐条隔离**，最可疑的是 `focusmanager.testmode`。

这两个现象与 Firefox 版本无关：155 和 154 都能复现，且只在被污染过的 profile 上复现；全新 profile 下两个版本都正常。
（9-14 当天一度误判成「Firefox 155 回归」并降级到 154，那个结论是错的。）

### 什么时候会踩到

- `ykt-ff-start`：污染专用 profile `/home/Si/.ykt-firefox`。机主在这个窗口里手动登录/输入时同样受影响。
- `ykt-ff-start-main`：污染机主日常 profile `i77vm44z.default-release`。这条最要紧——跑完这轮自动化，
  日常浏览器就会一直带着这批 pref，新标签页和输入法的问题一起留在那儿。

### 清理办法

Firefox 完全退出后（`pgrep -x firefox` 为空）执行：

```sh
python3 - <<'EOF'
import os
prefs = [
    "browser.newtabpage.activity-stream.testing.shouldInitializeFeeds",
    "focusmanager.testmode",
    "dom.input_events.security.minNumTicks",
    "dom.input_events.security.minTimeElapsedInMS",
    "dom.permissions.testing.enabled",
    "app.update.disabledForTesting",
    "browser.dom.window.dump.enabled",
    "browser.sessionstore.resume_from_crash",
    "security.fileuri.strict_origin_policy",
    "remote.prefs.recommended.applied",
]
profiles = [
    "/home/Si/.ykt-firefox",
    os.path.expanduser("~/.config/mozilla/firefox/i77vm44z.default-release"),
]
for prof in profiles:
    path = os.path.join(prof, "prefs.js")
    if not os.path.exists(path):
        continue
    lines = open(path, encoding="utf-8", errors="replace").read().split("\n")
    keep = [l for l in lines if not any('user_pref("%s"' % n in l for n in prefs)]
    open(path, "w", encoding="utf-8").write("\n".join(keep))
    print(prof, "removed", len(lines) - len(keep))
EOF
```

只能在 Firefox 未运行时执行；下次再用 `MOZ_MARIONETTE=1` 启动，这批 pref 会被重新写入。
想根治只能靠「自动化 profile 与日常 profile 分开 + 跑完就清理」。

### 排查手法（以后遇到同类症状）

- 先看 profile 有没有被污染：`grep -cE 'user_pref' prefs.js`（新 profile 约 168 条）
  加 `grep -E 'focusmanager|input_events|shouldInitializeFeeds' prefs.js`。
- 判断新标签页是否正常：直接截图（`spectacle -b -n -f -o /tmp/x.png`）比让人描述准确。
- 判断「Firefox 有没有把按键交给输入法」：用 `LD_PRELOAD` 挂一个几行的 C 小 .so，记录
  `gtk_im_context_filter_keypress` / `gtk_im_context_focus_in` 的调用（`typeof()` + `dlsym(RTLD_NEXT)` 即可）。
  注意 `GTK_IM_MODULE=fcitx` 时 Firefox 走异步路径，本来就不调 `filter_keypress`，不能只看这一个函数下结论。

### 当前状态（2026-09-14）

- 系统里的 Firefox 已被机主降级为 154.0.1（取自 pacman 缓存，`IgnorePkg` 未设置）。降级时 Firefox 新建了
  `zite51x3.default-release-1` 并把 `profiles.ini` 的默认指向它；日常 profile `i77vm44z.default-release` 仍在，
  需要用 `about:profiles` → `Set as Default Profile` 切回，或 `firefox --profile <dir> --allow-downgrade` 启动。
- `i77vm44z.default-release` 和 `.ykt-firefox` **目前仍带着**这批 pref，还没清理。
- `ykt-ff` / `ykt-ff-start` 尚未在 154 上复测（marionette 协议没变，理论上兼容）。
