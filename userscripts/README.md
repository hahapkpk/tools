# Userscripts

## Bilibili AV1 Buffer Boost

Tampermonkey userscript for smoother temporary 8x playback on Bilibili.

Install link:

https://raw.githubusercontent.com/hahapkpk/tools/main/userscripts/bilibili-av1-buffer-boost.user.js

Usage:

- Install Tampermonkey.
- Open the install link above.
- Confirm installation in Tampermonkey.
- Open a Bilibili video page.
- Hold the right arrow key, or long-press the left mouse button on the video, to request adaptive 8x playback.

The script monitors buffered seconds ahead. When the buffer is low, it temporarily drops to a safer catch-up speed. When the buffer becomes critical, it can briefly pause playback so Bilibili's own player can refill before continuing.

Version 0.3.0 includes an optional experimental `.m4s` prefetch layer. It is disabled by default:

```js
experimentalPrefetch: false
```

To try it, edit the userscript and change it to:

```js
experimentalPrefetch: true
```

The experimental layer observes Bilibili media requests, tries to infer nearby future `.m4s` URLs when the path has an incrementing number, and prefetches a small queue with low priority. This may help only on streams whose media requests are visible to page-level `fetch` and have predictable URLs.

This is still not guaranteed true multi-threaded player buffering. Bilibili playback depends on signed URLs, browser Media Source Extensions, range requests, CDN behavior, and the site player, so aggressive parallel fetching can fail or make playback less stable.
