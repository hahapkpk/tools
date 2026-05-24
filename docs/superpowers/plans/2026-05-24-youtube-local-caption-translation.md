# YouTube Local Caption Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avoid YouTube automatic-translation rate limits by translating source captions locally while retaining Volcengine Chinese dubbing.

**Architecture:** The userscript selects a real Chinese caption track when available. Otherwise it fetches an original caption track without `tlang`, translates merged source cues through Chrome `Translator`, and sends the resulting Chinese cues through the existing subtitle and Volcengine TTS paths. A manually selected YouTube fallback remains isolated from the default local flow.

**Tech Stack:** Tampermonkey userscript, YouTube caption track data, Chrome Translator API, Volcengine TTS, Node-based source checks.

---

### Task 1: Protect The Default Caption Request Path

**Files:**
- Modify: `scripts/test-youtube-captions-userscript.js`
- Modify: `github/tools/youtube-auto-zh-hans-captions.user.js`

- [x] **Step 1: Write failing checks**

Add checks requiring `translationEngine: 'local'`, a manual `youtube` fallback option, and source selection that marks untranslated caption tracks for local translation instead of YouTube translation.

- [x] **Step 2: Run checks to verify failure**

Run: `node scripts/test-youtube-captions-userscript.js`

Expected: failure for local translation settings and default non-`tlang` flow.

- [x] **Step 3: Implement source selection and settings**

Add a translation engine setting and adapt `selectBestCaptionSource()` so true Chinese tracks remain direct, while original non-Chinese tracks choose either local translation by default or explicit YouTube fallback.

- [x] **Step 4: Run checks**

Run: `node scripts/test-youtube-captions-userscript.js`

Expected: new source/settings checks pass.

### Task 2: Translate Original Cues Through Chrome

**Files:**
- Modify: `scripts/test-youtube-captions-userscript.js`
- Modify: `github/tools/youtube-auto-zh-hans-captions.user.js`

- [x] **Step 1: Write failing checks**

Require `Translator.availability()`, `Translator.create()`, a user-triggered preparation button, download progress status, per-source-language translator reuse, and cue translation before Volcengine playback.

- [x] **Step 2: Run checks to verify failure**

Run: `node scripts/test-youtube-captions-userscript.js`

Expected: failure for missing Chrome translation pipeline.

- [x] **Step 3: Implement translation pipeline**

Add `prepareLocalTranslator()` for the panel button, `getLocalTranslator()` for reuse, and `translateCuesLocally()` to translate merged full sentences. Use source captions as bilingual secondary text and preserve the existing TTS consumer of Chinese cues.

- [x] **Step 4: Run checks**

Run: `node scripts/test-youtube-captions-userscript.js && node --check github/tools/youtube-auto-zh-hans-captions.user.js`

Expected: all checks pass and script syntax is valid.

### Task 3: Preserve Fallbacks, Cache Separation, And Publish

**Files:**
- Modify: `scripts/test-youtube-captions-userscript.js`
- Modify: `github/tools/youtube-auto-zh-hans-captions.user.js`
- Mirror: `userscripts/youtube-auto-zh-hans-captions.user.js`

- [x] **Step 1: Write failing checks**

Require source-specific cache kinds and a warning label for the manually selected YouTube automatic-translation fallback.

- [x] **Step 2: Implement fallback and cache behavior**

Continue reading legacy cached translated cues, save new local translations under a distinct source kind, and limit `tlang=zh-Hans`/native automatic-translation priming to explicit fallback mode.

- [x] **Step 3: Validate against YouTube**

Use Kimi WebBridge on an English-caption video and confirm the default flow requests original caption data only, presents local translator preparation if required, and continues exposing Volcengine controls.

- [ ] **Step 4: Publish**

Run: `node scripts/test-youtube-captions-userscript.js && node --check github/tools/youtube-auto-zh-hans-captions.user.js && git -C github/tools diff --check`

Commit only the plan and userscript changes intended for publication, push `main`, and verify the raw install URL exposes the new version.
