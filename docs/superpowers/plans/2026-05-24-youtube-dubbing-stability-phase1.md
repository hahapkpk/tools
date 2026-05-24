# YouTube Dubbing Stability Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded Volcengine request recovery, visible queue state, and manual catch-up control without changing translation or speed.

**Architecture:** Extend the existing remote voice queue with status reporting and a single retry wrapper around Volcengine audio generation. Keep all hard-cancel entry points intact and expose a control-panel command that clears backlog and restarts narration from the currently visible subtitle.

**Tech Stack:** Tampermonkey userscript, Volcengine TTS API, HTML5 audio/video, Node source checks, Kimi WebBridge.

---

### Task 1: Establish Regression Checks

**Files:**
- Modify: `scripts/test-youtube-captions-userscript.js`

- [x] Add checks for a new release version, `isRetryableVolcError()`, `requestVolcAudioWithRetry()`, an `立即追上` button, and a `voiceProgressStatus` display.
- [x] Run `node scripts/test-youtube-captions-userscript.js`.
- [x] Confirm it reports failures for these missing symbols and labels before editing the userscript.

### Task 2: Add Bounded Request Recovery

**Files:**
- Modify: `github/tools/youtube-auto-zh-hans-captions.user.js`

- [x] Mark only timeouts, network failures, and HTTP `5xx` errors as retryable.
- [x] Add `requestVolcAudioWithRetry(text)` that attempts `requestVolcAudio(text)` once, reports `语音请求失败，正在重试...`, and attempts exactly one more time only for retryable failures.
- [x] Use the wrapper inside `getVolcAudioUrl()` so prefetch and active narration share the same bounded behavior.

### Task 3: Add Narration Status And Catch-Up Control

**Files:**
- Modify: `github/tools/youtube-auto-zh-hans-captions.user.js`
- Mirror: `userscripts/youtube-auto-zh-hans-captions.user.js`

- [x] Add a Volcengine-only row containing a status label and an `立即追上` button.
- [x] Update state during enqueue, synthesis wait, successful playback, queue completion, and final skip.
- [x] Implement `catchUpVolcNarration()` by cancelling remote audio and queue, resetting `spokenCueIndex`, updating status, then invoking `renderCurrentCue()` to enqueue only the current line.

### Task 4: Verify And Publish

**Files:**
- Modify: `github/tools/youtube-auto-zh-hans-captions.user.js`
- Create: `github/tools/docs/superpowers/specs/2026-05-24-youtube-dubbing-stability-design.md`
- Create: `github/tools/docs/superpowers/plans/2026-05-24-youtube-dubbing-stability-phase1.md`

- [x] Run `node scripts/test-youtube-captions-userscript.js`, `node --check github/tools/youtube-auto-zh-hans-captions.user.js`, and `git -C github/tools diff --check`.
- [x] Use Kimi WebBridge to load the candidate script on a separate YouTube test tab; verify the status row and `立即追上` control render and change queue state locally without requesting protected credentials.
- [ ] Commit and push this isolated first phase; verify the public installation URL exposes the new version and symbols.
