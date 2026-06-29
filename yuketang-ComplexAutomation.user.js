// ==UserScript==
// @name         雨课堂复合自动化
// @namespace    https://github.com/nagelanping/yuketang-ComplexAutomation
// @version      1.0.1
// @description  雨课堂视频/PPT自动浏览 + OpenAI-compatible API 多模态LLM截图答题
// @author       nagelanping
// @license      GPL-3.0-only
// @match        *://*.yuketang.cn/*
// @run-at       document-start
// @icon         http://yuketang.cn/favicon.ico
// @grant        GM_info
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      *
// @connect      cdn.jsdelivr.net
// @require      https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// ==/UserScript==

// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 nagelanping

(() => {
  'use strict';

  let panel; // UI 面板实例后置初始化

  // ---- 脚本配置，用户可修改 ----
  const Config = {
    version: (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || 'unknown',
    playbackRate: 2,      // 视频播放倍速
    pptInterval: 3000,    // ppt翻页间隔（毫秒）
    aiTimeout: 240000,    // 多模态模型请求超时（毫秒）
    aiMaxOutputTokens: 2048, // 兼容 CoT 模型，避免 thinking 阶段截断
    aiMaxRetry: 3,        // 作业题目最大重试次数
    storageKeys: {        // 使用者勿动
      ai: 'ykt_ai_conf',
      proClassCount: 'pro_lms_classCount',
      feature: 'ykt_feature_conf', // 是否开启AI作答/自动评论
      pendingAutoStart: 'ykt_pending_auto_start',
      failCounts: 'ykt_fail_counts' // 会话级：记录反复推不动的章节及尝试次数
    }
  };

  // 暂停闸门：所有 Runner 主循环都经由 Utils.sleep 推进，
  // 暂停时让 sleep 在计时结束后继续挂起，直到恢复，从而统一暂停整条自动化流程。
  const PauseGate = {
    paused: false,
    _waiters: [],
    onChange: null,
    pause() {
      if (this.paused) return;
      this.paused = true;
      this.onChange && this.onChange(true);
    },
    resume() {
      if (!this.paused) return;
      this.paused = false;
      const waiters = this._waiters;
      this._waiters = [];
      waiters.forEach(fn => fn());
      this.onChange && this.onChange(false);
    },
    toggle() {
      this.paused ? this.resume() : this.pause();
      return this.paused;
    },
    wait() {
      if (!this.paused) return Promise.resolve();
      return new Promise(resolve => this._waiters.push(resolve));
    }
  };

  const Utils = {
    // 短暂睡眠，等待网页加载；若处于暂停状态则在计时结束后继续挂起，直到恢复
    sleep: (ms = 1000) => new Promise(resolve => setTimeout(resolve, ms)).then(() => PauseGate.wait()),
    // 将一个 JSON 字符串解析为 JavaScript 对象
    safeJSONParse(value, fallback) {
      try {
        return JSON.parse(value);
      } catch (_) {
        return fallback;
      }
    },
    // 每隔一段时间检查某个条件是否满足（通过 checker 函数），如果满足就成功返回；如果超时仍未满足，就失败返回
    poll(checker, { interval = 1000, timeout = 20000 } = {}) {
      return new Promise(resolve => {
        const start = Date.now();
        const timer = setInterval(() => {
          if (checker()) {
            clearInterval(timer);
            resolve(true);
            return;
          }
          if (Date.now() - start > timeout) {
            clearInterval(timer);
            resolve(false);
          }
        }, interval);
      });
    },
    // 使用UI课程完成度来判别是否完成课程
    isProgressDone(text) {
      if (!text) return false;
      return text.includes('100%') || text.includes('99%') || text.includes('98%') || text.includes('已完成');
    },
    // 完成状态文案
    stateLabel(state) {
      return { completed: '已完成', in_progress: '进行中', not_started: '未开始' }[state] || '未知';
    },
    // 主要是规避firefox会创建多个iframe的问题
    inIframe() {
      return window.top !== window.self;
    },
    // 通过雨课堂播放器“当前时间 / 总时长”显示判断是否播完
    isPlayerTimeDisplayComplete() {
      const times = document.querySelector('.xt_video_player_current_time_display')?.innerText || '';
      const [nowTime, totalTime] = times.split(' / ');
      return Boolean(nowTime && totalTime && nowTime === totalTime);
    },
    // 下滑到最底部，触发课程加载
    scrollToBottom(containerSelector) {
      const el = document.querySelector(containerSelector);
      if (el) el.scrollTop = el.scrollHeight;
    },
    getCurrentClassroomId() {
      const query = new URLSearchParams(location.search);
      const queryId = query.get('classroom_id') || query.get('classroomId') || query.get('cid');
      if (queryId) return queryId;

      const path = location.pathname;
      return path.match(/^\/ai-workspace\/lms-graph\/([^/]+)/)?.[1]
        || path.match(/^\/v2\/web\/studentLog\/([^/]+)/)?.[1]
        || path.match(/^\/v2\/web\/cloud\/student\/[^/]+\/([^/]+)/)?.[1]
        || '';
    },
    isSupportedLearningPage() {
      const path = location.pathname;
      return path.includes('/ai-workspace/lms-graph/')
        || path.includes('/v2/web/')
        || path.includes('/pro/lms/');
    },
    isV2ContentPage() {
      return location.pathname.includes('/v2/web/')
        && !location.pathname.includes('/v2/web/studentLog/');
    },
    waitForMountTarget(timeout = 15000) {
      const getTarget = () => document.body || document.documentElement;
      const existing = getTarget();
      if (existing) return Promise.resolve(existing);

      return new Promise(resolve => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          observer.disconnect();
          clearTimeout(timer);
          resolve(getTarget());
        };
        const observer = new MutationObserver(() => {
          if (getTarget()) finish();
        });
        observer.observe(document, { childList: true, subtree: true });
        document.addEventListener('DOMContentLoaded', finish, { once: true });
        window.addEventListener('load', finish, { once: true });
        const timer = setTimeout(finish, timeout);
      });
    },
    async getDDL(media = null) {
      const element = media || document.querySelector('video') || document.querySelector('audio');

      const fallback = 180_000;
      if (!element) return fallback;

      let duration = Number(element.duration);
      if (!Number.isFinite(duration) || duration <= 0) {
        await new Promise(resolve => element.addEventListener('loadedmetadata', resolve, { once: true }));
        duration = Number(element.duration);
      }

      const elementDurationMs = duration * 1000;               // 转为毫秒
      const timeout = Math.max(elementDurationMs * 3, 10_000); // 至少 10 秒（防极短视频）;
      return timeout;
    }
  };

  // ---- 存储工具 ----
  const Store = {
    getAIConf() {
      const raw = localStorage.getItem(Config.storageKeys.ai);
      const saved = Utils.safeJSONParse(raw, {}) || {};
      const apiFormat = ['auto', 'openai-chat', 'openai-responses'].includes(saved.apiFormat)
        ? saved.apiFormat
        : 'auto';
      const authMethod = ['auto', 'bearer', 'x-api-key', 'api-key'].includes(saved.authMethod)
        ? saved.authMethod
        : 'auto';
      const conf = {
        url: saved.url ?? "https://api.openai.com/v1/chat/completions",
        key: saved.key ?? "sk-xxxxxxx",
        model: saved.model ?? "gpt-4o-mini",
        apiFormat, // auto、openai-chat 或 openai-responses
        authMethod, // auto、bearer、x-api-key 或 api-key
        thinkingEnabled: saved.thinkingEnabled ?? true,
        maxTokens: Number(saved.maxTokens || 0),
        stream: saved.stream ?? true,
      };
      return conf;
    },
    setAIConf(conf) {
      localStorage.setItem(Config.storageKeys.ai, JSON.stringify(conf));
    },
    getProClassCount() {
      const value = localStorage.getItem(Config.storageKeys.proClassCount);
      return value ? Number(value) : 1;
    },
    setProClassCount(count) {
      localStorage.setItem(Config.storageKeys.proClassCount, count);
    },
    clearProClassCount() {
      localStorage.removeItem(Config.storageKeys.proClassCount);
    },
    getFeatureConf() {
      const raw = localStorage.getItem(Config.storageKeys.feature);
      const saved = Utils.safeJSONParse(raw, {}) || {};
      const conf = {
        autoAI: saved.autoAI ?? false,
        autoComment: saved.autoComment ?? false,
        fontPatch: saved.fontPatch ?? false,
      };
      return conf;
    },
    setFeatureConf(conf) {
      localStorage.setItem(Config.storageKeys.feature, JSON.stringify(conf));
    },
    getPendingAutoStart() {
      const raw = localStorage.getItem(Config.storageKeys.pendingAutoStart);
      const saved = Utils.safeJSONParse(raw, null);
      if (!saved || !saved.classroomId || !saved.ts) return null;
      if (Date.now() - saved.ts > 30 * 60 * 1000) {
        localStorage.removeItem(Config.storageKeys.pendingAutoStart);
        return null;
      }
      return saved;
    },
    getPendingHandoff(maxAge = 5 * 60 * 1000) {
      const pending = this.getPendingAutoStart();
      const handoff = pending?.handoff;
      if (!handoff?.type || !handoff.ts) return null;
      if (Date.now() - handoff.ts > maxAge) return null;
      return handoff;
    },
    setPendingAutoStart(classroomId = '', returnUrl = '', extra = {}) {
      if (!classroomId) return;
      const prev = this.getPendingAutoStart() || {};
      const next = {
        classroomId,
        returnUrl: returnUrl || prev.returnUrl || '',
        ts: Date.now()
      };
      if (Object.prototype.hasOwnProperty.call(extra, 'handoff')) {
        if (extra.handoff) {
          next.handoff = {
            ...extra.handoff,
            ts: Date.now()
          };
        }
      } else if (prev.handoff) {
        next.handoff = prev.handoff;
      }
      localStorage.setItem(Config.storageKeys.pendingAutoStart, JSON.stringify(next));
    },
    clearPendingAutoStart() {
      localStorage.removeItem(Config.storageKeys.pendingAutoStart);
    }
  };

  // ---- 失败计数闸门 ----
  // 纯 DOM 进度驱动遍历的安全阀：记录"反复进入仍推不动"的章节及尝试次数，
  // 同一项满 maxAttempts 次仍未完成则跳过，避免已过截止/AI 答不全/进度回写延迟等场景死循环。
  // 用 sessionStorage：关闭标签页即清空，绝不跨会话残留，不承担"记忆刷到第几个"的职责。
  const FailGate = {
    maxAttempts: 3,
    _read() {
      return Utils.safeJSONParse(sessionStorage.getItem(Config.storageKeys.failCounts), {}) || {};
    },
    _write(map) {
      sessionStorage.setItem(Config.storageKeys.failCounts, JSON.stringify(map));
    },
    key(...parts) {
      return parts.map(p => String(p ?? '').replace(/\s+/g, ' ').trim()).join('||');
    },
    get(key) {
      return Number(this._read()[key] || 0);
    },
    bump(key) {
      const map = this._read();
      map[key] = Number(map[key] || 0) + 1;
      this._write(map);
      return map[key];
    },
    exhausted(key) {
      return this.get(key) >= this.maxAttempts;
    },
    exhaust(key) {
      const map = this._read();
      map[key] = this.maxAttempts;
      this._write(map);
    },
    // 主动跳过（考试/未知类型/功能关闭）：用哨兵值标记，与"失败耗尽"区分，扫描时静默略过、不告警
    skip(key) {
      const map = this._read();
      map[key] = -1;
      this._write(map);
    },
    skipped(key) {
      return this._read()[key] === -1;
    },
    reset(key) {
      const map = this._read();
      if (key in map) {
        delete map[key];
        this._write(map);
      }
    },
    clear() {
      sessionStorage.removeItem(Config.storageKeys.failCounts);
    }
  };

  // ---- UI 面板 ----
  function createPanel() {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.top = '48px';
    iframe.style.left = '48px';
    iframe.style.width = '380px';
    iframe.style.height = '500px';
    iframe.style.zIndex = '999999';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '16px';
    iframe.style.background = 'transparent';
    iframe.style.overflow = 'hidden';
    iframe.style.boxShadow = '0 16px 48px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08)';
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('id', 'ykt-helper-iframe');
    iframe.setAttribute('allowtransparency', 'true');
    const mountTarget = document.body || document.documentElement;
    if (!mountTarget) {
      throw new Error('面板挂载点不存在');
    }
    mountTarget.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(`
            <style>
              :root {
                --bg: #ffffff;
                --bg-elevated: #fbfbfd;
                --text: #1d1d1f;
                --text-secondary: #6e6e73;
                --text-tertiary: #8e8e93;
                --hairline: rgba(0, 0, 0, 0.08);
                --hairline-strong: rgba(0, 0, 0, 0.12);
                --accent: #0071e3;
                --accent-hover: #0077ed;
                --danger: #ff3b30;
                --fill: #f5f5f7;
                --fill-hover: #ececef;
                --radius: 16px;
                --radius-sm: 10px;
                --radius-control: 8px;
              }

              * { box-sizing: border-box; }

              html, body {
                margin: 0;
                padding: 0;
                overflow: hidden;
                font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif;
                font-size: 13px;
                color: var(--text);
                background: transparent;
                -webkit-font-smoothing: antialiased;
              }

              /* 收起后的胶囊 */
              .mini-basic {
                position: absolute;
                inset: 0;
                display: none;
                align-items: center;
                justify-content: center;
                border-radius: var(--radius);
                background: var(--accent);
                color: #fff;
                font-size: 13px;
                font-weight: 500;
                letter-spacing: 0.2px;
                cursor: pointer;
                z-index: 1000000;
                transition: background 0.2s ease;
              }
              .mini-basic.show { display: flex; }
              .mini-basic:hover { background: var(--accent-hover); }

              /* 主面板 */
              .panel {
                width: 100%;
                height: 100%;
                position: relative;
                overflow: hidden;
                background: var(--bg);
                border-radius: var(--radius);
                display: flex;
                flex-direction: column;
              }

              /* 标题栏 */
              .header {
                flex: 0 0 auto;
                height: 52px;
                padding: 0 16px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                background: var(--bg-elevated);
                border-bottom: 1px solid var(--hairline);
                cursor: move;
                user-select: none;
              }
              .header .title {
                font-size: 15px;
                font-weight: 600;
                letter-spacing: -0.2px;
                color: var(--text);
              }
              .header .title small {
                display: block;
                font-size: 11px;
                font-weight: 400;
                color: var(--text-tertiary);
                letter-spacing: 0;
                margin-top: 1px;
              }
              .tools ul {
                margin: 0;
                padding: 0;
                list-style: none;
                display: flex;
                gap: 8px;
              }
              .tools li {
                width: 26px;
                height: 26px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                background: var(--fill);
                color: var(--text-secondary);
                font-size: 14px;
                line-height: 1;
                cursor: pointer;
                transition: background 0.15s ease, color 0.15s ease;
              }
              .tools li:hover { background: var(--fill-hover); color: var(--text); }

              /* 内容 / 日志区 */
              .body {
                flex: 1 1 auto;
                overflow-y: auto;
                padding: 14px 16px;
                line-height: 1.5;
              }
              .body::-webkit-scrollbar { width: 8px; }
              .body::-webkit-scrollbar-thumb {
                background: rgba(0, 0, 0, 0.18);
                border-radius: 4px;
                border: 2px solid transparent;
                background-clip: padding-box;
              }
              .info { margin: 0; padding: 0; list-style: none; }
              .info li {
                margin-bottom: 7px;
                color: var(--text-secondary);
                font-size: 12.5px;
              }
              .info li strong { color: var(--text); font-weight: 600; }
              .info li .tag {
                color: var(--accent);
                font-weight: 500;
              }
              .info li.log-entry {
                display: flex;
                align-items: flex-start;
                gap: 7px;
                font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
                line-height: 1.45;
              }
              .info .log-tag {
                flex: 0 0 auto;
                font-weight: 700;
              }
              .info .log-tag.info { color: #248a3d; }
              .info .log-tag.warning { color: #b26a00; }
              .info .log-tag.error { color: #d70015; }
              .info .log-message {
                min-width: 0;
                overflow-wrap: anywhere;
              }
              .info hr {
                border: none;
                border-top: 1px solid var(--hairline);
                margin: 12px 0 4px;
              }

              /* 设置页 */
              #settings {
                display: none;
                position: absolute;
                top: 52px;
                left: 0;
                right: 0;
                bottom: 0;
                background: var(--bg);
                z-index: 99;
                padding: 16px;
                overflow-y: auto;
              }
              #settings::-webkit-scrollbar { width: 8px; }
              #settings::-webkit-scrollbar-thumb {
                background: rgba(0, 0, 0, 0.18);
                border-radius: 4px;
                border: 2px solid transparent;
                background-clip: padding-box;
              }

              .form-item { margin-bottom: 14px; }
              .form-item > label {
                display: block;
                margin-bottom: 6px;
                font-size: 12px;
                font-weight: 500;
                color: var(--text-secondary);
              }
              .form-item input[type="text"],
              .form-item input[type="password"],
              .form-item select {
                width: 100%;
                padding: 9px 11px;
                border: 1px solid var(--hairline-strong);
                border-radius: var(--radius-control);
                background: var(--bg);
                color: var(--text);
                font-size: 13px;
                font-family: inherit;
                outline: none;
                transition: border-color 0.15s ease, box-shadow 0.15s ease;
              }
              .form-item input::placeholder { color: var(--text-tertiary); }
              .form-item input:focus,
              .form-item select:focus {
                border-color: var(--accent);
                box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.15);
              }

              /* 开关式复选项 */
              .form-item .checkbox-label {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                font-size: 12.5px;
                color: var(--text);
                cursor: pointer;
                line-height: 1.45;
              }
              .form-item .checkbox-label input[type="checkbox"] {
                flex: 0 0 auto;
                appearance: none;
                -webkit-appearance: none;
                width: 38px;
                height: 22px;
                margin: 0;
                border-radius: 11px;
                background: #d1d1d6;
                position: relative;
                cursor: pointer;
                transition: background 0.2s ease;
              }
              .form-item .checkbox-label input[type="checkbox"]::after {
                content: "";
                position: absolute;
                top: 2px;
                left: 2px;
                width: 18px;
                height: 18px;
                border-radius: 50%;
                background: #fff;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
                transition: transform 0.2s ease;
              }
              .form-item .checkbox-label input[type="checkbox"]:checked { background: #34c759; }
              .form-item .checkbox-label input[type="checkbox"]:checked::after { transform: translateX(16px); }

              .settings-section {
                margin: 18px 0 10px;
                font-size: 11px;
                font-weight: 600;
                letter-spacing: 0.4px;
                text-transform: uppercase;
                color: var(--text-tertiary);
              }
              .settings-section:first-child { margin-top: 0; }

              /* 通用按钮 */
              button {
                font-family: inherit;
                border: none;
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                border-radius: var(--radius-control);
                transition: background 0.15s ease, opacity 0.15s ease;
              }
              button:active { opacity: 0.85; }

              .btn-primary { background: var(--accent); color: #fff; }
              .btn-primary:hover { background: var(--accent-hover); }
              .btn-secondary { background: var(--fill); color: var(--text); }
              .btn-secondary:hover { background: var(--fill-hover); }
              .btn-danger { background: var(--fill); color: var(--danger); }
              .btn-danger:hover { background: rgba(255, 59, 48, 0.1); }

              .settings-footer {
                display: flex;
                gap: 10px;
                margin-top: 20px;
              }
              .settings-footer button { flex: 1; padding: 10px; }

              /* 底部操作栏 */
              .footer {
                flex: 0 0 auto;
                display: flex;
                gap: 8px;
                padding: 12px 16px;
                background: var(--bg-elevated);
                border-top: 1px solid var(--hairline);
              }
              .footer button { padding: 10px 14px; }
              #btn-setting { flex: 0 0 auto; }
              #btn-clear { flex: 0 0 auto; }
              #btn-pause { flex: 0 0 auto; }
              #btn-start { flex: 1 1 auto; }
            </style>

            <div class="mini-basic" id="mini-basic">展开</div>
            <div class="panel" id="panel">
              <div class="header" id="header">
                <span class="title">雨课堂助手<small>Complex Automation</small></span>
                <div class='tools'>
                  <ul>
                    <li class='minimality' id="minimality" title="收起">&#8211;</li>
                  </ul>
                </div>
              </div>
              <div class="body">
                <ul class="info" id="info">
                  <li>兼容雨课堂各版本课程页面，自动处理视频、音频与作业。</li>
                  <li><strong>智能答题</strong>截取题面后交由多模态模型作答，无需 OCR。</li>
                  <li><strong>开始之前</strong>先在 <span class="tag">模型设置</span> 中填入 API Key 并启用自动作答。</li>
                  <li>配置完成后点击 <span class="tag">开始</span>，即可挂机处理视频与作业。</li>
                  <hr>
                  <li>运行日志将显示在此处。</li>
                </ul>
              </div>
              <div id="settings">
                <div class="settings-section">模型接入</div>
                <div class="form-item">
                  <label>接口地址</label>
                  <input type="text" id="ai_url" placeholder="https://api.openai.com/v1/chat/completions">
                </div>
                <div class="form-item">
                  <label>API Key</label>
                  <input type="password" id="ai_key" placeholder="sk-••••••••">
                </div>
                <div class="form-item">
                  <label>模型名称</label>
                  <input type="text" id="ai_model" placeholder="gpt-4o-mini / qwen-vl-plus">
                </div>
                <div class="form-item">
                  <label>接口格式</label>
                  <select id="ai_format">
                    <option value="auto">自动识别（按地址）</option>
                    <option value="openai-chat">OpenAI Chat Completions</option>
                    <option value="openai-responses">OpenAI Responses</option>
                  </select>
                </div>
                <div class="form-item">
                  <label>鉴权方式</label>
                  <select id="auth_method">
                    <option value="auto">自动识别</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="x-api-key">X-API-Key</option>
                    <option value="api-key">API-Key</option>
                  </select>
                </div>
                <div class="form-item">
                  <label>最大 Token</label>
                  <input type="text" id="ai_max_tokens" placeholder="留空为自动：CoT 32768，否则 4096">
                </div>

                <div class="settings-section">推理选项</div>
                <div class="form-item">
                  <label class="checkbox-label">
                    <input type="checkbox" id="ai_thinking">
                    <span>启用思维链（CoT），默认开启</span>
                  </label>
                </div>
                <div class="form-item">
                  <label class="checkbox-label">
                    <input type="checkbox" id="ai_stream">
                    <span>流式传输，默认开启，60 秒无响应判定超时</span>
                  </label>
                </div>

                <div class="settings-section">自动化功能</div>
                <div class="form-item">
                  <label class="checkbox-label">
                    <input type="checkbox" id="feature_auto_ai">
                    <span>自动作答作业与题目</span>
                  </label>
                </div>
                <div class="form-item">
                  <label class="checkbox-label">
                    <input type="checkbox" id="feature_auto_comment">
                    <span>自动回复图文与讨论区</span>
                  </label>
                </div>
                <div class="form-item">
                  <label class="checkbox-label">
                    <input type="checkbox" id="feature_font_patch">
                    <span>禁用雨课堂混淆字体（实验，截图答题通常无需开启）</span>
                  </label>
                </div>

                <div class="settings-footer">
                  <button id="close_settings" class="btn-secondary">取消</button>
                  <button id="save_settings" class="btn-primary">保存</button>
                </div>
              </div>
              <div class="footer">
                <button id="btn-setting" class="btn-secondary">模型设置</button>
                <button id="btn-clear" class="btn-danger">清除失败记录</button>
                <button id="btn-pause" class="btn-secondary" style="display:none;">暂停</button>
                <button id="btn-start" class="btn-primary">开始</button>
              </div>
            </div>
    `);
    doc.close();

    const ui = {
      iframe,
      doc,
      panel: doc.getElementById('panel'),
      header: doc.getElementById('header'),
      info: doc.getElementById('info'),
      btnStart: doc.getElementById('btn-start'),
      btnPause: doc.getElementById('btn-pause'),
      btnClear: doc.getElementById('btn-clear'),
      btnSetting: doc.getElementById('btn-setting'),
      settings: doc.getElementById('settings'),
      saveSettings: doc.getElementById('save_settings'),
      closeSettings: doc.getElementById('close_settings'),
      aiUrlInput: doc.getElementById('ai_url'),
      aiKeyInput: doc.getElementById('ai_key'),
      aiModelInput: doc.getElementById('ai_model'),
      aiFormatSelect: doc.getElementById('ai_format'),
      authMethodSelect: doc.getElementById('auth_method'),
      aiMaxTokensInput: doc.getElementById('ai_max_tokens'),
      aiThinkingInput: doc.getElementById('ai_thinking'),
      aiStreamInput: doc.getElementById('ai_stream'),
      featureAutoAI: doc.getElementById('feature_auto_ai'),
      featureAutoComment: doc.getElementById('feature_auto_comment'),
      featureFontPatch: doc.getElementById('feature_font_patch'),
      minimality: doc.getElementById('minimality'),
      miniBasic: doc.getElementById('mini-basic')
    };

    let isDragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    const hostWindow = window.parent || window;
    const onMove = e => {
      if (!isDragging) return;
      const deltaX = e.screenX - startX;
      const deltaY = e.screenY - startY;
      const maxLeft = Math.max(0, hostWindow.innerWidth - iframe.offsetWidth);
      const maxTop = Math.max(0, hostWindow.innerHeight - iframe.offsetHeight);
      iframe.style.left = Math.min(Math.max(0, startLeft + deltaX), maxLeft) + 'px';
      iframe.style.top = Math.min(Math.max(0, startTop + deltaY), maxTop) + 'px';
    };
    const stopDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      iframe.style.transition = '';
      doc.body.style.userSelect = '';
    };
    ui.header.addEventListener('mousedown', e => {
      isDragging = true;
      startX = e.screenX;
      startY = e.screenY;
      startLeft = parseFloat(iframe.style.left) || 0;
      startTop = parseFloat(iframe.style.top) || 0;
      iframe.style.transition = 'none';
      doc.body.style.userSelect = 'none';
      e.preventDefault();
    });
    doc.addEventListener('mousemove', onMove);
    hostWindow.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', stopDrag);
    hostWindow.addEventListener('mouseup', stopDrag);
    hostWindow.addEventListener('blur', stopDrag);

    const normalSize = { width: parseFloat(iframe.style.width), height: parseFloat(iframe.style.height) };
    const miniSize = 64;
    let isMinimized = false;
    const enterMini = () => {
      if (isMinimized) return;
      isMinimized = true;
      ui.panel.style.display = 'none';
      ui.miniBasic.classList.add('show');
      iframe.style.width = miniSize + 'px';
      iframe.style.height = miniSize + 'px';
    };
    const exitMini = () => {
      if (!isMinimized) return;
      isMinimized = false;
      ui.panel.style.display = '';
      ui.miniBasic.classList.remove('show');
      iframe.style.width = normalSize.width + 'px';
      iframe.style.height = normalSize.height + 'px';
    };
    ui.minimality.addEventListener('click', enterMini);
    ui.miniBasic.addEventListener('click', exitMini);

    const log = (message, level = '') => {
      const normalizedLevel = ['info', 'warning', 'error'].includes(String(level).toLowerCase())
        ? String(level).toLowerCase()
        : 'info';
      const label = { info: 'Info', warning: 'Warning', error: 'Error' }[normalizedLevel] || 'Info';
      const li = doc.createElement('li');
      const tag = doc.createElement('span');
      const text = doc.createElement('span');
      li.className = 'log-entry';
      tag.className = `log-tag ${normalizedLevel}`;
      text.className = 'log-message';
      tag.innerText = `[${label}]`;
      text.innerText = String(message ?? '').trim();
      li.appendChild(tag);
      li.appendChild(text);
      ui.info.appendChild(li);
      if (ui.info.lastElementChild) ui.info.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' });
    };

    const defaultAI = { url: 'https://api.openai.com/v1/chat/completions', key: 'sk-xxxxxxx', model: 'gpt-4o-mini', apiFormat: 'auto', authMethod: 'auto', thinkingEnabled: true, maxTokens: 0, stream: true };
    const loadAIConf = () => {
      const saved = Store.getAIConf();
      ui.aiUrlInput.value = saved.url || defaultAI.url;
      ui.aiKeyInput.value = saved.key || defaultAI.key;
      ui.aiModelInput.value = saved.model || defaultAI.model;
      ui.aiFormatSelect.value = saved.apiFormat || defaultAI.apiFormat;
      ui.authMethodSelect.value = saved.authMethod || defaultAI.authMethod;
      ui.aiThinkingInput.checked = saved.thinkingEnabled ?? defaultAI.thinkingEnabled;
      ui.aiStreamInput.checked = saved.stream ?? defaultAI.stream;
      ui.aiMaxTokensInput.value = saved.maxTokens > 0 ? String(saved.maxTokens) : '';
    };
    const loadFeatureConf = () => {
      const saved = Store.getFeatureConf();
      ui.featureAutoAI.checked = saved.autoAI;
      ui.featureAutoComment.checked = saved.autoComment;
      ui.featureFontPatch.checked = saved.fontPatch;
    };
    loadAIConf();
    loadFeatureConf();
    ui.btnSetting.onclick = () => {
      loadAIConf();
      loadFeatureConf();
      ui.settings.style.display = 'block';
    };
    ui.closeSettings.onclick = () => {
      ui.settings.style.display = 'none';
    };
    ui.saveSettings.onclick = () => {
      const conf = {
        url: ui.aiUrlInput.value.trim(),
        key: ui.aiKeyInput.value.trim(),
        model: ui.aiModelInput.value.trim(),
        apiFormat: ui.aiFormatSelect.value,
        authMethod: ui.authMethodSelect.value,
        thinkingEnabled: ui.aiThinkingInput.checked,
        stream: ui.aiStreamInput.checked,
        maxTokens: Math.max(0, parseInt(ui.aiMaxTokensInput.value.trim() || '0', 10) || 0)
      };
      Store.setAIConf(conf);
      const featureConf = {
        autoAI: ui.featureAutoAI.checked,
        autoComment: ui.featureAutoComment.checked,
        fontPatch: ui.featureFontPatch.checked
      };
      Store.setFeatureConf(featureConf);
      FontPatch.apply(featureConf.fontPatch);
      ui.settings.style.display = 'none';
      log('模型配置已保存');
    };

    ui.btnClear.onclick = () => {
      FailGate.clear();
      Store.clearPendingAutoStart();
      log('已清除本会话记住的失败章节与重试次数');
    };

    let startHandler = null;
    const invokeStart = () => {
      // 若处于暂停态先恢复，避免“开始”后流程仍被闸门挂起
      if (PauseGate.paused) PauseGate.resume();
      log('正在启动…');
      ui.btnStart.innerText = '运行中';
      ui.btnPause.style.display = '';
      ui.btnPause.innerText = '暂停';
      startHandler && startHandler();
    };

    PauseGate.onChange = paused => {
      ui.btnPause.innerText = paused ? '继续' : '暂停';
      ui.btnPause.className = paused ? 'btn-primary' : 'btn-secondary';
      log(paused ? '已暂停，当前步骤完成后挂起' : '已继续');
    };
    ui.btnPause.onclick = () => PauseGate.toggle();

    // 后面赋值给panel
    return {
      ...ui,
      log,
      setStartHandler(fn) {
        startHandler = fn;
        ui.btnStart.onclick = invokeStart;
      },
      start() {
        invokeStart();
      },
      resetStartButton(text = '开始') {
        ui.btnStart.innerText = text;
        // 流程结束（完成/出错/非目标页）时收起暂停按钮并复位闸门
        if (PauseGate.paused) PauseGate.resume();
        ui.btnPause.style.display = 'none';
      }
    };
  }

  // ---- 轻量字体混淆补丁（默认关闭）----
  const FontPatch = {
    styleEl: null,
    apply(enabled) {
      if (!enabled) {
        if (this.styleEl) {
          this.styleEl.remove();
          this.styleEl = null;
        }
        for (const style of document.querySelectorAll('style[data-ykt-font-patch-disabled="1"]')) {
          style.disabled = false;
          style.removeAttribute('data-ykt-font-patch-disabled');
        }
        return;
      }
      if (!document.head) return;
      if (!this.styleEl) {
        this.styleEl = document.createElement('style');
        this.styleEl.id = 'ykt-helper-font-patch';
        this.styleEl.textContent = [
          '@font-face {',
          '  font-family: "exam-data-decrypt-font";',
          '  src: local("YktDisabledEncryptedFont") !important;',
          '  unicode-range: U+0-10FFFF;',
          '}'
        ].join('\n');
        document.head.appendChild(this.styleEl);
      }
      for (const style of document.querySelectorAll('style')) {
        if (style.id === 'ykt-helper-font-patch') continue;
        if (/exam-data-decrypt-font|exam_font/.test(style.textContent || '')) {
          style.disabled = true;
          style.setAttribute('data-ykt-font-patch-disabled', '1');
        }
      }
    },
    scheduleFromConfig() {
      const tick = () => this.apply(Store.getFeatureConf().fontPatch);
      tick();
      setInterval(tick, 5000);
    }
  };

  // ---- 播放器工具 ----
  const Player = {
    isNearEnd(media, threshold = 1) {
      if (!media) return false;
      const duration = Number(media.duration || 0);
      const currentTime = Number(media.currentTime || 0);
      return Number.isFinite(duration) && duration > 1 && currentTime > 0 && duration - currentTime <= threshold;
    },
    applySpeed() {
      const rate = Config.playbackRate;
      const speedBtn = document.querySelector('xt-speedlist xt-button') || document.getElementsByTagName('xt-speedlist')[0]?.firstElementChild?.firstElementChild;
      const speedWrap = document.getElementsByTagName('xt-speedbutton')[0];
      if (speedBtn && speedWrap) {
        speedBtn.setAttribute('data-speed', rate);
        speedBtn.setAttribute('keyt', `${rate}.00`);
        speedBtn.innerText = `${rate}.00X`;
        const mousemove = document.createEvent('MouseEvent');
        mousemove.initMouseEvent('mousemove', true, true, unsafeWindow, 0, 10, 10, 10, 10, 0, 0, 0, 0, 0, null);
        speedWrap.dispatchEvent(mousemove);
        speedBtn.click();
      } else if (document.querySelector('video')) {
        document.querySelector('video').playbackRate = rate;
      }
    },
    prepareMedia(media) {
      if (!media) return;
      media.muted = true;
      media.defaultMuted = true;
      media.volume = 0;
      media.playbackRate = Config.playbackRate;
      media.setAttribute('muted', '');
      media.setAttribute('playsinline', '');
    },
    waitForReady(media, timeout = 10000) {
      return new Promise(resolve => {
        if (!media || media.readyState >= 1) {
          resolve(Boolean(media));
          return;
        }
        let timer;
        const done = () => {
          clearTimeout(timer);
          media.removeEventListener('loadedmetadata', done);
          media.removeEventListener('canplay', done);
          resolve(true);
        };
        media.addEventListener('loadedmetadata', done, { once: true });
        media.addEventListener('canplay', done, { once: true });
        timer = setTimeout(done, timeout);
      });
    },
    mute(media = document.querySelector('video') || document.querySelector('audio')) {
      const doc = media?.ownerDocument || document;
      const muteBtn = doc.querySelector('#video-box > div > xt-wrap > xt-controls > xt-inner > xt-volumebutton > xt-icon');
      if (muteBtn) muteBtn.click();
      this.prepareMedia(media);
    },
    findPlayButton(doc = document) {
      const selectors = [
        '.play-btn-tip',
        '.play-btn',
        '.video-js .vjs-big-play-button',
        '.xt-play-button',
        '.xt-startbutton',
        '.xt_video_player_play_btn',
        '.xt_video_player_common_icon',
        '[class*="play"][class*="btn"]',
        '[class*="player"][class*="play"]',
        '.player-play',
        '.player-start',
        '[class*="play-button"]:not([class*="pause"])',
        '[class*="play-btn"]'
      ];
      for (const sel of selectors) {
        const el = doc.querySelector(sel);
        if (el && el.offsetParent !== null) return el;
      }
      const candidates = [...doc.querySelectorAll('button, [role="button"], div, span')];
      return candidates.find(el => {
        if (!el || el.offsetParent === null) return false;
        const text = String(el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
        const cls = String(el.className || '');
        return /播放|play/i.test(text) && !/暂停|pause/i.test(`${text} ${cls}`);
      }) || null;
    },
    dispatchUserLikeClick(el) {
      if (!el) return false;
      const doc = el.ownerDocument || document;
      const view = doc.defaultView || window;
      const rect = el.getBoundingClientRect();
      const clientX = rect.left + Math.max(1, rect.width / 2);
      const clientY = rect.top + Math.max(1, rect.height / 2);
      const base = { bubbles: true, cancelable: true, clientX, clientY, view };
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        const Ctor = type.startsWith('pointer') && view.PointerEvent ? view.PointerEvent : view.MouseEvent;
        el.dispatchEvent(new Ctor(type, base));
      }
      if (typeof el.click === 'function') el.click();
      return true;
    },
    clickBigPlayButton(media = null) {
      const doc = media?.ownerDocument || document;
      const btn = this.findPlayButton(doc);
      if (btn) {
        return this.dispatchUserLikeClick(btn);
      }
      const video = media || doc.querySelector('video');
      if (video) {
        const rect = video.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return this.dispatchUserLikeClick(video);
        }
      }
      return false;
    },
    applyMediaDefault(media) {
      if (!media) return;
      this.prepareMedia(media);
      this.clickBigPlayButton(media);
      media.play().catch(() => { });
    },
    async startPlayback(media, maxRetries = 5) {
      if (!media) return false;
      await this.waitForReady(media);
      this.prepareMedia(media);
      for (let i = 0; i < maxRetries; i++) {
        this.clickBigPlayButton(media);
        await Utils.sleep(300);
        try {
          this.prepareMedia(media);
          await media.play();
        } catch (e) {
          console.warn('播放失败，重试:', e);
          await Utils.sleep(1000);
          continue;
        }
        await Utils.sleep(500);
        if (!media.paused || media.ended) return true;
      }
      return false;
    },
    async playFromStart(media) {
      if (!media) return;
      try {
        media.currentTime = 0;
      } catch (e) {
        console.warn('重置播放时间失败:', e);
      }
      await Utils.sleep(300);
    },
    observePause(video, shouldResume = () => true) {
      if (!video) return () => { };
      const doc = video.ownerDocument || document;
      const target = doc.getElementsByClassName('play-btn-tip')[0];
      let retryTimer = null;
      let resumeCheckTimer = null;
      let watchdogTimer = null;
      let lastResumeAt = 0;
      let lastClickResumeAt = 0;
      let lastTime = Number(video.currentTime || 0);
      let lastProgressAt = Date.now();
      const clearRetry = () => {
        if (!retryTimer) return;
        clearTimeout(retryTimer);
        retryTimer = null;
      };
      const clearResumeCheck = () => {
        if (!resumeCheckTimer) return;
        clearTimeout(resumeCheckTimer);
        resumeCheckTimer = null;
      };
      const noteProgress = () => {
        const currentTime = Number(video.currentTime || 0);
        if (currentTime > lastTime + 0.05) {
          lastProgressAt = Date.now();
          lastTime = currentTime;
        }
      };
      const shouldAttemptResume = (force = false) => {
        if (!shouldResume() || video.ended || this.isNearEnd(video)) return;
        noteProgress();
        return video.paused && (force || Date.now() - lastProgressAt > 1500);
      };
      // 自动播放：暂停事件立即尝试恢复；低频 watchdog 只处理漏掉的状态变化。
      const playVideo = (withClick = false, force = false) => {
        if (!shouldAttemptResume(force)) return;
        const now = Date.now();
        if (withClick) {
          if (now - lastClickResumeAt < 1200) return;
          lastClickResumeAt = now;
        } else if (now - lastResumeAt < 350) {
          return;
        }
        lastResumeAt = now;
        this.prepareMedia(video);
        if (withClick) this.clickBigPlayButton(video);
        video.play().catch(e => {
          if (!shouldAttemptResume(force)) return;
          console.warn('自动播放失败:', e);
          clearRetry();
          retryTimer = setTimeout(() => playVideo(true, true), 1200);
        });
      };
      const requestResume = (withClick = false, force = false, delay = 0) => {
        clearResumeCheck();
        const run = () => {
          resumeCheckTimer = null;
          playVideo(withClick, force);
          if (force && !withClick) {
            clearResumeCheck();
            resumeCheckTimer = setTimeout(() => {
              resumeCheckTimer = null;
              playVideo(true, true);
            }, 350);
          }
        };
        if (delay > 0) resumeCheckTimer = setTimeout(run, delay);
        else run();
      };
      requestResume(false, true);
      const watchdog = () => {
        noteProgress();
        playVideo(false);
      };
      watchdogTimer = setInterval(watchdog, 10000);
      const onPause = () => requestResume(false, true);
      const onProgress = () => {
        noteProgress();
        if (!video.paused) clearRetry();
      };
      const onSignal = () => requestResume(false, false);
      const onStall = () => requestResume(false, false, 800);
      video.addEventListener('pause', onPause);
      video.addEventListener('timeupdate', onProgress);
      video.addEventListener('playing', onProgress);
      video.addEventListener('waiting', onStall);
      video.addEventListener('stalled', onStall);
      doc.addEventListener('visibilitychange', onSignal);
      const view = doc.defaultView || window;
      view.addEventListener('focus', onSignal);

      let observer = null;
      if (target) {
        observer = new MutationObserver(list => {
          for (const mutation of list) {
            if (
              (mutation.type === 'childList' || mutation.type === 'characterData')
              && /播放|play/i.test(target.innerText || '')
              && shouldAttemptResume(true)
            ) {
              requestResume(false, true);
            }
          }
        });
        observer.observe(target, { childList: true, characterData: true, subtree: true });
      }
      return () => {
        clearRetry();
        clearResumeCheck();
        clearInterval(watchdogTimer);
        video.removeEventListener('pause', onPause);
        video.removeEventListener('timeupdate', onProgress);
        video.removeEventListener('playing', onProgress);
        video.removeEventListener('waiting', onStall);
        video.removeEventListener('stalled', onStall);
        doc.removeEventListener('visibilitychange', onSignal);
        view.removeEventListener('focus', onSignal);
        if (observer) observer.disconnect();
      };
    },
    waitForEnd(media, timeout = 0) {
      return new Promise(resolve => {
        if (!media) return resolve();
        if (media.ended) return resolve();
        let timer;
        const onEnded = () => {
          clearTimeout(timer);
          resolve();
        };
        media.addEventListener('ended', onEnded, { once: true });
        if (timeout > 0) {
          timer = setTimeout(() => {
            media.removeEventListener('ended', onEnded);
            resolve();
          }, timeout);
        }
      });
    },
  };

  // ---- ai-workspace 路由工具 ----
  const AiWorkspace = {
    normalizeText(text) {
      return String(text || '').replace(/\s+/g, ' ').trim();
    },
    isVisibleElement(element) {
      if (!element || element.nodeType !== 1) return false;
      const view = element.ownerDocument?.defaultView || window;
      const style = view.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    },
    isDisabledElement(element) {
      if (!element || element.nodeType !== 1) return false;
      return Boolean(element.disabled)
        || element.getAttribute('aria-disabled') === 'true'
        || /\b(is-disabled|disabled)\b/i.test(String(element.className || ''));
    },
    getRoute() {
      // ai-workspace / lms-graph 路由
      const match = location.pathname.match(/^\/ai-workspace\/lms-graph\/([^/]+)\/([^/]+)\/([^/?#]+)/);
      if (match) {
        const [, classroomId, type, leafId] = match;
        const query = new URLSearchParams(location.search);
        return { classroomId, type, leafId, nodeId: query.get('node_id') || '', source: 'ai-workspace/lms-graph' };
      }
      // v2/web/cloud 路由，例如 /v2/web/cloud/student/exercise/{classroomId}/{nodeId}/{leafId}
      const cloudMatch = location.pathname.match(/^\/v2\/web\/cloud\/student\/([^/]+)\/([^/]+)\/([^/]+)\/([^/?#]+)/);
      if (cloudMatch) {
        const [, type, classroomId, nodeId, leafId] = cloudMatch;
        return { classroomId, type, leafId, nodeId: nodeId || '', source: 'v2/web/cloud' };
      }
      // v2/web/xcloud 路由，例如 /v2/web/xcloud/video-student/{id}/{leafId}
      const xcloudMatch = location.pathname.match(/^\/v2\/web\/xcloud\/([^/?#]+)(?:\/(.+))?/);
      if (xcloudMatch) {
        const [, rawType, rest = ''] = xcloudMatch;
        const query = new URLSearchParams(location.search);
        const parts = rest.split('/').filter(Boolean);
        const classroomId = query.get('classroom_id') || query.get('classroomId') || '';
        return {
          classroomId,
          type: this.normalizeRouteType(rawType, rest),
          leafId: parts[parts.length - 1] || query.get('leaf_id') || rawType,
          nodeId: query.get('node_id') || parts[0] || '',
          source: 'v2/web/xcloud'
        };
      }
      const v2ContentMatch = location.pathname.match(/^\/v2\/web\/([^/]+)\/(.+)/);
      if (v2ContentMatch && !location.pathname.includes('/v2/web/studentLog/')) {
        const [, sourcePart, rest = ''] = v2ContentMatch;
        const query = new URLSearchParams(location.search);
        const parts = rest.split('/').filter(Boolean);
        const type = this.normalizeRouteType(parts[0] || sourcePart, rest);
        if (this.isMediaRouteType(type) || this.isExerciseRouteType(type)) {
          return {
            classroomId: query.get('classroom_id') || query.get('classroomId') || '',
            type,
            leafId: parts[parts.length - 1] || query.get('leaf_id') || sourcePart,
            nodeId: query.get('node_id') || parts[1] || '',
            source: `v2/web/${sourcePart}`
          };
        }
      }
      const genericV2Route = this.getGenericV2ContentRoute();
      if (genericV2Route) return genericV2Route;
      const handoffRoute = this.getPendingHandoffRoute();
      if (handoffRoute) return handoffRoute;
      return null;
    },
    getPendingHandoffRoute() {
      const handoff = Store.getPendingHandoff();
      if (!handoff) return null;
      const type = this.normalizeRouteType(handoff.type, handoff.type);
      if (!this.isMediaRouteType(type) && !this.isExerciseRouteType(type)) return null;
      const pending = Store.getPendingAutoStart();
      const query = new URLSearchParams(location.search);
      const parts = location.pathname.split('/').filter(Boolean);
      return {
        classroomId: query.get('classroom_id') || query.get('classroomId') || query.get('cid') || pending?.classroomId || '',
        type,
        leafId: query.get('leaf_id') || query.get('leafId') || parts[parts.length - 1] || handoff.title || '',
        nodeId: query.get('node_id') || query.get('nodeId') || '',
        source: 'pending-handoff'
      };
    },
    getGenericV2ContentRoute() {
      if (!Utils.isV2ContentPage()) return null;
      const query = new URLSearchParams(location.search);
      const pathText = decodeURIComponent(`${location.pathname} ${location.search}`);
      let type = this.normalizeRouteType(pathText, pathText);
      const handoff = Store.getPendingHandoff();
      const handoffType = this.normalizeRouteType(handoff?.type || '', handoff?.type || '');
      if (!this.isMediaRouteType(type) && !this.isExerciseRouteType(type)) {
        if (this.isMediaRouteType(handoffType) || this.isExerciseRouteType(handoffType)) {
          type = handoffType;
        } else if (this.getMediaCandidates().length || document.querySelector('.play-btn-tip, .video-js, xt-player, xt-wrap')) {
          type = 'video';
        } else {
          type = 'content';
        }
      }
      const parts = location.pathname.split('/').filter(Boolean);
      return {
        classroomId: query.get('classroom_id') || query.get('classroomId') || query.get('cid') || '',
        type,
        leafId: query.get('leaf_id') || query.get('leafId') || parts[parts.length - 1] || handoff?.title || '',
        nodeId: query.get('node_id') || query.get('nodeId') || '',
        source: handoff ? 'v2/web/content+handoff' : 'v2/web/content'
      };
    },
    normalizeRouteType(rawType = '', pathText = '') {
      const text = `${rawType} ${pathText}`.toLowerCase();
      if (/audio|yinpin|音频/.test(text)) return 'audio';
      if (/video|shipin|视频/.test(text)) return 'video';
      if (/exercise|zuoye|lianxi|ceping|kaoshi|作业|练习|测评|考试/.test(text)) return 'exercise';
      return String(rawType || '').replace(/-student$/i, '');
    },
    isMediaRouteType(type = '') {
      return /^(video|audio|shipin|yinpin)$/.test(String(type).toLowerCase());
    },
    isExerciseRouteType(type = '') {
      return /^(exercise|zuoye|lianxi|ceping|kaoshi)$/.test(String(type).toLowerCase());
    },
    getAccessibleDocuments() {
      const docs = [document];
      for (const iframe of document.querySelectorAll('iframe')) {
        try {
          if (iframe.contentDocument) docs.push(iframe.contentDocument);
        } catch (_) {
          // cross-origin iframe
        }
      }
      return docs;
    },
    getMediaCandidates() {
      return this.getAccessibleDocuments().flatMap(doc => [...doc.querySelectorAll('video, audio')]).filter(media => {
        if (!/^(video|audio)$/i.test(media.tagName || '')) return false;
        const rect = media.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;
        return isVisible || media.tagName.toLowerCase() === 'audio';
      });
    },
    getMedia() {
      const candidates = this.getMediaCandidates();
      if (!candidates.length) {
        for (const doc of this.getAccessibleDocuments()) {
          const media = doc.querySelector('video') || doc.querySelector('audio');
          if (media) return media;
        }
        return null;
      }
      const score = media => {
        const rect = media.getBoundingClientRect();
        const area = rect.width * rect.height;
        const playingBoost = !media.paused && !media.ended ? 1_000_000 : 0;
        const currentBoost = Number(media.currentTime || 0);
        return playingBoost + area + currentBoost;
      };
      return [...candidates].sort((a, b) => score(b) - score(a))[0];
    },
    isPlayerDone(media, { startTime = 0, minPlayedDelta = 0 } = {}) {
      if (!media) return false;
      const currentTime = Number(media?.currentTime || 0);
      const playedDelta = Math.max(0, currentTime - startTime);
      if (playedDelta < minPlayedDelta) return false;
      if (media?.ended) return true;
      if (Player.isNearEnd(media)) return true;
      const doc = media.ownerDocument || document;
      const display = doc.querySelector('.xt_video_player_current_time_display')?.innerText?.trim()
        || document.querySelector('.xt_video_player_current_time_display')?.innerText?.trim()
        || '';
      const [current, total] = display.split(' / ').map(text => text?.trim());
      return Boolean(playedDelta >= minPlayedDelta && current && total && current === total);
    },
    keepAlive(shouldResume = () => true) {
      let lastMedia = null;
      let lastResumeAt = 0;
      let lastTime = 0;
      let lastProgressAt = Date.now();
      const tick = () => {
        if (!shouldResume()) return;
        const media = lastMedia && !lastMedia.ended && lastMedia.isConnected
          ? lastMedia
          : this.getMedia();
        if (!media) return;
        if (lastMedia !== media) {
          lastTime = Number(media.currentTime || 0);
          lastProgressAt = Date.now();
        }
        lastMedia = media;
        const currentTime = Number(media.currentTime || 0);
        if (currentTime > lastTime + 0.05) {
          lastTime = currentTime;
          lastProgressAt = Date.now();
        }
        media.muted = true;
        media.defaultMuted = true;
        media.volume = 0;
        media.playbackRate = Config.playbackRate;
        if (
          media.paused
          && !media.ended
          && !Player.isNearEnd(media)
          && Date.now() - lastProgressAt > 3000
          && Date.now() - lastResumeAt > 3000
        ) {
          lastResumeAt = Date.now();
          media.play().catch(() => { });
        }
      };
      const timer = setInterval(tick, 3000);
      document.addEventListener('visibilitychange', tick);
      window.addEventListener('focus', tick);
      tick();
      return () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', tick);
        window.removeEventListener('focus', tick);
      };
    },
    getActiveLeafTitle() {
      return this.normalizeText(document.querySelector('.leaf-item.is-active')?.innerText);
    },
    getExerciseDocument() {
      const localHasExercise = document.querySelector('#app .container-body .container-problem')
        || document.querySelector('#app .container-problem')
        || document.querySelector('.container-problem');
      if (localHasExercise) return document;

      const frames = [...document.querySelectorAll('iframe')];
      for (const frame of frames) {
        try {
          const doc = frame.contentDocument;
          if (!doc?.body) continue;
          if (
            doc.querySelector('.container-problem')
            || doc.querySelector('.subject-item')
            || doc.querySelector('.item-body')
          ) {
            return doc;
          }
        } catch (_) {
          // ignore cross-document access failures
        }
      }
      return null;
    },
    getExerciseContainer() {
      const exerciseDoc = this.getExerciseDocument();
      return exerciseDoc?.querySelector('#app .container-body .container-problem')
        || exerciseDoc?.querySelector('#app .container-problem')
        || exerciseDoc?.querySelector('.container-problem')
        || null;
    },
    getExerciseQuestionTabs(root = this.getExerciseContainer()) {
      if (!root) return [];
      const selectors = [
        '.subject-item.J_order',
        '.subject-item',
        '.problem-index-item',
        '.question-index-item',
        '[class*="subject-item"]',
        '[class*="problem-index"]',
        '[class*="question-index"]'
      ].join(',');
      const visible = [...root.querySelectorAll(selectors)].filter((el, index, arr) => {
        if (!this.isVisibleElement(el)) return false;
        if (arr.indexOf(el) !== index) return false;
        return true;
      });
      return visible.filter(el => {
        // 宽泛 class* selector 可能同时命中题号列表容器和题号项；只保留叶子题号，避免末题被重复遍历。
        if (visible.some(other => other !== el && el.contains(other))) return false;
        const text = this.normalizeText(el.innerText);
        return text && text.length <= 20;
      });
    },
    getExerciseProblems(root = this.getExerciseContainer()) {
      const container = root?.closest?.('.container-problem') || this.getExerciseContainer();
      const candidates = [
        container?.__vue__,
        container?.__vue__?.$parent,
        root?.__vue__,
        root?.__vue__?.$parent
      ].filter(Boolean);
      for (const vm of candidates) {
        const list = vm.exerciseList || vm.$parent?.exerciseList || vm.$data?.exerciseList;
        const problems = list?.problems || list?.problemList || list;
        if (Array.isArray(problems)) return problems;
      }
      return [];
    },
    isProblemSubmitted(problem) {
      if (!problem) return false;
      const user = problem.user || problem.user_answer || problem.answer || {};
      return Boolean(
        user.submit_time
        || user.submitTime
        || user.submitted
        || user.is_right !== undefined
        || user.isRight !== undefined
        || problem.submitted
        || problem.done
      );
    },
    isExerciseTabAnswered(tab) {
      if (!tab) return false;
      const text = this.normalizeText(tab.innerText);
      const cls = String(tab.className || '');
      const statusAttrs = [
        tab.getAttribute('aria-label'),
        tab.getAttribute('title'),
        tab.getAttribute('data-status'),
        tab.getAttribute('data-answer-status')
      ].filter(Boolean).join(' ');
      return /已完成|已作答|已提交|回答正确|回答错误|正确|错误|✓|✔/.test(`${text} ${statusAttrs}`)
        || /(done|complete|completed|submitted|answered|correct|wrong|right|finish|finished|success)/i.test(cls)
        || Boolean(tab.querySelector('.done, .complete, .completed, .submitted, .answered, .correct, .wrong, .right, .success, .el-icon-check'));
    },
    getExerciseQuestionBody(root = this.getExerciseContainer()) {
      if (!root) return null;
      const itemType = root.querySelector('.item-type');
      if (itemType?.parentElement && this.isVisibleElement(itemType.parentElement)) return itemType.parentElement;
      const selectors = [
        '.item-body',
        '.problem-content',
        '.question-content',
        '.problem-main',
        '.problem-body',
        '.question-body',
        '[class*="problem-content"]',
        '[class*="question-content"]',
        '[class*="problem-body"]',
        '[class*="question-body"]'
      ];
      for (const selector of selectors) {
        const match = [...root.querySelectorAll(selector)].find(el => this.isVisibleElement(el));
        if (match) return match;
      }
      return root;
    },
    isExerciseAnswered(root = this.getExerciseContainer()) {
      if (!root) return false;
      const statusSelectors = [
        '.result',
        '.status',
        '.answer-status',
        '[class*="result"]',
        '[class*="status"]'
      ];
      for (const selector of statusSelectors) {
        const statusNode = [...root.querySelectorAll(selector)]
          .find(el => this.isVisibleElement(el) && /已完成|已作答|已提交|回答正确|回答错误/.test(this.normalizeText(el.innerText)));
        if (statusNode) return true;
      }
      const disabledDoneButton = [...root.querySelectorAll('button, .el-button, [role="button"]')]
        .find(el => this.isVisibleElement(el)
          && this.isDisabledElement(el)
          && /已完成|已作答|已提交|回答正确|回答错误|完成本题/.test(this.normalizeText(el.innerText)));
      if (disabledDoneButton) return true;
      return false;
    },
    getExerciseActionButton(root = this.getExerciseContainer(), pattern = /提交|保存|确认|确定|下一题|下一道|下一步|完成本题/) {
      if (!root) return null;
      const selectors = 'button, .el-button, [role="button"], [class*="button"]';
      const ownerDocument = root.ownerDocument || document;
      const nodes = [
        ...root.querySelectorAll(selectors),
        ...ownerDocument.querySelectorAll(selectors)
      ];
      return nodes.find(el => this.isVisibleElement(el)
        && !this.isDisabledElement(el)
        && pattern.test(this.normalizeText(el.innerText)));
    }
  };

  // ---- 防切屏 ----
  function preventScreenCheck() {
    const win = unsafeWindow;
    const blackList = new Set(['visibilitychange', 'blur', 'pagehide']);
    win._addEventListener = win.addEventListener;
    win.addEventListener = (...args) => blackList.has(args[0]) ? undefined : win._addEventListener(...args);
    document._addEventListener = document.addEventListener;
    document.addEventListener = (...args) => blackList.has(args[0]) ? undefined : document._addEventListener(...args);
    Object.defineProperties(document, {
      hidden: { value: false },
      visibilityState: { value: 'visible' },
      hasFocus: { value: () => true },
      onvisibilitychange: { get: () => undefined, set: () => { } },
      onblur: { get: () => undefined, set: () => { } }
    });
    Object.defineProperties(win, {
      onblur: { get: () => undefined, set: () => { } },
      onpagehide: { get: () => undefined, set: () => { } }
    });
  }

  // ---- Screenshot & Multimodal AI ----
  const Solver = {
    async captureQuestionImage(element) {
      if (!element) throw new Error('无题目元素');
      try {
        panel.log('正在截取题面截图...');
        const canvas = await html2canvas(element, {
          useCORS: true,
          allowTaint: false,
          logging: false,
          scale: 2,
          backgroundColor: '#ffffff',
          windowWidth: document.documentElement.scrollWidth,
          windowHeight: document.documentElement.scrollHeight
        });
        panel.log(`题面截图完成：${canvas.width}x${canvas.height}`);
        return canvas.toDataURL('image/png');
      } catch (err) {
        console.warn('html2canvas 截图失败，尝试 SVG foreignObject 备用方案:', err);
        return this.captureQuestionImageBySVG(element);
      }
    },
    captureQuestionImageBySVG(element) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) throw new Error('题目区域不可见，无法截图');
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(rect.width * scale);
      canvas.height = Math.ceil(rect.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      const clone = element.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      const html = new XMLSerializer().serializeToString(clone);
      const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">`,
        `<foreignObject width="100%" height="100%">${html}</foreignObject>`,
        '</svg>'
      ].join('');
      return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          panel.log(`备用截图完成：${canvas.width}x${canvas.height}`);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('SVG 备用截图失败'));
        };
        img.src = url;
      });
    },
    getVisibleOptionCount(itemBodyElement) {
      const container = this.getOptionContainer(itemBodyElement);
      if (!container) return 0;
      return this.getOptionElements(container).length;
    },
    getOptionContainer(itemBodyElement) {
      if (!itemBodyElement) return null;
      return itemBodyElement.querySelector('.list-inline.list-unstyled-radio')
        || itemBodyElement.querySelector('.list-unstyled.list-unstyled-radio')
        || itemBodyElement.querySelector('.list-unstyled')
        || itemBodyElement.querySelector('ul.list')
        || itemBodyElement.querySelector('[class*="option-list"]')
        || itemBodyElement.querySelector('[class*="answer-list"]')
        || itemBodyElement.querySelector('[role="radiogroup"]')
        || itemBodyElement.querySelector('ul');
    },
    getOptionElements(container) {
      if (!container) return [];
      const groups = [
        ':scope > li',
        ':scope > .option-item, :scope > .answer-item, :scope > [class*="option-item"], :scope > [class*="answer-item"]',
        '.el-radio.homeworkElRadio, .el-checkbox',
        '[role="radio"], [role="checkbox"]',
        'li',
        '.option-item, .answer-item, [class*="option-item"], [class*="answer-item"]'
      ];
      for (const selectors of groups) {
        let nodes = [];
        try {
          nodes = [...container.querySelectorAll(selectors)];
        } catch (_) {
          continue;
        }
        nodes = nodes.filter((el, index, arr) => el.offsetParent !== null && arr.indexOf(el) === index);
        if (nodes.length) return nodes;
      }
      return [...container.children].filter(el => el.offsetParent !== null);
    },
    resolveAPIFormat(url, apiFormat) {
      if (apiFormat === 'openai-chat' || apiFormat === 'openai-responses') return apiFormat;
      return /\/responses?$/.test(url) ? 'openai-responses' : 'openai-chat';
    },
    inferAuthMethod(method, url, model) {
      const target = `${url || ''} ${model || ''}`.toLowerCase();
      if (method === 'x-api-key' || method === 'api-key') return method;
      if (target.includes('xiaomimimo') || target.includes('mimo')) return 'api-key';
      if (target.includes('anthropic')) return 'x-api-key';
      if (method && method !== 'auto') return method;
      return 'bearer';
    },
    buildAuthHeaders(method, key, url, model) {
      const resolved = this.inferAuthMethod(method, url, model);
      if (resolved === 'x-api-key') return { 'x-api-key': key };
      if (resolved === 'api-key') return { 'api-key': key };
      return { 'Authorization': `Bearer ${key}` };
    },
    normalizeEndpoint(url, apiFormat) {
      const raw = String(url || '').trim();
      if (!raw) return raw;
      const target = apiFormat === 'openai-responses' ? 'responses' : 'chat/completions';
      let parsed;
      try {
        parsed = new URL(raw);
      } catch (_) {
        const trimmed = raw.replace(/\/+$/, '');
        if (/\/chat\/completions?$/.test(trimmed) || /\/responses?$/.test(trimmed)) return trimmed;
        if (/\/chat$/.test(trimmed)) return `${trimmed}/completions`;
        return `${trimmed}/${target}`;
      }

      const originalPath = parsed.pathname.replace(/\/+$/, '');
      const path = originalPath || '';
      const hasVersion = /\/v\d+(?:$|\/)/i.test(path);
      const host = parsed.hostname.toLowerCase();

      if (/\/chat\/completions?$/.test(path) || /\/responses?$/.test(path)) {
        parsed.pathname = path;
        return parsed.toString();
      }
      if (/\/chat$/.test(path)) {
        parsed.pathname = `${path}/completions`;
        return parsed.toString();
      }

      if (!path || path === '/') {
        const versionPrefix = host.includes('dashscope.aliyuncs.com') ? '/compatible-mode/v1' : '/v1';
        parsed.pathname = `${versionPrefix}/${target}`;
        return parsed.toString();
      }

      if (host.includes('dashscope.aliyuncs.com') && path === '/compatible-mode') {
        parsed.pathname = `${path}/v1/${target}`;
        return parsed.toString();
      }

      parsed.pathname = `${path}/${target}`;
      if (!hasVersion && (host.includes('openai.com') || host.includes('xiaomimimo.com')) && !path.startsWith('/v1')) {
        parsed.pathname = `/v1${parsed.pathname}`;
      }
      return parsed.toString();
    },
    buildPrompt() {
      const system = [
        '# 角色设定',
        '',
        '你是严谨的“多模态答题助手”。你的核心职责是专门根据用户提供的题目截图进行精准作答。',
        '',
        '## 任务背景与洞察',
        '',
        '由于截图可能包含中文、英文、公式、配图、图片题干、图片选项以及字体混淆，你必须完全以截图中的**视觉内容**为依据，绝不可依赖用户可能附带的任何复制文本，也不得进行任何脱离截图内容的幻觉推理。',
        '',
        '## 工作流与映射规则',
        '',
        '请仔细观察截图，并按以下规则处理：',
        '',
        '1. **识别题型**：判定题目属于以下四种类型之一：`choice`（单选题）、`multiple`（多选题）、`truefalse`（判断题）、`fillblank`（填空题）。',
        '2. **提取与映射答案**：',
        '   - **选择题 (choice / multiple)**：严格按截图中选项的排列顺序（从上到下，或从左到右），将其依次映射为 A, B, C, D, E, F 等字母，并提取正确选项。',
        '   - **判断题 (truefalse)**：优先寻找截图中“正确/错误/对/错”所对应的选项字母进行输出；若截图中没有选项字母，则直接输出“对”或“错”。',
        '   - **填空题 (fillblank)**：按照题目留空的先后顺序，依次提取或计算出对应的答案文本。',
        '',
        '## 输出约束',
        '',
        '- **格式要求**：只输出一个纯 JSON 对象，**绝对禁止**使用 Markdown 格式，**禁止**输出 ```json 这样的代码块，**禁止**包含任何前言、后语或解释。',
        '- **JSON Schema**：{"type":"choice|multiple|truefalse|fillblank","answers":["A"]}',
        '- **字段限制**：`answers` 数组中仅包含纯粹的答案值，不得包含题号、解析说明。',
        '- **基调与风格**：直接、精确、保守；不解释，不展示推理过程。',
        '- 如果模型或服务端支持 reasoning / thinking 字段，可以在该字段内部推理；最终 content 仍必须只包含 JSON 对象。',
        '',
        '## 示例 1',
        '',
        '### REQUEST 1',
        '',
        'User Input: [单选题截图，选项从上到下为 A. 10 B. 12 C. 15]',
        '',
        '### RESPONSE 1',
        '',
        'CoT Reasoning: 根据计算，正确答案为 15',
        'Formal Response: {"type":"choice","answers":["C"]}',
        '',
        '## 示例 2',
        '',
        '### REQUEST 2',
        '',
        'User Input: [判断题截图，内容为“地球是平的”，无选项字母]',
        '',
        '### RESPONSE 2',
        '',
        'CoT Reasoning: 判断题目内容为错误',
        'Formal Response: {"type":"truefalse","answers":["错"]}',
        '',
        '## 示例 3',
        '',
        '### REQUEST 3',
        '',
        'User Input: [填空题截图，有两个空]',
        '',
        '### RESPONSE 3',
        '',
        'CoT Reasoning: 根据截图进行推理，答案应该分别是“苹果”和“重力”',
        'Formal Response: {"type":"fillblank","answers":["苹果","重力"]}'
      ].join('\n');
      return { system };
    },
    isThinkingModel(url, model) {
      return /qwen|qwq|deepseek-r1|reason|thinking|agentworld|vllm/i.test(`${url || ''} ${model || ''}`);
    },
    getMaxOutputTokens(conf) {
      const manual = Number(conf.maxTokens || 0);
      if (Number.isFinite(manual) && manual > 0) return manual;
      return conf.thinkingEnabled ? 32768 : 4096;
    },
    buildThinkingParams(enabled, apiFormat, url, model) {
      const isThinkingModel = this.isThinkingModel(url, model) || /mimo|xiaomimimo/i.test(`${url || ''} ${model || ''}`);
      if (apiFormat === 'openai-responses') {
        return enabled
          ? { reasoning: { effort: 'medium' } }
          : { reasoning: { effort: 'minimal' } };
      }
      if (!isThinkingModel) return {};
      if (enabled) {
        return {
          thinking: { type: 'enabled' },
          enable_thinking: true,
          chat_template_kwargs: { enable_thinking: true }
        };
      }
      return {
        thinking: { type: 'disabled' },
        enable_thinking: false,
        chat_template_kwargs: { enable_thinking: false }
      };
    },
    buildSamplingParams(conf) {
      return conf.forceSamplingParams
        ? { temperature: 1.0, top_p: 0.95 }
        : {};
    },
    async askAI(imageDataUrl, optionCount = 0, questionType = 'choice') {
      const saved = Store.getAIConf();
      const API_KEY = saved.key;
      const MODEL_NAME = saved.model;
      const API_FORMAT = this.resolveAPIFormat(saved.url, saved.apiFormat || 'auto');
      const API_URL = this.normalizeEndpoint(saved.url, API_FORMAT);
      const AUTH_METHOD = saved.authMethod || 'auto';
      return new Promise((resolve, reject) => {
        if (!API_KEY || API_KEY.includes('sk-xxxx')) {
          const msg = '请在 [AI配置] 中填写有效的 API Key';
          panel.log(msg, 'warning');
          reject(msg);
          return;
        }
        const { system } = this.buildPrompt();
        const maxOutputTokens = this.getMaxOutputTokens(saved);
        const thinkingParams = this.buildThinkingParams(Boolean(saved.thinkingEnabled), API_FORMAT, API_URL, MODEL_NAME);
        const headers = {
          'Content-Type': 'application/json',
          ...this.buildAuthHeaders(AUTH_METHOD, API_KEY, API_URL, MODEL_NAME)
        };
        const isMiMo = /mimo|xiaomimimo/i.test(`${API_URL} ${MODEL_NAME}`);
        const streamState = saved.stream ? this.createStreamState() : null;
        const payload = API_FORMAT === 'openai-responses'
          ? {
            model: MODEL_NAME,
            input: [
              { role: 'system', content: [{ type: 'input_text', text: system }] },
              {
                role: 'user',
                content: [
                  { type: 'input_image', image_url: imageDataUrl }
                ]
              }
            ],
            max_output_tokens: maxOutputTokens,
            ...(saved.stream ? { stream: true } : {}),
            ...this.buildSamplingParams(saved),
            ...thinkingParams
          }
          : {
            model: MODEL_NAME,
            messages: [
              { role: 'system', content: system },
              {
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: imageDataUrl } }
                ]
              }
            ],
            ...(isMiMo
              ? { max_completion_tokens: maxOutputTokens }
              : { max_tokens: maxOutputTokens }),
            ...(saved.stream ? { stream: true } : {}),
            ...this.buildSamplingParams(saved),
            ...thinkingParams
          };
        panel.log(`请求多模态模型：${API_URL}，${saved.stream ? 'stream' : 'non-stream'}，thinking=${saved.thinkingEnabled ? 'on' : 'off'}，max_tokens=${maxOutputTokens}`);
        let settled = false;
        let requestHandle = null;
        let firstChunkTimer = null;
        const streamFirstChunkTimeout = Math.max(Number(Config.aiTimeout || 0), 60000);
        const cleanupFirstChunkTimer = () => {
          if (firstChunkTimer) {
            clearTimeout(firstChunkTimer);
            firstChunkTimer = null;
          }
        };
        const settleResolve = value => {
          if (settled) return;
          settled = true;
          cleanupFirstChunkTimer();
          resolve(value);
        };
        const settleReject = err => {
          if (settled) return;
          settled = true;
          cleanupFirstChunkTimer();
          reject(err);
        };
        const request = {
          method: 'POST',
          url: API_URL,
          headers,
          data: JSON.stringify(payload),
          timeout: saved.stream ? 0 : Config.aiTimeout,
          onload: res => {
            cleanupFirstChunkTimer();
            if (res.status < 200 || res.status >= 300) {
              const err = `请求失败: HTTP ${res.status} - ${(res.responseText || '').slice(0, 300)}`;
              panel.log(err, 'error');
              settleReject(err);
              return;
            }
            try {
              if (saved.stream) {
                this.consumeStreamChunk(streamState, res.responseText || '');
                this.flushStreamBuffer(streamState);
                const streamText = this.extractStreamText(streamState);
                if (!streamText) {
                  let fallbackText = '';
                  try {
                    fallbackText = this.extractAIText(JSON.parse(res.responseText));
                  } catch (_) {
                    // response was real SSE or malformed JSON
                  }
                  if (fallbackText) {
                    settleResolve(fallbackText);
                  } else {
                    settleReject(streamState.reasoning
                      ? 'AI 响应为空：流式只收到 thinking/reasoning，未收到最终答案'
                      : 'AI 响应为空：流式未收到 content/output_text');
                  }
                } else {
                  settleResolve(streamText);
                }
                return;
              }
              const json = JSON.parse(res.responseText);
              const answerText = this.extractAIText(json);
              if (!answerText) {
                const finishReason = json.choices?.[0]?.finish_reason || json.choices?.[0]?.stop_reason || '';
                const msg = finishReason === 'length'
                  ? 'AI 响应为空：模型只输出 thinking/reasoning 且达到 token 上限，请确认模型支持视觉输入或关闭 thinking'
                  : 'AI 响应为空：未在 content/output_text 中找到答案';
                settleReject(msg);
              }
              else settleResolve(answerText);
            } catch (e) {
              settleReject(`JSON 解析失败：${e.message || e}`);
            }
          },
          onerror: () => settleReject('网络错误'),
          ontimeout: () => settleReject('请求超时')
        };
        if (saved.stream) {
          request.onprogress = res => {
            if (res.responseText && !streamState.firstChunkReceived) {
              streamState.firstChunkReceived = true;
              cleanupFirstChunkTimer();
              panel.log('流式响应已收到首个回传，继续等待模型输出完成...');
            }
            this.consumeStreamChunk(streamState, res.responseText || '');
            const partial = this.extractUsableJsonText(streamState.content) || this.extractUsableJsonText(streamState.reasoning);
            if (partial && !streamState.loggedAnswer) {
              streamState.loggedAnswer = true;
              panel.log('流式响应中已检测到答案 JSON，等待服务端结束...');
            } else if (streamState.reasoning && !streamState.loggedReasoning) {
              streamState.loggedReasoning = true;
              panel.log('流式响应正在输出 thinking/reasoning...');
            }
          };
          firstChunkTimer = setTimeout(() => {
            if (streamState.firstChunkReceived) return;
            try {
              requestHandle?.abort?.();
            } catch (_) {
              // ignore abort failures
            }
            settleReject(`流式请求首字延迟超过 ${Math.round(streamFirstChunkTimeout / 1000)} 秒：服务端未开始回传`);
          }, streamFirstChunkTimeout);
        }
        requestHandle = GM_xmlhttpRequest(request);
      });
    },
    createStreamState() {
      return {
        offset: 0,
        buffer: '',
        content: '',
        reasoning: '',
        lastEvent: '',
        loggedAnswer: false,
        loggedReasoning: false,
        firstChunkReceived: false
      };
    },
    consumeStreamBlock(state, block) {
      if (!state || !block) return;
      const lines = block.split(/\r?\n/);
      let eventName = '';
      let dataLines = [];
      for (const line of lines) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      const dataText = dataLines.join('\n').trim();
      if (!dataText || dataText === '[DONE]') return;
      try {
        this.consumeStreamEvent(state, JSON.parse(dataText), eventName);
      } catch (_) {
        // ignore partial or non-JSON SSE frames
      }
    },
    consumeStreamChunk(state, responseText) {
      if (!state || !responseText) return;
      const next = responseText.slice(state.offset);
      state.offset = responseText.length;
      state.buffer += next;
      const blocks = state.buffer.split(/\n\n+/);
      state.buffer = blocks.pop() || '';
      for (const block of blocks) {
        this.consumeStreamBlock(state, block);
      }
    },
    flushStreamBuffer(state) {
      if (!state?.buffer) return;
      this.consumeStreamBlock(state, state.buffer);
      state.buffer = '';
    },
    consumeStreamEvent(state, event, eventName = '') {
      if (!state || !event) return;
      const choice = event.choices?.[0];
      const delta = choice?.delta || choice?.message || {};
      const content = this.flattenContent(delta.content)
        || this.flattenContent(delta.text)
        || this.flattenContent(event.delta)
        || this.flattenContent(event.output_text);
      if (content) state.content += content;

      const reasoning = this.flattenContent(delta.reasoning_content)
        || this.flattenContent(delta.reasoning)
        || this.flattenContent(delta.thinking)
        || this.flattenContent(event.reasoning)
        || this.flattenContent(event.summary);
      if (reasoning) state.reasoning += reasoning;

      if (/response\.output_text\.delta/.test(event.type || eventName)) {
        state.content += event.delta || '';
      }
      if (/response\.(reasoning|output_item)\./.test(event.type || eventName)) {
        state.reasoning += event.delta || event.text || '';
      }
    },
    extractStreamText(state) {
      if (!state) return '';
      const contentJson = this.extractUsableJsonText(state.content);
      if (contentJson) return contentJson;
      if (state.content.trim()) return state.content.trim();
      return this.extractUsableJsonText(state.reasoning);
    },
    flattenContent(content) {
      if (typeof content === 'string') return content.trim();
      if (!Array.isArray(content)) return '';
      return content.map(part => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        return part.text || part.content || part.output_text || part.value || '';
      }).join('').trim();
    },
    extractUsableJsonText(text) {
      const source = String(text || '');
      const matches = source.match(/\{[^{}]*"answers"\s*:\s*\[[^\]]*\][^{}]*\}/g) || [];
      for (const candidate of matches) {
        try {
          const parsed = JSON.parse(candidate);
          const type = String(parsed.type || '');
          if (type.includes('|')) continue; // 这是提示词里的 schema，不是模型答案。
          if (Array.isArray(parsed.answers) && parsed.answers.length) return candidate;
        } catch (_) {
          // ignore malformed JSON snippets
        }
      }
      return '';
    },
    extractAIText(json) {
      if (!json) return '';
      if (typeof json.output_text === 'string') return json.output_text.trim();
      const message = json.choices?.[0]?.message;
      const chatText = this.flattenContent(message?.content);
      if (chatText) return chatText;

      const reasoningText = this.flattenContent(message?.reasoning_content)
        || this.flattenContent(message?.reasoning)
        || this.flattenContent(message?.thinking);
      const reasoningJson = this.extractUsableJsonText(reasoningText);
      if (reasoningJson) return reasoningJson;

      const choiceText = this.flattenContent(json.choices?.[0]?.text);
      if (choiceText) return choiceText;

      if (Array.isArray(json.content)) {
        const directContent = this.flattenContent(json.content);
        if (directContent) return directContent;
      }
      if (Array.isArray(json.output)) {
        const outputText = json.output.flatMap(item => item.content || [])
          .map(part => part.text || part.content || part.output_text || '')
          .join('')
          .trim();
        if (outputText) return outputText;
        const outputReasoning = json.output.flatMap(item => item.content || [])
          .map(part => part.reasoning || part.summary || '')
          .join('')
          .trim();
        return this.extractUsableJsonText(outputReasoning);
      }
      return '';
    },
    detectQuestionType(itemBodyElement) {
      if (!itemBodyElement) return 'choice';
      const typeEl = itemBodyElement.querySelector('.item-type')
        || itemBodyElement.closest('.container-problem')?.querySelector('.item-type')
        || itemBodyElement.closest('.question-wrap')?.querySelector('.item-type')
        || itemBodyElement.closest('.problem-wrap')?.querySelector('.item-type');
      const typeText = typeEl?.innerText?.trim() || '';
      if (/填空/.test(typeText)) return 'fillblank';
      if (/判断/.test(typeText)) return 'truefalse';
      if (/多选/.test(typeText)) return 'multiple';
      if (/选择/.test(typeText)) {
        const checkboxCount = itemBodyElement.querySelectorAll('.el-checkbox, input[type="checkbox"], [role="checkbox"]').length;
        return checkboxCount > 0 ? 'multiple' : 'choice';
      }
      // 未标明题型时，根据输入框/填空下划线判断填空
      const inputs = itemBodyElement.querySelectorAll('input[type="text"], input:not([type]), textarea, [contenteditable="true"], .blank, .fill-blank, .fillblank, [class*="blank"]');
      if (inputs.length > 0) return 'fillblank';
      const checkboxCount = itemBodyElement.querySelectorAll('.el-checkbox, input[type="checkbox"], [role="checkbox"]').length;
      if (checkboxCount > 0) return 'multiple';
      return 'choice';
    },

    async fillBlanks(answerData, itemBodyElement) {
      const answers = Array.isArray(answerData)
        ? answerData.map(s => String(s).trim()).filter(Boolean)
        : String(answerData || '').split(/[;；|/,，]/).map(s => s.trim()).filter(Boolean);
      // 先尝试真正的 input/textarea/contenteditable
      let inputs = [...itemBodyElement.querySelectorAll('input[type="text"], input:not([type]), textarea, [contenteditable="true"]')]
        .filter(el => el.offsetParent !== null);

      // 如果没有，尝试可点击的填空占位元素
      if (!inputs.length) {
        const blanks = [...itemBodyElement.querySelectorAll('.blank, .fill-blank, .fillblank, [class*="blank"], [class*="fillblank"]')]
          .filter(el => el.offsetParent !== null);
        for (const blank of blanks) {
          blank.click();
          await Utils.sleep(300);
          const input = document.querySelector('input:focus, textarea:focus, [contenteditable="true"]:focus')
            || itemBodyElement.querySelector('input[type="text"], input:not([type]), textarea, [contenteditable="true"]');
          if (input) inputs.push(input);
        }
      }

      if (!inputs.length) {
        panel.log('未找到填空输入框', 'warning');
        return;
      }
      panel.log(`AI 建议填空：${answers.join('；')}`);
      for (let i = 0; i < inputs.length; i++) {
        const value = answers[i] || answers[answers.length - 1] || '';
        const input = inputs[i];
        input.scrollIntoView({ behavior: 'instant', block: 'center' });
        input.focus();
        if (input.isContentEditable) {
          input.innerText = value;
        } else {
          input.value = value;
        }
        ['focus', 'input', 'change', 'blur'].forEach(evt => {
          input.dispatchEvent(new Event(evt, { bubbles: true }));
        });
        input.blur();
        await Utils.sleep(300);
      }
    },

    parseAIAnswer(aiResponse, questionType) {
      const raw = String(aiResponse || '').trim();
      panel.log(`AI 原始返回：${raw.slice(0, 200)}`);
      let text = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) text = jsonMatch[0];
      try {
        const parsed = JSON.parse(text);
        const answers = Array.isArray(parsed.answers) ? parsed.answers : [parsed.answer].filter(Boolean);
        return {
          type: parsed.type || questionType,
          answers: answers.map(v => String(v).trim()).filter(Boolean),
          raw
        };
      } catch (_) {
        // fall through
      }
      if (questionType === 'fillblank') {
        const m = raw.match(/(?:正确)?答案[：:]?\s*(.+)/i);
        return { type: questionType, answers: String(m?.[1] || raw).split(/[;；|]/).map(s => s.trim()).filter(Boolean), raw };
      }
      if (questionType === 'truefalse' && /正确|对|true|yes/i.test(raw)) return { type: questionType, answers: ['对'], raw };
      if (questionType === 'truefalse' && /错误|错|false|no/i.test(raw)) return { type: questionType, answers: ['错'], raw };
      const letters = raw.toUpperCase().match(/[A-F]/g) || [];
      const unique = [...new Set(letters)];
      return { type: questionType, answers: questionType === 'multiple' ? unique : unique.slice(0, 1), raw };
    },

    answerToIndices(parsed, optionCount) {
      const map = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };
      const answers = parsed.answers || [];
      if (parsed.type === 'truefalse') {
        const first = String(answers[0] || '').trim();
        if (/^A$/i.test(first) || /对|正确|true|yes/i.test(first)) return [0];
        if (/^B$/i.test(first) || /错|错误|false|no/i.test(first)) return [1];
      }
      const indices = [];
      for (const value of answers) {
        const letters = String(value || '').toUpperCase().match(/[A-F]/g) || [];
        for (const letter of letters) {
          if (map[letter] !== undefined) indices.push(map[letter]);
        }
      }
      return [...new Set(indices)].filter(index => !optionCount || index < optionCount);
    },

    async autoSelectAndSubmit(aiResponse, itemBodyElement) {
      const questionType = this.detectQuestionType(itemBodyElement);
      const parsed = this.parseAIAnswer(aiResponse, questionType);

      if (questionType === 'fillblank') {
        if (!parsed.answers.length) {
          panel.log('未提取到填空答案，请人工检查', 'warning');
          return;
        }
        await this.fillBlanks(parsed.answers, itemBodyElement);
      } else {
        const listContainer = this.getOptionContainer(itemBodyElement);
        if (!listContainer) {
          panel.log('未找到选项容器', 'warning');
          return;
        }
        const options = this.getOptionElements(listContainer);
        const targetIndices = this.answerToIndices(parsed, options.length);
        if (!targetIndices.length) {
          panel.log('未提取到有效选项，请人工检查', 'warning');
          return;
        }
        panel.log(`AI 建议选：${parsed.answers.join(', ')}`, 'warning');
        for (const idx of targetIndices) {
          if (!options[idx]) continue;
          const clickable = options[idx].querySelector('label.el-radio') ||
            options[idx].querySelector('label.el-checkbox') ||
            options[idx].querySelector('.el-radio__label') ||
            options[idx].querySelector('.el-checkbox__label') ||
            options[idx].querySelector('[role="radio"]') ||
            options[idx].querySelector('[role="checkbox"]') ||
            options[idx].querySelector('input') ||
            options[idx];
          clickable.click();
          await Utils.sleep(150);
        }
      }

      const submitBtn = (() => {
        const ownerDocument = itemBodyElement.ownerDocument || document;
        const roots = [itemBodyElement.parentElement, itemBodyElement, ownerDocument].filter(Boolean);
        const matchText = text => /提交|保存|确认|确定|提交答案/.test(text);
        for (const root of roots) {
          const local = root.querySelectorAll('button, .el-button, [role="button"]');
          for (const btn of local) {
            if (btn.offsetParent !== null
              && !AiWorkspace.isDisabledElement(btn)
              && matchText(btn.innerText || '')) return btn;
          }
        }
        const global = ownerDocument.querySelectorAll('.el-button.el-button--primary.el-button--medium');
        for (const btn of global) {
          if (matchText(btn.innerText || '')
            && btn.offsetParent !== null
            && !AiWorkspace.isDisabledElement(btn)) return btn;
        }
        return null;
      })();
      if (submitBtn) {
        panel.log('正在提交...');
        submitBtn.click();
      } else {
        panel.log('未找到提交按钮，请手动提交', 'warning');
      }
    }
  };

  // ---- v2 逻辑 ----
  // PPT 页码指示器选择器（resolveSlides 与 playPPTByNavigation 共用）
  const PPT_INDICATOR_SELECTORS = [
    '.swiper-pagination-bullet-active',
    '.page-indicator',
    '.ppt-page-number',
    '[class*="pagination"][class*="active"]'
  ];

  class V2Runner {
    constructor(panel) {
      this.panel = panel;
      this.baseUrl = location.href;
      this.courseListUrl = '';
      this.classroomId = Utils.getCurrentClassroomId() || this.baseUrl;
      this.shouldStop = false;
    }

    setCourseListUrl() {
      if (!this.courseListUrl && document.querySelector('.logs-list')) {
        this.courseListUrl = location.href;
      }
    }

    async returnToList() {
      const target = this.courseListUrl || this.baseUrl;
      if (target && location.href !== target) {
        location.href = target;
      } else {
        history.back();
      }
      await Utils.sleep(1500);
    }

    async waitForExternalHandoff(timeout = 1200) {
      await Utils.sleep(timeout);
      if (document.visibilityState === 'hidden' || !document.hasFocus()) {
        this.shouldStop = true;
        this.panel.log('已交给新页面继续，返回目录页后会自动续跑');
        return true;
      }
      return false;
    }

    markHandoff(type, title = '') {
      this.setCourseListUrl();
      Store.setPendingAutoStart(this.classroomId, this.courseListUrl || location.href, {
        handoff: {
          type,
          title,
          source: 'v2'
        }
      });
    }

    clickInCurrentTab(element) {
      if (!element) return;
      const doc = element.ownerDocument || document;
      const view = doc.defaultView || window;
      const touchedLinks = [...element.querySelectorAll('a[target]')].map(link => ({
        link,
        target: link.getAttribute('target')
      }));
      for (const { link } of touchedLinks) {
        link.setAttribute('target', '_self');
      }

      const restoreFns = [];
      let restored = false;
      let restoreTimer = null;
      const navigateCurrentTab = url => {
        if (!url) return;
        try {
          location.href = new URL(String(url), location.href).href;
        } catch (_) {
          location.href = String(url);
        }
      };
      const captureLinkClick = event => {
        const link = event.target?.closest?.('a[href]');
        if (!link || !element.contains(link)) return;
        const href = link.getAttribute('href') || '';
        if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        navigateCurrentTab(link.href || href);
      };
      const restore = () => {
        if (restored) return;
        restored = true;
        clearTimeout(restoreTimer);
        doc.removeEventListener('click', captureLinkClick, true);
        view.removeEventListener('pagehide', restore);
        for (const { link, target } of touchedLinks) {
          if (target == null) link.removeAttribute('target');
          else link.setAttribute('target', target);
        }
        restoreFns.forEach(fn => {
          try { fn(); } catch (_) { }
        });
      };
      const openInCurrentTab = url => {
        navigateCurrentTab(url);
        return window;
      };
      for (const win of [...new Set([view, typeof unsafeWindow !== 'undefined' ? unsafeWindow : null].filter(Boolean))]) {
        try {
          const originalOpen = win.open;
          win.open = openInCurrentTab;
          restoreFns.push(() => { win.open = originalOpen; });
        } catch (_) {
          // Some browsers/userscript sandboxes may reject patching window.open.
        }
      }
      doc.addEventListener('click', captureLinkClick, true);
      view.addEventListener('pagehide', restore);
      restoreTimer = setTimeout(restore, 15000);

      const directLink = [...element.querySelectorAll('a[href]')].find(link => {
        const href = link.getAttribute('href') || '';
        return href && !href.startsWith('#') && !/^javascript:/i.test(href);
      });

      if (directLink) {
        navigateCurrentTab(directLink.href || directLink.getAttribute('href'));
        return;
      }
      element.click();
    }

    // 三态分类：'completed' | 'in_progress' | 'not_started'
    // 对应雨课堂右侧状态列：已完成/已读、(N/M 或 x%) 进行中、未开始/未读
    getCompletionState(statusText) {
      const text = String(statusText || '');
      // 1. 数字比例优先：N/N 完成，N/M(N<M) 进行中，0/M 未开始
      const fractionMatch = text.match(/(\d+)\s*\/\s*(\d+)/);
      if (fractionMatch) {
        const current = parseInt(fractionMatch[1], 10);
        const total = parseInt(fractionMatch[2], 10);
        if (total > 0 && current >= total) return 'completed';
        return current > 0 ? 'in_progress' : 'not_started';
      }
      // 2. 百分比：100% 完成，其余进行中
      const percentMatch = text.match(/(\d+)\s*%/);
      if (percentMatch) {
        return parseInt(percentMatch[1], 10) >= 100 ? 'completed' : 'in_progress';
      }
      // 3. 文本状态
      if (text.includes('已完成') || text.includes('已读')) return 'completed';
      if (text.includes('进行中')) return 'in_progress';
      // 未开始 / 未读 / 其他默认按未开始处理
      return 'not_started';
    }

    isBatchActivity(type = '', tagText = '') {
      return type.includes('piliang') || /批量|章节|单元/.test(tagText);
    }

    isHomeworkActivity(type = '', tagText = '') {
      return type.includes('zuoye')
        || type.includes('lianxi')
        || type.includes('ceping')
        || /作业|练习|测评|测试|习题/.test(tagText);
    }

    async run() {
      this.panel.log('开始按目录进度遍历，定位第一个未完成项...');
      let missingListCount = 0;
      while (true) {
        if (this.shouldStop) return;
        await this.autoSlide();
        const list = [...(document.querySelector('.logs-list')?.childNodes || [])]
          .filter(node => node.nodeType === 1);
        if (!list.length) {
          missingListCount++;
          this.panel.log('未找到课程列表，稍后重试', 'warning');
          if (missingListCount >= 5) {
            this.panel.log('多次未找到课程列表，停止遍历（请确认当前在课程目录页）', 'error');
            this.panel.resetStartButton('开始');
            break;
          }
          await Utils.sleep(2000);
          continue;
        }
        missingListCount = 0;
        this.setCourseListUrl();

        // 按 DOM 顺序找第一个"未完成且未达重试上限"的可处理项
        let target = null;
        let skippedByLimit = 0;
        const autoAI = Store.getFeatureConf().autoAI;
        for (let i = 0; i < list.length; i++) {
          const course = list[i]?.querySelector('.content-box')?.querySelector('section');
          if (!course) continue;
          const type = course.querySelector('.tag')?.querySelector('use')?.getAttribute('xlink:href') || 'piliang';
          const tagText = course.querySelector('.tag')?.innerText?.trim() || '';
          const title = course.querySelector('h2')?.innerText?.trim() || `第${i + 1}项`;
          const isBatch = this.isBatchActivity(type, tagText);
          const isHomework = this.isHomeworkActivity(type, tagText);
          const statusText = course.querySelector('.statistics-box .aside')?.innerText || '';
          const statusState = this.getCompletionState(statusText);
          if (statusState === 'completed') continue; // 顶层已完成（含整批完成）一律跳过
          // 关闭 AI 作答时进入纯刷视频模式：作业类项直接无视，不进入、不重载
          if (isHomework && !isBatch && !autoAI) continue;
          const failKey = FailGate.key(this.classroomId, i, title);
          if (FailGate.skipped(failKey)) continue; // 主动跳过项（考试/未知/功能关闭），静默略过
          if (FailGate.exhausted(failKey)) {
            skippedByLimit++;
            this.panel.log(`${title} 尝试 ${FailGate.maxAttempts} 次仍未完成，跳过`, 'warning');
            continue;
          }
          target = { course, listNode: list[i], type, title, isBatch, isHomework, statusState, failKey, index: i };
          break;
        }

        if (!target) {
          // 没有可处理项：先尝试加载更多，再判定收尾
          const loadedMore = await this.ensureCourseListLoadedPast(list.length, list.length);
          if (loadedMore) {
            this.panel.log('课程列表继续加载，重新扫描');
            continue;
          }
          if (skippedByLimit > 0) {
            this.panel.log(`遍历结束：仍有 ${skippedByLimit} 项达到重试上限未完成，请手动检查`, 'warning');
            this.panel.resetStartButton('开始');
          } else {
            this.panel.log('课程已全部完成');
            this.panel.resetStartButton('已完成');
          }
          Store.clearPendingAutoStart();
          break;
        }

        const { course, listNode, type, title, isBatch, isHomework, statusState, failKey } = target;
        const stateLabel = Utils.stateLabel(statusState);
        this.panel.log(`处理第 ${target.index + 1}/${list.length} 项，类型 ${type}，状态 ${stateLabel}，标题：${title}`);
        FailGate.bump(failKey); // 进入前先记一次尝试，处理后整页重载会重新扫描复查

        if (type.includes('shipin')) {
          await this.handleVideo(course, title);
        } else if (isBatch) {
          await this.handleBatch(listNode, failKey);
        } else if (type.includes('ketang')) {
          await this.handleClassroom(course);
        } else if (type.includes('kejian')) {
          await this.handleCourseware(course);
        } else if (isHomework) {
          await this.handleHomework(course, failKey);
        } else if (type.includes('kaoshi')) {
          this.panel.log('考试区域脚本会被屏蔽，已跳过', 'warning');
          FailGate.skip(failKey); // 主动屏蔽，非失败，静默不再进入
          continue; // 未离开目录页，直接重新扫描下一项
        } else {
          this.panel.log('非视频/批量/课件/考试，已跳过', 'warning');
          FailGate.skip(failKey);
          continue;
        }
        if (this.shouldStop) return;
      }
    }

    async autoSlide() {
      for (let i = 0; i < 2; i++) {
        Utils.scrollToBottom('.viewContainer');
        await Utils.sleep(800);
      }
    }

    async ensureCourseListLoadedPast(targetIndex, previousLength = 0) {
      let lastLength = previousLength;
      for (let attempt = 0; attempt < 6; attempt++) {
        Utils.scrollToBottom('.viewContainer');
        Utils.scrollToBottom('.logs-list');
        window.scrollTo(0, document.body.scrollHeight);
        await Utils.sleep(1200);
        const nextLength = document.querySelector('.logs-list')?.childNodes?.length || 0;
        if (nextLength > targetIndex) return true;
        if (nextLength > lastLength) {
          this.panel.log(`课程列表继续加载：${lastLength} -> ${nextLength}`);
          lastLength = nextLength;
        }
      }
      return lastLength > previousLength;
    }

    async handleVideo(course, catalogTitle = '视频') {
      this.markHandoff('video', catalogTitle);
      this.clickInCurrentTab(course);
      if (await this.waitForExternalHandoff(1500)) return;
      await Utils.sleep(3000);
      const progressNode = document.querySelector('.progress-wrap')?.querySelector('.text');
      const title = document.querySelector('.title')?.innerText || '视频';
      const isDeadline = document.querySelector('.box')?.innerText.includes('已过考核截止时间');
      if (isDeadline) this.panel.log(`${title} 已过截止，进度不再增加，将直接跳过`, 'warning');
      const ok = await this.playCurrentVideoUntilProgressDone(title, progressNode, { isDeadline, interval: 5000 });
      if (ok) this.panel.log(`${title} 播放完成`);
      else this.panel.log(`${title} 播放完成度未达 100%`, 'warning');
      await this.returnToList();
    }

    async playCurrentVideoUntilProgressDone(title, progressNode, { isDeadline = false, interval = 3000 } = {}) {
      const video = document.querySelector('video');
      Player.applySpeed();
      Player.mute(video);
      let replayRequired = false;
      let replayStartTime = 0;
      if (!isDeadline && !Utils.isProgressDone(progressNode?.innerHTML) && video) {
        replayRequired = true;
        this.panel.log(`${title} 完成度未满，从头重新播放以刷新进度`);
        await Player.playFromStart(video);
        replayStartTime = Number(video.currentTime || 0);
        await Player.startPlayback(video);
      } else {
        Player.applyMediaDefault(video);
      }
      const stopObserve = Player.observePause(video);
      const replayReachedEnd = () => {
        if (!replayRequired || !video) return false;
        const currentTime = Number(video.currentTime || 0);
        const duration = Number(video.duration || 0);
        const minDelta = Number.isFinite(duration) && duration > 0 ? Math.min(3, duration * 0.8) : 3;
        const playedDelta = Math.max(0, currentTime - replayStartTime);
        if (playedDelta < minDelta) return false;
        if (video.ended) return true;
        return Player.isNearEnd(video);
      };
      const ok = await Utils.poll(
        () => isDeadline || Utils.isProgressDone(progressNode?.innerHTML) || replayReachedEnd(),
        { interval, timeout: await Utils.getDDL(video) }
      );
      stopObserve();
      if (ok && replayRequired && !Utils.isProgressDone(progressNode?.innerHTML)) {
        this.panel.log(`${title} 已从头播放到结尾，等待返回目录后刷新完成度`, 'warning');
      }
      return ok;
    }

    async handleBatch(listNode, parentFailKey = '') {
      const section = listNode.querySelector('.content-box')?.querySelector('section');
      const batchTitle = section?.querySelector('h2')?.innerText?.trim() || '批量区';
      // 展开按钮在 section 内；子项列表 .leaf_list__wrap 是列表节点的后代、在 section 之外
      const expandBtn = section?.querySelector('.sub-info')?.querySelector('.gray')?.querySelector('span');
      if (!expandBtn) {
        this.panel.log(`批量区「${batchTitle}」未找到展开按钮，跳过`, 'warning');
        if (parentFailKey) FailGate.skip(parentFailKey);
        return;
      }
      expandBtn.click();
      // 等子项渲染：轮询 .activity__wrap 出现，最多 ~3 秒
      await Utils.poll(
        () => (listNode.querySelector('.leaf_list__wrap')?.querySelectorAll('.activity__wrap')?.length || 0) > 0,
        { interval: 300, timeout: 3000 }
      );
      const activities = [...(listNode.querySelector('.leaf_list__wrap')?.querySelectorAll('.activity__wrap') || [])];
      this.panel.log(`进入批量区「${batchTitle}」，共 ${activities.length} 项，定位第一个未完成子项...`);
      const autoAI = Store.getFeatureConf().autoAI;

      // 只处理第一个未完成且未超限的子项，处理完整页重载后重新进入复查
      for (let i = 0; i < activities.length; i++) {
        const item = activities[i];
        if (!item) continue;
        const tagText = item.querySelector('.tag')?.innerText || '';
        const tagHref = item.querySelector('.tag')?.querySelector('use')?.getAttribute('xlink:href') || '';
        const title = item.querySelector('h2')?.innerText?.trim() || `第${i + 1}项`;
        const isHomework = this.isHomeworkActivity(tagHref, tagText);
        const statusText = item.querySelector('.statistics-box .aside')?.innerText || '';
        const statusState = this.getCompletionState(statusText);
        if (statusState === 'completed') continue;
        // 关闭 AI 作答时纯刷视频：作业子项直接无视，不进入、不重载
        if (isHomework && !autoAI) continue;

        const subKey = FailGate.key(this.classroomId, batchTitle, i, title);
        if (FailGate.skipped(subKey)) continue; // 主动跳过子项，静默
        if (FailGate.exhausted(subKey)) {
          this.panel.log(`${title} 尝试 ${FailGate.maxAttempts} 次仍未完成，跳过`, 'warning');
          continue;
        }

        const stateLabel = Utils.stateLabel(statusState);
        this.panel.log(`处理批量子项 ${i + 1}/${activities.length}：${title}（状态 ${stateLabel}）`);
        FailGate.bump(subKey);
        // 子项有实际进展：重置批量顶层计数，避免多子项的正常推进误触发顶层重试上限
        if (parentFailKey) FailGate.reset(parentFailKey);

        if (tagText === '音频') {
          await this.playAudioItem(item, title);
        } else if (tagHref.includes('shipin')) {
          await this.playVideoItem(item, title);
        } else if (tagHref.includes('tuwen') || tagHref.includes('taolun')) {
          await this.autoCommentItem(item, tagHref.includes('tuwen') ? '图文' : '讨论');
        } else if (isHomework) {
          await this.handleHomework(item, subKey);
        } else {
          this.panel.log(`类型未知，已跳过：${title}`, 'warning');
          FailGate.skip(subKey); // 主动跳过，静默，不重载，继续看同批后续子项
          continue;
        }
        return; // 已推进一项，交回 run() 由重载后重新扫描
      }

      // 没有可处理子项：子项或已全部完成、或全部已跳过/超限。
      // 标记批量顶层已跳过，避免 run() 再为这个推不动的批量浪费整页重载。
      if (parentFailKey) FailGate.skip(parentFailKey);
      this.panel.log(`批量区「${batchTitle}」无可处理子项，继续扫描下一项`, 'warning');
    }

    async playAudioItem(item, title) {
      this.panel.log(`开始播放音频：${title}`);
      this.markHandoff('audio', title);
      this.clickInCurrentTab(item);
      if (await this.waitForExternalHandoff()) return;
      await Utils.sleep(2500);
      Player.applyMediaDefault(document.querySelector('audio'));
      const progressNode = document.querySelector('.progress-wrap')?.querySelector('.text');
      await Utils.poll(() => Utils.isProgressDone(progressNode?.innerHTML), { interval: 3000, timeout: await Utils.getDDL() });
      this.panel.log(`${title} 播放完成`);
      await this.returnToList();
    }

    async playVideoItem(item, title) {
      this.panel.log(`开始播放视频：${title}`);
      this.markHandoff('video', title);
      this.clickInCurrentTab(item);
      if (await this.waitForExternalHandoff()) return;
      await Utils.sleep(2500);
      const progressNode = document.querySelector('.progress-wrap')?.querySelector('.text');
      const ok = await this.playCurrentVideoUntilProgressDone(title, progressNode);
      if (ok) this.panel.log(`${title} 播放完成`);
      else this.panel.log(`${title} 播放完成度未达 100%`, 'warning');
      await this.returnToList();
    }

    async autoCommentItem(item, typeText) {
      this.panel.log(`开始处理${typeText}：${item.querySelector('h2')?.innerText || ''}`);
      item.click();
      await Utils.sleep(1200);

      // 检查是否开启自动评论功能
      const featureFlags = Store.getFeatureConf();
      if (!featureFlags.autoComment) {
        this.panel.log(`${typeText}已查看，但未开启自动回复功能`, 'warning');
        await this.returnToList();
        return;
      }
       
      // 开启了自动评论功能，执行评论逻辑
      window.scrollTo(0, document.body.scrollHeight);
      await Utils.sleep(800);
      window.scrollTo(0, 0);
      const commentSelectors = ['#new_discuss .new_discuss_list .cont_detail', '.new_discuss_list dd .cont_detail', '.cont_detail.word-break'];
      let firstComment = '';
      for (let retry = 0; retry < 30 && !firstComment; retry++) {
        for (const sel of commentSelectors) {
          const list = document.querySelectorAll(sel);
          for (const node of list) {
            if (node?.innerText?.trim()) {
              firstComment = node.innerText.trim();
              break;
            }
          }
          if (firstComment) break;
        }
        if (!firstComment) await Utils.sleep(500);
      }
      if (!firstComment) {
        this.panel.log('未找到评论内容，跳过该项', 'warning');
      } else {
        const input = document.querySelector('.el-textarea__inner');
        if (input) {
          input.value = firstComment;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          await Utils.sleep(800);
          const sendBtn = document.querySelector('.el-button.submitComment') ||
            document.querySelector('.publish_discuss .postBtn button') ||
            document.querySelector('.el-button--primary');
          if (sendBtn && !sendBtn.disabled && !sendBtn.classList.contains('is-disabled')) {
            sendBtn.click();
            this.panel.log(`已在${typeText}区发表评论`);
          } else {
            this.panel.log('发送按钮不可用或不存在', 'warning');
          }
        } else {
          this.panel.log('未找到评论输入框，跳过', 'warning');
        }
      }
      await this.returnToList();
    }

    async handleHomework(item, failKey = '') {
      const featureFlags = Store.getFeatureConf();
      if (!featureFlags.autoAI) {
        this.panel.log('已关闭AI自动答题，跳过该项', 'warning');
        if (failKey) FailGate.skip(failKey); // 防御性：正常路径已在扫描阶段跳过作业，不会进到这里
        return;
      }
      this.panel.log('进入作业，启动截图 + 多模态 AI');
      this.markHandoff('exercise', item.querySelector('h2')?.innerText?.trim() || '作业');
      item.click();
      await Utils.poll(() => {
        const exerciseDoc = AiWorkspace.getExerciseDocument() || document;
        return Boolean(AiWorkspace.getExerciseContainer())
          || AiWorkspace.getExerciseQuestionTabs(exerciseDoc).length > 0
          || exerciseDoc.querySelector('.item-type, .item-body, .container-problem');
      }, { interval: 500, timeout: 12000 });
      let i = 0;
      const maxRetry = Config.aiMaxRetry; // 最大重试次数
      while (true) {
        const exerciseDoc = AiWorkspace.getExerciseDocument() || document;
        const container = AiWorkspace.getExerciseContainer() || exerciseDoc.querySelector('.container-problem') || exerciseDoc;
        const items = AiWorkspace.getExerciseQuestionTabs(exerciseDoc);
        const problems = AiWorkspace.getExerciseProblems(container);
        if (!items.length) {
          this.panel.log('未找到题号列表，尝试按当前题和下一题按钮推进', 'warning');
          let touchedQuestion = false;
          let previousFingerprint = '';
          for (let fallbackIndex = 0; fallbackIndex < 50; fallbackIndex++) {
            const latestDoc = AiWorkspace.getExerciseDocument() || document;
            const latestContainer = AiWorkspace.getExerciseContainer() || latestDoc.querySelector('.container-problem') || latestDoc;
            const currentQuestion = AiWorkspace.getExerciseQuestionBody(latestContainer);
            const fingerprint = AiWorkspace.normalizeText(currentQuestion?.innerText || '').slice(0, 120);
            if (!currentQuestion || !fingerprint || (fallbackIndex > 0 && fingerprint === previousFingerprint)) break;
            touchedQuestion = true;
            if (!AiWorkspace.isExerciseAnswered(currentQuestion)) {
              const questionType = Solver.detectQuestionType(currentQuestion);
              let optionCount = 0;
              if (questionType !== 'fillblank') {
                optionCount = Solver.getVisibleOptionCount(currentQuestion);
                if (!optionCount) {
                  this.panel.log(`当前题未找到选项，停止无题号 fallback`, 'warning');
                  break;
                }
              }
              const imageDataUrl = await Solver.captureQuestionImage(currentQuestion);
              panel.log('请求多模态 AI 获取答案...');
              const aiText = await Solver.askAI(imageDataUrl, optionCount, questionType);
              await Solver.autoSelectAndSubmit(aiText, currentQuestion);
              await Utils.sleep(1500);
            }
            previousFingerprint = fingerprint;
            const nextBtn = AiWorkspace.getExerciseActionButton(latestDoc, /下一题|下一道|下一步/);
            if (!nextBtn) break;
            nextBtn.click();
            const moved = await Utils.poll(() => {
              const movedDoc = AiWorkspace.getExerciseDocument() || document;
              const movedContainer = AiWorkspace.getExerciseContainer() || movedDoc.querySelector('.container-problem') || movedDoc;
              const nextQuestion = AiWorkspace.getExerciseQuestionBody(movedContainer);
              const nextFingerprint = AiWorkspace.normalizeText(nextQuestion?.innerText || '').slice(0, 120);
              return nextFingerprint && nextFingerprint !== fingerprint;
            }, { interval: 500, timeout: 5000 });
            if (!moved) break;
          }
          if (!touchedQuestion) {
            this.panel.log('未找到题号列表或题目内容，跳过该作业以避免重载循环', 'warning');
            if (failKey) FailGate.skip(failKey);
          }
          break;
        }
        if (i >= items.length) {
          this.panel.log(`所有题目处理完毕，共 ${items.length} 题，准备交卷`);
          break;
        }
        const listItem = items[i];
        if (AiWorkspace.isProblemSubmitted(problems[i]) || AiWorkspace.isExerciseTabAnswered(listItem)) {
          this.panel.log(`第 ${i + 1} 题已提交，跳过...`, 'warning');
          i++;
          continue;
        }
        listItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        listItem.click();
        await Utils.sleep(2200);

        const targetEl = document.querySelector('.item-type')?.parentElement || document.querySelector('.item-body') || document.querySelector('.container-problem');

        // 判断本题是否已完成：看当前题面或题号标签上的状态
        const isAnswered = AiWorkspace.isExerciseAnswered(targetEl)
          || AiWorkspace.isProblemSubmitted(problems[i])
          || AiWorkspace.isExerciseTabAnswered(listItem)
          || listItem.className?.includes('done')
          || listItem.className?.includes('completed')
          || listItem.className?.includes('correct')
          || listItem.className?.includes('finished')
          || /已完成|已作答|已提交|回答正确|回答错误|对|✓|✔/.test(listItem.innerText || '');

        if (isAnswered) {
          this.panel.log(`第 ${i + 1} 题已完成，跳过...`, 'warning');
          i++;
          continue;
        }
        const questionType = Solver.detectQuestionType(targetEl);
        let optionCount = 0;
        if (questionType !== 'fillblank') {
          optionCount = Solver.getVisibleOptionCount(targetEl);
          if (!optionCount) {
            this.panel.log(`第 ${i + 1} 题未找到选项，跳过`, 'warning');
            i++;
            continue;
          }
        }
        let retryCount = 0;
        let success = false;
        while (retryCount < maxRetry && !success) {
          try {
            if (retryCount > 0) {
              this.panel.log(`第 ${i + 1} 题重试 ${retryCount}/${maxRetry}...`, 'warning');
            }
            const imageDataUrl = await Solver.captureQuestionImage(targetEl);
            panel.log('请求多模态 AI 获取答案...');
            const aiText = await Solver.askAI(imageDataUrl, optionCount, questionType);
            await Solver.autoSelectAndSubmit(aiText, targetEl);
            const saved = await Utils.poll(() => {
              const freshDoc = AiWorkspace.getExerciseDocument() || document;
              const freshContainer = AiWorkspace.getExerciseContainer() || freshDoc.querySelector('.container-problem') || freshDoc;
              const freshTabs = AiWorkspace.getExerciseQuestionTabs(freshDoc);
              const freshProblems = AiWorkspace.getExerciseProblems(freshContainer);
              return AiWorkspace.isProblemSubmitted(freshProblems[i])
                || AiWorkspace.isExerciseTabAnswered(freshTabs[i] || listItem)
                || AiWorkspace.isExerciseAnswered(targetEl);
            }, { interval: 500, timeout: 5000 });
            if (!saved) this.panel.log(`第 ${i + 1} 题提交状态未及时回写，继续处理后续题目`, 'warning');
            success = true;
          } catch (err) {
            retryCount++;
            this.panel.log(`AI 答题失败：${err}`, 'error');
            if (retryCount < maxRetry) {
              this.panel.log(`等待 5 秒后重试...`, 'warning');
              await Utils.sleep(5000);
            } else {
              this.panel.log(`第 ${i + 1} 题重试 ${maxRetry} 次后仍失败，跳过`, 'warning');
            }
          }
        }
        await Utils.sleep(1500);
        i++;
      }

      // 尝试点击整体交卷/提交按钮
      const submitAllBtn = AiWorkspace.getExerciseActionButton(document, /交卷|提交作业|提交试卷|完成作业|确认提交/);
      if (submitAllBtn) {
        this.panel.log('已找到交卷按钮，正在提交...');
        submitAllBtn.click();
        await Utils.sleep(1500);
      } else {
        this.panel.log('未找到整体交卷按钮，可能已经自动保存', 'warning');
      }

      await this.returnToList();
    }

    async handleClassroom(course) {
      this.panel.log('进入课堂模式...');
      course.click();
      await Utils.sleep(5000);
      const iframe = document.querySelector('iframe.lesson-report-mobile');
      if (!iframe || !iframe.contentDocument) {
        this.panel.log('未找到课堂 iframe，跳过', 'warning');
        await this.returnToList();
        return;
      }
      const video = iframe.contentDocument.querySelector('video');
      const audio = iframe.contentDocument.querySelector('audio');
      for (const media of [video, audio].filter(Boolean)) {
        await Player.playFromStart(media);
        await Player.startPlayback(media);
        Player.applyMediaDefault(media);
        await Player.waitForEnd(media);
      }
      await this.returnToList();
    }

    async handleCourseware(course) {
      const tableData = course.parentNode?.parentNode?.parentNode?.__vue__?.tableData;
      const deadlinePassed = (tableData?.deadline || tableData?.end) ? (tableData.deadline < Date.now() || tableData.end < Date.now()) : false;
      if (deadlinePassed) {
        this.panel.log(`${course.querySelector('h2')?.innerText || '课件'} 已结课，跳过`, 'warning');
        await this.returnToList();
        return;
      }
      course.click();
      await Utils.sleep(3000);

      // 检测"查看课件"按钮（课件概况页专用）
      const checkBtn = document.querySelector('.ppt_img_box .check') || document.querySelector('p.check');
      if (checkBtn && /查看课件|查看PPT|查看幻灯片/i.test(checkBtn.innerText?.trim() || '')) {
        this.panel.log('检测到"查看课件"按钮，正在点击...');
        checkBtn.click();
        await Utils.sleep(2000);
      }

      const classType = document.querySelector('.el-card__header')?.innerText || '';
      const className = document.querySelector('.dialog-header')?.firstElementChild?.innerText || '课件';
      const isPPT = classType.includes('PPT')
        || location.pathname.includes('/ppt')
        || Boolean(document.querySelector('.swiper-wrapper'))
        || Boolean(document.querySelector('.ppt-container'))
        || Boolean(document.querySelector('[class*="ppt-slide"]'));

      if (isPPT) {
        await this.playPPTSlides(className);
      } else {
        const videoBox = document.querySelector('.video-box');
        if (videoBox) {
          videoBox.click();
          await Utils.sleep(1800);
          const cwVideo = document.querySelector('video');
          await Player.playFromStart(cwVideo);
          await Player.startPlayback(cwVideo);
          Player.applySpeed();
          const muteBtn = document.querySelector('.xt_video_player_common_icon');
          muteBtn && muteBtn.click();
          await Utils.poll(() => Utils.isPlayerTimeDisplayComplete(), { interval: 800, timeout: await Utils.getDDL() });
          this.panel.log(`${className} 视频播放完毕`);
        }
      }
      await this.returnToList();
    }

    getSlideReadStatus(slide) {
      if (!slide) return false;
      const cls = slide.className || '';
      // 明确的已读标记
      const readClasses = ['read', 'is-read', 'visited', 'completed', 'done', 'is-viewed', 'watched'];
      for (const c of readClasses) {
        if (cls.includes(c)) return true;
      }
      // 内部存在已读图标/文字
      if (slide.querySelector('.read, .is-read, .visited, .completed, .done, .is-viewed, .icon-check, .el-icon-check')) {
        return true;
      }
      const text = (slide.innerText || '').trim();
      if (/已读|已完成|已观看/.test(text)) return true;
      // active/current 只代表当前页，不代表已读，按未读处理
      return false;
    }

    resolveSlides(slideSelectors) {
      // 先尝试从页码指示器获取真实总页数
      let expectedCount = 0;
      for (const sel of PPT_INDICATOR_SELECTORS) {
        const el = document.querySelector(sel);
        const text = el?.innerText?.trim() || '';
        const m = text.match(/(\d+)\s*\/\s*(\d+)/);
        if (m) {
          expectedCount = parseInt(m[2], 10);
          break;
        }
      }

      // 收集所有候选 slide 集合
      const candidates = [];
      for (const selector of slideSelectors) {
        const els = [...document.querySelectorAll(selector)].filter(el => el.offsetParent !== null);
        if (els.length <= 1) continue;

        // 按 data-swiper-slide-index / aria-label / 内容去重（loop 模式复制 slide 会产生相同 index）
        const seen = new Set();
        const deduped = [];
        for (const el of els) {
          const key = el.getAttribute('data-swiper-slide-index')
            || el.getAttribute('aria-label')
            || el.innerHTML?.slice(0, 200);
          if (!seen.has(key)) {
            seen.add(key);
            deduped.push(el);
          }
        }

        // 计算平均面积，用于区分主视图和缩略图
        const avgArea = deduped.reduce((sum, el) => {
          const rect = el.getBoundingClientRect();
          return sum + rect.width * rect.height;
        }, 0) / deduped.length;

        candidates.push({ selector, slides: deduped, avgArea, count: deduped.length });
      }

      if (!candidates.length) return [];

      // 优先匹配页码指示器数量
      if (expectedCount > 0) {
        const match = candidates.find(c => c.count === expectedCount)
          || candidates.reduce((best, c) => Math.abs(c.count - expectedCount) < Math.abs(best.count - expectedCount) ? c : best, candidates[0]);
        if (match) {
          this.panel.log(`检测到页码指示器共 ${expectedCount} 张，使用选择器 ${match.selector}（${match.count} 张）`);
          return match.slides;
        }
      }

      // 否则选择平均面积最大的（主视图而非缩略图）
      candidates.sort((a, b) => b.avgArea - a.avgArea);
      const best = candidates[0];
      this.panel.log(`选择最大幻灯片区域：${best.selector}，共 ${best.count} 张`);
      return best.slides;
    }

    async playPPTSlides(className) {
      this.panel.log(`开始播放 PPT：${className}`);

      // 多候选选择器：兼容弹窗式/内嵌式/新版雨课堂 PPT
      // 注意：swiper loop 模式会复制首尾 slide 产生 swiper-slide-duplicate，需要排除
      const slideSelectors = [
        '.swiper-wrapper > .swiper-slide:not(.swiper-slide-duplicate)',
        '.swiper-wrapper > .swiper-slide',
        '.ppt-slide:not(.swiper-slide-duplicate)',
        '.slide-page',
        '.ppt-container .slide',
        '.ppt-content .page',
        '[class*="ppt-slide"]:not(.swiper-slide-duplicate)',
        '[class*="slide-page"]',
        '.ppt-viewer .page'
      ];

      const slides = this.resolveSlides(slideSelectors);

      if (slides.length > 0) {
        // 尝试识别已读/未读：如果任意 slide 能识别出已读状态，就只刷未读页
        const readStatuses = slides.map(s => this.getSlideReadStatus(s));
        const canDetectRead = readStatuses.some(s => s === true);
        if (canDetectRead) {
          this.panel.log('检测到幻灯片已读/未读状态，将跳过已读页');
        }

        for (let i = 0; i < slides.length; i++) {
          if (readStatuses[i] === true) {
            this.panel.log(`${className}：第 ${i + 1}/${slides.length} 张已读，跳过`, 'warning');
            continue;
          }
          slides[i].scrollIntoView({ behavior: 'instant', block: 'nearest' });
          slides[i].click();
          this.panel.log(`${className}：第 ${i + 1}/${slides.length} 张`);
          await Utils.sleep(Config.pptInterval);
        }
      } else {
        this.panel.log('未找到幻灯片列表，尝试按翻页按钮/键盘翻页...', 'warning');
        await this.playPPTByNavigation(className);
      }

      await Utils.sleep(Config.pptInterval);

      const videoBoxes = document.querySelectorAll('.video-box');
      if (videoBoxes?.length) {
        this.panel.log('PPT 中有视频，继续播放');
        for (let i = 0; i < videoBoxes.length; i++) {
          if (videoBoxes[i].innerText === '已完成') {
            this.panel.log(`第 ${i + 1} 个视频已完成，跳过`, 'warning');
            continue;
          }
          videoBoxes[i].click();
          await Utils.sleep(2000);
          const pptVideo = document.querySelector('video');
          await Player.playFromStart(pptVideo);
          await Player.startPlayback(pptVideo);
          Player.applySpeed();
          const muteBtn = document.querySelector('.xt_video_player_common_icon');
          muteBtn && muteBtn.click();
          const stopObserve = Player.observePause(pptVideo);
          await Utils.poll(() => Utils.isPlayerTimeDisplayComplete(), { interval: 800, timeout: await Utils.getDDL() });
          stopObserve();
        }
      }
      this.panel.log(`${className} 已播放完毕`);
    }

    async playPPTByNavigation(className) {
      const nextSelectors = [
        '.swiper-button-next',
        '.ppt-next',
        '.next-page',
        '[class*="next"][class*="page"]',
        '[class*="arrow-right"]',
        '.btn-next-slide'
      ];
      let nextBtn = null;
      for (const selector of nextSelectors) {
        nextBtn = document.querySelector(selector);
        if (nextBtn && nextBtn.offsetParent !== null) break;
      }

      let lastPage = '';
      let sameCount = 0;
      let pageNum = 0;
      const maxPages = 200;

      while (sameCount < 3 && pageNum < maxPages) {
        const indicator = PPT_INDICATOR_SELECTORS.reduce((found, sel) => found || document.querySelector(sel), null);
        const currentPage = indicator?.innerText?.trim() || '';

        if (currentPage && currentPage === lastPage) {
          sameCount++;
        } else {
          sameCount = 0;
          lastPage = currentPage;
          pageNum++;
          this.panel.log(`${className}：第 ${pageNum} 页${currentPage ? `（${currentPage}）` : ''}`);
        }

        if (nextBtn) {
          nextBtn.click();
        } else {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
          document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
        }
        await Utils.sleep(Config.pptInterval);
      }

      this.panel.log(`${className} PPT 翻页结束，共 ${pageNum} 页`);
    }
  }

  // ---- pro/lms 旧版（仅做转发） ----
  class ProOldRunner {
    constructor(panel) {
      this.panel = panel;
    }
    run() {
      this.panel.log('准备打开新标签页...');
      const leafDetail = document.querySelectorAll('.leaf-detail');
      let classCount = Store.getProClassCount() - 1;
      while (leafDetail[classCount] && !leafDetail[classCount].firstChild.querySelector('i').className.includes('shipin')) {
        classCount++;
        Store.setProClassCount(classCount + 1);
        this.panel.log('课程不属于视频，已跳过', 'warning');
      }
      leafDetail[classCount]?.click();
    }
  }

  // ---- pro/lms 新版（主要逻辑） ----
  class ProNewRunner {
    constructor(panel) {
      this.panel = panel;
    }
    async run() {
      preventScreenCheck();
      const readClassStatus = () => document.querySelector('#app > div.app_index-wrapper > div.wrap > div.viewContainer.heightAbsolutely > div > div > div > div > section.title')?.lastElementChild?.innerText || '';
      let classCount = Store.getProClassCount();
      while (true) {
        this.panel.log(`准备播放第 ${classCount} 集...`);
        await Utils.sleep(2000);
        const className = document.querySelector('.header-bar')?.firstElementChild?.innerText || '';
        const classType = document.querySelector('.header-bar')?.firstElementChild?.firstElementChild?.getAttribute('class') || '';
        const classStatus = readClassStatus();
        if (classType.includes('tuwen') && !classStatus.includes('已读')) {
          this.panel.log(`正在阅读：${className}`);
          await Utils.sleep(2000);
        } else if (classType.includes('taolun')) {
          this.panel.log(`讨论区暂不自动发帖，${className}`, 'warning');
          await Utils.sleep(2000);
        } else if (classType.includes('shipin') && !classStatus.includes('100%')) {
          this.panel.log(`2s 后开始播放：${className}`);
          await Utils.sleep(2000);
          let statusTimer;
          let videoTimer;
          try {
            statusTimer = setInterval(() => {
              const status = readClassStatus();
              if (Utils.isProgressDone(status)) {
                this.panel.log(`${className} 播放完毕`);
                clearInterval(statusTimer);
                statusTimer = null;
              }
            }, 200);

            const videoWaitStart = Date.now();
            videoTimer = setInterval(() => {
              const video = document.querySelector('video');
              if (video) {
                setTimeout(async () => {
                  await Player.playFromStart(video);
                  await Player.startPlayback(video);
                  Player.applySpeed();
                  Player.mute();
                  Player.observePause(video);
                }, 2000);
                clearInterval(videoTimer);
                videoTimer = null;
              } else if (Date.now() - videoWaitStart > 20000) {
                location.reload();
              }
            }, 5000);

            await Utils.sleep(8000);
            await Utils.poll(() => {
              const status = readClassStatus();
              return Utils.isProgressDone(status);
            }, { interval: 1000, timeout: await Utils.getDDL() });
          } finally {
            if (statusTimer) clearInterval(statusTimer);
            if (videoTimer) clearInterval(videoTimer);
          }
        } else if (classType.includes('zuoye')) {
          this.panel.log(`进入作业：${className}（暂无自动答题）`, 'warning');
          await Utils.sleep(2000);
        } else if (classType.includes('kaoshi')) {
          this.panel.log(`进入考试：${className}（不会自动答题）`, 'warning');
          await Utils.sleep(2000);
        } else if (classType.includes('ketang')) {
          this.panel.log(`进入课堂：${className}（暂无自动功能）`, 'warning');
          await Utils.sleep(2000);
        } else {
          this.panel.log(`已看过：${className}`);
          await Utils.sleep(2000);
        }
        this.panel.log(`第 ${classCount} 集播放完毕`);
        classCount++;
        Store.setProClassCount(classCount);
        const nextBtn = document.querySelector('.btn-next');
        if (nextBtn) {
          const event1 = new Event('mousemove', { bubbles: true });
          event1.clientX = 9999;
          event1.clientY = 9999;
          nextBtn.dispatchEvent(event1);
          nextBtn.dispatchEvent(new Event('click'));
        } else {
          Store.clearProClassCount();
          this.panel.log('课程播放完毕');
          Store.clearPendingAutoStart();
          break;
        }
      }
    }
  }

  // ---- ai-workspace 新版学习空间 ----
  class AiWorkspaceRunner {
    constructor(panel) {
      this.panel = panel;
    }

    getExerciseQuestionLabel(root) {
      const tabs = AiWorkspace.getExerciseQuestionTabs(root);
      const active = tabs.find(tab => /active|current|selected|is-active/.test(tab.className));
      return AiWorkspace.normalizeText(active?.innerText || '');
    }

    getReturnUrl() {
      const pending = Store.getPendingAutoStart();
      const route = AiWorkspace.getRoute();
      if (!pending || !route) return '';
      if (Utils.isV2ContentPage()) return pending.returnUrl || '';
      if (route.classroomId && pending.classroomId !== route.classroomId) return '';
      return pending.returnUrl || '';
    }

    getSourceWindow() {
      try {
        if (!window.opener || window.opener.closed) return null;
        if (window.opener.location.origin !== location.origin) return null;
        return window.opener;
      } catch (_) {
        return null;
      }
    }

    async returnToSource() {
      const returnUrl = this.getReturnUrl();
      if (!returnUrl) {
        this.panel.log('未找到课程目录返回地址，无法自动返回继续遍历', 'warning');
        return false;
      }
      this.panel.log('媒体播放完成，返回课程目录页继续匹配');
      await Utils.sleep(1200);
      const sourceWindow = this.getSourceWindow();
      if (sourceWindow) {
        try {
          sourceWindow.location.href = returnUrl;
          sourceWindow.focus();
          window.close();
          return true;
        } catch (_) {
          // ignore and fallback
        }
      }

      if (location.href !== returnUrl) {
        location.href = returnUrl;
      } else {
        history.back();
      }
      return true;
    }

    async handleMedia(route) {
      const title = AiWorkspace.getActiveLeafTitle() || `${route.type} ${route.leafId}`;
      this.panel.log(`开始播放：${title}`);
      const ready = await Utils.poll(() => {
        const media = AiWorkspace.getMedia();
        if (media) return true;
        for (const doc of AiWorkspace.getAccessibleDocuments()) {
          const btn = Player.findPlayButton(doc);
          if (btn) Player.dispatchUserLikeClick(btn);
        }
        return false;
      }, { interval: 1000, timeout: 45000 });
      let media = AiWorkspace.getMedia();
      if (!ready || !media) {
        this.panel.log('未找到视频/音频元素，停止当前轮次', 'warning');
        return false;
      }

      const playbackState = { completed: false };
      const shouldResume = () => !playbackState.completed;
      let stopObserve = () => { };
      let stopKeepAlive = () => { };

      // 确保从开头播放，避免中间段未刷到
      Player.prepareMedia(media);
      await Player.playFromStart(media);
      const startedImmediately = await Player.startPlayback(media);
      if (!startedImmediately) {
        this.panel.log('首次播放未确认启动，继续接管并重试', 'warning');
      }

      if (media.tagName.toLowerCase() === 'video') {
        Player.applySpeed();
        Player.mute(media);
        stopObserve = Player.observePause(media, shouldResume);
      } else {
        Player.applyMediaDefault(media);
        stopKeepAlive = AiWorkspace.keepAlive(shouldResume);
      }
      this.panel.log(`已接管播放器：${media.tagName.toLowerCase()}，目标倍速 ${Config.playbackRate}x，静音开启`);
      try {
        let startTime = 0;
        const started = await Utils.poll(() => {
          const currentMedia = AiWorkspace.getMedia();
          if (currentMedia) media = currentMedia;
          if (!media) return false;
          const currentTime = Number(media.currentTime || 0);
          return currentTime > startTime + 0.5 || (!media.paused && media.readyState >= 2 && currentTime > startTime + 0.2);
        }, { interval: 500, timeout: 15000 });
        if (!started) {
          this.panel.log('未确认到视频实际开始播放，停止当前轮次', 'warning');
          return false;
        }
        startTime = Number(media.currentTime || 0);

        let resolveEnded;
        const endedPromise = new Promise(resolve => {
          resolveEnded = resolve;
        });
        const onEnded = () => {
          playbackState.completed = true;
          resolveEnded(true);
        };
        media.addEventListener('ended', onEnded);
        const done = await Promise.race([
          endedPromise,
          Utils.poll(() => {
            if (playbackState.completed) return true;
            const currentMedia = AiWorkspace.getMedia();
            if (currentMedia) media = currentMedia;
            if (AiWorkspace.isPlayerDone(media, { startTime, minPlayedDelta: 3 })) {
              playbackState.completed = true;
              return true;
            }
            return false;
          }, { interval: 1000, timeout: await Utils.getDDL(media) })
        ]);
        media.removeEventListener('ended', onEnded);
        playbackState.completed = true;
        if (!done) {
          this.panel.log('等待播放完成超时，停止当前轮次', 'warning');
          return false;
        }
      } finally {
        stopObserve();
        stopKeepAlive();
      }

      this.panel.log(`${title} 播放完成`);
      return true;
    }

    async solveExerciseQuestion(root, label = '') {
      const questionRoot = AiWorkspace.getExerciseQuestionBody(root);
      if (!questionRoot) {
        this.panel.log('未找到题目容器，停止当前轮次', 'warning');
        return false;
      }
      if (AiWorkspace.isExerciseAnswered(questionRoot)) {
        this.panel.log(`${label || '当前题目'} 已完成，跳过`, 'warning');
        return true;
      }

      const questionType = Solver.detectQuestionType(questionRoot);
      let optionCount = 0;
      if (questionType !== 'fillblank') {
        optionCount = Solver.getVisibleOptionCount(questionRoot);
        if (!optionCount) {
          this.panel.log(`${label || '当前题目'} 未找到选项，跳过`, 'warning');
          return false;
        }
      }

      const maxRetry = Config.aiMaxRetry;
      for (let retryCount = 0; retryCount < maxRetry; retryCount++) {
        try {
          if (retryCount > 0) this.panel.log(`${label || '当前题目'} 重试 ${retryCount}/${maxRetry - 1}`, 'warning');
          const imageDataUrl = await Solver.captureQuestionImage(questionRoot);
          this.panel.log('请求多模态 AI 获取答案...');
          const aiText = await Solver.askAI(imageDataUrl, optionCount, questionType);
          await Solver.autoSelectAndSubmit(aiText, questionRoot);
          await Utils.sleep(1200);
          return true;
        } catch (err) {
          this.panel.log(`AI 答题失败：${err}`, 'error');
          if (retryCount < maxRetry - 1) await Utils.sleep(5000);
        }
      }
      return false;
    }

    isExerciseQuestionSubmitted(root, tab = null, index = -1, checkCurrentBody = false) {
      const problems = AiWorkspace.getExerciseProblems(root);
      return AiWorkspace.isProblemSubmitted(problems[index])
        || AiWorkspace.isExerciseTabAnswered(tab)
        || (checkCurrentBody && AiWorkspace.isExerciseAnswered(AiWorkspace.getExerciseQuestionBody(root)));
    }

    async advanceExerciseQuestion(root, previousFingerprint = '') {
      const currentRoot = AiWorkspace.getExerciseContainer() || root;
      const nextBtn = AiWorkspace.getExerciseActionButton(currentRoot, /下一题|下一道|下一步/);
      if (!nextBtn) return false;
      nextBtn.click();
      return Utils.poll(() => {
        const latestRoot = AiWorkspace.getExerciseContainer() || currentRoot;
        const questionRoot = AiWorkspace.getExerciseQuestionBody(latestRoot);
        const fingerprint = AiWorkspace.normalizeText(questionRoot?.innerText || '').slice(0, 120);
        return fingerprint && fingerprint !== previousFingerprint;
      }, { interval: 500, timeout: 5000 });
    }

    async handleExercise(route) {
      const featureFlags = Store.getFeatureConf();
      if (!featureFlags.autoAI) {
        this.panel.log('已关闭 AI 自动答题，作业将直接跳过', 'warning');
        return true;
      }

      const ready = await Utils.poll(() => Boolean(AiWorkspace.getExerciseContainer()), { interval: 500, timeout: 20000 });
      const root = AiWorkspace.getExerciseContainer();
      if (!ready || !root) {
        this.panel.log('未找到作业容器，停止当前轮次', 'warning');
        return false;
      }

      this.panel.log(`开始处理作业：${AiWorkspace.getActiveLeafTitle() || route.leafId}`);
      const tabs = AiWorkspace.getExerciseQuestionTabs(root);
      if (tabs.length) {
        this.panel.log(`检测到题目索引 ${tabs.length} 个，按题号顺序作答`);
        for (let i = 0; i < tabs.length; i++) {
          const currentRoot = AiWorkspace.getExerciseContainer() || root;
          const currentTabs = AiWorkspace.getExerciseQuestionTabs(currentRoot);
          const currentTab = currentTabs[i];
          if (!currentTab) break;
          if (this.isExerciseQuestionSubmitted(currentRoot, currentTab, i, false)) {
            this.panel.log(`第 ${i + 1} 题已提交，跳过`, 'warning');
            continue;
          }
          currentTab.click();
          await Utils.sleep(1200);
          const latestRoot = AiWorkspace.getExerciseContainer() || currentRoot;
          if (this.isExerciseQuestionSubmitted(latestRoot, currentTab, i, true)) {
            this.panel.log(`第 ${i + 1} 题已提交，跳过`, 'warning');
            continue;
          }
          await this.solveExerciseQuestion(latestRoot, `第 ${i + 1} 题`);
        }
        return true;
      }

      this.panel.log('未找到题号列表，尝试只处理当前题并按下一题推进', 'warning');
      let previousFingerprint = '';
      for (let i = 0; i < 20; i++) {
        const currentRoot = AiWorkspace.getExerciseContainer() || root;
        const questionRoot = AiWorkspace.getExerciseQuestionBody(currentRoot);
        const fingerprint = AiWorkspace.normalizeText(questionRoot?.innerText || '').slice(0, 120);
        if (!fingerprint) break;
        if (i > 0 && fingerprint === previousFingerprint) break;
        if (this.isExerciseQuestionSubmitted(currentRoot, null, i, true)) {
          this.panel.log(`${this.getExerciseQuestionLabel(currentRoot) || `第 ${i + 1} 题`} 已提交，跳过`, 'warning');
        } else {
          await this.solveExerciseQuestion(currentRoot, this.getExerciseQuestionLabel(currentRoot) || `第 ${i + 1} 题`);
        }
        previousFingerprint = fingerprint;
        const moved = await this.advanceExerciseQuestion(currentRoot, fingerprint);
        if (!moved) break;
      }
      return true;
    }

    async run() {
      preventScreenCheck();
      const route = AiWorkspace.getRoute() || AiWorkspace.getGenericV2ContentRoute();
      if (!route) {
        this.panel.log('当前页面已离开 ai-workspace/lms-graph', 'warning');
        return;
      }
      if (!route.leafId && route.type !== 'content') {
        this.panel.log('未能识别当前知识点', 'warning');
        return;
      }
      let ok = false;
      if (AiWorkspace.isMediaRouteType(route.type)) {
        ok = await this.handleMedia(route);
      } else if (AiWorkspace.isExerciseRouteType(route.type)) {
        ok = await this.handleExercise(route);
      } else if (route.type === 'content') {
        ok = await this.handleMedia(route);
        if (!ok && Store.getFeatureConf().autoAI) {
          ok = await this.handleExercise(route);
        }
      } else {
        this.panel.log(`当前类型为 ${route.type}，最小方案暂不自动处理`, 'warning');
        return;
      }
      if (!ok) {
        await this.returnToSource();
        return;
      }
      await this.returnToSource();
    }
  }

  // ---- 路由 ----
  function start() {
    const classroomId = Utils.getCurrentClassroomId();
    const returnUrl = location.pathname.includes('/v2/web/studentLog/') ? location.href : '';
    const pendingHandoff = Store.getPendingHandoff();
    if (returnUrl || (!pendingHandoff && !Utils.isV2ContentPage())) {
      Store.setPendingAutoStart(classroomId, returnUrl, { handoff: null });
    }
    const aiRoute = AiWorkspace.getRoute();
    if (aiRoute) {
      panel.log(`正在匹配处理逻辑：${aiRoute.source || 'ai-workspace/lms-graph'}/${aiRoute.type}`);
      new AiWorkspaceRunner(panel).run();
      return;
    }
    const url = location.host;
    const path = location.pathname.split('/');
    const matchURL = `${url}${path[0]}/${path[1]}/${path[2]}`;
    panel.log(`正在匹配处理逻辑：${matchURL}`);
    if (matchURL.includes('yuketang.cn/v2/web') || matchURL.includes('gdufemooc.cn/v2/web')) {
      // v2 路线必须在课程列表页运行，避免在单个课件/视频页误启动主循环
      if (!document.querySelector('.logs-list')) {
        const pendingAutoStart = Store.getPendingAutoStart();
        const contentRoute = AiWorkspace.getRoute() || AiWorkspace.getGenericV2ContentRoute();
        if (pendingAutoStart?.returnUrl && Utils.isV2ContentPage() && contentRoute) {
          panel.log(`检测到 V2 内容页，接管处理：${contentRoute.source}/${contentRoute.type}`);
          new AiWorkspaceRunner(panel).run();
          return;
        }
        panel.resetStartButton('开始');
        panel.log('当前页面不是课程列表（缺少 .logs-list），请返回课程目录页后再开始', 'warning');
        return;
      }
      new V2Runner(panel).run();
    } else if (matchURL.includes('yuketang.cn/pro/lms') || matchURL.includes('gdufemooc.cn/pro/lms')) {
      if (document.querySelector('.btn-next')) {
        new ProNewRunner(panel).run();
      } else {
        new ProOldRunner(panel).run();
      }
    } else {
      panel.resetStartButton('开始');
      panel.log('当前页面非支持页面，应匹配 */v2/web/*、*/pro/lms/* 或 */ai-workspace/lms-graph/*', 'warning');
    }
  }

  // ---- 启动 ----
  async function boot() {
    if (Utils.inIframe()) return;
    await Utils.waitForMountTarget();
    try {
      panel = createPanel();
      panel.log(`yuketang-ComplexAutomation v${Config.version} 已加载`);
      FontPatch.scheduleFromConfig();
      panel.setStartHandler(start);
      const pendingAutoStart = Store.getPendingAutoStart();
      const currentClassroomId = Utils.getCurrentClassroomId();
      const pendingHandoff = Store.getPendingHandoff();
      const isV2ContinuationPage = Utils.isV2ContentPage() && pendingAutoStart?.returnUrl;
      const isHandoffContinuationPage = Boolean(pendingHandoff && pendingAutoStart?.returnUrl);
      const canResumeCurrentPage = pendingAutoStart
        && (Utils.isSupportedLearningPage() || isHandoffContinuationPage)
        && (
          isV2ContinuationPage
          || isHandoffContinuationPage
          || (currentClassroomId && pendingAutoStart.classroomId === currentClassroomId)
        );
      if (canResumeCurrentPage) {
        panel.log(`检测到跨页面跳转，自动恢复刷课：课堂 ${currentClassroomId || pendingAutoStart.classroomId}`);
        setTimeout(() => panel.start(), 1200);
      }
    } catch (err) {
      console.error('面板初始化失败:', err);
    }
  }

  boot();

})();
