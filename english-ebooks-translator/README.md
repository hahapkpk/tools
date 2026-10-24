# 每周英文 EPUB → 简体中文（私有运行）

这是源码与部署模板，不是电子书发布站。公共代码中不包含原书、译文、缓存或密钥。仅在你有权使用原书且服务条款允许时运行；**私有仓库并不自动取得版权许可**。

## 当前状态：已实现 ≠ 已上线

- 已实现：EPUB 检查/翻译 CLI；私有仓库定时发现上游、每次最多处理一期、校验下载、草稿 Release 上传/回读验证/发布；进程内安全输入 API key 的本地入口。
- 自动化单元测试使用受控的 API/子进程替身，不联网、不扣费、不创建真实 Release。Python 标准库即可运行。
- 本地真实 `2026.10.24` EPUB 已完成只读 inspect；**没有因此生成整本中文译书**。
- 已通过 GitHub 浏览器授权并创建私有仓库 `hahapkpk/english-reading-zh`。本地完整测试套件 35 项通过。
- 尚未验证：真实 DeepSeek 翻译效果/耗时/账单、GitHub Actions 和真实 Release 端到端翻译。模板中的 `__CODE_REF__` 必须在部署前替换。单元测试不代表真实翻译已经完成。

## 1. 本地先检查，不收费

安装 Python 3.12 或更高版本，确认终端里的 `python --version` 可用。在本目录执行：

```console
python -m ebook_translator inspect --input "D:\Books\issue.epub"
python -m unittest discover -s tests -p test_automation.py -v
```

Windows 可双击 `inspect.bat` 后输入文件路径，也可把 EPUB 拖到该批处理文件上。它只检查 ZIP/XML 结构、字符/片段数量和图片哈希，不需要 API key，不调用模型。

### 本地完整翻译（会收费）

双击 `run.bat`。依次输入输入文件、输出文件、模型名；只有输入大写 `YES` 才继续到密钥提示。

- 用 `getpass` 隐藏输入 `DEEPSEEK_API_KEY`；不把密钥放进命令行、不回显、不写 `.env`、不保存配置。没有安全控制台时拒绝降级为明文输入。
- 密钥只交给本次子进程；关闭窗口后，下次需重新输入。不实现 GitHub 登录，也没有 GUI。
- 译文写入你选择的位置，拒绝覆盖已有文件。私有 SQLite 缓存位于 `%LOCALAPPDATA%\EnglishEbooksTranslator\translation.sqlite3`；**缓存含原文与译文，不是无敏感数据的普通缓存**。
- 默认源字符上限 `600000`；可在启动前设置环境变量 `MAX_SOURCE_CHARS`。这是字符上限，不是美元/人民币或 token 上限。重试可能产生额外费用；真实小样本测试前整期成本未知。
- 为避免异常回显模型响应或密钥，启动器隐藏子进程输出，只显示成功/失败。失败时不要把密钥、书文或完整 HTTP 请求贴到聊天/Issue。

高级用户可直接调用 CLI；`--api-key-env` 后面只能是环境变量**名称**，不是密钥：

```console
python -m ebook_translator translate --input "D:\Books\issue.epub" --output "D:\Books\issue.zh.epub" --cache "D:\PrivateCache\translation.sqlite3" --model deepseek-v4-flash --base-url https://api.deepseek.com/v1 --max-chars 600000 --api-key-env DEEPSEEK_API_KEY
```

`--max-units N` 只用于单独的小样本试译，输出文件名必须包含 `sample`；自动化不会把样本当整书上传。全量翻译失败或不完整时，核心 CLI 不应交付完整输出。

## 2. 安全建立私有云端运行仓库

