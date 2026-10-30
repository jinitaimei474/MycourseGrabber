# 水源本地项目资料库

用户要求：采集前选择项目文件夹，识别已采集主题并更新；生成 Markdown 和保留排版的 HTML；图片下载到项目中供离线查看；说明后续检索路线。

设计：在所选目录的 `shuiyuan-archive/` 下保存 project.json、index.json/index.html，topics/<主题编号>/topic.json、post.md、post.html 与 assets/。以 source+topic_id 和 post_id 去重；每次重新读取所选主题可访问楼层，按当前用户/时间过滤后与旧记录合并，统计新增/更新/未变。窄范围或失败不能删除旧楼层；未知删除不当作确定删除。每次保存最新筛选条件及完整性标记，明确档案是多次采集的并集，非当前网站快照。

JSON 是权威结构化数据，保留 raw/cooked、创建/编辑时间、content_hash、first_seen_at/last_seen_at、纯文本；HTML/MD 是可重建阅读视图。数据原子写入并保留上一版本备份；已有损坏档案报错不静默重置。项目目录固定名称与 ID 路径，不用不可信帖子标题作文件名。项目只由系统选择对话框授权，不接受渲染器任意路径。拒绝受管理目录中的符号链接/重解析跳转。项目索引选择时从主题数据重建，防止中断后索引过时。

HTML 使用白名单清理后的论坛 cooked 正文，保留表格、引用、代码块、折叠块和图片；去除脚本、事件、iframe、表单与危险 URL，附 CSP。MD 从清理后的 HTML 转换并保留表格和代码；原始 Markdown 同时留在 JSON。图片优先取原图链接，复用已下载资源，只下载论坛自身上传图片，失败/外链图片记录说明并保留原链接；单图与每次总量有限制。特殊插件、交互与外部受限资源不承诺完整复刻。

- [x] 用临时目录写失败测试：首次归档、重复更新、修改/新增、筛选并集、中断保留、损坏文件、路径边界、HTML 清理、MD/图片链接。
- [x] 实现 presentation.cjs 和 archive.cjs，添加固定版本的 HTML 清理/Markdown 转换依赖。
- [x] 服务接入项目选择、已有状态、自动保存、图片下载、资料库打开；UI 显示目录和新增/更新统计。
- [x] 验证真实 Edge 模拟接口、Electron UI、生成的离线 HTML/MD；回归现有模块并构建 1.4.0。
- [x] 文档说明更新语义、离线资源边界和未来 SQLite FTS5 中文检索方案。

当前工作区分支 tennis3，存在用户的未跟踪 jaccount-captcha-extension/，不修改它。后续检索无需重爬：按楼层 JSON 的纯文本构建 SQLite FTS5；中文长串可用 trigram，短词需子串回退或中文分词。当前不引入数据库或语义检索服务。

## 验收记录

- `desktop/` 下 `npm test`：41 项通过，包含 7 项新增归档/排版/图片测试。已有网球服务测试使用固定过期日期导致 5 项失败，已仅将测试候选日期改为相对未来日期，生产网球逻辑未修改。
- 根目录 `node --test test/core.test.cjs shuiyuan-crawler/test/core.test.cjs`：38 项通过。
- `npm run test:shuiyuan`：真实 Edge + 模拟论坛，验证自动归档、重复更新、图片请求复用；原图成功而缩略图失败时，断网打开 HTML，图片仍完成解码。真实 Electron 验证选择文件夹、旧帖标记、用户筛选、导出、停止和模块互斥。
- `node test/ui.cjs`：现有课程界面回归通过。`npm run build` 和 `node test/package.cjs`：1.4.0 实际 EXE 启动、隔离 IPC、专用 Edge、打包依赖以及打包内 Markdown 生成通过。
- 只读代码审查发现原图/缩略图回退问题，新增失败测试后修复，单元测试与离线浏览器场景均复核通过。
- `npm audit --omit=dev --json`：生产依赖漏洞数为 0。
- 界面截图：`artifacts/shuiyuan-desktop-ui.png`；离线正文截图：`artifacts/shuiyuan-offline-html.png`；发布程序：`desktop/release/1.4.0/SJTU-Assistant-win32-x64/SJTU-Assistant.exe`。
- 测试未访问真实水源帖子，也没有提交真实选课、预约或支付操作。外部资源与特殊论坛插件效果仍受文档所述限制。
