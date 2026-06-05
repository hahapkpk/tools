from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Callable

from .notion_blocks import detail_blocks_from_record, failure_properties, properties_from_record, summary_blocks
from .records import filter_records, normalize_record, sort_records


@dataclass(frozen=True)
class SyncConfig:
    dry_run: bool = False
    limit: int | None = None
    force_rewrite: bool = False
    filter_field: str = "所属"
    filter_value: str = "活动"
    source_url: str = ""


def run_sync(config: SyncConfig, dingtalk, notion, now: Callable[[], str] | None = None) -> dict[str, int]:
    synced_at = now() if now else datetime.now().astimezone().isoformat(timespec="seconds")
    raw_records = dingtalk.list_records()
    records = [normalize_record(item) for item in raw_records]
    records = filter_records(records, config.filter_field, config.filter_value)
    records = sort_records(records)
    if config.limit is not None:
        records = records[: config.limit]

    stats = {"created": 0, "updated": 0, "skipped": 0, "failed": 0, "total": len(records)}
    synced_records = []

    for record in records:
        record["source_url"] = config.source_url
        try:
            existing = notion.find_page_by_record_id(record["record_id"]) if not config.dry_run else None
            if config.dry_run:
                stats["created"] += 1
                synced_records.append(record)
                continue

            props = properties_from_record(record, synced_at)
            blocks = detail_blocks_from_record(record)
            if existing:
                notion.update_page(existing["id"], props)
                notion.replace_blocks(existing["id"], blocks)
                record["notion_page_id"] = existing["id"]
                record["notion_page_url"] = existing.get("url", "")
                stats["updated"] += 1
            else:
                page = notion.create_page(props, blocks)
                record["notion_page_id"] = page["id"]
                record["notion_page_url"] = page.get("url", "")
                stats["created"] += 1
            synced_records.append(record)
        except Exception as exc:
            stats["failed"] += 1
            if not config.dry_run:
                try:
                    existing = notion.find_page_by_record_id(record["record_id"])
                    if existing:
                        notion.update_page(existing["id"], failure_properties(exc, synced_at))
                except Exception:
                    pass
    if not config.dry_run:
        notion.replace_summary(summary_blocks(synced_records, synced_at, config.source_url))
    return stats

