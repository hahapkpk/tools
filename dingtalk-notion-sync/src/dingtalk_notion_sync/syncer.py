from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

from .notion_blocks import (
    detail_blocks_from_record,
    failure_properties,
    properties_from_record,
    stale_properties,
    summary_blocks,
)
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
    source_ids = [record["record_id"] for record in records]
    duplicate_ids = len(source_ids) - len(set(source_ids))
    missing_required = sum(
        1 for record in records if not all(record.get(key) for key in ("record_id", "title", "execution_date"))
    )
    if not records or duplicate_ids or missing_required:
        raise RuntimeError(
            "DingTalk integrity check failed: "
            f"selected={len(records)} duplicate_ids={duplicate_ids} missing_required={missing_required}"
        )

    existing_pages = notion.iter_database_pages()
    page_groups: dict[str, list[dict[str, Any]]] = {}
    for page in existing_pages:
        record_id = _page_property_text(page, "DingTalk Record ID")
        if record_id:
            page_groups.setdefault(record_id, []).append(page)
    notion_duplicates = sum(len(pages) - 1 for pages in page_groups.values())
    if notion_duplicates:
        raise RuntimeError(f"Notion integrity check failed: duplicate_ids={notion_duplicates}")
    existing_by_id = {record_id: pages[0] for record_id, pages in page_groups.items()}
    selected_ids = set(source_ids)
    stale_ids = sorted(set(existing_by_id) - selected_ids)
    process_records = records[: config.limit] if config.limit is not None else records

    stats = {
        "created": 0,
        "updated": 0,
        "skipped": 0,
        "failed": 0,
        "stale": len(stale_ids),
        "stale_marked": 0,
        "total": len(records),
        "processed": len(process_records),
        "notion_before": len(existing_by_id),
        "missing_before": len(selected_ids - set(existing_by_id)),
        "notes": sum(bool(record.get("note")) for record in records),
        "attachments": sum(len(record.get("attachments") or []) for record in records),
    }
    audit = {
        "selected": len(records),
        "notion_before": len(existing_by_id),
        "missing_before": len(selected_ids - set(existing_by_id)),
        "stale": len(stale_ids),
        "duplicate_ids": duplicate_ids,
        "notion_duplicate_ids": notion_duplicates,
        "missing_required": missing_required,
        "notes": stats["notes"],
        "attachments": stats["attachments"],
    }
    print("SYNC_AUDIT " + " ".join(f"{key}={value}" for key, value in audit.items()))
    synced_records = []

    for record in process_records:
        record["source_url"] = config.source_url
        try:
            existing = existing_by_id.get(record["record_id"])
            if config.dry_run:
                stats["updated" if existing else "created"] += 1
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
                    if existing:
                        notion.update_page(existing["id"], failure_properties(exc, synced_at))
                except Exception:
                    pass

    if not config.dry_run and config.limit is None:
        for record_id in stale_ids:
            page = existing_by_id[record_id]
            if _page_select_name(page, "同步状态") == "Stale":
                continue
            try:
                notion.update_page(page["id"], stale_properties(synced_at))
                stats["stale_marked"] += 1
            except Exception:
                stats["failed"] += 1
        notion.replace_summary(summary_blocks(synced_records, synced_at, config.source_url))
    return stats


def _page_property_text(page: dict[str, Any], name: str) -> str:
    prop = (page.get("properties") or {}).get(name) or {}
    values = prop.get("rich_text") or prop.get("title") or []
    return "".join(
        item.get("plain_text") or (item.get("text") or {}).get("content") or ""
        for item in values
    ).strip()


def _page_select_name(page: dict[str, Any], name: str) -> str:
    prop = (page.get("properties") or {}).get(name) or {}
    return str((prop.get("select") or {}).get("name") or "")

