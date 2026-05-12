# iCloud Photos Web Uploader

Tampermonkey script for `https://www.icloud.com/photos`.

## Install

Open the raw script URL in a browser with Tampermonkey installed:

```text
https://raw.githubusercontent.com/hahapkpk/tools/main/icloud-photos-web-uploader.user.js
```

## Usage

1. Sign in to iCloud Photos in the browser.
2. Install and enable `icloud-photos-web-uploader.user.js`.
3. Open iCloud Photos.
4. Use the floating panel to pick images, drag images, or paste a screenshot.

The script does not store Apple ID credentials or call private iCloud APIs. It hands image files to the upload control already present on the iCloud Photos page.

If the panel says it cannot find the upload control, click the native iCloud upload button once and try again. Apple may change the page structure, so this script uses best-effort DOM detection.
