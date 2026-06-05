from __future__ import annotations

import os
from dataclasses import dataclass, replace

from dotenv import load_dotenv


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _int_env(name: str) -> int | None:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return None
    return int(raw)


@dataclass(frozen=True)
class AppConfig:
    dingtalk_app_key: str
    dingtalk_app_secret: str
    dingtalk_base_id: str
    dingtalk_sheet_id: str
    dingtalk_operator_id: str
    notion_token: str
    notion_database_id: str
    notion_summary_page_id: str
    source_url: str
    filter_field: str = "所属"
    filter_value: str = "活动"
    notion_version: str = "2022-06-28"
    dry_run: bool = False
    limit: int | None = None
    force_rewrite: bool = False

    @classmethod
    def from_env(cls) -> "AppConfig":
        load_dotenv()
        required = [
            "DINGTALK_APP_KEY",
            "DINGTALK_APP_SECRET",
            "DINGTALK_BASE_ID",
            "DINGTALK_SHEET_ID",
            "DINGTALK_OPERATOR_ID",
            "NOTION_TOKEN",
            "NOTION_DATABASE_ID",
            "NOTION_SUMMARY_PAGE_ID",
        ]
        missing = [name for name in required if not os.getenv(name)]
        if missing:
            raise RuntimeError("Missing required environment variables: " + ", ".join(missing))
        base_id = os.environ["DINGTALK_BASE_ID"]
        return cls(
            dingtalk_app_key=os.environ["DINGTALK_APP_KEY"],
            dingtalk_app_secret=os.environ["DINGTALK_APP_SECRET"],
            dingtalk_base_id=base_id,
            dingtalk_sheet_id=os.environ["DINGTALK_SHEET_ID"],
            dingtalk_operator_id=os.environ["DINGTALK_OPERATOR_ID"],
            notion_token=os.environ["NOTION_TOKEN"],
            notion_database_id=os.environ["NOTION_DATABASE_ID"],
            notion_summary_page_id=os.environ["NOTION_SUMMARY_PAGE_ID"],
            source_url=os.getenv("DINGTALK_SOURCE_URL", f"https://alidocs.dingtalk.com/i/nodes/{base_id}"),
            filter_field=os.getenv("DINGTALK_FILTER_FIELD", "所属"),
            filter_value=os.getenv("DINGTALK_FILTER_VALUE", "活动"),
            notion_version=os.getenv("NOTION_VERSION", "2022-06-28"),
            dry_run=_bool_env("SYNC_DRY_RUN", False),
            limit=_int_env("SYNC_LIMIT"),
            force_rewrite=_bool_env("SYNC_FORCE_REWRITE", False),
        )

    def with_overrides(self, *, dry_run: bool | None = None, limit: int | None = None, force_rewrite: bool | None = None) -> "AppConfig":
        updates = {}
        if dry_run is not None:
            updates["dry_run"] = dry_run
        if limit is not None:
            updates["limit"] = limit
        if force_rewrite is not None:
            updates["force_rewrite"] = force_rewrite
        return replace(self, **updates)

