from __future__ import annotations

from typing import Any

from .http import request_json


class DingTalkClient:
    def __init__(self, app_key: str, app_secret: str, base_id: str, sheet_id: str, operator_id: str) -> None:
        self.app_key = app_key
        self.app_secret = app_secret
        self.base_id = base_id
        self.sheet_id = sheet_id
        self.operator_id = operator_id
        self._access_token: str | None = None

    def access_token(self) -> str:
        if self._access_token:
            return self._access_token
        payload = request_json(
            "POST",
            "https://api.dingtalk.com/v1.0/oauth2/accessToken",
            headers={"Content-Type": "application/json"},
            json={"appKey": self.app_key, "appSecret": self.app_secret},
        )
        token = payload.get("accessToken")
        if not token:
            raise RuntimeError("DingTalk access token response did not include accessToken")
        self._access_token = str(token)
        return self._access_token

    def list_records(self, max_results: int = 100) -> list[dict[str, Any]]:
        url = (
            f"https://api.dingtalk.com/v1.0/notable/bases/{self.base_id}/"
            f"sheets/{self.sheet_id}/records/list?operatorId={self.operator_id}"
        )
        token = self.access_token()
        headers = {"Content-Type": "application/json", "x-acs-dingtalk-access-token": token}
        records: list[dict[str, Any]] = []
        next_token = ""
        while True:
            body: dict[str, Any] = {"maxResults": max_results}
            if next_token:
                body["nextToken"] = next_token
            payload = request_json("POST", url, headers=headers, json=body)
            records.extend(_extract_records(payload))
            next_token = payload.get("nextToken") or payload.get("result", {}).get("nextToken") or payload.get("data", {}).get("nextToken") or ""
            if not next_token:
                return records


def _extract_records(payload: dict[str, Any]) -> list[dict[str, Any]]:
    for value in (
        payload.get("records"),
        payload.get("value"),
        payload.get("data", {}).get("records"),
        payload.get("result", {}).get("records"),
    ):
        if isinstance(value, list):
            return value
    return []

