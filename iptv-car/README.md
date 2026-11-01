# 安卓车机直播源：央视优先版（mytv-android）

适用于 mytv-android V2.2.0.219。以 CCTV-1、CCTV-13 最优先，其余央视与常看卫视居后。每 6 小时自动更新、检测实际视频媒体和测速。无需额外的 GitHub Token。

## 两个固定订阅地址

日常使用（CCTV-1/CCTV-13 最前，必要时含明确标记的国内待验证备用源）：
https://raw.githubusercontent.com/hahapkpk/tools/main/iptv-car/live.m3u

严格已验证模式（仅含海外 GitHub 实测通过的线路，可能缺失央视主频道）：
https://raw.githubusercontent.com/hahapkpk/tools/main/iptv-car/live-verified.m3u

检测报告：
https://raw.githubusercontent.com/hahapkpk/tools/main/iptv-car/status.json

在车机 IPTV 订阅管理里添加第一个网络 M3U URL 即可；不要输入 Gist ID 或 Token。车机是否及时重新拉取订阅取决于软件缓存与刷新机制。

## 频道优先级

1. CCTV-1、CCTV-13 固定最前。
2. CCTV-2、3、4、5、5+、6、7、8、9、10、11、12、14、15、16、17。
3. 湖南、浙江、江苏、东方、北京、广东、山东、安徽、湖北、深圳、天津、四川、重庆、辽宁卫视。
4. 其他地方台与国际频道不放进车机主列表，减少冗余。

修改频道顺序：iptv-car/update.py 中的 FOCUS_CHANNELS。

## 自动更新

GitHub Actions 工作流：.github/workflows/iptv-car-update.yml
每 6 小时调度一次，或进入仓库 Actions → Update car IPTV playlist → Run workflow 手动启动。
源来自 OrangeWay520/my-iptv、Lightconer/TVBox-Sources、Chaniug/IPTV-Collector、iptv-org/iptv。

通过 HLS M3U8 播放清单与视频媒体分片验证；测速门槛约 280 KiB/s（约 2.3 Mbps），首批数据延迟不超过 4 秒。通常每频道保留最多 4 条已验证线路。

## CCTV-1/CCTV-13 重要例外

海外 GitHub 节点测速未通过，不等于国内车机网络不可播放。因此这两台若严格验证通过的线路不足两条，可以增加少量“常看央视（待车机验证）”的备用线路，最多合计四条。它们仅是从上游采集、尚未在车机环境确认的线路，并不意味着能看或不卡顿；明确返回 404、媒体格式虚假等错误的线路不加入备用。

日常订阅 live.m3u 保留这类标记清楚的备用源，方便车机真实试播；live-verified.m3u 不包含任何待验证线路，适合对比。
整体抓取/检测发生严重异常时，保持上一版节目单不被清空。

## 运行状态及调整

- status.json 的 priority_channels 显示每个重点频道的 verified 与 unverified_fallback 数量。
- verification 显示总候选、速度过滤和失败原因。
- streamcheck.py 定义 MIN_KIB_PER_SECOND / MAX_FIRST_BYTE_SEC 等测速门槛。
- 更准确的国内稳定性判定，需要在国内运营商网络额外部署测速节点。
- 脚本单元测试：python3 -m unittest discover -s iptv-car -p "test_*.py" -v

## Gist 备份与安全

Gist 7ac16f68822d2bcaa8c84ee128634692 仍用于播放器配置备份。直播源仓库与 Gist 相互独立，新的自动更新不需要修改 Gist。
此前 Gist 历史版本出现过可 Base64 解码的 Token：应撤销旧 Token；Secret Gist 的链接一旦泄露就可被他人读取，绝不要再上传有效 Token。

## 相关

仓库：https://github.com/hahapkpk/tools/tree/main/iptv-car
自动更新：https://github.com/hahapkpk/tools/actions/workflows/iptv-car-update.yml
测速参考：https://github.com/Guovin/iptv-api
