from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any


FIELD_NAMES = {
    "title": ["任务内容", "活动名称", "标题", "名称"],
    "priority": ["重要程度"],
    "owner": ["负责人", "责任人"],
    "execution_date": ["执行时间", "日期", "活动日期"],
    "status": ["任务状态", "状态"],
    "group": ["所属"],
    "category": ["所属分类", "活动类型", "分类"],
    "contact": ["活动联系人", "联系人"],
    "note": ["备注", "说明"],
    "attachments": ["图片", "附件"],
    "created_time": ["创建时间"],
}

ACTIVITY_CATEGORIES = {"演播室活动", "广播电台", "外出活动"}
SHANGHAI_TZ = timezone(timedelta(hours=8))


def normalize_record(record: dict[str, Any]) -> dict[str, Any]:
    fields = record.get("fields") or record.get("values") or record.get("fieldValues") or record
    normalized = {
        "record_id": str(
            record.get("recordId")
            or record.get("record_id")
            or record.get("id")
            or fields.get("recordId")
            or ""
        ),
        "title": _to_text(_pick(fields, FIELD_NAMES["title"])),
        "priority": _to_text(_pick(fields, FIELD_NAMES["priority"])),
        "owner": _to_text(_pick(fields, FIELD_NAMES["owner"])),
        "execution_date": _to_date(_pick(fields, FIELD_NAMES["execution_date"])),
        "status": _to_text(_pick(fields, FIELD_NAMES["status"])),
        "group": _to_text(_pick(fields, FIELD_NAMES["group"])),
        "category": _to_text(_pick(fields, FIELD_NAMES["category"])),
        "contact": _to_text(_pick(fields, FIELD_NAMES["contact"])),
        "note": _to_text(_pick(fields, FIELD_NAMES["note"])),
        "attachments": _to_attachments(_pick(fields, FIELD_NAMES["attachments"])),
        "created_time": _to_text(_pick(fields, FIELD_NAMES["created_time"])),
        "source_url": "",
        "notion_page_id": "",
        "notion_page_url": "",
    }
    if not normalized["record_id"]:
        normalized["record_id"] = _fallback_record_id(normalized)
    return normalized


def filter_records(records: list[dict[str, Any]], field_name: str = "所属", expected: str = "活动") -> list[dict[str, Any]]:
    key = "group" if field_name == "所属" else field_name
    filtered = []
    for record in records:
        if str(record.get(key) or "") == expected:
            filtered.append(record)
            continue
        if field_name == "所属" and expected == "活动" and not record.get("group"):
            if str(record.get("category") or "") in ACTIVITY_CATEGORIES:
                normalized = dict(record)
                normalized["group"] = expected
                filtered.append(normalized)
    return filtered


def sort_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(records, key=lambda item: (item.get("execution_date") or "9999-99-99", item.get("title") or ""))


def _pick(fields: dict[str, Any], names: list[str]) -> Any:
    for name in names:
        if name in fields:
            return fields[name]
    return ""


def _to_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        parts = [part for part in (_to_text(item) for item in value) if part]
        if all(isinstance(item, dict) and "text" in item for item in value):
            return "".join(parts)
        return "、".join(parts)
    if isinstance(value, dict):
        for key in ("markdown", "name", "displayName", "text", "title", "label", "value", "fileName", "filename"):
            if value.get(key) is not None:
                return _to_text(value[key])
        if "richText" in value:
            return _to_text(value["richText"])
        return ""
    return str(value).strip()


def _to_date(value: Any) -> str:
    if value in (None, ""):
        return ""
    if isinstance(value, dict):
        for key in ("timestamp", "value", "text", "date"):
            if key in value:
                return _to_date(value[key])
    text = _to_text(value)
    if not text:
        return ""
    if len(text) >= 10 and text[4:5] in {"-", "/"}:
        return _format_date_text(text[:10])
    try:
        timestamp = float(text)
    except ValueError:
        timestamp = 0
    if timestamp > 0:
        if timestamp > 10_000_000_000:
            timestamp /= 1000
        return datetime.fromtimestamp(timestamp, tz=SHANGHAI_TZ).date().isoformat()
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return text


def _format_date_text(value: str) -> str:
    parts = value.replace("/", "-").split("-")
    if len(parts) != 3:
        return value
    return f"{parts[0]}-{parts[1].zfill(2)}-{parts[2].zfill(2)}"


def _to_attachments(value: Any) -> list[dict[str, str]]:
    if value in (None, ""):
        return []
    items = value if isinstance(value, list) else [value]
    attachments: list[dict[str, str]] = []
    for item in items:
        if isinstance(item, str):
            attachments.append({"url": item, "name": item.rsplit("/", 1)[-1] or "attachment"})
            continue
        if not isinstance(item, dict):
            continue
        url = item.get("url") or item.get("downloadUrl") or item.get("previewUrl") or item.get("link")
        if not url:
            continue
        name = item.get("fileName") or item.get("filename") or item.get("name") or str(url).rsplit("/", 1)[-1]
        attachments.append({"url": str(url), "name": str(name or "attachment")})
    return attachments


def _fallback_record_id(record: dict[str, Any]) -> str:
    return "|".join([record.get("title") or "", record.get("execution_date") or "", record.get("category") or ""])
