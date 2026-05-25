# YouTube Smart Dubbing And Terminology Design

## Scope

This increment completes the remaining requested dubbing improvements without changing the already working default playback mode. Progress status, manual catch-up, transient request retry, semantic voice cues, and credential testing remain in place.

## Smart Catch-Up

- Add an explicit `智能语速追赶` choice between `自然流畅` and `紧跟画面`.
- `自然流畅` remains the default and continues to play every sentence at normal audio playback speed.
- `智能语速追赶` never drops queued sentences. When the oldest narration item falls behind the video, the next audio segment plays slightly faster: normal up to `0.8` seconds lag, then bounded steps up to `1.18x` audio playback speed.
- This adjusts already generated audio using `HTMLAudioElement.playbackRate` with pitch preservation where supported. It avoids extra TTS requests and keeps latency stable.

## Queue Recovery

- Existing TTS request retry remains unchanged: one retry only for transient network, timeout, or server failures.
- Add handling for an audio element that raises a playback error after it has started loading. The failed item is released, a short status appears, and the next queued sentence is attempted.
- Token checks continue to prevent stale playback after seeking, switching videos, changing voice settings, or manual catch-up.

## Terminology Corrections

- Add a multiline `专有名词修正表` field under Volcengine settings.
- The format is one entry per line: `source=spoken form`, for example `Notion=诺申`.
- Empty lines and lines without a non-empty value are ignored. Matching is literal, case-insensitive for Latin words, and longer source terms are processed first.
- Corrections apply only to text sent to Volcengine synthesis. Displayed subtitles and exported subtitle files remain untouched.

## Verification

- Source checks require all three new behavior paths and version `0.5.12`.
- Syntax and diff validation run before publishing.
- Browser verification checks the new controls appear after installing the update and exercises status changes without exposing saved credentials.
