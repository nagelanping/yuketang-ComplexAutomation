# AGENTS.md

This file gives coding agents the project-specific rules for this repository.

## Project

雨课堂复合自动化 userscript，单文件交付：

- Main source: `yuketang-ComplexAutomation.user.js`
- Prompt source for AI answering: `SystemPrompt.md`
- Reference-only code: `ref/`

The userscript runs as an IIFE on `*.yuketang.cn` pages at `@run-at document-start`.
There is no build system, package manager, bundled test framework, or generated artifact.
Development means editing the `.user.js` file directly and validating in a browser userscript manager.

Do not modify `ref/` as project source. Treat it only as audit/comparison material.

## Required Checks

- Syntax check after JS edits:
  `node --check yuketang-ComplexAutomation.user.js`
- Runtime validation is manual:
  install/update the userscript in Tampermonkey or a compatible manager, open a 雨课堂 course catalog page, start from the script panel, and inspect browser Console plus panel logs.

If a task changes only docs or prompts, say whether `node --check` was unnecessary.

## Versioning

The only release version source is the userscript header:

- Search keyword: `@version`
- `Config.version` reads `GM_info.script.version`
- Do not hardcode a second version elsewhere
- Versions inside `ref/` are unrelated

## Code Navigation

Use search keywords instead of fixed line numbers. Line numbers drift in this single large file.
Prefer `rg -n` locally; `grep -n` is also fine when documenting commands.

Useful anchors:

- Header/version/connects:
  `rg -n "@version|@connect|@require" yuketang-ComplexAutomation.user.js`
- Startup chain:
  `rg -n "function boot|function start|function createPanel" yuketang-ComplexAutomation.user.js`
- Core singletons:
  `rg -n "const Config|const Utils|const Store|const FailGate|const PauseGate|const Player|const AiWorkspace|const Solver" yuketang-ComplexAutomation.user.js`
- Route runners:
  `rg -n "class V2Runner|class ProOldRunner|class ProNewRunner|class AiWorkspaceRunner" yuketang-ComplexAutomation.user.js`
- V2 traversal and return behavior:
  `rg -n "async run\\(\\)|returnToList|handleBatch|handleVideo|handleHomework|handleCourseware" yuketang-ComplexAutomation.user.js`
- Completion-state logic:
  `rg -n "getCompletionState|isProgressDone|statistics-box \\.aside" yuketang-ComplexAutomation.user.js`
- FailGate usage:
  `rg -n "FailGate\\.|ykt_fail_counts|clearPendingAutoStart" yuketang-ComplexAutomation.user.js`
- AI answering pipeline:
  `rg -n "captureQuestionImage|askAI|autoSelectAndSubmit|detectQuestionType|getOptionElements|buildPrompt" yuketang-ComplexAutomation.user.js`

When writing project docs or explanations, cite these keywords/commands rather than line numbers.

## Architecture

Startup chain:

`boot()` -> skip iframe -> `createPanel()` -> load `pendingAutoStart` -> `start()` route dispatch.

Route dispatch in `start()`:

- `/ai-workspace/lms-graph/*` -> `AiWorkspaceRunner`
- `/v2/web/*` -> `V2Runner`, but only when `.logs-list` exists; content pages are either handed to `AiWorkspaceRunner` when a V2 content route is recognized, or rejected to avoid starting the catalog loop on the wrong page
- `/pro/lms/*` -> `.btn-next` selects `ProNewRunner`; otherwise `ProOldRunner`

The UI panel is created inside `createPanel()`. It owns visible controls, AI config form, feature toggles, logs, start/pause/reset actions, and the clear-failure action.

## V2 Execution Model

V2 is intentionally DOM-progress-driven. Do not add a persistent index cursor.

Each `V2Runner.run()` pass:

1. Calls `autoSlide()` to trigger lazy loading.
2. Scans top-level `.logs-list` children in DOM order.
3. Picks the first item whose `getCompletionState(...)` is not `completed` and whose FailGate key is neither skipped nor exhausted.
4. Dispatches one handler.
5. Handler processes one item and usually calls `returnToList()`.
6. `returnToList()` navigates back to the catalog URL, causing a full page reload.
7. `boot()` sees matching `pendingAutoStart` and restarts the loop.

This means progress advances because the server-side DOM status changes after reload, not because the script remembers "the next index".

Startup writes `{classroomId, returnUrl}` into `pendingAutoStart`. It records where to resume, not which item to resume from.

## Completion State

`getCompletionState(statusText)` classifies status text into:

