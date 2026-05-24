# YouTube Dubbing Stability Design

## Scope

This increment changes only Volcengine dubbing reliability and user control. It does not alter subtitle retrieval, local translation, automatic speaking speed, or translated terminology.

## Behavior

- A transient Volcengine request failure is retried once. Transient means a network error, request timeout, or HTTP `5xx`; authentication and client errors are returned immediately.
- If a sentence still cannot be synthesized, that sentence is skipped and the remaining queue continues.
- The Volcengine control panel shows narration state: idle/synchronized, waiting for audio, queued delay in seconds, retrying, or skipped sentence.
- An `立即追上` button cancels current remote narration and queued lines, resets the spoken marker, and allows narration to resume from the subtitle active at the current video position.

## Safety Rules

- Seeking, switching videos, disabling dubbing, changing voice settings, and testing a voice retain existing hard-cancel behavior.
- The retry count is fixed at one; no repeated loop can generate unbounded API traffic.
- This increment is published separately from automatic speed adjustment and glossary replacement so regression causes stay isolated.

## Verification

- Source checks require the retry classifier, one-retry wrapper, status row, catch-up action, and existing queue continuation behavior.
- Browser verification confirms the new controls render only for the Volcengine engine and that `立即追上` clears queued playback state without needing API credentials.
