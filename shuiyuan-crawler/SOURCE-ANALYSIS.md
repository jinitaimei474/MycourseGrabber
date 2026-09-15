# 水源源码与接口分析

## 现场确认（2026-09-14）

通过用户已登录的 Edge 水源标签页，只读检查 DOM、meta generator、脚本 URL 和接口响应。页面使用 Discourse `2026.5.0-latest.1`，提交 `7ce032bd12b98f08ff810e6ec4a143e23c35144b`。外部无登录访问会跳转至交大 jAccount，因此采用同源浏览器扩展请求。

首页 DOM 中的 `a.title[href^="/t/"]` 可定位主题链接。Discourse 通过脚本动态加载内容，仅抓 HTML 或当前渲染楼层会遗漏长帖。因此程序调用页面本身使用的 JSON 接口，不依赖逐页滚动。

| 请求 | 已核对结构 | 用途 |
| --- | --- | --- |
| `GET /t/{id}.json?include_raw=true` | `id`, `title`, `post_stream.stream`, `post_stream.posts` | 获取主题、楼层 ID 索引和首批正文 |
| `GET /t/{id}/posts.json?post_ids[]=...&include_raw=true` | `post_stream.posts` | 按 ID 分批补齐正文 |
| `GET /search.json?q=Xflops+in%3Atitle&page=1` | `topics`, `grouped_search_result.more_full_page_results` | 按标题搜索并让用户选择，支持更多结果 |

帖子字段：`id` 为全站楼层 ID，`post_number` 为主题内楼层号，`username` 为账号名，`name` 为昵称，`created_at` 为发帖时间，`updated_at` 为编辑时间，`raw` 为 Markdown 原文，`cooked` 为渲染 HTML。现场两个正文接口均返回 `raw`。时间过滤使用 `created_at`，同时导出 UTC 原值与北京时间。

## 现场功能验证

测试主题为首页可见的超算队分享活动帖 #515272，当时共有 5 楼。记录见 `artifacts/live-verification.json`。

- 主题接口返回 5 个 ID 和 5 条首批正文。
- 指定楼层批量接口返回正确 ID，包含原文。
- 搜索 `Xflops` 返回 4 个主题，包含测试目标。
- 面板完整抓取 5/5，全部用户匹配 5 条。
- 指定首帖作者及对应北京时间日期，匹配 1 条。
- 未来时间段匹配 0 条，仍正确报告任务完整。
- TXT 与 JSON 导出按钮生成了相应 Blob；解析 JSON 确認 5 条均有 UTC 和北京时间，TXT 有时间标记。验证时拦截实际文件下载，未将样本保存到用户下载目录。
- 已在真实页面临时加载面板。持久安装的扩展路径尚未替用户加载，刷新后的自动注入需要按 README 安装。

## 自动化验证与边界

Node 内置测试覆盖 47 楼分批抓取（超过初始一批）、重复楼层、网址中的主题/楼层编号区分、用户精确匹配、北京时间起止边界、非法日期、缺失楼层、失败后部分结果保留、取消、429 重试和搜索翻页参数。项目现有选课工具的测试也同时运行通过。

真实站点完整抓取验证为 5 楼，长帖全量行为由 47 楼模拟接口测试覆盖；不把模拟测试描述为线上大规模爬取验证。动态新增、已删除或不可见的内容无法由初始可见索引保证，导出文件会报告索引内的缺失项和异常字段。

## 上游依据

- 水源官方组织介绍：https://github.com/ShuiyuanSJTU
- Discourse 主题接口实现：https://github.com/discourse/discourse/blob/main/app/controllers/topics_controller.rb
- Discourse 搜索接口实现：https://github.com/discourse/discourse/blob/main/app/controllers/search_controller.rb
- Discourse 主题接口结构测试：https://github.com/discourse/discourse/blob/main/spec/requests/api/topics_spec.rb

实际接口适配以本次登录页面观察为准，上游 main 会继续变化。
