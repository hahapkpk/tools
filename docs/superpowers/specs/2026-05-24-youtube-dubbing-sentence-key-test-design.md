# YouTube Dubbing Sentence And Key Test Design

## Scope

This increment adds a Volcengine credential test command and separates narration phrasing from visual subtitle layout. It does not implement automatic speaking speed or terminology replacement.

## Credential Test

- Add a `测试 Key` action in the Volcengine credential section.
- The button requests one short Chinese sample with the currently selected Volcengine voice.
- The button saves the values currently typed in the visible authentication fields and sends a fresh request, so an older audio cache cannot mask invalid credentials.
- Before the sample plays it clears active narration and queued lines; after the test ends, narration resumes from the subtitle currently on screen.
- Success shows `火山凭证正常，语音连接成功`; failures surface the existing precise request message such as HTTP status or timeout.

## Narration Segmentation

- Display cues remain unchanged so subtitles retain current two-line layout and timing.
- A separate narration cue array is derived from translated display cues.
- Narration does not split on visual line breaks or the display width limit.
- Narration completes a cue on sentence-ending punctuation, a pause longer than `1.2` seconds, or a safety maximum of `120` visible text units. The larger cap is required because the confirmed broken complete sentence is already close to 100 translated characters.
- The known broken example `我刚开始使用 Notion 的时候，主要把它` followed by `用于个人事务，并没有真正把它看作是一个开发者工具。` must become one narration request.
- On the active test video's `v6` caption cache, the new rule reduces `93` display cues to `50` narration cues and joins the confirmed broken example.

## Safety

- Existing queue, retry, `立即追上`, pause, seeking, and video-change cancellation continue to operate.
- Browser speech remains on the existing display cue path; the new sentence queue applies to Volcengine narration only.
