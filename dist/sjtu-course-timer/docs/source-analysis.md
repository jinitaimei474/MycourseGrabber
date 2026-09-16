# 基于当前登录页面的源码分析

> 这是 2026-09-14 的 v0.1 采集和验证记录。v0.2 沿用相同接口，新增多课程轮询、自动切换类别重新查询和结束时间；现行行为及测试见 README.md。

采集日期：2026-09-14。入口为 `https://i.sjtu.edu.cn/xsxk/zzxkyzb_cxZzxkYzbIndex.html`。

## 采集范围

- `artifacts/course-page.html`：通过 Edge“查看源码”取得的服务端 HTML。
- `artifacts/course-live.html`：通过控制台只读导出的动态 DOM，包含已经查询出来的课程和教学班。
- `artifacts/assets/`：原 HTML 引用的 64 个 JS/CSS 文件，另补充动态 DOM 明确引用的两个核心脚本。
- `artifacts/asset-manifest.json`：初始 64 个资源的 URL 和本地文件名。
- `artifacts/live-scripts.json`：动态页面实际引用的脚本 URL，包括补充的两个核心脚本。
- `artifacts/chooseCourseZzxk.js`：当前页面选课函数定义。

这些是浏览器能够取得的前端资源，不包括服务器后端源码或数据库。两处按命名推测的资源返回 404，随后通过实际动态脚本列表确认正确文件名，初版没有依赖猜测的文件。

## 页面结构

页面使用正方教务系统组件、jQuery、Bootstrap、搜索组件和动态 AJAX 加载。主脚本为 `js/comp/jwglxt/xkgl/xsxk/zzxkYzb.js`，后续动态加载 `zzxkYzbZy.js` 和 `zzxkYzbChoosedZy.js`。

查询区域位于 `#searchBox`，关键词输入框为 `input[name='searchInput']`。课程类别切换会更新 `kklxdm`、`xkkz_id` 等值；课程列表位于 `#contentBox`。

每个 `tr.body_tr` 包含：

| 字段/控件 | 含义 |
| --- | --- |
| `.jxb_id` | 教学班内部 ID |
| `.do_jxb_id` | 服务器生成的选课操作标识，不是页面上的课程号 |
| `.kch_id` | 课程内部 ID |
| `.jxbzls` | 教学班组合数量 |
| `.jxbmc` / `.jsxmzc` / `.sksj` | 教学班名称、教师、时间 |
| `.rsxx .jxbrs` / `.rsxx .jxbrl` | 已选人数、容量 |
| `.an button` | 原有选课操作按钮 |

用户看到的“课程号”不能直接替代 `kch_id` 或 `do_jxb_id`。初版从原页面读取这些值，不硬编码账号、令牌、选课轮次或教学班 ID。

## 已确认的请求

| 操作 | 路径 | 证据 |
| --- | --- | --- |
| 加载类别页面 | `/xsxk/zzxkyzb_cxZzxkYzbDisplay.html` | 主 JS 中 `.load()` |
| 查询课程列表 | `/xsxk/zzxkyzb_cxZzxkYzbPartDisplay.html` | `loadCoursesByPaged()` |
| 刷新课程的教学班余量 | `/xsxk/zzxkyzbjk_cxJxbWithKchZzxkYzb.html` | `loadJxbxxZzxk()`；已在真实页面验证只读调用 |
| 前置选课提示 | `/xsxk/zzxkyzb_cxXkTitleMsg.html` | `checkCourse_2()` |
| 冲突检测 | `/xsxk/zzxkyzb_cxCtKcZyZzxkYzb.html` | `checkCourse_20()` / `checkCourse_25()` |
| 最终选课提交 | `/xsxk/zzxkyzbjk_xkBcZyZzxkYzb.html` | `saveCourse()` / `saveDjxbCourseBc()`；未实际提交 |

提交参数包括 `jxb_ids`（来自动态 `do_jxb_id`）、`kch_id`、`xkkz_id`、`kklxdm`、`xklc`、`xkxnm`、`xkxqm` 和容量/重修/教学班等选项。页面还存在动态 CSRF 字段及请求工具封装。因此直接拼 HTTP POST 容易漏掉运行时条件，初版只点击原有按钮。

最终提交响应中，页面源码将 `flag=1/3/6` 作为成功处理；`-1` 表示容量不足，`2` 进入冲突提示，其余需要检查原因。**其他接口的 flag=1 不代表已经选课成功。**

`chooseCourseZzxk()` 会进入校验链：学分/门次/志愿数检查、选课提示、可能的权重选择、时间冲突、教材或组合教学班处理，之后才提交。初版保留这些逻辑，遇到弹窗停止，不绕过校验。

## 现场发现的兼容性

学校旧版工具改写了 `Array.prototype.filter` 和 `some`，回调参数顺序变为“下标、元素”，还将 `String.prototype.trim` 改为删除全部空白。第一次现场扫描因此漏掉了课程行。初版改用独立迭代和正则首尾清理，回归测试在相同改写环境下执行。

## 已完成的验证与边界

- 13 项 Node 行为测试通过，含旧版原型改写回归测试。
- 实际页面扫描识别到 66 个教学班，数据用于验证识别能力，不意味着全部教学班均适合自动提交。
- 面板只读检查监测到 0 个 AJAX 请求，没有执行提交。
- 余量刷新验证实际发出教学班查询请求，返回目标班 90/90、满员；未出现最终选课提交请求。
- 尚未检验真实选课成功、账户过期后的重新登录、父子教学班组合、验证码或自动处理确认弹窗。

网站原函数中存在同步 AJAX；请求阻塞主线程时，页面的停止按钮及 15 秒响应计时器可能延后执行。停止不能撤回已经发出的请求。若后续要求更强的超时控制和后台调度，应改为 Playwright 外部调度并重新验证接口行为。
