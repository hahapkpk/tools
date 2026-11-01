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
MAX_PRIORITY_CANDIDATES = 18
# Program order is the on-screen order, NOT an alphabetical sort.
FOCUS_CHANNELS = [
    "CCTV-1", "CCTV-13", "CCTV-2", "CCTV-3", "CCTV-4", "CCTV-5",
    "CCTV-5+", "CCTV-6", "CCTV-7", "CCTV-8", "CCTV-9", "CCTV-10",
    "CCTV-11", "CCTV-12", "CCTV-14", "CCTV-15", "CCTV-16", "CCTV-17",
    "湖南卫视", "浙江卫视", "江苏卫视", "东方卫视",
    "北京卫视", "广东卫视", "山东卫视", "安徽卫视", "湖北卫视",
    "深圳卫视", "天津卫视", "四川卫视", "重庆卫视", "辽宁卫视",
]
CRITICAL_CHANNELS = ("CCTV-1", "CCTV-13")
NON_DEFINITIVE_FAILURES = {
    "slow", "fetch_error", "segment_failed", "timeout", "http_403",
    "high_latency", "short_sample"
}

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
    m = re.fullmatch(r"(?i)CCTV[\s-]*5\+(?:\s*(?:HD|高清|超清))?(?:\s*\([^)]{1,40}\))?", name)
    if m:
        return "CCTV-5+"
    m = re.fullmatch(r"(?i)CCTV[\s-]*(\d{1,2})(?:\s*(?:HD|高清|超清|4K))?(?:\s*\([^)]{1,40}\))?", name)
    if m:
        return "CCTV-" + str(int(m.group(1)))
    aliases = {
        "上海东方卫视": "东方卫视",
        "东方卫视高清": "东方卫视",
        "Guangdong Satellite TV": "广东卫视",
        "Hunan Satellite TV": "湖南卫视",
        "Zhejiang Satellite TV": "浙江卫视",
        "Jiangsu Satellite TV": "江苏卫视",
    }
    cleaned = re.sub(r"(?:高清|超清|HD)$", "", name).strip()
    return aliases.get(cleaned, cleaned)[:70]


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
            if name not in FOCUS_CHANNELS:
                continue
            key = name.casefold()
            entry = by_name.setdefault(key, {"name": name, "group": group, "logo": logo, "urls": []})
            if not entry["logo"] and logo:
                entry["logo"] = logo
            if stream not in entry["urls"] and len(entry["urls"]) < MAX_PRIORITY_CANDIDATES:
                entry["urls"].append(stream)

    if not all(c.casefold() in by_name for c in CRITICAL_CHANNELS):
        raise RuntimeError("Upstream missing CCTV-1 or CCTV-13; retaining previous playlist")

    candidates = list(dict.fromkeys(url for row in by_name.values() for url in row["urls"]))
    # Download actual HLS manifests and media segments. A 200 HEAD response alone
    # cannot establish stream playability or sufficient network throughput.
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        results = list(executor.map(lambda url: validate_stream(url, safe_url), candidates))
    results_by_url = dict(zip(candidates, results))
    rejected = Counter(result.reason for result in results if result.state != "verified")

    def rank_good(url):
        result = results_by_url[url]
        return result.latency_ms, -result.speed_kib_s

    def pick_lines(item):
        good = sorted((u for u in item["urls"] if results_by_url[u].state == "verified"),
                      key=rank_good)[:MAX_PER_CHANNEL]
        if item["name"] not in CRITICAL_CHANNELS or len(good) >= 2:
            return good, []
        # Overseas GitHub hosts can falsely reject mainland-carrier streams.
        # Never mark these as verified. Retain a few *unverified* trial routes
        # only for the two most important CCTV channels.
        trials = [u for u in item["urls"]
                  if u not in good and results_by_url[u].reason in NON_DEFINITIVE_FAILURES]
        trials.sort(key=lambda u: (
            {"http_403": 0, "slow": 1, "high_latency": 2, "timeout": 3,
             "short_sample": 4, "segment_failed": 5, "fetch_error": 6}.get(
                 results_by_url[u].reason, 8),
            0 if u.startswith("https://") else 1,
        ))
        fallback = []
        used_hosts = {urllib.parse.urlsplit(u).hostname for u in good}
        for url in trials:
            host = urllib.parse.urlsplit(url).hostname
            if host in used_hosts:
                continue
            fallback.append(url)
            used_hosts.add(host)
            if len(good) + len(fallback) >= MAX_PER_CHANNEL:
                break
        return good, fallback

    def render_m3u(rows, detail):
        lines = ["#EXTM3U", "# " + detail]
        for name, group, logo, stream, tested in rows:
            clean = lambda t: str(t).replace('"', "").replace("\n", "").replace("\r", "")
            tag = group if tested else "常看央视（待车机验证）"
            attrs = f'group-title="{clean(tag)}"'
            if logo:
                attrs += f' tvg-logo="{clean(logo)}"'
            lines.append(f"#EXTINF:-1 {attrs},{clean(name)}")
            lines.append(stream)
        return "\n".join(lines) + "\n"

    chosen = []
    verified = []
    per_channel = {}
    for name in FOCUS_CHANNELS:
        item = by_name.get(name.casefold())
        if item is None:
            per_channel[name] = {"verified": 0, "unverified_fallback": 0}
            continue
        good, trial = pick_lines(item)
        group = "常看央视" if name in CRITICAL_CHANNELS else (
            "央视频道" if name.startswith("CCTV-") else "常看卫视"
        )
        for url in good:
            line = (name, group, item["logo"], url, True)
            chosen.append(line)
            verified.append(line)
        for url in trial:
            chosen.append((name, group, item["logo"], url, False))
        per_channel[name] = {"verified": len(good), "unverified_fallback": len(trial)}

    if not all(per_channel.get(c, {}).get("verified", 0) +
               per_channel.get(c, {}).get("unverified_fallback", 0) > 0
               for c in CRITICAL_CHANNELS):
        raise RuntimeError("CCTV-1 or CCTV-13 missing, keeping previous playlist")
    if len(verified) < 5 or len({x[0] for x in chosen}) < 6:
        raise RuntimeError(f"Only {len(verified)} verified lines, keeping previous playlist")

    # "live.m3u" is the preexisting car subscription URL: keep it stable.
    # "live-verified.m3u" is the alternative for strict verification only.
    (OUTPUT / "live.m3u").write_text(
        render_m3u(chosen, "CCTV-1 and CCTV-13 first. Unverified backups are labeled."),
        encoding="utf-8",
    )
    (OUTPUT / "live-verified.m3u").write_text(
        render_m3u(verified, "Only media-sampled streams; may omit CCTV-1/13 abroad."),
        encoding="utf-8",
    )
    stats = {
        "verified_entries": len(verified),
        "unverified_fallback_entries": len(chosen) - len(verified),
        "rejected_candidates": sum(rejected.values()),
    }
    status = {
        "updated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "channel_count": len({r[0] for r in chosen}),
        "stream_count": len(chosen),
        "priority_channels": per_channel,
        "verification": {
            **stats,
            "candidate_urls": len(candidates),
            "rejected_reasons": dict(rejected.most_common()),
            "min_speed_kib_s": 280,
            "max_start_latency_s": 4,
            "method": "HLS media-segment download / sample bytes + timing",
        },
        "sources": reports,
        "note": ("Verified counts are from overseas GitHub Actions. CCTV-1/13 backup "
                 "lines are unverified (not guaranteed playable), offered for domestic "
                 "vehicle-network testing. Other channels are strictly verified."),
    }
    (OUTPUT / "status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(status, ensure_ascii=False))


if __name__ == "__main__":
    main()
