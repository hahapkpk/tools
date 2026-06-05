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

    assert stats == {"created": 1, "updated": 0, "skipped": 0, "failed": 0, "total": 1}
    assert notion.calls == []


def test_run_sync_creates_updates_and_replaces_summary_after_details():
    dingtalk = FakeDingTalk([
        {"recordId": "1", "fields": {"任务内容": "活动A", "执行时间": "2026-06-05", "所属": "活动"}},
        {"recordId": "2", "fields": {"任务内容": "活动B", "执行时间": "2026-06-06", "所属": "活动"}},
        {"recordId": "3", "fields": {"任务内容": "维护C", "执行时间": "2026-06-07", "所属": "设备维修"}},
    ])
    notion = FakeNotion(existing={"2": {"id": "page-2", "url": "https://notion.so/page-2"}})

    stats = run_sync(
        SyncConfig(dry_run=False, source_url="https://alidocs.dingtalk.com/i/nodes/example"),
        dingtalk,
        notion,
        now=lambda: "2026-06-05T10:00:00+08:00",
    )

    assert stats == {"created": 1, "updated": 1, "skipped": 0, "failed": 0, "total": 2}
    assert notion.calls[0][0] == "find"
    assert ("create", "活动A") in [(call[0], call[1]) for call in notion.calls]
    assert ("update", "page-2") in [(call[0], call[1]) for call in notion.calls]
    assert notion.calls[-1][0] == "replace_summary"
    assert "https://notion.so/page-1" in notion.summary_text
    assert "https://notion.so/page-2" in notion.summary_text


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

    def find_page_by_record_id(self, record_id):
        self.calls.append(("find", record_id))
        return self.existing.get(record_id)

    def create_page(self, properties, blocks):
        title = properties["标题"]["title"][0]["text"]["content"]
        self.calls.append(("create", title))
        page_id = f"page-{properties['DingTalk Record ID']['rich_text'][0]['text']['content']}"
        return {"id": page_id, "url": f"https://notion.so/{page_id}"}

    def update_page(self, page_id, properties):
        self.calls.append(("update", page_id))

    def replace_blocks(self, page_id, blocks):
        self.calls.append(("replace_blocks", page_id))

    def replace_summary(self, blocks):
        self.calls.append(("replace_summary", len(blocks)))
        self.summary_text = "\n".join(_plain_text(block) for block in blocks)


def _plain_text(block):
    data = block.get(block["type"], {})
    rich_text = data.get("rich_text") or []
    return "".join(item.get("plain_text") or item.get("text", {}).get("content", "") for item in rich_text)

