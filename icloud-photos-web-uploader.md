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

## Format handling

Apple says iCloud Photos stores originals in formats such as HEIF, JPEG, RAW, PNG, GIF, TIFF, HEVC, and MP4, but iCloud.com uploads from a computer to a personal library accept JPEG files.

For iCloud.com compatibility, this script keeps JPEG files unchanged and converts other browser-decodable image files to JPEG before handing them to iCloud's upload control. Transparent images are flattened onto a white background. If the browser cannot decode the source file, such as some HEIC/RAW files on Windows Chrome, the panel shows a conversion error instead of uploading a file iCloud.com may reject.
