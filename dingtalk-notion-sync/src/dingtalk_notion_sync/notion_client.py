from __future__ import annotations

from typing import Any

from .http import request_json


class NotionClient:
    base_url = "https://api.notion.com/v1"

    def __init__(self, token: str, database_id: str, summary_page_id: str, version: str = "2022-06-28") -> None:
        self.database_id = database_id.replace("-", "")
        self.summary_page_id = summary_page_id
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Notion-Version": version,
            "Content-Type": "application/json",
        }

    def find_page_by_record_id(self, record_id: str) -> dict[str, Any] | None:
        payload = request_json(
            "POST",
            f"{self.base_url}/databases/{self.database_id}/query",
            headers=self.headers,
            json={
                "filter": {"property": "DingTalk Record ID", "rich_text": {"equals": record_id}},
                "page_size": 1,
            },
        )
        results = payload.get("results") or []
        return results[0] if results else None

    def create_page(self, properties: dict[str, Any], blocks: list[dict[str, Any]]) -> dict[str, Any]:
        payload = request_json(
            "POST",
            f"{self.base_url}/pages",
            headers=self.headers,
            json={"parent": {"database_id": self.database_id}, "properties": properties, "children": blocks[:100]},
        )
        if len(blocks) > 100:
            self.append_blocks(payload["id"], blocks[100:])
        return {"id": payload["id"], "url": payload.get("url", "")}

    def update_page(self, page_id: str, properties: dict[str, Any]) -> None:
        request_json("PATCH", f"{self.base_url}/pages/{page_id}", headers=self.headers, json={"properties": properties})

    def replace_blocks(self, page_id: str, blocks: list[dict[str, Any]]) -> None:
        for child in self.iter_child_blocks(page_id):
            self.archive_block(child["id"])
        self.append_blocks(page_id, blocks)

    def replace_summary(self, blocks: list[dict[str, Any]]) -> None:
        self.replace_blocks(self.summary_page_id, blocks)

    def append_blocks(self, page_id: str, blocks: list[dict[str, Any]]) -> None:
        for index in range(0, len(blocks), 100):
            chunk = blocks[index:index + 100]
            if chunk:
                request_json(
                    "PATCH",
                    f"{self.base_url}/blocks/{page_id}/children",
                    headers=self.headers,
                    json={"children": chunk},
                )

    def iter_child_blocks(self, page_id: str) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        start_cursor = None
        while True:
            params: dict[str, Any] = {"page_size": 100}
            if start_cursor:
                params["start_cursor"] = start_cursor
            payload = request_json(
                "GET",
                f"{self.base_url}/blocks/{page_id}/children",
                headers=self.headers,
                params=params,
            )
            results.extend(payload.get("results") or [])
            if not payload.get("has_more"):
                return results
            start_cursor = payload.get("next_cursor")

    def archive_block(self, block_id: str) -> None:
        request_json("PATCH", f"{self.base_url}/blocks/{block_id}", headers=self.headers, json={"archived": True})

