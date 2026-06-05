# DingTalk Activity Notion Sync Design

## Goal

Create a new standalone script project in `github/tools` that syncs DingTalk multidimensional table activity records into Notion on a schedule. The sync must write both detailed database entries and a readable "钉钉活动日志" summary page.

## Context

The design follows the structure of `hahapkpk/get-notion-sync`: environment-based secrets, a local dry-run path, idempotent Notion updates, and GitHub Actions scheduling. The DingTalk API shape follows the existing local `studio-calendar-dingtalk.js` implementation and the provided multidimensional table endpoints.

No real DingTalk app secret, Notion token, MCP URL key, database ID, or page ID will be committed. The repository will contain only `.env.example` placeholders and documentation for GitHub Secrets.

## Scope

Build a new folder:

```text
dingtalk-notion-sync/
```

The script will:

- Fetch a DingTalk access token with `DINGTALK_APP_KEY` and `DINGTALK_APP_SECRET`.
- Pull records from `baseId=lyQod3RxJKOyZ0GmSQ64bkydJkb4Mw9r`, `sheetId=dv19yqvsgs3oebp3pcjys`.
- Pass `operatorId=9m3AgKXsQ3RhU8Rb3pKzkAiEiE`.
- Follow DingTalk pagination through `nextToken`.
- Filter records where `所属` equals `活动`.
- Sort records by `执行时间`.
- Upsert each record into a Notion detail database.
- Rebuild or update a Notion summary page titled or documented as `钉钉活动日志`.
- Support `--dry-run`, `--limit`, and `--force-rewrite`.

The script will not use the DingTalk MCP gateway URL. The gateway URL contains a sensitive key and is not suitable for committed automation examples.

## Target Notion Database

The target Notion detail database should contain these properties:

| Name | Type | Purpose |
| --- | --- | --- |
| 标题 | Title | Activity or task title |
| DingTalk Record ID | Text | Idempotency key |
| 执行时间 | Date | Activity date |
| 任务状态 | Select | Original task status |
| 所属 | Select | Expected to be 活动 after filtering |
| 所属分类 | Select | Activity subtype |
| 负责人 | Rich text | Responsible people |
| 活动联系人 | Rich text | Contact person |
| 备注 | Rich text | Short note preview |
| 图片 | Files | Attachment URLs when usable |
| 钉钉文档链接 | URL | Source DingTalk document |
| 最后同步时间 | Date | Sync timestamp |
| 同步状态 | Select | Synced or Failed |
| 同步错误 | Rich text | Error message for failed records |

The implementation can assume these properties exist. It may validate missing required properties and produce a clear error instead of silently creating the database schema.

## Summary Page

The summary page will be identified by `NOTION_SUMMARY_PAGE_ID`. Each successful run will replace the page body with a fresh activity log:

- Heading: `钉钉活动日志`
- Sync timestamp
- Source document link
- Total count
- Activity entries grouped by `执行时间`
- Each entry includes title, category, status, owner, contact, note preview, and a link to the matching Notion detail page when available

Replacing the body avoids duplicate content across scheduled runs. Manual edits inside the generated summary page body may be overwritten.

## Data Mapping

The DingTalk fields map directly:

| DingTalk field | Normalized key | Notion property/body |
| --- | --- | --- |
| 任务内容 | title | 标题 and page heading |
| 重要程度 | priority | Body metadata |
| 负责人 | owner | 负责人 |
| 执行时间 | execution_date | 执行时间 |
| 任务状态 | status | 任务状态 |
| 所属 | group | 所属 |
| 所属分类 | category | 所属分类 |
| 活动联系人 | contact | 活动联系人 |
| 备注 | note | 备注 and body content |
| 图片 | attachments | 图片 and body links |
| 创建时间 | created_time | Body metadata |

The script must tolerate DingTalk field payloads that arrive as strings, objects, arrays, rich-text arrays, user objects, date timestamps, or attachment objects.

## Idempotency

The detail database uses `DingTalk Record ID` as the unique key.

- No matching page: create a page.
- Matching page: update properties and replace the generated body.
- Unchanged records can be skipped unless `--force-rewrite` is set.

The first version can use a conservative update strategy: update existing pages every run after fetching records. This is simpler and acceptable for the expected table size. A later optimization can compare normalized hashes.

## Configuration

Required environment variables:

```text
DINGTALK_APP_KEY
DINGTALK_APP_SECRET
DINGTALK_BASE_ID
DINGTALK_SHEET_ID
DINGTALK_OPERATOR_ID
NOTION_TOKEN
NOTION_DATABASE_ID
NOTION_SUMMARY_PAGE_ID
```

Optional environment variables:

```text
DINGTALK_FILTER_FIELD=所属
DINGTALK_FILTER_VALUE=活动
SYNC_DRY_RUN=false
SYNC_LIMIT=
SYNC_FORCE_REWRITE=false
NOTION_VERSION=2022-06-28
```

## Scheduling

Add a GitHub Actions workflow under `dingtalk-notion-sync/.github/workflows/dingtalk-notion-sync.yml` or document how to move it to the repository-level `.github/workflows` directory if GitHub does not discover nested workflows. The intended schedule mirrors `get-notion-sync`:

```text
09:00 Asia/Shanghai
21:00 Asia/Shanghai
```

GitHub cron expression:

```text
0 1,13 * * *
```

The workflow will also support manual `workflow_dispatch` with dry-run, limit, and force-rewrite inputs.

## Error Handling

The script should fail fast for missing required environment variables. DingTalk and Notion HTTP failures should include status code and a short response message without printing secrets.

Per-record Notion write failures should increment a failed counter and continue where possible. If a record already has a detail page, the script should try to mark it with `同步状态=Failed` and write a short `同步错误`.

The summary page should only be rebuilt after the detail sync has finished collecting successful page links.

## Testing

Add focused tests for:

- DingTalk record normalization across strings, arrays, user objects, rich text, attachments, and date timestamps.
- Filtering `所属 = 活动`.
- Notion property construction.
- Summary page block generation.
- Dry-run behavior avoiding Notion write calls.

Network calls should be mocked. Tests should not require real DingTalk or Notion credentials.

## Deliverables

- `dingtalk-notion-sync/sync.py`
- `dingtalk-notion-sync/src/dingtalk_notion_sync/`
- `dingtalk-notion-sync/tests/`
- `dingtalk-notion-sync/.env.example`
- `dingtalk-notion-sync/requirements.txt`
- `dingtalk-notion-sync/pyproject.toml`
- `dingtalk-notion-sync/README.md`
- `dingtalk-notion-sync/.github/workflows/dingtalk-notion-sync.yml`

