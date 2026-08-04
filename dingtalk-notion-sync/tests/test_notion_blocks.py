from dingtalk_notion_sync.notion_blocks import (
    detail_blocks_from_record,
    properties_from_record,
    stale_properties,
    summary_blocks,
)


def sample_record(**overrides):
    record = {
        "record_id": "rec-001",
        "title": "技术保障活动",
        "priority": "高",
        "owner": "姚念英",
        "execution_date": "2026-06-05",
        "status": "进行中",
        "group": "活动",
        "category": "演播室活动",
        "contact": "李四",
        "note": "提前检查灯光和音频",
        "attachments": [{"url": "https://example.com/a.jpg", "name": "a.jpg"}],
        "created_time": "2026-06-01T08:00:00+08:00",
        "source_url": "https://alidocs.dingtalk.com/i/nodes/example",
        "notion_page_url": "https://notion.so/page",
    }
    record.update(overrides)
    return record


def test_properties_from_record_builds_database_payload():
    props = properties_from_record(sample_record(), synced_at="2026-06-05T10:00:00+08:00")

    assert props["标题"]["title"][0]["text"]["content"] == "技术保障活动"
    assert props["DingTalk Record ID"]["rich_text"][0]["text"]["content"] == "rec-001"
    assert props["执行时间"]["date"]["start"] == "2026-06-05"
    assert props["任务状态"]["select"]["name"] == "进行中"
    assert props["所属"]["select"]["name"] == "活动"
    assert props["所属分类"]["select"]["name"] == "演播室活动"
    assert props["负责人"]["rich_text"][0]["text"]["content"] == "姚念英"
    assert props["负责人（标签）"]["multi_select"] == [{"name": "姚念英"}]
    assert props["备注"]["rich_text"][0]["text"]["content"] == "提前检查灯光和音频"
    assert props["图片"]["files"][0]["external"]["url"] == "https://example.com/a.jpg"
    assert props["同步状态"]["select"]["name"] == "Synced"


def test_owner_tags_strip_spaces_and_split_multiple_people():
    props = properties_from_record(
        sample_record(owner="沈  伟、鲁　竞，姚念英、沈伟"),
        synced_at="2026-06-05T10:00:00+08:00",
    )

    assert props["负责人（标签）"]["multi_select"] == [
        {"name": "沈伟"},
        {"name": "鲁竞"},
        {"name": "姚念英"},
    ]


def test_stale_properties_are_recoverable_status_updates():
    props = stale_properties("2026-06-05T10:00:00+08:00")

    assert props["同步状态"]["select"]["name"] == "Stale"
    assert "不存在" in props["同步错误"]["rich_text"][0]["text"]["content"]


def test_long_notes_are_split_without_truncation():
    note = "设备要求" * 1000
    props = properties_from_record(sample_record(note=note), synced_at="2026-06-05T10:00:00+08:00")

    assert len(props["备注"]["rich_text"]) > 1
    assert "".join(item["text"]["content"] for item in props["备注"]["rich_text"]) == note


def test_detail_blocks_from_record_include_metadata_and_attachment_links():
    blocks = detail_blocks_from_record(sample_record())

    block_types = [block["type"] for block in blocks]
    assert block_types[:2] == ["heading_2", "paragraph"]
    assert any("提前检查灯光和音频" in _plain_text(block) for block in blocks)
    assert any("https://example.com/a.jpg" in _plain_text(block) for block in blocks)


def test_summary_blocks_group_records_by_execution_date():
    records = [
        sample_record(record_id="1", title="活动A", execution_date="2026-06-05", notion_page_url="https://notion.so/a"),
        sample_record(record_id="2", title="活动B", execution_date="2026-06-06", notion_page_url=""),
    ]

    blocks = summary_blocks(
        records,
        synced_at="2026-06-05T10:00:00+08:00",
        source_url="https://alidocs.dingtalk.com/i/nodes/example",
    )

    assert blocks[0]["type"] == "heading_1"
    text = "\n".join(_plain_text(block) for block in blocks)
    assert "钉钉活动日志" in text
    assert "共 2 条活动记录" in text
    assert "2026-06-05" in text
    assert "活动A" in text
    assert "Notion: https://notion.so/a" in text


def _plain_text(block):
    data = block.get(block["type"], {})
    rich_text = data.get("rich_text") or []
    return "".join(item.get("plain_text") or item.get("text", {}).get("content", "") for item in rich_text)

