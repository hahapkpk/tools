#!/usr/bin/env bash
# ============================================================
# ModLens (qwen3.7-flash) 一键安装脚本
# 用法:
#   bash install.sh                # 交互式输入 apiKey（不回显）
#   bash install.sh <apiKey>       # 或直接带参
# 安装后只需:
#   python3 ~/.modlens/modlens_ocr.py <图片路径或URL>
# ============================================================
set -euo pipefail

BASE_URL="${MODLENS_BASE_URL:-https://raw.githubusercontent.com/hahapkpk/tools/main/modlens}"
DEST="${MODLENS_HOME:-$HOME/.modlens}"

echo "== ModLens (qwen3.7-flash) 一键安装 =="

command -v python3 >/dev/null 2>&1 || {
  echo "[错误] 未找到 python3，请先安装: https://python.org (macOS/Linux 一般自带)"
  exit 1
}

mkdir -p "$DEST"
echo "== 下载组件到 $DEST =="
curl -fsSL -o "$DEST/modlens_ocr.py" "$BASE_URL/modlens_ocr.py" || {
  echo "[错误] 下载调用器失败: $BASE_URL/modlens_ocr.py"
  exit 1
}
if ! curl -fsSL -o "$DEST/SKILL.md" "$BASE_URL/SKILL.md" 2>/dev/null; then
  echo "[警告] SKILL.md 下载失败（不影响调用器使用）"
fi

# ---- 获取 apiKey ----
KEY="${1:-}"
if [ -z "$KEY" ]; then
  if [ ! -t 0 ]; then
    echo "[错误] 当前 stdin 不是终端（如 curl|bash 管道），无法交互输入。"
    echo "       请先下载脚本再运行: bash install.sh <apiKey>"
    exit 1
  fi
  printf "请输入 qwen3.7-flash 的 apiKey（输入不回显）: "
  read -r -s KEY
  printf "\n"
  if [ -z "$KEY" ]; then
    echo "[错误] apiKey 不能为空"
    exit 1
  fi
fi

# ---- 写入配置（key 经环境变量传入 python，不落命令行参数）----
echo "== 写入配置 =="
MODLENS_KEY="$KEY" python3 - "$DEST" <<'PYEOF'
import json, os, sys
key = os.environ.get("MODLENS_KEY", "")
dest = sys.argv[1]
cfg_path = os.path.join(dest, "config.json")
cfg = {
    "openai": {
        "apiKey": key,
        "baseUrl": "https://llm-exsymve8p80526c8.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
        "model": "qwen3.7-flash",
    }
}
with open(cfg_path, "w") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
try:
    os.chmod(cfg_path, 0o600)
except Exception:
    pass
print("[ok] 配置已写入", cfg_path)
PYEOF

# ---- 验证 ----
echo "== 验证授权矩阵 (--probe) =="
if ! python3 "$DEST/modlens_ocr.py" --probe; then
  echo
  echo "[错误] 授权验证失败。常见原因:"
  echo "  - 该 key 未授权 qwen3.7-flash（403 access_denied）→ 百炼控制台-业务空间-模型授权里勾选，或换 key"
  echo "  - key 无效（401）→ 重新运行: bash install.sh <正确key>"
  exit 1
fi

echo
echo "==============================================="
echo "✅ 安装完成！"
echo ""
echo "识图命令:"
echo "  python3 $DEST/modlens_ocr.py <图片路径或URL>"
echo ""
echo "常用参数:"
echo "  -o 输出.json      结果写入文件"
echo "  --prompt \"...\"   额外识别指示"
echo "  --timeout 300000  超时毫秒"
echo "  --probe           再次诊断模型授权"
echo "==============================================="
