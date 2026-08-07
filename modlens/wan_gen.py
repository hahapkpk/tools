#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wan2.7-image 文生图（DashScope 原生接口，零依赖 python3）

配置复用 ModLens 的 ~/.modlens/config.json（apiKey + baseUrl 自动推导 /api/v1），
也可用环境变量 MODLENS_API_KEY / WAN_MODEL 覆盖。

用法:
  python3 wan_gen.py "<prompt>" [输出.png] [尺寸如 1024*1024] [--model wan2.7-image]
示例:
  python3 wan_gen.py "蓝色圆形徽标" badge.png 1024*1024
"""
import argparse, json, os, sys, urllib.request, urllib.error

DEFAULT_BASE = "https://llm-exsymve8p80526c8.cn-beijing.maas.aliyuncs.com"
DEFAULT_MODEL = "wan2.7-image"
CONFIG_CANDIDATES = [
    os.path.expanduser("~/.modlens/config.json"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json"),
]

def load_key_and_base():
    key = os.environ.get("MODLENS_API_KEY")
    base = os.environ.get("MODLENS_BASE_URL")
    for p in CONFIG_CANDIDATES:
        if os.path.exists(p):
            try:
                with open(p) as f:
                    o = json.load(f).get("openai", {})
                key = key or o.get("apiKey")
                base = base or o.get("baseUrl")
                break
            except Exception:
                pass
    if not key:
        sys.exit("[error] 缺少 apiKey：先运行 modlens_ocr.py --set-key <key>，或设环境变量 MODLENS_API_KEY")
    # 从 OpenAI 兼容 baseUrl 推导 DashScope 原生地址：/compatible-mode/v1 -> /api/v1
    if base:
        base = base.rstrip("/").replace("/compatible-mode/v1", "").replace("/compatible-mode", "")
    else:
        base = DEFAULT_BASE
    return key, base.rstrip("/") + "/api/v1"

def req(key, method, url, data=None, timeout=90):
    r = urllib.request.Request(url, method=method,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    if data is not None:
        r.data = json.dumps(data).encode()
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        sys.exit(f"[error] HTTP {e.code}: {e.read().decode(errors='replace')[:400]}")

def main():
    ap = argparse.ArgumentParser(description="wan2.7-image 文生图（零依赖 python3）")
    ap.add_argument("prompt", help="图像描述")
    ap.add_argument("output", nargs="?", default="generated.png", help="输出文件（默认 generated.png）")
    ap.add_argument("size", nargs="?", default="1024*1024", help="尺寸（默认 1024*1024）")
    ap.add_argument("--model", default=None, help="模型名（默认 wan2.7-image，可设 wan2.7-image-pro）")
    args = ap.parse_args()

    key, base = load_key_and_base()
    model = args.model or os.environ.get("WAN_MODEL") or DEFAULT_MODEL
    print(f"[info] 模型={model} size={args.size}")
    print(f"[info] 提交任务...")
    task = req(key, "POST", f"{base}/services/aigc/multimodal-generation/generation",
               {"model": model,
                "input": {"messages": [{"role": "user", "content": [{"text": args.prompt}]}]},
                "parameters": {"size": args.size}})
    choices = task.get("output", {}).get("choices", [])
    content = choices[0].get("message", {}).get("content", []) if choices else []
    url = None
    for item in content:
        if isinstance(item, dict) and item.get("type") == "image":
            url = item.get("image")
            break
    if not url:
        sys.exit(f"[error] 响应无图片: {json.dumps(task, ensure_ascii=False)[:500]}")
    print(f"[info] 下载 {url[:120]}...")
    with urllib.request.urlopen(url, timeout=120) as resp:
        data = resp.read()
    with open(args.output, "wb") as f:
        f.write(data)
    print(f"[ok] 已保存 {args.output} ({len(data)} bytes)")

if __name__ == "__main__":
    main()