1. **只在 GitHub 官方网站或官方 CLI 的浏览器授权页面登录。** 如使用 CLI，运行 `gh auth login --hostname github.com --web`，按浏览器提示确认。不要向聊天发送密码、验证码、OAuth 回调链接、PAT 或 API key。本项目不代办登录。
2. 新建名为 **`english-reading-zh`** 的仓库，选择 **Private** 并初始化默认分支。授权完成后本人核对仓库右上方 Private 标志；不要把译书放在公共 `hahapkpk/tools`。
3. 在私有仓库 Settings → Secrets and variables → Actions → Repository secrets 添加 `DEEPSEEK_API_KEY`。只在 GitHub 自己的 Secret 表单里输入。运行时使用 GitHub 自动提供的 `GITHUB_TOKEN`，**不需要另建 PAT**。
4. 将 `templates/private-weekly.yml` 复制到私有仓库的 `.github/workflows/weekly.yml`。将所有 `__CODE_REF__` 替换成已经审核并推送到 `hahapkpk/tools` 的同一个 **40 位完整 commit SHA**。公共代码位于该仓库的 `english-ebooks-translator/` 子目录，checkout 到 `code/`。
5. 先保持 Repository variable `ENABLE_TRANSLATION=false`。在 Actions 手动运行时选择默认的 `mode=sample`，只翻译前 100 个文本片段，输出有 SAMPLE 标记，剩余内容仍为英文。样本也会调用付费接口；本期约覆盖 1.3 万源字符。检查质量与账单后，再将 `ENABLE_TRANSLATION` 改为字符串 `true`，手动选择 `full` 或等待每日调度。未开启时，整期和定时任务均跳过，不会因为添加密钥而直接开始整期翻译。
6. 成功后只在该私有仓库 Releases 下载 `translated.zh.epub`（整期）、`translated.sample.zh.epub`（样本）与 `manifest.json`。样本使用独立 `sample-` 前缀 tag，绝不会被计作整期完成。不要开启 Pages，不要手工把仓库改为 Public，不要重新分发无授权内容。

模板仅放在 `templates/`，本公共源码不包含触发付费任务的 `.github/workflows/`。模板工作任务先检查事件仓库为 private，Python 又通过**带认证的 GitHub REST API**验证当前 `GITHUB_REPOSITORY` 的 `full_name` 与 `private is True`，在下载原书前，以及翻译/上传/发布前重复检查。仓库可见性被其他人并发修改仍有竞态风险，因此必须保持私有且限制管理权限。

### 可选 Repository variables（不是 secrets）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `START_ISSUE` | `2026.10.24` | 包含当天，格式 `YYYY.MM.DD`，只从此日期起查找 |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | 按本项目需求保留该默认别名；见下方官方文档变化说明 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | 只改成你信任的 API 地址；密钥会发送给该服务 |
| `MAX_SOURCE_CHARS` | `600000` | 源字符总上限，不是费用上限；超限应停止而不是发布残缺译书 |
| `ENABLE_TRANSLATION` | 未设置/`false` | 只有字符串 `true` 才允许整期与定时翻译；样本可以单独手动运行 |

**模型名会变。** 本次读取 DeepSeek 官方价格页时，页面已推荐 `deepseek-flash`，说明旧 `deepseek-v4-flash` 别名仍接受、实际由 DeepSeek-V4.1-Flash-1017 提供服务并按 Flash 计费。因此配置是可变的，不应把默认别名理解为固定模型版本。不要沿用旧 `deepseek-chat` 示例；启用前再次检查官方模型/计费说明，本项目不承诺单期成本。

## 3. 自动化策略与安全边界

