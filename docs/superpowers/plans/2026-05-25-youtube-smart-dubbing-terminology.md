# YouTube Smart Dubbing And Terminology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional adaptive catch-up playback, audio-error queue recovery, and a Volcengine-only terminology correction table.

**Architecture:** Keep subtitle display and existing normal narration intact. Extend only the Volcengine playback path: a selectable playback-rate policy, a small recovery helper for audio failures, and a persisted text transformation immediately before synthesis.

**Tech Stack:** Tampermonkey userscript, Volcengine TTS, HTML5 audio/video, Node source checks, Kimi WebBridge.

---

### Task 1: Establish Failing Checks

**Files:**
- Modify: `scripts/test-youtube-captions-userscript.js`

- [x] Require version `0.5.12`, a selectable `智能语速追赶` mode with bounded playback-rate calculation, an audio playback error recovery helper, and a persisted terminology correction control.
- [x] Run `node scripts/test-youtube-captions-userscript.js` and confirm the new checks fail before production edits.

### Task 2: Add Smart Catch-Up And Audio Recovery

**Files:**
- Modify: `github/tools/youtube-auto-zh-hans-captions.user.js`

- [x] Add the `智能语速追赶` sync option and a bounded `getVolcPlaybackRate()` function.
- [x] Apply that rate only to queued Volcengine audio playback; keep `自然流畅` and voice tests unaffected.
- [x] Add an audio-error recovery handler that releases failed playback and continues the queue with a visible status.

### Task 3: Add Voice-Only Terminology Corrections

**Files:**
- Modify: `github/tools/youtube-auto-zh-hans-captions.user.js`
- Mirror: `userscripts/youtube-auto-zh-hans-captions.user.js`

- [x] Store a multiline terminology string in settings and expose it in the Volcengine panel.
- [x] Parse valid `source=spoken form` lines and apply replacements only when constructing synthesized narration text.
- [x] Keep subtitle display, cache, and exports unchanged.

### Task 4: Verify And Publish

**Files:**
- Modify: `github/tools/youtube-auto-zh-hans-captions.user.js`
- Create: `docs/superpowers/specs/2026-05-25-youtube-smart-dubbing-terminology-design.md`
- Create: `docs/superpowers/plans/2026-05-25-youtube-smart-dubbing-terminology.md`

- [x] Run source checks, syntax validation, repository diff validation, and mirror hash comparison.
- [x] Temporarily load the candidate script in a separate real YouTube tab through Kimi WebBridge and verify the new mode, terminology control, and existing progress/catch-up controls render without calling the protected API.
- [ ] Commit the YouTube script and records, push `main`, and confirm the raw installation URL exposes `v0.5.12`.
