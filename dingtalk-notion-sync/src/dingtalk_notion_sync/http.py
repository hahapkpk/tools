from __future__ import annotations

from typing import Any

import requests


class HttpError(RuntimeError):
    pass


def request_json(method: str, url: str, **kwargs: Any) -> dict[str, Any]:
    response = requests.request(method, url, timeout=kwargs.pop("timeout", 60), **kwargs)
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    if response.status_code >= 400:
        message = payload.get("message") or payload.get("errorMessage") or payload.get("errmsg") or response.text[:500]
        raise HttpError(f"{method} {url.split('?', 1)[0]} failed: HTTP {response.status_code} {message}")
    return payload