- 上游固定为 `hehonghui/awesome-english-ebooks`，`master` 分支、`01_economist` 路径；通过公共 GitHub API 枚举，不执行上游内容。无效日期、其他路径、非 EPUB、非法 blob SHA 被忽略；树返回 truncated 时拒绝继续。
- 按日期从早到晚选择尚未完成的版本，**每次最多一期**。调度为每天 UTC `01:23`（cron `23 1 * * *`）；这不是每次只看最新一期，也不是一次补齐所有积压。并发组不取消前一个任务。
- Release tag 为 `economist-日期-完整源blobSHA`；相同期数内容修订后会有新 tag。完整发布资产有 manifest 与输出 SHA-256，跳过前重新下载并核验；不能仅凭同名 tag 判定成功。
- 原书限 20 MiB；下载 Git blob API 返回的 base64，核对元数据的 SHA/size，重新计算 Git 的 `SHA1("blob " + 大小 + NUL + 实际字节)`。API JSON 响应也有体积上限。
- 先完整翻译，再创建/复用 **Draft Release**，上传译书与 manifest，下载回读并逐字节核验两项资产，最后取消 Draft 并读取对应 tag 验证已发布。目标仅为当前私有仓库，不向上游或公共代码仓库发布。
- 若留下完整且校验通过的草稿，下次可直接发布而不再付费翻译。缺资产/上传中断的草稿会复用同一 tag，借助 SQLite 缓存重试；缓存丢失、模型改变或未完成片段仍可能再次收费，**不保证 exactly-once 计费**。已发布但校验失败的资产会停止运行，要求人工检查，不会静默覆盖。
- 只缓存私有 `.cache/` 中的 SQLite，不上传 GitHub Actions artifacts。缓存恢复后即便翻译步骤失败也尝试保存；硬终止、超时、额度耗尽等仍可能导致缓存未保存。私有仓库的缓存也包含文章内容，管理权限应最小化，不要改模板增加不可信 PR 触发器。
- 工作流仅请求 `contents: write`；Actions checkout/setup-python/cache 使用从官方仓库实际读取的完整 SHA，checkout 不持久化凭据。运行依赖 Python 标准库及 GitHub 托管 runner 提供的 `gh`。
- `GITHUB_STEP_SUMMARY` 仅输出固定状态和每次一期上限；不输出文章、源文、提示词、密钥或原始 API 错误。自动化隐藏子进程日志；定位失败应优先检查权限、配额、输入大小、模型名和草稿状态，而不是打开包含书文的调试输出。

### 已核验的 Actions 固定引用

以下是通过官方仓库 `git ls-remote` 读取的 tag 指向，不是凭记忆填写；不表示做过供应链审计，也不保证永远最新：

| 官方仓库 tag | 固定 SHA |
|---|---|
| `actions/checkout` `v4` | `11d5960a326750d5838078e36cf38b85af677262` |
| `actions/setup-python` `v5` | `a26af69be951a213d495a4c3e4e4022e16d87065` |
| `actions/cache` `v4`（restore/save 子动作） | `0057852bfaa89a56745cba8c7296529d2fc39830` |

可重新核验：`git ls-remote https://github.com/actions/checkout.git refs/tags/v4`（其他两个仓库同理）。云端仍可能遇到 API 限流，失败时不自动无上限重试。发现上游时会跳过起始日期之前的已知期刊目录，避免为历史每一期浪费 API 请求。

## 4. 验证范围与后续验收

自动化测试命令：

```console
python -m unittest discover -s tests -p test_automation.py -v
```

覆盖日期与起始日、路径筛选、版本 tag、私有守卫、修订幂等决策、Git blob 校验/体积限制、CLI 参数、一次只选最早一期、上传失败/回读损坏不发布、草稿恢复、完成版本跳过、错误脱敏、仅进程密钥、本地不落密钥配置。开发记录包含先看到缺失行为的 RED，再实现并通过 GREEN；真实网络边界以替身隔离。

上线验收仍需本人在私有仓库完成：确认 API key 有效 → 小样本质量/账单 → 替换已推送源码 SHA → 手动运行一期 → 阅读器检查排版、图片与链接 → 对照账单 → 再运行验证同 revision 不重新翻译 → 开启定时。**测试通过不等于已经完成这些验收。**

官方参考（部署前再次检查）：

- DeepSeek 价格与当前模型：`https://api-docs.deepseek.com/quick_start/pricing`
- GitHub CLI 浏览器登录：`https://cli.github.com/manual/gh_auth_login`
- GitHub CLI Release 下载参数：`https://cli.github.com/manual/gh_release_download`
- GitHub Git blob API：`https://docs.github.com/en/rest/git/blobs`
