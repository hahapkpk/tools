from __future__ import annotations

import argparse
import sys

from dingtalk_notion_sync.config import AppConfig
from dingtalk_notion_sync.dingtalk import DingTalkClient
from dingtalk_notion_sync.notion_client import NotionClient
from dingtalk_notion_sync.syncer import SyncConfig, run_sync


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync DingTalk activity records to Notion.")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to Notion.")
    parser.add_argument("--limit", type=int, help="Only process the first N filtered records.")
    parser.add_argument("--force-rewrite", action="store_true", help="Rewrite existing Notion pages.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    app_config = AppConfig.from_env().with_overrides(
        dry_run=True if args.dry_run else None,
        limit=args.limit,
        force_rewrite=True if args.force_rewrite else None,
    )
    dingtalk = DingTalkClient(
        app_config.dingtalk_app_key,
        app_config.dingtalk_app_secret,
        app_config.dingtalk_base_id,
        app_config.dingtalk_sheet_id,
        app_config.dingtalk_operator_id,
    )
    notion = NotionClient(
        app_config.notion_token,
        app_config.notion_database_id,
        app_config.notion_summary_page_id,
        version=app_config.notion_version,
    )
    stats = run_sync(
        SyncConfig(
            dry_run=app_config.dry_run,
            limit=app_config.limit,
            force_rewrite=app_config.force_rewrite,
            filter_field=app_config.filter_field,
            filter_value=app_config.filter_value,
            source_url=app_config.source_url,
        ),
        dingtalk,
        notion,
    )
    print(
        "SYNC_SUMMARY "
        + " ".join(f"{key}={value}" for key, value in stats.items())
    )
    return 1 if stats["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())

