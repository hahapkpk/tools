# YouTube Dubbing Sentence And Key Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide an explicit Volcengine connectivity test and eliminate unnatural mid-sentence voice breaks caused by display-oriented subtitle segmentation.

**Architecture:** Preserve existing subtitle cues for rendering and exports, while deriving a distinct `voiceCues` sequence for Volcengine playback with semantic sentence boundaries. Add a credential test action that uses the existing audio request/authentication path and then returns narration to the current video position.

**Tech Stack:** Tampermonkey userscript, Volcengine TTS, HTML5 audio/video, Node source checks, Kimi WebBridge.

---

### Task 1: Establish Failing Checks

**Files:**
- Modify: `scripts/test-youtube-captions-userscript.js`

- [x] Require version `0.5.11`, a `测试 Key` control and `testVolcCredentials()` function.
- [x] Require `voiceCues`, `mergeVoiceCues()`, semantic punctuation boundaries, a `120` text-unit safety cap, and Volcengine playback selection from `voiceCues`.
- [x] Run `node scripts/test-youtube-captions-userscript.js` and confirm the candidate checks fail before userscript edits.

### Task 2: Implement Credential Test

**Files:**
- Modify: `github/tools/youtube-auto-zh-hans-captions.user.js`

- [x] Add a credential-section button that invokes `testVolcCredentials()` after persisting the currently typed credential values.
- [x] Implement test playback using a fresh `requestVolcAudioWithRetry('这是火山语音连接测试。')` call, cancelling normal narration first, displaying the success or precise failure status, and calling `catchUpVolcNarration()` after the sample ends.

### Task 3: Implement Narration Cues

**Files:**
- Modify: `github/tools/youtube-auto-zh-hans-captions.user.js`
- Mirror: `userscripts/youtube-auto-zh-hans-captions.user.js`

- [x] Add `state.voiceCues` and derive it in `applyCues()` with `mergeVoiceCues(state.cues)`.
- [x] Implement `mergeVoiceCues()` so it ignores display newlines and width breaks, splitting only at sentence endings, pauses over `1.2` seconds, or a `120` text-unit maximum.
- [x] Route Volcengine `syncVoice()` selection through narration cues while leaving subtitle rendering and browser speech unchanged.

### Task 4: Verify And Publish

**Files:**
- Modify: `github/tools/youtube-auto-zh-hans-captions.user.js`
- Create: `github/tools/docs/superpowers/specs/2026-05-24-youtube-dubbing-sentence-key-test-design.md`
- Create: `github/tools/docs/superpowers/plans/2026-05-24-youtube-dubbing-sentence-key-test.md`

- [x] Run source checks, syntax validation, repository diff validation, and mirror hash comparison.
- [x] Run the new semantic joining rule against the actual YouTube video's current `v6` cache and assert the known half-sentence pair is merged; the new control's rendering is covered by the source check until the user updates the installed script.
- [ ] Commit only YouTube script and its documentation; push and confirm the raw installation URL exposes `v0.5.11`.
