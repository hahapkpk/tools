#!/usr/bin/env python3
"""Aggregate public M3U playlists for a car Android IPTV player. No GitHub PAT required."""
from __future__ import annotations

import concurrent.futures
import datetime as dt
import ipaddress
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, OrderedDict

from streamcheck import validate_stream
from pathlib import Path

SOURCES = [
    ("OrangeWay520", "https://raw.githubusercontent.com/OrangeWay520/my-iptv/master/my_channels.m3u"),
    ("Lightconer", "https://raw.githubusercontent.com/Lightconer/TVBox-Sources/main/output/live.m3u"),
    ("Chaniug", "https://raw.githubusercontent.com/Chaniug/IPTV-Collector/master/iptv-cn.m3u"),
    ("iptv-org", "https://iptv-org.github.io/iptv/countries/cn.m3u"),
]
OUTPUT = Path(__file__).resolve().parent
MAX_BYTES = 9_000_000
MAX_PER_CHANNEL = 4
USER_AGENT = "mytv-car-playlist-updater/1.0 (+GitHub Actions)"
ATTRIBUTE = re.compile(r'([a-zA-Z0-9_-]+)="([^"]*)"')
SENSITIVE_KEYS = {"token", "access_token", "apikey", "api_key", "password", "passwd", "secret", "signature", "session", "authorization", "key", "auth", "sign", "sig", "pwd"}


def safe_url(url: str) -> bool:
    try:
        parts = urllib.parse.urlsplit(url.strip())
        if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
            return False
        if parts.username or parts.password or parts.hostname.lower() == "localhost":
            return False
        try:
            ip = ipaddress.ip_address(parts.hostname)
            if not ip.is_global or ip.version != 4:
                return False
        except ValueError:
            if parts.hostname.lower().endswith((".local", ".internal", ".localhost")):
                return False
        if any(k.lower() in SENSITIVE_KEYS for k, _ in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)):
            return False
        if parts.path.lower().endswith((".html", ".htm", ".mp4", ".mkv", ".mpd", ".flv")):
            return False
        return True
    except (ValueError, TypeError):
        return False


def normalize_name(name: str) -> str:
    name = re.sub(r"[\r\n\x00-\x1f]", "", name).strip()
    name = re.sub(r"\s+", " ", name)
    m = re.fullmatch(r"(?i)CCTV[\s-]*(\d{1,2})(?:\s*(?:HD|高清|超清|4K))?(?:\s*\([^)]{1,40}\))?", name)
    if m:
        return "CCTV-" + str(int(m.group(1)))
    return name[:70]


def group_for(name: str, original: str) -> str:
    if re.search(r"(?i)CCTV|CGTN|CETV|央视频道|央视台", name + original):
        return "央视频道"
    if "卫视" in name or "卫视频道" in original:
        return "卫视频道"
    if re.search("地方|省市|城市|湖北|广东|浙江|江苏|湖南|山东|北京|上海", original):
        return "地方频道"
    return "其他频道"


def parse_m3u(text: str):
    if not text.lstrip("\ufeff \r\n").startswith("#EXTM3U"):
        raise ValueError("Not an M3U playlist")
    meta = None
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("#EXTINF:"):
            meta = line
        elif line and not line.startswith("#") and meta:
            url = line.strip()
            title = meta.split(",", 1)[-1].strip() if "," in meta else ""
            attrs = dict(ATTRIBUTE.findall(meta))
            meta = None
            name = normalize_name(title)
            if not name or len(name) < 2 or not safe_url(url):
                continue
            if "更新时间" in name or name in {"公告", "说明", "测试"}:
                continue
            group = group_for(name, attrs.get("group-title", ""))
            logo = attrs.get("tvg-logo", "")
            if not safe_url(logo) or not logo.startswith("https://"):
                logo = ""
            yield name, group, url, logo


def download(name: str, url: str):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/plain,*/*"})
    with urllib.request.urlopen(req, timeout=22) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("Playlist too large")
    rows = list(parse_m3u(body.decode("utf-8-sig", errors="replace")))
    if len(rows) < 8:
        raise ValueError("Too few eligible streams")
    return rows


def main():
    by_name = OrderedDict()
    reports = []
    for label, url in SOURCES:
        try:
            rows = download(label, url)
            reports.append({"source": label, "downloaded": len(rows), "status": "ok"})
        except Exception as exc:
            reports.append({"source": label, "status": "failed", "error": str(exc)[:180]})
            continue
        for name, group, stream, logo in rows:
            key = name.casefold()
            entry = by_name.setdefault(key, {"name": name, "group": group, "logo": logo, "urls": []})
            if not entry["logo"] and logo:
                entry["logo"] = logo
            if stream not in entry["urls"] and len(entry["urls"]) < MAX_PER_CHANNEL + 2:
                entry["urls"].append(stream)

    if len(by_name) < 8:
        raise RuntimeError("Insufficient source data; retaining previous playlist")

    candidates = list(dict.fromkeys(url for row in by_name.values() for url in row["urls"]))
    # Download actual HLS manifests and media segments. A 200 HEAD response alone
    # cannot establish stream playability or sufficient network throughput.
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        results = list(executor.map(lambda url: validate_stream(url, safe_url), candidates))
    results_by_url = dict(zip(candidates, results))
    rejected = Counter(result.reason for result in results if result.state != "verified")

    chosen = []
    stats = {"verified": 0, "rejected": sum(rejected.values())}
    ordering = {"央视频道": 0, "卫视频道": 1, "地方频道": 2, "其他频道": 3}
    for item in sorted(by_name.values(), key=lambda r: (ordering[r["group"]], r["name"])):
        urls = [u for u in item["urls"] if results_by_url[u].state == "verified"]
        # Fast starts first, then higher throughput; keep at most four tested lines.
        urls.sort(key=lambda u: (results_by_url[u].latency_ms, -results_by_url[u].speed_kib_s))
        for url in urls[:MAX_PER_CHANNEL]:
            chosen.append((item["name"], item["group"], item["logo"], url))
            stats["verified"] += 1

    # Guard against a widespread provider / GitHub runner outage. Keep the
    # last published playlist intact instead of replacing it with a tiny list.
    if len(chosen) < 15 or len({row[0] for row in chosen}) < 10:
        raise RuntimeError(
            f"Only {len(chosen)} verified lines; keeping previous playlist "
            f"(rejections: {dict(rejected.most_common(8))})"
        )

    lines = ["#EXTM3U", "# Only streams with media samples passing GitHub runner validation are included."]
    for name, group, logo, stream in chosen:
        clean = lambda t: str(t).replace('"', "").replace("\n", "").replace("\r", "")
        attrs = f'group-title="{clean(group)}"'
        if logo:
            attrs += f' tvg-logo="{clean(logo)}"'
        lines.append(f"#EXTINF:-1 {attrs},{clean(name)}")
        lines.append(stream)
    (OUTPUT / "live.m3u").write_text("\n".join(lines) + "\n", encoding="utf-8")
    status = {
        "updated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "channel_count": len({r[0] for r in chosen}),
        "stream_count": len(chosen),
        "verification": {
            **stats,
            "candidate_urls": len(candidates),
            "rejected_reasons": dict(rejected.most_common()),
            "min_speed_kib_s": 280,
            "max_start_latency_s": 4,
            "method": "HLS media-segment download / sample bytes + timing",
        },
        "sources": reports,
        "note": "Validated from the GitHub runner only. Mobile-carrier playability and geographic restrictions may differ.",
    }
    (OUTPUT / "status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(status, ensure_ascii=False))


if __name__ == "__main__":
    main()
