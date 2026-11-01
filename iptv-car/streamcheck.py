#!/usr/bin/env python3
"""Real media probing for public IPTV sources (no HEAD-only false positives)."""
from __future__ import annotations

import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

USER_AGENT = "Mozilla/5.0 (compatible; mytv-car-stream-validator/2.0)"
MAX_MANIFEST = 180_000
SAMPLE_BYTES = 262_144
MIN_SAMPLE_BYTES = 48 * 1024
MIN_KIB_PER_SECOND = 280.0
MAX_FIRST_BYTE_SEC = 4.0
MAX_TOTAL_SEC = 9.0
SOCKET_TIMEOUT = 4.0
MAX_HLS_LEVELS = 3
MAX_SEGMENT_ATTEMPTS = 2

@dataclass(frozen=True)
class Result:
    state: str   # verified | rejected
    reason: str
    latency_ms: int = 0
    speed_kib_s: float = 0.0


def _opener(safe_url):
    class SafeRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            if not safe_url(newurl):
                raise ValueError("Unsafe redirect URL")
            return super().redirect_request(req, fp, code, msg, headers, newurl)
    return urllib.request.build_opener(SafeRedirect)


def _read(url, opener, *, limit, timeout=SOCKET_TIMEOUT, max_seconds=MAX_TOTAL_SEC):
    start = time.monotonic()
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "*/*",
                      "Range": f"bytes=0-{limit - 1}"}
    )
    with opener.open(req, timeout=timeout) as response:
        if response.status not in (200, 206):
            raise ValueError("Unexpected HTTP status")
        content_type = response.headers.get("Content-Type", "").lower()
        if "text/html" in content_type or "application/json" in content_type:
            raise ValueError("HTML/JSON instead of video")
        chunks = []
        size = 0
        first_byte = None
        while size < limit:
            if time.monotonic() - start > max_seconds:
                break
            part = response.read(min(32_768, limit - size))
            if not part:
                break
            if first_byte is None:
                first_byte = time.monotonic() - start
            chunks.append(part)
            size += len(part)
        elapsed = max(time.monotonic() - start, 0.001)
    return b"".join(chunks), first_byte or elapsed, elapsed, content_type


def _playlist_entries(text):
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return lines


def _variant_url(lines):
    variants = []
    for index, line in enumerate(lines[:-1]):
        if line.startswith("#EXT-X-STREAM-INF:"):
            width = 0
            m = re.search(r"RESOLUTION=(\d+)x(\d+)", line)
            if m:
                width = int(m.group(1))
            bitrate = 0
            m = re.search(r"BANDWIDTH=(\d+)", line)
            if m:
                bitrate = int(m.group(1))
            next_line = lines[index + 1]
            if not next_line.startswith("#"):
                variants.append((width, bitrate, next_line))
    if not variants:
        return None
    # Prefer at least SD/HD over UHD for weak mobile connections.
    variants.sort(key=lambda v: (v[0] > 1920, v[0] < 640, abs((v[1] or 2_500_000) - 2_500_000)))
    return variants[0][-1]


def _media_segment_urls(lines):
    segments = []
    for line in lines:
        if not line.startswith("#") and "://" not in line[:5]:
            segments.append(line)
    # Do not test the newest live-edge segment first; it may not exist yet.
    return list(reversed(segments[-3:-1])) + (segments[-1:] if len(segments) < 2 else [])


def _looks_like_media(data: bytes) -> bool:
    if data.startswith(b"FLV") or data.startswith(b"\x1a\x45\xdf\xa3"):
        return True
    if len(data) > 12 and data[4:8] in (b"ftyp", b"styp", b"moof", b"mdat"):
        return True
    # MPEG transport stream sync bytes at 188-byte packet boundaries.
    for offset in range(min(188, max(0, len(data) - 377))):
        if data[offset] == 0x47 and data[offset + 188] == 0x47 and data[offset + 376] == 0x47:
            return True
    return False


def validate_stream(url: str, safe_url) -> Result:
    """Download manifest + a video sample, reject failures/slow streams.

    This tests from GitHub's runner, not from the user's mobile provider.
    """
    if not safe_url(url):
        return Result("rejected", "unsafe_url")
    opener = _opener(safe_url)
    t0 = time.monotonic()
    try:
        current = url
        for _ in range(MAX_HLS_LEVELS):
            if not safe_url(current):
                return Result("rejected", "unsafe_child")
            data, latency, elapsed, ctype = _read(current, opener, limit=MAX_MANIFEST)
            if data.lstrip().startswith((b"<html", b"<!DOCTYPE", b"{")):
                return Result("rejected", "not_video")
            if not data.startswith(b"#EXTM3U"):
                return _rate_media(data, latency, elapsed)
            lines = _playlist_entries(data.decode("utf-8-sig", errors="replace"))
            if "#EXT-X-ENDLIST" in lines:
                return Result("rejected", "not_live")
            variant = _variant_url(lines)
            if variant:
                current = urllib.parse.urljoin(current, variant)
                continue
            if not any(x.startswith("#EXT-X-TARGETDURATION:") for x in lines):
                return Result("rejected", "not_hls")
            segment_urls = _media_segment_urls(lines)
            if not segment_urls:
                return Result("rejected", "no_segments")
            last_reason = "segment_failed"
            for segment in segment_urls[:MAX_SEGMENT_ATTEMPTS]:
                segment_url = urllib.parse.urljoin(current, segment)
                if not safe_url(segment_url):
                    last_reason = "unsafe_child"
                    continue
                try:
                    sample, seg_latency, seg_elapsed, seg_ctype = _read(
                        segment_url, opener, limit=SAMPLE_BYTES
                    )
                    answer = _rate_media(sample, seg_latency, seg_elapsed)
                    if answer.state == "verified":
                        return answer
                    last_reason = answer.reason
                except Exception:
                    last_reason = "segment_failed"
            return Result("rejected", last_reason)
        return Result("rejected", "nested_playlist")
    except urllib.error.HTTPError as exc:
        return Result("rejected", f"http_{exc.code}")
    except TimeoutError:
        return Result("rejected", "timeout")
    except Exception as exc:
        return Result("rejected", "fetch_error")


def _rate_media(data: bytes, latency: float, elapsed: float) -> Result:
    if len(data) < MIN_SAMPLE_BYTES:
        return Result("rejected", "short_sample")
    if not _looks_like_media(data):
        return Result("rejected", "invalid_media")
    speed = len(data) / 1024 / max(elapsed, 0.001)
    if latency > MAX_FIRST_BYTE_SEC:
        return Result("rejected", "high_latency", round(latency * 1000), round(speed, 1))
    if elapsed > MAX_TOTAL_SEC or speed < MIN_KIB_PER_SECOND:
        return Result("rejected", "slow", round(latency * 1000), round(speed, 1))
    return Result("verified", "ok", round(latency * 1000), round(speed, 1))
