# ============================================================
# ModLens (qwen3.7-flash) 一键安装脚本 (Windows PowerShell)
# 用法:
#   powershell -ExecutionPolicy Bypass -File install.ps1                # 交互式输入 apiKey（不回显）
#   powershell -ExecutionPolicy Bypass -File install.ps1 <apiKey>       # 或直接带参
# 安装后只需:
#   python3 $HOME\.modlens\modlens_ocr.py <图片路径或URL>
# ============================================================
$ErrorActionPreference = "Stop"

$BaseUrl = "https://raw.githubusercontent.com/hahapkpk/tools/main/modlens"
$Dest = Join-Path $HOME ".modlens"

Write-Host "== ModLens (qwen3.7-flash) 一键安装 =="

if (-not (Get-Command python3 -ErrorAction SilentlyContinue)) {
    Write-Host "[错误] 未找到 python3，请先安装: https://python.org (安装时勾选 Add to PATH)"
    exit 1
}

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Write-Host "== 下载组件到 $Dest =="
Invoke-WebRequest -UseBasicParsing -OutFile (Join-Path $Dest "modlens_ocr.py") "$BaseUrl/modlens_ocr.py"
try {
    Invoke-WebRequest -UseBasicParsing -OutFile (Join-Path $Dest "SKILL.md") "$BaseUrl/SKILL.md"
} catch {
    Write-Host "[警告] SKILL.md 下载失败（不影响调用器使用）"
}

# ---- 获取 apiKey ----
$Key = ""
if ($args.Count -gt 0) {
    $Key = $args[0]
} else {
    $Secure = Read-Host "请输入 qwen3.7-flash 的 apiKey（输入不回显）" -AsSecureString
    $Key = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure))
    if ([string]::IsNullOrEmpty($Key)) {
        Write-Host "[错误] apiKey 不能为空"
        exit 1
    }
}

# ---- 写入配置 ----
Write-Host "== 写入配置 =="
$cfg = @{
    openai = @{
        apiKey  = $Key
        baseUrl = "https://llm-exsymve8p80526c8.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
        model   = "qwen3.7-flash"
    }
} | ConvertTo-Json -Depth 3
$CfgPath = Join-Path $Dest "config.json"
Set-Content -Path $CfgPath -Value $cfg -Encoding UTF8
Write-Host "[ok] 配置已写入 $CfgPath"

# ---- 验证 ----
Write-Host "== 验证授权矩阵 (--probe) =="
python3 (Join-Path $Dest "modlens_ocr.py") --probe
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[错误] 授权验证失败。常见原因:"
    Write-Host "  - 该 key 未授权 qwen3.7-flash（403 access_denied）→ 百炼控制台-业务空间-模型授权里勾选，或换 key"
    Write-Host "  - key 无效（401）→ 重新运行: install.ps1 <正确key>"
    exit 1
}

Write-Host ""
Write-Host "==============================================="
Write-Host "✅ 安装完成！"
Write-Host ""
Write-Host "识图命令:"
Write-Host "  python3 $Dest\modlens_ocr.py <图片路径或URL>"
Write-Host ""
Write-Host "常用参数:"
Write-Host "  -o 输出.json      结果写入文件"
Write-Host "  --prompt `"...`"   额外识别指示"
Write-Host "  --timeout 300000  超时毫秒"
Write-Host "  --probe           再次诊断模型授权"
Write-Host "==============================================="
