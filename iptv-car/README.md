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


## 严格媒体验证（2026-11-01 升级）

过去仅用 HEAD 检查 HTTP 200，会把打不开的视频、错误的网页、空节目、卡顿线路带入列表。当前改为：

1. **GET 请求取真实内容**：读取 HLS M3U8 主/子播放列表，寻找有效的直播分片；直链媒体则读取少量实际数据，拒绝 HTML/JSON 占位页。
2. **视频数据格式验证**：检查 TS 同步标志、fMP4 / FLV 等媒体头；排除无法读到真实媒体片段的链接。
3. **速度和首屏延时筛选**：抽样至少 48 KiB 媒体数据，速率低于 **280 KiB/s** 或首批数据延迟超过 **4 秒**的线路不写入。单段测试有最大用时限制，结果仅为短时抽样指标，不代表持续 4G/5G 播放不卡顿。
4. **同频道择优**：优先低首屏延迟、高测速；每频道最多 4 条已通过验证的线路。
5. **失败保护**：若本次得到少于 15 条线路或不足 10 个频道，任务报错，**保留上一次发布的 M3U**，防止一次大范围封锁导致空列表。

所有验证在 GitHub Actions 提供的网络节点执行。**GitHub 测速不等于你车机移动网络上的速度**。需要最准确的国内运营商检测，可考虑在国内电脑或自有网络增加一台检测节点，上传结果供本仓库汇总；现阶段不需要给验证脚本提供 GitHub Gist Token。

健康状态在 \`status.json\` 的 \`verification\` 字段查看，包括已通过/已剔除数量及原因。\`probe\` 旧字段已停止使用。
项目实现参考： https://github.com/Guovin/iptv-api （更完整的 IPTV 测速 / 分辨率 / 广告过滤方案）。
