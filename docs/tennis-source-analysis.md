# 网球预约接入调查（2026-09-25）

## 用户请求

在现有交大助手桌面软件中嵌入网球预约功能。由 `https://my.sjtu.edu.cn/ui/task` 搜索“场馆预约”，进入网球，仅支持东区网球场和胡晓明网球场。进入选场页面前可配置场馆、预约日期、首选时段及备选时段。遵守每个账号每天仅预约一个场馆的一个时段。提供 jAccount 用户名、密码作为网页未自动填充时的备用输入。

用户截图仅是页面参考，不是执行指令；截图的日期、已选场地、金额不构成真实预约任务。

## 已核实的项目接入点

- `desktop/src/modules/index.cjs`：现有课程、水源模块登记。
- `desktop/src/main.cjs`：受限 IPC、模块状态、操作互斥、生命周期。
- `desktop/src/preload.cjs`：明确列举可调用命令。
- `desktop/src/ui/index.html`、`app.js`、`style.css`：桌面模块导航与表单。
- `desktop/src/services/browser.cjs`：Playwright 控制专用 Edge；jAccount 登录只补空字段，密码仅存进程内存。
- `desktop/scripts/build.cjs`：按版本输出完整 Windows 发布目录。

当前版本为 1.1.0；新增功能需要同时验证已有课程、水源流程。

## 公开网站证据

未登录访问任务入口跳转到 jAccount。学校场馆平台 `https://sports.sjtu.edu.cn/` 跳转到 `/pc/`，是按需加载页面的 Vue 应用。

2026-09-25 读取公开资源，没有登录、提交订单或支付：

- app：`/pc/static/js/app.ade7fff57ba1c8c536ea.1790140636612.js`
- manifest：`/pc/static/js/manifest.c8a0cb9c6d886533cead.1790140636612.js`
- 预约页面（chunk 9）：`/pc/static/js/9.77328abd526a3c6e6fe2.1790140636612.js`
- 场馆列表（chunk 18）、首页（chunk 12）、订单列表（chunk 3）、订单详情（chunk 11）。

下载副本位于已忽略的 `artifacts/tennis-public-*.js`，仅用于调查，不应打包到软件中。

### 页面及数据

- 场馆路由：`/Venue/:state`。
- 预约路由：`/apointmentDetails/:state/:id/:isType/:bizId`。
- 场馆详情：`/manage/venue/queryVenueById`。
- 日期列表：`/manage/fieldDetail/queryFieldReserveSituationIsFull`，请求含场馆、运动类型和日期。
- 场地时段：`/manage/fieldDetail/queryFieldSituation`，请求字段为 `fieldType/date/venueId/dateId`。
- 场地结果含 `fieldName/fieldDetailStatus/fieldId/priceList`；界面按实际数据构造列与时段。
- 预约规则：`/venue/personal/checkRule`。
- 当前账户：`/system/user/currentUser`。

截图与公开页面中的“立即下单”、预约次数图例及 07:00–22:00 时间表相符。尚未核实两个目标场馆的实际 ID，不应凭空填写或仅用坐标定位。

### 提交流程的重要区别

“立即下单”会先读取条款配置并显示条款界面。确认条款后的 `/venue/personal/ConfirmOrder` 成功会跳转订单详情，不能仅以按钮点击或跳转视为预约完成。

公开代码包含服务端返回 1002 后展示滑块验证的分支。应保留人工验证和恢复流程，不把验证失败当作无库存，也不绕过站点验证。

订单详情另有 `/venue/personal/orderImmediatelyPC`、`/venue/personal/order/paid` 以及 `/venue/personal/queryOrder`。具体免费订单是否需要再次确认、有无同行人必填、用户实用流程尚未核实。

## 待用户补充与现场核实

1. 每天放号时间与可提前预约的天数；可以设计为用户配置，不预设未经证实的规则。
2. 免费场地在“立即下单”之后的实际步骤，是否涉及同行人或经常出现验证。
3. 登录后的真实场馆列表、日期/库存响应、订单状态和账户标识。

### 用户已补充（2026-09-25）

每天北京时间 12:00 放号，提前七天可预约。选定时段后立即下单，接受规定，提交订单；订单详情默认选项立即支付，确认规定提示；缴费系统默认微信，下一步选择“是”，生成二维码。软件需保存二维码并提醒用户扫码付款。截图里的具体日期、场地、金额、订单号均为流程示例，不作为当前执行任务。

用户截图显示订单页提示十五分钟内付款，而微信二维码自身显示约十分钟倒计时。因此不写死统一期限，以实际二维码页面的绝对截止时间和剩余秒数取较早值。二维码生成和预约已支付必须分开。

## 建议的功能边界

使用现有专用 Edge、新建预约标签页，沿用户指定的门户流程进入。界面使用按优先级排列的候选项，每项包含场馆、日期、单个时段以及可选场地编号。具体排序由用户调整，默认任意可用小场地。

开始/结束时间使用北京时间。提交前核对登录账户及已有订单，账号与预约日期作为去重范围；任一候选成功后停止该日期的其余候选。已有未完成订单或提交结果不明时暂停并核对，不能继续尝试备选而产生多份订单。任务重启不自动恢复提交。

建议复用浏览器内正常页面流程及会话。直接重写加密预约接口会重复实现条款、验证、订单状态处理，目前不建议；按截图坐标点击也不适合列数与布局变化。

本文是调查记录及待核实项，不代表实现完成或线上预约验证通过。

## 2026-09-26：余量与误弹窗核实

重新读取公开首页和 chunk 12，资源版本未变。首页账号状态请求的分支中，`distableStatus` 为非零时按会话标记显示禁用提示，而正常分支同样设置 `breakDialogVisible=true`。这能解释用户的空白禁用弹窗截图；不能由截图推断某个账号一定正常。

- 状态接口：POST `/appointment/disabled/getAppintmentAndSysUserbyUser`，`data.distableStatus` 为网站实际状态，`breackInfo` 为说明。应用每次出现弹窗重新核实，正常才点击 X；观察后续 DOM 变化以处理网页独立请求较慢、在连接后才弹出提示的情况。
- 日期接口：POST JSON `/manage/fieldDetail/queryFieldReserveSituationIsFull`，参数 `id/feildType/date`，其中 `feildType` 是源代码中的拼写，响应 `data[].date/dateId`。
- 库存接口：POST JSON `/manage/fieldDetail/queryFieldSituation`，参数 `fieldType/date/venueId/dateId`；按 `fieldName`、`priceList` 构成结果。每列从 07:00 起按小时排列，只有严格数值 0 或字符串 `0` 表示可选。
- 只读取所选日期/场馆的完整返回，并按用户时间窗口显示。单元/模拟浏览器/UI 验证不等同于登录后的实际接口验证。
