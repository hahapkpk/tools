from __future__ import annotations

import re
from collections import defaultdict
from typing import Any


MAX_TEXT = 1900


def properties_from_record(record: dict[str, Any], synced_at: str, status: str = "Synced", error: str = "") -> dict[str, Any]:
    return {
        "标题": {"title": _rich_text(record.get("title") or "未命名活动")},
        "DingTalk Record ID": {"rich_text": _rich_text(record.get("record_id") or "")},
        "执行时间": {"date": {"start": record.get("execution_date") or None}},
        "任务状态": _select(record.get("status")),
        "所属": _select(record.get("group")),
        "所属分类": _select(record.get("category")),
        "负责人": {"rich_text": _rich_text(record.get("owner") or "")},
        "负责人（标签）": {"multi_select": [{"name": name} for name in owner_tags(record.get("owner"))]},
        "活动联系人": {"rich_text": _rich_text(record.get("contact") or "")},
        "备注": {"rich_text": _rich_text(record.get("note") or "")},
        "图片": {"files": _files(record.get("attachments") or [])},
        "钉钉文档链接": {"url": record.get("source_url") or None},
        "最后同步时间": {"date": {"start": synced_at}},
        "同步状态": {"select": {"name": status}},
        "同步错误": {"rich_text": _rich_text(error)},
    }


def failure_properties(error: Exception, synced_at: str) -> dict[str, Any]:
    return {
        "最后同步时间": {"date": {"start": synced_at}},
        "同步状态": {"select": {"name": "Failed"}},
        "同步错误": {"rich_text": _rich_text(str(error))},
    }


def stale_properties(synced_at: str) -> dict[str, Any]:
    return {
        "最后同步时间": {"date": {"start": synced_at}},
        "同步状态": {"select": {"name": "Stale"}},
        "同步错误": {"rich_text": _rich_text("当前钉钉活动筛选结果中已不存在此记录")},
    }


def owner_tags(value: Any) -> list[str]:
    names: list[str] = []
    for part in re.split(r"[、,，;；\n]+", str(value or "")):
        name = re.sub(r"\s+", "", part)
        if name and name not in names:
            names.append(name)
    return names


def detail_blocks_from_record(record: dict[str, Any]) -> list[dict[str, Any]]:
    lines = [
        ("执行时间", record.get("execution_date")),
        ("任务状态", record.get("status")),
        ("所属分类", record.get("category")),
        ("负责人", record.get("owner")),
        ("活动联系人", record.get("contact")),
        ("重要程度", record.get("priority")),
        ("创建时间", record.get("created_time")),
    ]
    blocks = [
        _heading(2, record.get("title") or "未命名活动"),
        _paragraph(" | ".join(f"{label}: {value}" for label, value in lines if value)),
    ]
    if record.get("note"):
        blocks.extend([_heading(3, "备注"), *_paragraph_chunks(record["note"])])
    attachments = record.get("attachments") or []
    if attachments:
        blocks.append(_heading(3, "图片"))
        for attachment in attachments:
            blocks.append(_paragraph(f"{attachment.get('name') or 'attachment'}: {attachment.get('url') or ''}"))
    if record.get("source_url"):
        blocks.append(_paragraph(f"钉钉文档: {record['source_url']}"))
    return blocks


def summary_blocks(records: list[dict[str, Any]], synced_at: str, source_url: str) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[record.get("execution_date") or "未设置日期"].append(record)

    blocks = [
        _heading(1, "钉钉活动日志"),
        _paragraph(f"最后同步时间: {synced_at}"),
        _paragraph(f"来源文档: {source_url}"),
        _paragraph(f"共 {len(records)} 条活动记录"),
    ]
    for date in sorted(grouped):
        blocks.append(_heading(2, date))
        for record in grouped[date]:
            lines = [
                record.get("title") or "未命名活动",
                f"分类: {record.get('category') or '-'}",
                f"状态: {record.get('status') or '-'}",
                f"负责人: {record.get('owner') or '-'}",
                f"联系人: {record.get('contact') or '-'}",
            ]
            if record.get("note"):
                lines.append(f"备注: {record['note'][:300]}")
            if record.get("notion_page_url"):
                lines.append(f"Notion: {record['notion_page_url']}")
            blocks.append(_bulleted("\n".join(lines)))
    return blocks


def _select(value: Any) -> dict[str, Any]:
    text = str(value or "").strip()
    return {"select": {"name": text}} if text else {"select": None}


def _files(attachments: list[dict[str, str]]) -> list[dict[str, Any]]:
    files = []
    for attachment in attachments:
        url = attachment.get("url")
        if not url:
            continue
        files.append({
            "name": attachment.get("name") or url.rsplit("/", 1)[-1] or "attachment",
            "type": "external",
            "external": {"url": url},
        })
    return files


def _heading(level: int, text: str) -> dict[str, Any]:
    block_type = f"heading_{min(max(level, 1), 3)}"
    return {"object": "block", "type": block_type, block_type: {"rich_text": _rich_text(text)}}


def _paragraph(text: str) -> dict[str, Any]:
    return {"object": "block", "type": "paragraph", "paragraph": {"rich_text": _rich_text(text)}}


def _bulleted(text: str) -> dict[str, Any]:
    return {"object": "block", "type": "bulleted_list_item", "bulleted_list_item": {"rich_text": _rich_text(text)}}


def _paragraph_chunks(text: str) -> list[dict[str, Any]]:
    return [_paragraph(text[index:index + MAX_TEXT]) for index in range(0, len(text), MAX_TEXT)] or [_paragraph("")]


def _rich_text(text: Any) -> list[dict[str, Any]]:
    value = str(text or "")
    if not value:
        return []
    return [
        {"type": "text", "text": {"content": chunk}, "plain_text": chunk}
        for chunk in (value[index:index + MAX_TEXT] for index in range(0, len(value), MAX_TEXT))
    ][:100]

