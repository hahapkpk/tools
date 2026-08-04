from dingtalk_notion_sync.records import filter_records, normalize_record, sort_records


def test_normalize_record_handles_dingtalk_field_shapes():
    raw = {
        "recordId": "rec-001",
        "fields": {
            "任务内容": [{"text": "技术保障活动"}],
            "重要程度": {"label": "高"},
            "负责人": [{"name": "姚念英"}, {"displayName": "张三"}],
            "执行时间": 1783267200000,
            "任务状态": {"value": "进行中"},
            "所属": {"text": "活动"},
            "所属分类": "演播室活动",
            "活动联系人": {"text": "李四"},
            "备注": [{"text": "提前检查灯光"}, {"text": "和音频"}],
            "图片": [
                {"url": "https://example.com/a.jpg", "fileName": "a.jpg"},
                {"downloadUrl": "https://example.com/b.png", "name": "b.png"},
            ],
            "创建时间": "2026-06-05T08:30:00+08:00",
        },
    }

    record = normalize_record(raw)

    assert record["record_id"] == "rec-001"
    assert record["title"] == "技术保障活动"
    assert record["priority"] == "高"
    assert record["owner"] == "姚念英、张三"
    assert record["execution_date"] == "2026-07-06"
    assert record["status"] == "进行中"
    assert record["group"] == "活动"
    assert record["category"] == "演播室活动"
    assert record["contact"] == "李四"
    assert record["note"] == "提前检查灯光和音频"
    assert record["attachments"] == [
        {"url": "https://example.com/a.jpg", "name": "a.jpg"},
        {"url": "https://example.com/b.png", "name": "b.png"},
    ]
    assert record["created_time"] == "2026-06-05T08:30:00+08:00"


def test_filter_records_keeps_only_activity_group():
    raw_records = [
        {"recordId": "1", "fields": {"任务内容": "活动A", "执行时间": "2026-06-06", "所属": "活动"}},
        {"recordId": "2", "fields": {"任务内容": "维护B", "执行时间": "2026-06-07", "所属": "设备维修"}},
        {"recordId": "3", "fields": {"任务内容": "活动C", "执行时间": "2026-06-05", "所属": {"label": "活动"}}},
    ]

    records = filter_records([normalize_record(item) for item in raw_records], "所属", "活动")

    assert [record["record_id"] for record in records] == ["1", "3"]


def test_filter_records_includes_activity_category_when_group_is_missing():
    raw_records = [
        {"recordId": "1", "fields": {"任务内容": "足球联赛", "执行时间": "2026-05-03", "所属分类": "外出活动"}},
        {"recordId": "2", "fields": {"任务内容": "会议保障", "执行时间": "2026-05-04", "所属分类": "二楼会议室"}},
        {"recordId": "3", "fields": {"任务内容": "综合活动", "执行时间": "2026-05-05", "所属分类": "活动"}},
        {"recordId": "4", "fields": {"任务内容": "草稿", "执行时间": "2026-05-03"}},
        {"recordId": "5", "fields": {"任务内容": "维护", "执行时间": "2026-05-03", "所属分类": "设备维修"}},
    ]

    records = filter_records([normalize_record(item) for item in raw_records], "所属", "活动")

    assert [record["record_id"] for record in records] == ["1", "2", "3"]
    assert all(record["group"] == "活动" for record in records)


def test_normalize_record_reads_markdown_note_shape():
    record = normalize_record({
        "recordId": "1",
        "fields": {
            "任务内容": "足球联赛",
            "执行时间": "2026-05-23",
            "所属": "活动",
            "备注": {"markdown": "**设备要求**\n\n- 双机位\n- 网络测试"},
        },
    })

    assert record["note"] == "**设备要求**\n\n- 双机位\n- 网络测试"
def test_normalize_record_interprets_dingtalk_timestamps_in_shanghai_time():
    record = normalize_record({
        "recordId": "1",
        "fields": {"任务内容": "足球联赛", "执行时间": 1779465600000, "所属": "活动"},
    })

    assert record["execution_date"] == "2026-05-23"


def test_sort_records_orders_by_execution_date_then_title():
    records = [
        normalize_record({"recordId": "2", "fields": {"任务内容": "B", "执行时间": "2026-06-07", "所属": "活动"}}),
        normalize_record({"recordId": "1", "fields": {"任务内容": "A", "执行时间": "2026-06-05", "所属": "活动"}}),
        normalize_record({"recordId": "3", "fields": {"任务内容": "C", "执行时间": "2026-06-05", "所属": "活动"}}),
    ]

    ordered = sort_records(records)

    assert [record["record_id"] for record in ordered] == ["1", "3", "2"]