- `completed`
- `in_progress`
- `not_started`

Ordering matters:

- Fractions first: `N/N` means completed; `N/M` with `N < M` means in progress; `0/M` means not started.
- Percentages next: `100%` means completed; other percentages mean in progress.
- Text last: `已完成` / `已读` means completed; `进行中` means in progress; other text defaults to not started.

This priority handles mixed UI text such as `1% 进行中` or `3/6 进行中`.

## Batch Sections

Batch sections are top-level list nodes whose content lives partly outside the inner `section`.

Important selector rule:

- `handleBatch(listNode, parentFailKey)` receives the `.logs-list` child node.
- The expand button is inside `section`.
- The child list `.leaf_list__wrap` is a descendant of the list node, not necessarily a descendant of `section`.

Batch handling also advances only one unfinished child item per pass, then returns control to the reload/rescan model. Do not convert it into a multi-item in-memory loop unless the whole V2 execution model is intentionally redesigned.

## FailGate

`FailGate` is a sessionStorage dead-loop guard, not progress storage.

- Storage key: `ykt_fail_counts`
- `key(...parts)` builds stable classroom/title/index keys.
- `bump(key)` increments attempts before entering an item.
- `exhausted(key)` skips after `maxAttempts`.
- `skip(key)` marks deliberate skips such as exams, unknown types, or disabled homework.
- `skipped(key)` checks deliberate skip state.
- `reset(key)` clears parent counts when a batch child made real progress.
- `clear()` is wired to the panel clear-failure action together with `Store.clearPendingAutoStart()`.

Use sessionStorage behavior deliberately: closing the tab clears it. Do not use FailGate to remember course progress across sessions.

## Feature Modes

Feature flags live in `Store.getFeatureConf()`.

When `autoAI === false`, the V2 scanner enters pure media mode:

- top-level homework-like items are ignored before entering them
- homework children inside batch sections are ignored at the child level
- media, audio, courseware, and relevant batch sections still run

Do not make disabled homework cause page entry or reload loops.

## Player

`Player` centralizes video/audio behavior:

- playback rate
- mute/default media setup
- start/play-from-beginning helpers
- pause observation
- end/progress waits

For V2 video startup, preserve the current pattern: `observePause` clicks the large `.play-btn-tip` style UI and calls `video.play()`. Avoid replacing it with only a raw `media.play()`, because the site player often needs UI interaction.

## Solver

`Solver` handles screenshot-based multimodal answering.

Main flow:

1. Capture question image with `html2canvas`.
2. Fall back to SVG `foreignObject` capture when needed.
3. Detect question type.
4. Parse visible option containers/elements through layered selectors.
5. Call an OpenAI-compatible multimodal API through `GM_xmlhttpRequest`.
6. Parse the model response and select/submit answers.

API behavior:

- Endpoint normalization supports `/chat/completions` and `/responses`.
- Auth header selection supports `auto`, `bearer`, `x-api-key`, and `api-key`.
- Thinking/reasoning options and streaming are configurable.
- Manual max tokens are honored; automatic max tokens are larger when thinking is enabled.

The canonical answer prompt is `SystemPrompt.md`. If answer behavior changes, inspect and update that file as needed. The expected final model content is pure JSON like:

`{"type":"choice|multiple|truefalse|fillblank","answers":["A"]}`

## Editing Rules

- Keep the project single-file unless the user explicitly asks for a structural change.
- Keep comments concise and useful.
- Preserve GPL-3.0-only headers and SPDX identifiers when adding source files.
- When adding a new AI provider domain, check userscript metadata near `@connect`; current metadata also includes wildcard `@connect *`.
- Before changing DOM selectors, identify the target route first: V2, Pro, and ai-workspace structures differ.
- Preserve the V2 invariant: handler either returns to the catalog/reload flow or explicitly continues scanning. Do not introduce localStorage progress cursors.
- When a change affects behavior, architecture, validation, routing, storage keys, AI flow, selectors, or other content described in this file, update the matching `AGENTS.md` section in the same change.
- Do not edit `ref/` as part of delivery.

## Common Pitfalls

- Starting `V2Runner` on a content page can create wrong loops. The `.logs-list` guard is intentional.
- Batch child selectors scoped only under `section` will miss `.leaf_list__wrap`.
- Treating `进行中` as unfinished without checking fractions/percentages first can misclassify mixed status strings.
- Retrying an item without FailGate can create infinite reload loops.
- Marking skipped items as failed causes noisy false warnings; use `FailGate.skip()` for deliberate skips.
