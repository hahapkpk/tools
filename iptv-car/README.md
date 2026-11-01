# 安卓车机 mytv-android 自动更新直播源

此目录由 GitHub Actions 每 6 小时自动整理公开的 M3U 直播源，并生成统一、固定的网络订阅地址。**不要将 GitHub Personal Access Token 或 mytv-android 的 \`all_configs.json\` 放到本目录。**

## 车机订阅

**M3U 地址：**
https://raw.githubusercontent.com/hahapkpk/tools/main/iptv-car/live.m3u

**状态报告：**
https://raw.githubusercontent.com/hahapkpk/tools/main/iptv-car/status.json

在 mytv-android 2.2.0.219 的订阅源管理中，添加以上 M3U URL（不要填入云同步 Gist ID 栏）。添加成功后，测试央视与卫视频道能否播放。频道可能受地域、运营商、网络和上游版权/可用性限制。

## 更新说明

- 自动运行：每 6 小时，GitHub Actions 可延迟或错过个别调度。
- 手动运行：仓库 Actions → Update car IPTV playlist → Run workflow。
- 来源：OrangeWay520 / my-iptv、Lightconer / TVBox-Sources、Chaniug / IPTV-Collector、iptv-org / iptv。
- 处理：聚合 M3U、规范央视频道名、按频道合并备用流、URL 去重、限制每频道最多 4 条、排除本地/私有 IP、IPv6 直连和疑似含私密 Token 的链接；HEAD 轻量探测仅作为排序信号，404/410 删除。
- GitHub Actions 运行环境与车机使用的国内移动网络不同，**HEAD 返回成功不代表真实可播放**，返回 403/超时也不一定代表无效。
- 全部上游下载失败或生成条目不足时，脚本以非零状态退出，保留仓库中的上一份可用列表。
- 输出的 M3U 是公开播放地址的索引，不是视频缓存或转码服务。

## 与 Gist 云备份的区别

Gist 中的 \`all_configs.json\` 用来备份播放器设置和收藏。本目录只更新 **网络订阅源内容**，不会写入 Gist 或修改云备份，也不会自动覆盖你的收藏频道。

最稳妥的使用方式：车机只需添加一次上述订阅 URL；往后仓库文件自动更新，但**车机什么时候重新下载 M3U，取决于 mytv-android 自身的缓存策略、订阅刷新或重启行为**。若软件未自动刷新，请在订阅管理中手动刷新或重新进入频道列表。

**安全提醒：** 如果旧 Gist 的历史版本包含 Base64 编码的 Gist Token，应在 GitHub 中撤销该 Token；Secret Gist 不是私密保险箱，任何知道链接的人可读取内容。
