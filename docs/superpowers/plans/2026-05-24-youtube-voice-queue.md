# YouTube Volcengine Voice Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Chinese voice-over lines from being cut off when the next subtitle appears.

**Architecture:** Keep the existing sentence-level subtitle cues and Volcengine audio cache. Replace per-cue interruption with a FIFO remote-audio queue; the default `natural` mode finishes queued lines, while `sync` mode drops not-yet-started lines whose subtitle window is already more than 1.5 seconds behind the video.

**Tech Stack:** Tampermonkey userscript, YouTube HTML5 video state, Volcengine TTS audio URLs, Node source checks, Kimi WebBridge verification.

---

### Task 1: Queue Contract And UI

**Files:**
- Modify: `scripts/test-youtube-captions-userscript.js`
- Modify: `github/tools/youtube-auto-zh-hans-captions.user.js`

- [ ] Add failing checks requiring `voiceSyncMode: 'natural'`, the `自然流畅` and `紧跟画面` choices, and remote voice queue helpers.
- [ ] Run `node scripts/test-youtube-captions-userscript.js`; verify the new checks fail on `v0.5.8`.
- [ ] Add the synchronization setting, selector row, and queue state without changing subtitle extraction.

### Task 2: Continuous Remote Audio Playback

**Files:**
- Modify: `github/tools/youtube-auto-zh-hans-captions.user.js`
- Mirror: `userscripts/youtube-auto-zh-hans-captions.user.js`

- [ ] Route subtitle speech through `enqueueVolcCue()` and `playNextVolcCue()` so a new cue does not call `cancelSpeech()` while earlier narration is playing.
- [ ] Drop queued, not-yet-started entries only in `sync` mode when current playback is over `1.5` seconds beyond their cue end.
- [ ] Keep hard cancellation for seeking, video changes, disabling dubbing, voice changes, and test playback.

### Task 3: Verify And Publish

**Files:**
- Modify: `github/tools/youtube-auto-zh-hans-captions.user.js`

- [ ] Run `node scripts/test-youtube-captions-userscript.js`, `node --check github/tools/youtube-auto-zh-hans-captions.user.js`, and `git -C github/tools diff --check`.
- [ ] Verify on the current YouTube page that the new script queues adjacent Volcengine cues without cancelling the current audio and exposes the new sync selector.
- [ ] Commit and push the userscript and this plan to `hahapkpk/tools`, then confirm the raw install URL reports `v0.5.9`.
