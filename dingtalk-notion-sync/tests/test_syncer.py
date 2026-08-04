import pytest

from dingtalk_notion_sync.syncer import SyncConfig, run_sync


def test_dry_run_does_not_write_to_notion():
    dingtalk = FakeDingTalk([
        {"recordId": "1", "fields": {"任务内容": "活动A", "执行时间": "2026-06-05", "所属": "活动"}},
    ])
    notion = FakeNotion()

    stats = run_sync(
        SyncConfig(dry_run=True, source_url="https://alidocs.dingtalk.com/i/nodes/example"),
        dingtalk,
        notion,
        now=lambda: "2026-06-05T10:00:00+08:00",
    )

    assert stats == {
        "created": 1,
        "updated": 0,
        "skipped": 0,
        "failed": 0,
        "stale": 0,
        "stale_marked": 0,
        "total": 1,
        "processed": 1,
        "notion_before": 0,
        "missing_before": 1,
        "notes": 0,
        "attachments": 0,
    }
    assert notion.calls == [("list",)]


def test_run_sync_creates_updates_and_replaces_summary_after_details():
    dingtalk = FakeDingTalk([
        {"recordId": "1", "fields": {"任务内容": "活动A", "执行时间": "2026-06-05", "所属": "活动"}},
        {"recordId": "2", "fields": {"任务内容": "活动B", "执行时间": "2026-06-06", "所属": "活动"}},
        {"recordId": "3", "fields": {"任务内容": "维护C", "执行时间": "2026-06-07", "所属": "设备维修"}},
    ])
    notion = FakeNotion(existing={
        "2": {"id": "page-2", "url": "https://notion.so/page-2"},
        "old": {"id": "page-old", "url": "https://notion.so/page-old"},
    })

    stats = run_sync(
        SyncConfig(dry_run=False, source_url="https://alidocs.dingtalk.com/i/nodes/example"),
        dingtalk,
        notion,
        now=lambda: "2026-06-05T10:00:00+08:00",
    )

    assert stats == {
        "created": 1,
        "updated": 1,
        "skipped": 0,
        "failed": 0,
        "stale": 1,
        "stale_marked": 1,
        "total": 2,
        "processed": 2,
        "notion_before": 2,
        "missing_before": 1,
        "notes": 0,
        "attachments": 0,
    }
    assert notion.calls[0][0] == "list"
    two_part_calls = [(call[0], call[1]) for call in notion.calls if len(call) >= 2]
    assert ("create", "活动A") in two_part_calls
    assert ("update", "page-2") in two_part_calls
    assert ("update", "page-old") in two_part_calls
    stale_call = next(call for call in notion.calls if call[:2] == ("update", "page-old"))
    assert stale_call[2] == "Stale"
    assert notion.calls[-1][0] == "replace_summary"
    assert "https://notion.so/page-1" in notion.summary_text
    assert "https://notion.so/page-2" in notion.summary_text


def test_limited_run_does_not_mark_stale_or_replace_summary():
    dingtalk = FakeDingTalk([
        {"recordId": "1", "fields": {"任务内容": "活动A", "执行时间": "2026-06-05", "所属": "活动"}},
        {"recordId": "2", "fields": {"任务内容": "活动B", "执行时间": "2026-06-06", "所属": "活动"}},
    ])
    notion = FakeNotion(existing={"old": {"id": "page-old", "url": "https://notion.so/page-old"}})

    stats = run_sync(
        SyncConfig(limit=1),
        dingtalk,
        notion,
        now=lambda: "2026-06-05T10:00:00+08:00",
    )

    assert stats["processed"] == 1
    assert stats["stale"] == 1
    assert stats["stale_marked"] == 0
    assert not any(call[0] == "replace_summary" for call in notion.calls)
    assert not any(call[:2] == ("update", "page-old") for call in notion.calls)


def test_empty_activity_selection_stops_before_reading_or_writing_notion():
    notion = FakeNotion(existing={"old": {"id": "page-old"}})

    with pytest.raises(RuntimeError, match="selected=0"):
        run_sync(SyncConfig(), FakeDingTalk([]), notion)

    assert notion.calls == []


class FakeDingTalk:
    def __init__(self, records):
        self.records = records

    def list_records(self):
        return self.records


class FakeNotion:
    def __init__(self, existing=None):
        self.existing = existing or {}
        self.calls = []
        self.summary_text = ""

    def iter_database_pages(self):
        self.calls.append(("list",))
        pages = []
        for record_id, page in self.existing.items():
            copy = dict(page)
            copy["properties"] = {
                "DingTalk Record ID": {
                    "rich_text": [{"plain_text": record_id, "text": {"content": record_id}}],
                },
                "同步状态": {"select": {"name": page.get("status", "Synced")}},
            }
            pages.append(copy)
        return pages

    def create_page(self, properties, blocks):
        title = properties["标题"]["title"][0]["text"]["content"]
        self.calls.append(("create", title))
        page_id = f"page-{properties['DingTalk Record ID']['rich_text'][0]['text']['content']}"
        return {"id": page_id, "url": f"https://notion.so/{page_id}"}

    def update_page(self, page_id, properties):
        status = (properties.get("同步状态", {}).get("select") or {}).get("name")
        self.calls.append(("update", page_id, status))

    def replace_blocks(self, page_id, blocks):
        self.calls.append(("replace_blocks", page_id))

    def replace_summary(self, blocks):
        self.calls.append(("replace_summary", len(blocks)))
        self.summary_text = "\n".join(_plain_text(block) for block in blocks)


def _plain_text(block):
    data = block.get(block["type"], {})
    rich_text = data.get("rich_text") or []
    return "".join(item.get("plain_text") or item.get("text", {}).get("content", "") for item in rich_text)

