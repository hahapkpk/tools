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
- Hold the backquote key (`) to request adaptive 8x playback.

The script monitors buffered seconds ahead. When the buffer is too low, it temporarily drops to a safer catch-up speed, then resumes 8x after the buffer recovers.

This is safer than trying to force multi-threaded media segment fetching from a userscript. Bilibili playback depends on signed URLs, browser Media Source Extensions, range requests, CDN behavior, and the site player, so aggressive parallel fetching can fail or make playback less stable.
