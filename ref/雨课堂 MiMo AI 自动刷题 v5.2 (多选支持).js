// ==UserScript==
// @name         雨课堂 MiMo AI 自动刷题 v5.2 (多选支持)
// @namespace    https://www.yuketang.cn/
// @version      5.2.0
// @description  雨课堂自动刷课 - 视觉识别版：截图题目→MiMo AI看图作答→自动提交→自动跳转下一个习题。v5.2新增多选题(checkbox)支持，自动检测单选/多选
// @author       AI Assistant
// @match        https://www.yuketang.cn/v2/web/cloud/student/exercise/*
// @match        https://www.yuketang.cn/v2/web/studentLog/*
// @require      https://html2canvas.hertzen.com/dist/html2canvas.min.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @connect      api.xiaomimimo.com
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 配置 ====================
    const CONFIG = {
        apiKey: '',
        model: 'mimo-v2-flash',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        delayBetweenQuestions: 2000,
        maxRetry: 3,
    };

    // ==================== 状态管理 ====================
    const STATE = {
        isRunning: false,
        totalQuestions: 0,
        answered: 0,
        stats: { correct: 0, wrong: 0, skipped: 0 },
    };

    // ==================== 页面检测 ====================
    function isExercisePage() {
        return /\/v2\/web\/cloud\/student\/exercise\//.test(location.href);
    }

    function isStudentLogPage() {
        return /\/v2\/web\/studentLog\//.test(location.href);
    }

    function getClassroomId() {
        const m = location.href.match(/studentLog\/(\d+)/) || location.href.match(/exercise\/(\d+)\//);
        return m ? m[1] : null;
    }

    // ==================== 课程模式 ====================
    function getCourseQueue() {
        try {
            return JSON.parse(GM_getValue('yt_course_queue', '[]'));
        } catch (e) { return []; }
    }

    function setCourseQueue(queue) {
        GM_setValue('yt_course_queue', JSON.stringify(queue));
    }

    function getCourseIndex() {
        return parseInt(GM_getValue('yt_course_index', '0'));
    }

    function setCourseIndex(idx) {
        GM_setValue('yt_course_index', String(idx));
    }

    function isCourseMode() {
        return GM_getValue('yt_course_mode', 'false') === 'true';
    }

    function setCourseMode(on) {
        GM_setValue('yt_course_mode', on ? 'true' : 'false');
    }

    // ==================== 日志 ====================
    function log(msg, type) {
        const prefix = { info: '[信息]', success: '[成功]', error: '[错误]', warning: '[警告]', ai: '[AI]' }[type] || '[信息]';
        console.log(`[雨课堂AI] ${prefix} ${msg}`);
    }

    // ==================== UI ====================
    function createUI() {
        const panel = document.createElement('div');
        panel.id = 'yt-ai-panel';
        panel.innerHTML = `
        <style>
          #yt-ai-panel{position:fixed;top:80px;right:20px;z-index:99999;width:340px;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:13px;}
          #yt-ai-panel .hd{padding:12px 16px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;}
          #yt-ai-panel .hd h3{margin:0;font-size:15px;}
          #yt-ai-panel .hd .close{cursor:pointer;font-size:18px;opacity:.8;}
          #yt-ai-panel .bd{padding:12px 16px;}
          #yt-ai-panel .bd .row{margin-bottom:8px;display:flex;align-items:center;gap:8px;}
          #yt-ai-panel .bd label{width:60px;color:#666;flex-shrink:0;}
          #yt-ai-panel .bd input{flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;}
          #yt-ai-panel .bd select{padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;}
          #yt-ai-panel .btn{width:100%;padding:10px 16px;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600;transition:all .2s;margin-top:4px;}
          #yt-ai-panel .btn-start{background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;}
          #yt-ai-panel .btn-start:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(102,126,234,.4);}
          #yt-ai-panel .btn-start:disabled{background:#ccc;cursor:not-allowed;transform:none;box-shadow:none;}
          #yt-ai-panel .btn-stop{background:#f44336;color:#fff;}
          #yt-ai-panel .btn-test{background:#ff9800;color:#fff;}
          #yt-ai-panel .progress{margin-top:8px;background:#f0f0f0;border-radius:4px;height:6px;overflow:hidden;}
          #yt-ai-panel .progress .bar{height:100%;background:linear-gradient(135deg,#667eea,#764ba2);transition:width .3s;width:0%;}
          #yt-ai-panel .stats{margin-top:8px;font-size:12px;color:#888;}
          #yt-ai-panel .log-area{margin-top:8px;max-height:200px;overflow-y:auto;background:#f9f9f9;border-radius:6px;padding:8px;font-size:11px;color:#555;}
          #yt-ai-panel .log-area .log-line{padding:2px 0;border-bottom:1px solid #f0f0f0;word-break:break-all;}
        </style>
        <div class="hd"><h3 id="yt-panel-title">AI视觉刷题 v5.2</h3><span class="close" id="yt-ai-close">x</span></div>
        <div class="bd">
          <div class="row"><label>API Key:</label><input type="password" id="yt-api-key" placeholder="输入MiMo API Key"></div>
          <div class="row"><label>模型:</label><select id="yt-model"><option value="mimo-v2-flash">mimo-v2-flash</option><option value="mimo-v2-pro">mimo-v2-pro</option></select></div>
          <div id="yt-course-info" style="display:none;margin-bottom:4px;padding:4px 8px;background:#e8f5e9;border-radius:6px;font-size:12px;color:#2e7d32;"></div>
          <button class="btn btn-test" id="yt-btn-scan" style="display:none;">扫描课程习题</button>
          <button class="btn btn-test" id="yt-btn-test">测试截图效果</button>
          <button class="btn btn-start" id="yt-btn-start">开始自动答题</button>
          <button class="btn btn-start" id="yt-btn-course" style="display:none;">开始刷课</button>
          <button class="btn btn-stop" id="yt-btn-stop" style="display:none;">停止</button>
          <div class="progress"><div class="bar" id="yt-progress-bar"></div></div>
          <div class="stats" id="yt-stats"></div>
          <div class="log-area" id="yt-log"></div>
        </div>`;
        document.body.appendChild(panel);

        const savedKey = GM_getValue('yt_api_key', '');
        const savedModel = GM_getValue('yt_model', 'mimo-v2-flash');
        document.getElementById('yt-api-key').value = savedKey;
        document.getElementById('yt-model').value = savedModel;
        if (savedKey) CONFIG.apiKey = savedKey;
        CONFIG.model = savedModel;

        document.getElementById('yt-ai-close').onclick = () => { panel.style.display = 'none'; };
        document.getElementById('yt-api-key').onchange = function () {
            CONFIG.apiKey = this.value;
            GM_setValue('yt_api_key', this.value);
        };
        document.getElementById('yt-model').onchange = function () {
            CONFIG.model = this.value;
            GM_setValue('yt_model', this.value);
        };
        document.getElementById('yt-btn-test').onclick = testScreenshot;
        document.getElementById('yt-btn-start').onclick = startAutoAnswer;
        document.getElementById('yt-btn-course').onclick = startCourseMode;
        document.getElementById('yt-btn-scan').onclick = scanAndStart;
        document.getElementById('yt-btn-stop').onclick = stopAutoAnswer;
    }

    function addLogLine(msg, type) {
        const logArea = document.getElementById('yt-log');
        if (!logArea) return;
        const icon = { info: '', success: '', error: '', warning: '', ai: '' }[type] || '';
        const line = document.createElement('div');
        line.className = 'log-line';
        line.textContent = `${icon} ${msg}`;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
        log(msg, type);
    }

    function updateUIState(running) {
        const startBtn = document.getElementById('yt-btn-start');
        const stopBtn = document.getElementById('yt-btn-stop');
        if (startBtn) startBtn.style.display = running ? 'none' : 'block';
        if (stopBtn) stopBtn.style.display = running ? 'block' : 'none';
    }

    function updateProgress() {
        const bar = document.getElementById('yt-progress-bar');
        const stats = document.getElementById('yt-stats');
        if (bar && STATE.totalQuestions > 0) {
            bar.style.width = (STATE.answered / STATE.totalQuestions * 100) + '%';
        }
        if (stats) {
            stats.textContent = `进度: ${STATE.answered}/${STATE.totalQuestions} | 正确:${STATE.stats.correct} 错误:${STATE.stats.wrong} 跳过:${STATE.stats.skipped}`;
        }
    }

    // ==================== 数据提取 ====================
    function getExerciseData() {
        try {
            const container = document.querySelector('.container-problem');
            if (!container || !container.__vue__) return null;
            const parent = container.__vue__.$parent;
            return parent.exerciseList;
        } catch (e) {
            return null;
        }
    }

    function extractProblems(exerciseList) {
        const problems = [];
        for (const pr of exerciseList.problems) {
            const submitted = !!(pr.user && pr.user.submit_time);
            problems.push({
                index: pr.index,
                problem_id: pr.problem_id,
                type: pr.content.Type,
                submitted: submitted,
                isRight: pr.user && pr.user.is_right,
            });
        }
        return problems;
    }

    // ==================== 截图为图片 ====================
    async function captureQuestionArea() {
        // 找到题目卡片区域（包含题干和选项）
        const selectors = [
            '.problem-content',
            '.question-content',
            '.exercise-content',
            '.container-problem .el-card',
            '.container-problem .el-card__body',
            '.container-problem',
        ];

        let target = null;
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetHeight > 100) {
                target = el;
                break;
            }
        }

        if (!target) {
            throw new Error('找不到题目区域');
        }

        addLogLine('正在截取题目截图...', 'info');

        try {
            // 使用 html2canvas 截取
            const canvas = await html2canvas(target, {
                scale: 2,                    // 2倍分辨率提高OCR精度
                useCORS: true,               // 允许跨域资源
                allowTaint: false,           // 不允许污染canvas
                backgroundColor: '#ffffff',
                logging: false,
                // 尝试让html2canvas使用页面已加载的字体
                onclone: function (clonedDoc) {
                    // 确保克隆文档中的字体也正确加载
                },
            });

            const dataUrl = canvas.toDataURL('image/png');
            addLogLine(`截图完成: ${canvas.width}x${canvas.height}`, 'success');
            return dataUrl;

        } catch (e) {
            // 如果html2canvas失败（比如字体跨域），尝试用SVG方式
            addLogLine('html2canvas截图失败，尝试SVG方式: ' + e.message, 'warning');
            return captureViaSVG(target);
        }
    }

    function captureViaSVG(target) {
        // SVG foreignObject 方式作为备用
        const rect = target.getBoundingClientRect();
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = rect.width * scale;
        canvas.height = rect.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);

        // 克隆元素并获取其HTML
        const clone = target.cloneNode(true);
        const styles = getComputedStyles(target);
        const html = new XMLSerializer().serializeToString(target);

        const svgData = `
            <svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">
                <foreignObject width="100%" height="100%">
                    <div xmlns="http://www.w3.org/1999/xhtml" style="${styles}">
                        ${html}
                    </div>
                </foreignObject>
            </svg>
        `;

        return new Promise((resolve, reject) => {
            const img = new Image();
            const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);

            img.onload = () => {
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = (e) => {
                URL.revokeObjectURL(url);
                reject(new Error('SVG渲染失败'));
            };
            img.src = url;
        });
    }

    function getComputedStyles(el) {
        const cs = getComputedStyle(el);
        const important = [
            'font-family', 'font-size', 'font-weight', 'color', 'background-color',
            'line-height', 'text-align', 'padding', 'margin', 'border',
            'width', 'display', 'flex-direction', 'align-items', 'justify-content',
        ];
        return important.map(p => `${p}: ${cs.getPropertyValue(p)}`).join('; ');
    }

    // ==================== 测试截图 ====================
    async function testScreenshot() {
        try {
            addLogLine('正在测试截图...', 'info');
            const dataUrl = await captureQuestionArea();
            addLogLine('截图成功!', 'success');

            // 在新窗口显示截图
            const win = window.open('', '_blank');
            if (win) {
                win.document.write(`<img src="${dataUrl}" style="max-width:100%;"><br><p>截图效果预览</p>`);
                addLogLine('截图已在新窗口打开', 'success');
            } else {
                // 弹窗被拦截，在面板中显示小图
                const img = document.createElement('img');
                img.src = dataUrl;
                img.style.cssText = 'max-width:100%;max-height:300px;margin-top:8px;border-radius:6px;';
                const logArea = document.getElementById('yt-log');
                if (logArea) logArea.appendChild(img);
                addLogLine('截图已显示在日志区域', 'success');
            }
        } catch (e) {
            addLogLine('截图失败: ' + e.message, 'error');
            console.error(e);
        }
    }

    // ==================== AI 视觉答题 ====================
    async function callMiMoVision(imageDataUrl, questionType) {
        const typeDesc = {
            'SingleChoice': '单选题',
            'MultipleChoice': '多选题',
            'TrueOrFalse': '判断题',
        }[questionType] || '单选题';

        const systemPrompt = `你是一个专业答题助手。你的任务是根据截图中的题目，给出正确答案的选项字母。

【严格输出格式】
- 单选题：只输出一个大写字母，如 A
- 多选题：只输出字母用逗号分隔，如 A,C,D
- 判断题：正确输出 A，错误输出 B

【绝对禁止】
- 禁止输出任何解释、分析、标点符号以外的内容
- 禁止在字母前后添加任何文字
- 禁止输出类似"答案是A"或"选D"的表述`;

        const userPrompt = `这是一道${typeDesc}。请仔细查看截图中的题目和选项内容，然后严格按照格式要求输出答案。`;

        const apiKey = CONFIG.apiKey || document.getElementById('yt-api-key').value;
        if (!apiKey) throw new Error('请先设置API Key');

        // 提取base64数据（去掉data:image/png;base64,前缀）
        const base64Data = imageDataUrl.split(',')[1];

        const response = await fetch(`${CONFIG.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': apiKey,
            },
            body: JSON.stringify({
                model: CONFIG.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: userPrompt },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:image/png;base64,${base64Data}`,
                                },
                            },
                        ],
                    },
                ],
                max_completion_tokens: 100,
                temperature: 0.1,
                thinking: { type: 'disabled' },
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API错误 ${response.status}: ${errText.substring(0, 200)}`);
        }

        const data = await response.json();
        return data.choices[0].message.content.trim();
    }

    function parseAnswer(answerText, questionType) {
        const upper = answerText.toUpperCase().trim();
        addLogLine(`AI原始返回: "${answerText}"`, 'ai');

        // 策略1: 直接匹配纯字母答案（如 "A" / "B,C"）
        const pureMatch = upper.match(/^[A-D](,[A-D])*$/);
        if (pureMatch) {
            const letters = upper.match(/[A-D]/g);
            if (questionType === 'MultipleChoice' || questionType === 'multiple') {
                return [...new Set(letters)].sort();
            }
            return [letters[0]];
        }

        // 策略2: 匹配 "答案: A" / "正确答案是D" / "选B" / "选项C" 等模式
        const patterns = [
            /(?:正确)?答案[是为：:]\s*([A-D])/i,
            /选[选项择]?\s*([A-D])/i,
            /[\(（]\s*([A-D])\s*[\)）]/,
            /选项\s*([A-D])/i,
            /应该?选[择]?\s*([A-D])/i,
        ];
        for (const pat of patterns) {
            const m = upper.match(pat);
            if (m && m[1]) {
                addLogLine(`通过模式匹配到答案: ${m[1]}`, 'info');
                if (questionType === 'MultipleChoice' || questionType === 'multiple') {
                    const all = upper.match(/[A-D]/g) || [];
                    return [...new Set(all)].sort();
                }
                return [m[1]];
            }
        }

        // 策略3: 从整个文本中提取所有A-D字母，取第一个
        const letters = upper.match(/[A-D]/g);
        if (letters && letters.length > 0) {
            addLogLine(`从文本中提取到字母: ${letters.join(',')}`, 'warning');
            if (questionType === 'MultipleChoice' || questionType === 'multiple') {
                return [...new Set(letters)].sort();
            }
            return [letters[0]];
        }

        // 策略4: 如果完全没有字母，尝试匹配常见的中文判断词
        if (questionType === 'TrueOrFalse' || questionType === 'judge') {
            if (/正确|对|是|真|true|T/i.test(upper)) return ['A'];
            if (/错误|错|否|假|false|F/i.test(upper)) return ['B'];
        }

        return [];
    }

    // ==================== UI 交互 ====================
    function getCurrentOptions() {
        // 检测当前题目是单选题(radio)还是多选题(checkbox)
        const radios = document.querySelectorAll('.el-radio.homeworkElRadio');
        if (radios.length > 0) return { type: 'radio', elements: radios };
        const checkboxes = document.querySelectorAll('.el-checkbox');
        if (checkboxes.length > 0) return { type: 'checkbox', elements: checkboxes };
        // 兜底：用通用的选项容器
        const allOptions = document.querySelectorAll('.el-radio, .el-checkbox, [class*="option"]');
        if (allOptions.length > 0) return { type: 'auto', elements: allOptions };
        return { type: 'none', elements: [] };
    }

    function isQuestionSubmitted() {
        const options = getCurrentOptions();
        if (options.type === 'none' || options.elements.length === 0) return false;
        const first = options.elements[0];
        return first.classList.contains('is-disabled') || first.classList.contains('is-checked');
    }

    async function clickOption(answerLetter, questionType) {
        const idx = answerLetter.charCodeAt(0) - 65;
        const options = getCurrentOptions();

        if (options.type === 'none' || options.elements.length === 0) {
            throw new Error(`选项${answerLetter}不存在（找不到选项元素）`);
        }
        if (idx < 0 || idx >= options.elements.length) {
            throw new Error(`选项${answerLetter}不存在（共${options.elements.length}个选项）`);
        }

        const target = options.elements[idx];
        const label = target.querySelector('label') || target.querySelector('input') || target;
        label.click();
        await sleep(300);

        const typeLabel = options.type === 'checkbox' ? ' (多选)' : (options.type === 'radio' ? ' (单选)' : '');
        addLogLine(`已选择选项 ${answerLetter}${typeLabel}`, 'info');
        return true;
    }

    async function clickSubmit() {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            const text = btn.textContent.trim();
            if ((text === '提交' || text === 'submit') && !btn.disabled && !btn.classList.contains('is-disabled')) {
                btn.click();
                addLogLine('已点击提交按钮', 'success');
                await sleep(1500);
                return true;
            }
        }
        throw new Error('找不到可用的提交按钮');
    }

    async function navigateToQuestion(index) {
        const problemItem = document.querySelector(`.subject-item.J_order[data-order="${index}"]`);
        if (problemItem) {
            problemItem.click();
            await sleep(800);

            const options = getCurrentOptions();
            if (options.type === 'none' || options.elements.length === 0) {
                addLogLine(`第${index}题无选项，跳过`, 'warning');
                return 'submitted';
            }
            const first = options.elements[0];
            if (first.classList.contains('is-disabled')) {
                addLogLine(`第${index}题已提交，跳过`, 'info');
                return 'submitted';
            }
            return true;
        }
        return false;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==================== 课程模式：扫描学生日志页 ====================
    async function scanStudentLog() {
        addLogLine('正在扫描课程页面，获取所有习题链接...', 'info');

        const classroomId = getClassroomId();
        if (!classroomId) {
            addLogLine('无法获取课程ID', 'error');
            return [];
        }

        let activitySkuId = null;

        // 方法1：通过API获取活动列表（此API无需XTBZ）
        try {
            addLogLine('方法1: 调用活动列表API...', 'info');
            const resp = await fetch(`/v2/api/web/logs/learn/${classroomId}?actype=-1&page=0&offset=50&sort=-1`);
            const data = await resp.json();
            if (data.data && data.data.activities) {
                const activities = [];
                for (const act of data.data.activities) {
                    if (act.type === 15) {
                        const content = typeof act.content === 'string' ? safeParseJSON(act.content) : act.content;
                        const skuId = content.sku_id || act.sku_id;
                        activitySkuId = skuId;
                        activities.push({
                            courseware_id: act.courseware_id,
                            sku_id: skuId,
                            title: act.title || '未命名',
                            c_n: act.c_n || 0,
                            l_n: act.l_n || 0,
                        });
                    }
                }
                addLogLine(`API找到 ${activities.length} 个课件活动，共约 ${activities.reduce((s, a) => s + a.l_n, 0)} 个学习单元`, 'success');
                activities.forEach(a => {
                    addLogLine(`  - ${a.title} (${a.l_n}个单元, sku=${a.sku_id})`, 'info');
                });
            }
        } catch (e) {
            addLogLine('活动API调用失败: ' + e.message, 'warning');
        }

        // 方法2：尝试DOM方式——点击"线上学习"筛选，然后展开卡片
        addLogLine('方法2: 尝试DOM交互展开卡片...', 'info');
        try {
            // 点击"线上学习" radio
            const onlineLabels = document.querySelectorAll('label, span, .el-radio__label');
            let clicked = false;
            for (const el of onlineLabels) {
                if (el.textContent.trim() === '线上学习') {
                    const radio = el.closest('.el-radio') || el.parentElement || el;
                    radio.click();
                    clicked = true;
                    addLogLine('已点击"线上学习"筛选', 'info');
                    break;
                }
            }
            if (!clicked) {
                // 备用：查找所有radio并点击"线上学习"
                const radios = document.querySelectorAll('.el-radio');
                for (const r of radios) {
                    if (r.textContent.includes('线上学习')) {
                        r.click();
                        clicked = true;
                        addLogLine('已点击"线上学习"筛选(备用方式)', 'info');
                        break;
                    }
                }
            }
            if (clicked) {
                await sleep(2000);
            }
        } catch (e) {
            addLogLine('切换筛选失败: ' + e.message, 'warning');
        }

        // 等待内容加载后扫描DOM
        await sleep(1500);

        // 方法3：尝试点击"展开"按钮
        try {
            const expandEl = findTextInDOM('展开');
            if (expandEl) {
                expandEl.click();
                addLogLine('已点击"展开"按钮', 'info');
                await sleep(2000);
            } else {
                addLogLine('未找到"展开"按钮，可能卡片已展开', 'info');
            }
        } catch (e) {
            addLogLine('点击展开失败: ' + e.message, 'warning');
        }

        // 方法4：全面扫描DOM中的所有习题链接
        addLogLine('方法4: 全面扫描DOM中的习题链接...', 'info');
        const exerciseUrls = deepScanExerciseLinks(classroomId, activitySkuId);

        if (exerciseUrls.length > 0) {
            setCourseQueue(exerciseUrls);
            setCourseIndex(0);
            setCourseMode(true);
            addLogLine(`扫描完成！共找到 ${exerciseUrls.length} 个习题`, 'success');
            exerciseUrls.forEach((ex, i) => {
                addLogLine(`  ${i + 1}. ${ex.title}`, 'info');
            });
        } else {
            addLogLine('未找到习题链接', 'error');
            addLogLine('请尝试以下操作后重试：', 'warning');
            addLogLine('  1. 手动点击"线上学习"筛选', 'warning');
            addLogLine('  2. 手动点击"展开"按钮', 'warning');
            addLogLine('  3. 确保页面中显示了"学前必读"等课程卡片', 'warning');
        }

        return exerciseUrls;
    }

    // 安全解析JSON
    function safeParseJSON(str) {
        if (!str || typeof str !== 'string') return {};
        try { return JSON.parse(str); } catch (e) { return {}; }
    }

    // 在DOM中查找包含指定文本的元素
    function findTextInDOM(text) {
        const candidates = document.querySelectorAll('span, a, button, div, i, .el-link, [class*="expand"]');
        for (const el of candidates) {
            const t = el.textContent.trim();
            if (t === text && el.offsetHeight > 0) {
                return el;
            }
        }
        return null;
    }

    // 深度扫描习题链接
    function deepScanExerciseLinks(classroomId, skuId) {
        const exerciseUrls = [];
        const seen = new Set();

        // 1. 扫描所有 <a> 标签
        document.querySelectorAll('a[href]').forEach(a => {
            const href = a.href;
            if (href && href.includes('/exercise/') && !seen.has(href)) {
                seen.add(href);
                const title = (a.textContent || '').trim().substring(0, 80) || '未命名习题';
                exerciseUrls.push({
                    url: href.includes('?') ? href : href + '?hide_return=1',
                    title: title,
                    leaf_id: extractLeafId(href),
                    sku_id: skuId || extractSkuId(href),
                });
            }
        });

        // 2. 扫描带 data-url/data-href 属性的元素
        document.querySelectorAll('[data-url], [data-href]').forEach(el => {
            const url = el.getAttribute('data-url') || el.getAttribute('data-href');
            if (url && url.includes('/exercise/') && !seen.has(url)) {
                seen.add(url);
                const fullUrl = url.startsWith('http') ? url : 'https://www.yuketang.cn' + url;
                const title = (el.textContent || '').trim().substring(0, 80) || '未命名习题';
                exerciseUrls.push({
                    url: fullUrl.includes('?') ? fullUrl : fullUrl + '?hide_return=1',
                    title: title,
                    leaf_id: extractLeafId(url),
                    sku_id: skuId || extractSkuId(url),
                });
            }
        });

        // 3. 扫描Vue事件处理中的链接（内联onclick等）
        document.querySelectorAll('[onclick]').forEach(el => {
            const onclick = el.getAttribute('onclick') || '';
            const match = onclick.match(/['"]([^'"]*exercise[^'"]*)['"]/);
            if (match) {
                const path = match[1];
                const fullUrl = path.startsWith('http') ? path : 'https://www.yuketang.cn' + path;
                if (!seen.has(fullUrl)) {
                    seen.add(fullUrl);
                    const title = (el.textContent || '').trim().substring(0, 80) || '未命名习题';
                    exerciseUrls.push({
                        url: fullUrl.includes('?') ? fullUrl : fullUrl + '?hide_return=1',
                        title: title,
                        leaf_id: extractLeafId(path),
                        sku_id: skuId || extractSkuId(path),
                    });
                }
            }
        });

        // 4. 扫描所有可能包含习题链接的容器
        const containerSelectors = [
            '[class*="leaf"]', '[class*="chapter"]', '[class*="section"]',
            '[class*="courseware"]', '[class*="content"]', '[class*="tree"]',
            '.el-tree-node', '.el-collapse-item',
        ];
        containerSelectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(container => {
                container.querySelectorAll('a[href]').forEach(a => {
                    const href = a.href;
                    if (href && href.includes('/exercise/') && !seen.has(href)) {
                        seen.add(href);
                        const title = (a.textContent || '').trim().substring(0, 80) || '未命名习题';
                        exerciseUrls.push({
                            url: href.includes('?') ? href : href + '?hide_return=1',
                            title: title,
                            leaf_id: extractLeafId(href),
                            sku_id: skuId || extractSkuId(href),
                        });
                    }
                });
            });
        });

        return exerciseUrls;
    }

    function extractLeafId(url) {
        const m = url.match(/\/exercise\/\d+\/(\d+)\//);
        return m ? m[1] : null;
    }

    function extractSkuId(url) {
        const m = url.match(/\/exercise\/\d+\/\d+\/(\d+)/);
        return m ? m[1] : null;
    }

    async function goToNextExercise() {
        const queue = getCourseQueue();
        const idx = getCourseIndex();
        const nextIdx = idx + 1;

        if (nextIdx >= queue.length) {
            addLogLine('所有习题已完成！课程刷题结束！', 'success');
            setCourseMode(false);
            setCourseQueue([]);
            setCourseIndex(0);
            return false;
        }

        const next = queue[nextIdx];
        setCourseIndex(nextIdx);
        addLogLine(`\n=== 课程模式：跳转到第 ${nextIdx + 1}/${queue.length} 个习题 ===`, 'info');
        addLogLine(`标题: ${next.title}`, 'info');
        addLogLine(`3秒后跳转...`, 'info');

        await sleep(3000);
        window.location.href = next.url;
        return true;
    }

    async function scanAndStart() {
        const queue = await scanStudentLog();
        if (queue && queue.length > 0) {
            updateCourseUI();
            addLogLine('\n扫描完成！点击"开始刷课"开始自动答题', 'success');
            document.getElementById('yt-btn-course').style.display = 'block';
            document.getElementById('yt-btn-scan').style.display = 'none';
        }
    }

    async function startCourseMode() {
        const queue = getCourseQueue();
        const idx = getCourseIndex();

        if (queue.length === 0) {
            addLogLine('请先扫描课程习题', 'warning');
            return;
        }

        if (idx >= queue.length) {
            addLogLine('所有习题已完成', 'success');
            return;
        }

        // 如果当前不在第一个习题上，跳转到第一个
        const current = queue[idx];
        const expectedUrl = current.url;
        if (!location.href.includes(expectedUrl.replace('https://www.yuketang.cn', '').split('?')[0])) {
            addLogLine(`跳转到第 ${idx + 1} 个习题: ${current.title}`, 'info');
            window.location.href = expectedUrl;
            return;
        }

        // 在当前习题页面上开始答题
        setCourseMode(true);
        updateCourseUI();
        addLogLine(`课程模式：第 ${idx + 1}/${queue.length} 个习题`, 'info');
        await startAutoAnswer();
    }

    function updateCourseUI() {
        const infoEl = document.getElementById('yt-course-info');
        const scanBtn = document.getElementById('yt-btn-scan');
        const courseBtn = document.getElementById('yt-btn-course');
        const startBtn = document.getElementById('yt-btn-start');
        const titleEl = document.getElementById('yt-panel-title');

        if (isStudentLogPage()) {
            if (titleEl) titleEl.textContent = 'AI刷课 v5.2 (课程页)';
            if (scanBtn) scanBtn.style.display = 'block';
            if (startBtn) startBtn.style.display = 'none';
            if (courseBtn) courseBtn.style.display = 'none';
            return;
        }

        if (isCourseMode()) {
            const queue = getCourseQueue();
            const idx = getCourseIndex();
            if (titleEl) titleEl.textContent = 'AI刷课 v5.2 (课程模式)';
            if (infoEl) {
                infoEl.style.display = 'block';
                infoEl.textContent = `课程进度: ${idx + 1}/${queue.length} | ${queue[idx]?.title || ''}`;
            }
            if (courseBtn) {
                courseBtn.style.display = 'block';
                courseBtn.textContent = `继续刷课 (${idx + 1}/${queue.length})`;
            }
            if (startBtn) startBtn.style.display = 'none';
        } else {
            if (titleEl) titleEl.textContent = 'AI视' + '觉刷题 v5.2';
            if (infoEl) infoEl.style.display = 'none';
            if (courseBtn) courseBtn.style.display = 'none';
            if (startBtn) startBtn.style.display = 'block';
        }
    }
    async function startAutoAnswer() {
        if (STATE.isRunning) {
            addLogLine('已在运行中', 'warning');
            return;
        }

        const apiKey = document.getElementById('yt-api-key').value;
        if (!apiKey && !CONFIG.apiKey) {
            addLogLine('请先输入MiMo API Key', 'error');
            return;
        }
        CONFIG.apiKey = apiKey || CONFIG.apiKey;
        CONFIG.model = document.getElementById('yt-model').value || CONFIG.model;

        STATE.isRunning = true;
        STATE.answered = 0;
        STATE.stats = { correct: 0, wrong: 0, skipped: 0 };
        updateUIState(true);

        try {
            addLogLine('正在提取题目数据...', 'info');
            const exerciseData = getExerciseData();
            if (!exerciseData) throw new Error('无法提取题目数据');

            const problems = extractProblems(exerciseData);
            STATE.totalQuestions = problems.length;
            addLogLine(`找到 ${problems.length} 道题目`, 'success');

            const submitted = problems.filter(p => p.submitted);
            const unanswered = problems.filter(p => !p.submitted);
            addLogLine(`已提交: ${submitted.length} 题, 未答: ${unanswered.length} 题`, 'info');

            if (unanswered.length === 0) {
                addLogLine('所有题目已答完!', 'success');
                STATE.isRunning = false;
                updateUIState(false);
                return;
            }

            // 逐题作答
            for (const problem of unanswered) {
                if (!STATE.isRunning) {
                    addLogLine('用户停止运行', 'warning');
                    break;
                }

                addLogLine(`\n--- 第 ${problem.index} 题 (${problem.type}) ---`, 'info');

                // 导航到该题
                addLogLine(`导航到第 ${problem.index} 题...`, 'info');
                const navResult = await navigateToQuestion(problem.index);
                if (navResult === 'submitted') {
                    STATE.answered++;
                    updateProgress();
                    continue;
                }
                if (!navResult) {
                    addLogLine('导航失败，跳过此题', 'warning');
                    STATE.stats.skipped++;
                    continue;
                }

                await sleep(500);

                // 截图题目
                addLogLine('截取题目图片...', 'info');
                let imageDataUrl;
                try {
                    imageDataUrl = await captureQuestionArea();
                } catch (e) {
                    addLogLine('截图失败: ' + e.message, 'error');
                    STATE.stats.skipped++;
                    continue;
                }

                // 调用AI视觉识别
                let answer = null;
                for (let retry = 0; retry <= CONFIG.maxRetry; retry++) {
                    try {
                        if (retry > 0) {
                            addLogLine(`重试第 ${retry} 次...`, 'warning');
                            await sleep(1000);
                        }

                        const rawAnswer = await callMiMoVision(imageDataUrl, problem.type);
                        const parsed = parseAnswer(rawAnswer, problem.type);

                        if (parsed.length > 0) {
                            answer = parsed;
                            addLogLine(`AI视觉回答: ${answer.join(', ')} (原始: ${rawAnswer})`, 'ai');
                            break;
                        } else {
                            addLogLine(`AI返回无效答案: ${rawAnswer}`, 'warning');
                        }
                    } catch (e) {
                        addLogLine(`AI调用失败: ${e.message}`, 'error');
                        if (retry >= CONFIG.maxRetry) throw e;
                    }
                }

                if (!answer || answer.length === 0) {
                    addLogLine('无法获取有效答案，跳过此题', 'warning');
                    STATE.stats.skipped++;
                    continue;
                }

                // 点击答案并提交
                try {
                    for (const letter of answer) {
                        await clickOption(letter, problem.type);
                    }
                    await clickSubmit();
                    STATE.answered++;
                    updateProgress();
                    await sleep(500);
                } catch (e) {
                    addLogLine(`操作失败: ${e.message}`, 'error');
                    STATE.stats.skipped++;
                }

                await sleep(CONFIG.delayBetweenQuestions);
            }

            addLogLine('\n=== 答题完成 ===', 'success');
            addLogLine(`正确: ${STATE.stats.correct}, 错误: ${STATE.stats.wrong}, 跳过: ${STATE.stats.skipped}`, 'info');

            // 课程模式：自动跳转下一个习题
            if (isCourseMode()) {
                const queue = getCourseQueue();
                const idx = getCourseIndex();
                addLogLine(`\n课程进度: ${idx + 1}/${queue.length}`, 'info');
                await sleep(1000);
                await goToNextExercise();
            }

        } catch (e) {
            addLogLine(`运行出错: ${e.message}`, 'error');
            console.error(e);
        } finally {
            STATE.isRunning = false;
            updateUIState(false);
        }
    }

    function stopAutoAnswer() {
        STATE.isRunning = false;
        addLogLine('正在停止...', 'warning');
        updateUIState(false);
    }

    // ==================== 初始化 ====================
    function init() {
        createUI();

        if (isStudentLogPage()) {
            addLogLine('雨课堂AI刷课 v5.2 已加载（课程页）', 'success');
            addLogLine('点击"扫描课程习题"获取所有习题', 'info');
            updateCourseUI();
            return;
        }

        if (isExercisePage()) {
            addLogLine('雨课堂AI视觉刷题 v5.2 已加载', 'success');

            // 课程模式：自动恢复
            if (isCourseMode()) {
                updateCourseUI();
                const queue = getCourseQueue();
                const idx = getCourseIndex();
                if (queue.length > 0 && idx < queue.length) {
                    addLogLine(`课程模式：第 ${idx + 1}/${queue.length} 个习题`, 'info');
                    addLogLine('2秒后自动开始答题...', 'info');
                    setTimeout(() => {
                        startAutoAnswer();
                    }, 2000);
                }
            } else {
                updateCourseUI();
            }
        }

        addLogLine('提示: 设置API Key后点击"测试截图效果"验证截图是否正常', 'info');
        addLogLine('确认截图正常后点击"开始自动答题"', 'info');

        // 暴露API到全局
        window.__YT__ = {
            testScreenshot: testScreenshot,
            startAutoAnswer: startAutoAnswer,
            stopAutoAnswer: stopAutoAnswer,
            captureQuestionArea: captureQuestionArea,
            getProblems: () => extractProblems(getExerciseData()),
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2000));
    } else {
        setTimeout(init, 2000);
    }
})();
