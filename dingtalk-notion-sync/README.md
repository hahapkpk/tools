# DingTalk Activity to Notion Sync

Sync DingTalk multidimensional table activity records into Notion:

- one Notion database page per DingTalk record
- one generated summary page named `钉钉活动日志`

The script reads DingTalk records from the configured base and sheet, filters `所属 = 活动`, then writes details and a grouped summary to Notion.

## Notion Database Schema

Create a Notion database shared with your Notion integration. Add these properties exactly:

| Name | Type |
| --- | --- |
| 标题 | Title |
| DingTalk Record ID | Text |
| 执行时间 | Date |
| 任务状态 | Select |
| 所属 | Select |
| 所属分类 | Select |
| 负责人 | Rich text |
| 活动联系人 | Rich text |
| 备注 | Rich text |
| 图片 | Files |
| 钉钉文档链接 | URL |
| 最后同步时间 | Date |
| 同步状态 | Select |
| 同步错误 | Rich text |

Create or choose a separate Notion page for the generated summary, then copy its page ID into `NOTION_SUMMARY_PAGE_ID`.

## Local Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .[test]
Copy-Item .env.example .env
```

Fill `.env` with real values. Do not commit `.env`.

Preview without Notion writes:

```powershell
python sync.py --dry-run --limit 5
```

Run the sync:

```powershell
python sync.py
```

## GitHub Secrets

Add these repository secrets before enabling the workflow:

| Secret name | Value |
| --- | --- |
| `DINGTALK_APP_KEY` | DingTalk AppKey |
| `DINGTALK_APP_SECRET` | DingTalk AppSecret |
| `DINGTALK_BASE_ID` | DingTalk base ID |
| `DINGTALK_SHEET_ID` | DingTalk sheet ID |
| `DINGTALK_OPERATOR_ID` | Operator unionId |
| `DINGTALK_SOURCE_URL` | Source document URL |
| `NOTION_TOKEN` | Notion integration token |
| `NOTION_DATABASE_ID` | Target Notion database ID |
| `NOTION_SUMMARY_PAGE_ID` | Target summary page ID |

## Schedule

The workflow runs at 09:00 and 21:00 Asia/Shanghai:

```yaml
cron: "0 1,13 * * *"
```

It also supports manual `workflow_dispatch` with `dry_run`, `limit`, and `force_rewrite`.

The workflow file is stored at the repository root:

```text
.github/workflows/dingtalk-notion-sync.yml
```

## Notes

- The DingTalk access token is refreshed automatically.
- The detail database uses `DingTalk Record ID` as the idempotency key.
- The summary page body is replaced on every successful non-dry-run sync.
- Keep DingTalk app secrets, Notion tokens, and MCP gateway URLs out of git.
