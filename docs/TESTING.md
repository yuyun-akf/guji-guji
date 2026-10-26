# 回归记录

## v0.8.13 — 2026-10-26

- `node --test tests/core.test.mjs tests/startup.test.mjs tests/social.test.mjs`：**94/94 通过**。语法检查、`git diff --check` 均通过。
- 静态断言：小手机通用 FontAwesome 图标已经由猫耳水母内联 SVG 取代，SVG 包含简笔画的淡紫蓝主体、粉色猫耳；图标保持 54px 点击区域但只绘制 48px 吉祥物。
- 位置持久化、取消拖动、正常轻点和浏览器原生顶层仍由原有测试覆盖；还需真实 Android WebView 确认细节是否清楚及点击区是否正常。

## v0.8.12 — 2026-10-26

- `node --test tests/core.test.mjs tests/startup.test.mjs tests/social.test.mjs`：**94/94 通过**，语法检查与 `git diff --check` 通过。
- 悬浮图标替换为本插件内置 SVG；无额外网络资源或其他扩展依赖。保留 Popover 手动顶层显示、显示开关以及完整卸载流程。
- 受控 DOM 回归：触摸轻微偏移不保存位置；超过阈值拖动后松手只保存一次扩展设置、阻断本次点击；位置比例可供窗口尺寸变化时恢复并限制在视口中；取消拖动不覆盖已保存位置。
- 尚未在安卓真机核验手指拖动、点击、旋转屏幕及宿主美化覆盖情况；浏览器集成脚本仍需安装 Chromium 后执行。

## v0.8.11 — 2026-10-26

- 用户真机 v0.8.10 日志：悬浮开关开、DOM 存在、脚本引用一致、`display=grid`、`visibility=visible`，但实际矩形 `(292,-176) 54×54`，所以按钮在视口上方，遮挡层与瞬息插件不是当前证据指向的故障。
- 修改本插件浮窗定位约束并优先启用浏览器原生 Popover 顶层；旧 WebView 回退普通 fixed。补充受控 DOM 的 Popover 开关测试，诊断记录是否成功进入顶层。
- `node --test tests/core.test.mjs tests/startup.test.mjs tests/social.test.mjs`：**93/93 通过**；`node --check index.js`、`node --check bootstrap.js`、`git diff --check` 均通过。
- `tests/browser.test.cjs` 已加入「带 transform 的宿主页面滚动后按钮仍在视口」测试，但执行环境没有安装 Chromium，无法完成真实浏览器测试；**Android 真机仍需查看按钮位置、点击行为及顶层诊断**。

## v0.8.10 — 2026-10-26

- `node --test tests/core.test.mjs tests/startup.test.mjs tests/social.test.mjs`：**93/93 通过**；语法检查及改动空白检查通过。
- 新增诊断分类测试：按钮缺失、被隐藏、在视口外、中心被其他元素遮挡、几何位置正常；保留旧的悬浮开关与启动回归。
- 诊断在关闭手机、切换开关、挂载后触发。MutationObserver 仅在按钮已开启但实际被移除时安排探测，诊断签名不变不重复写运行日志；扩展设置状态文字相同时不重复改动 DOM，避免触发循环。
- **仍需安卓实测**：关闭手机后到「运行日志」检查 `悬浮按钮诊断`；若日志显示按钮“几何位置正常”但用户仍看不见，需进一步调查 WebView 顶层渲染／遮挡，不能把此状态当作最终修复。

## v0.8.9 — 2026-10-26

- `node --test tests/core.test.mjs tests/startup.test.mjs tests/social.test.mjs`：**92/92 通过**；静态语法与 Git diff 空白检查通过。
- 受控 DOM 回归确认：旧 `<details>` 面板可替换；设置页仅有单个原生 `inline-drawer-header`、`inline-drawer-content` 和酒馆按钮；玩家切换悬浮状态会调用 `saveSettingsDebounced`、改变真实按钮可见性、更新状态文字；按钮被宿主移除后能重新挂载；内联样式优先级 `important` 保持定位。
- 静态核对 SillyTavern 1.18.0 官方 `index.html` 的扩展设置容器和 `script.js` 的 `.inline-drawer-toggle` 委托事件，样式引用宿主主题变量。不等于真实页面可点、可见测试。
- **待安卓实测**：第三方酒馆美化是否对扩展入口应用主题、悬浮图标在不同 WebView 是否可见及可点击、实际保存后刷新能否保留悬浮状态。没有安装到玩家的酒馆实例。

## v0.8.8 — 2026-10-26

- `node --test tests/core.test.mjs tests/startup.test.mjs tests/social.test.mjs`：**92/92 通过**；`node --check index.js`、`node --check bootstrap.js`、`git diff --check` 通过。
- 自动化：玩家选图写入 user 消息，角色后续回复独立；双方表情包气泡仅显示图片，不泄露内部说明；100张一次保存，超过上限安全跳过；带 deflate 压缩的 ZIP + 中文 CSV 用途目录可正确导入原图、内容名称、使用场景。
- 扩展设置列表只添加一个折叠入口，按钮打开手机、勾选悬浮状态会更新保存数据和真实按钮 CSS 显隐；禁用后清理入口。历史回归与旧聊天不变。
- **待真机测试**：Android 长时间批量导入内存、ZIP 原生 `DecompressionStream('deflate-raw')` 支持、扩展设置宿主 DOM 在不同版本中的位置及移动端悬浮按钮是否受第三方主题覆盖；不要将 Node 虚拟 DOM 测试等同真实浏览器通过。

## v0.8.7 — 2026-10-25

- `node --test tests/core.test.mjs tests/startup.test.mjs tests/social.test.mjs`：**87/87 通过**；`node --check index.js`、`node --check bootstrap.js`、`git diff --check` 通过。
- 手机预设选项读取自身已保存的 `config.presetSource`，不再被酒馆当前激活预设覆盖；切换并重开设置后保留选择，选中的 A/B 预设条目都可注入手机但不会改变宿主设置。
- 一条朋友圈的多角色点赞、评论、互相回复由一次 JSON 生成解析，并严格核对参与角色和直接联系方式；不连线的人物间回复会被拒绝。
- 已有角色自主发帖及随附互动合并为一次生成；玩家点赞不调用 API；同条动态连续多条玩家评论合并成一个待回复批次，成功后移除队列，不重复调用。
- 批量角色口吻、复杂人际可知边界和 JSON 输出可靠性仍需在真实模型、真实 SillyTavern 1.18/1.19 及 Android 运行时验收；受控 VM 测试不等同于实际安装通过。

## v0.8.6 — 2026-10-25

- `node --test tests/core.test.mjs tests/startup.test.mjs tests/social.test.mjs`：**84/84 通过**；`node --check index.js`、`node --check bootstrap.js`、`git diff --check` 通过。
- 桌面只保留「咕叽聊」内「发现→朋友圈」，不再重复提供朋友圈桌面应用；「吱付宝」仅为独立空壳，无支付操作。
- 手机设置的预设来源每次依据酒馆当前选择显示，不继承旧下拉框缓存；只注入当前宿主预设对应的勾选条目，不抹除其他预设的历史勾选。
- 手机界面当前角色、user 面具的可见文本按 `{{char}}`、`{{user}}` 动态替换；公共测试不再包含私人角色名。
- 当前仅为 Node VM / 受控 DOM 回归与代码静态检查，**不代表已在真实酒馆、安卓或 Termux 测通**。宿主刷新后全局预设被其他机制修改的情况需要单独复现。

## v0.8.5 — 2026-10-25

执行 `node --test tests/core.test.mjs tests/startup.test.mjs tests/social.test.mjs`：**82/82 通过**；`node --check index.js`、`node --check bootstrap.js`、`git diff --check` 通过。

- 旧联系人及私聊在点赞/取消、评论/回复、转发、增删角色联系方式连线后保持原样；旧朋友圈可照常读取。
- 角色之间联系方式默认不存在，两个角色同时认识 user 不是互相认识的凭据。只有手工确认的联系人对可以在对方动态互动；任一角色失去 user 好友状态会即时阻止互动。
- 角色只能读到自己有资格看到的动态评论；非共同好友评论不送给模型。未建立直接连线时，不为尝试互动的角色调用模型。
- 角色自主发布朋友圈可在主页和发现产生未读计数与弹窗入口；阅读后清除。模型互动默认关闭，手动触发有调用确认。
- UI 模板包含移除联系人数量后的主页、新的朋友圈入口、角色间联系方式及自动互动设置。

以上主要为 Node VM / 受控 DOM 回归。**尚需真实酒馆 1.18/1.19、Android/Termux/WebView 测试**：浏览器原生弹窗可点击性、评论输入滚动、媒体图像保留、前后台提醒层级、实际模型是否遵守互动权限与回复格式。浏览器测试此前缺少 Playwright Chromium 程序，不能声明通过。

## v0.8.4 — 2026-10-25

执行 `node --test tests/core.test.mjs tests/startup.test.mjs tests/social.test.mjs`：**75/75 通过**。`node --check index.js`、`node --check bootstrap.js` 与 `git diff --check` 通过（代码静态测试）。

- 角色头像上传走与「我」同一张压缩图片编码器，不再错误要求原图小于 350KB。图片表情包仍受原限额约束。
- 主动消息为不同联系人独立保存未读数量；UI 既有手机外提醒，也有手机内顶部提醒；引用栏新增取消操作。
- 新消息采用故事时间递增、日历手动调整后的故事时段；既有消息原时间保持不变。
- 角色卡信息/当前 user 人设、实际关系阶段、职业保密、当日时段和动态名字宏进入手机提示；不修改原角色卡文字。
- 多本世界书设置实际显示复选框，选中多本后进入分组条目管理；关闭单本暂停注入且保留勾选。动态触发仍为受控子集，不承诺完全复制酒馆原生世界书引擎。
- 关系重查返回有区分的状态，保存活动设置给出成功提示。

**未完成：**浏览器及 Termux/SillyDroid 真机验证、真实模型是否遵守保密规则。以上 Node 测试的 UI 通过来自受控 DOM，并非安装酒馆后的截图验收。建议在实际机型验证手机通知层级、文件选择返回与多本世界书条目点击；原聊天数据不会由升级主动改写。

## v0.8.3 — 2026-10-25

执行 `node --test tests/core.test.mjs tests/startup.test.mjs tests/social.test.mjs`：**68/68 通过**。`node --check index.js` 与 `git diff --check` 通过。测试使用 Node VM 和受控 DOM，不等于在 SillyTavern 真实页面验证。

- 修复联系人列表局部变量遮盖 DOM 根节点、好友关系同步引用未定义变量；恢复旧版发出申请展示。
- 角色卡性格/场景/说话示例及正在绑定的 user 人设参与手机提示；模型需保持角色知情边界。
- 两本不同世界书的常驻项、关键词、次级关键词、禁用项匹配与截断预算；未选中条目不被发送。
- 嘎嘎小狗只读专用 memory 提示槽，不吸收导演/输出规则；柏宝书按其 API v1 读快照与正常注入历史；过去时间线直接屏蔽所有正文记忆。
- 手机记录注入正文默认关，关闭后清理扩展提示槽；只读/写测试确认不更改旧消息正文及第三方插件数据。
- UI 设置开关、注入预览记录到独立运行日志、旧启动控件及取消选择弹窗测试。

尚需真实环境验证：嘎嘎小狗与柏宝书具体版本的运行时可访问性，留痕记忆非标准存储字段，1.18/1.19 世界书的递归与特殊匹配语义（目前是受控子集），手机端人设与注入位置、两方向时间线是否符合实际剧情，Android 弹窗/主动私聊。浏览器测试已尝试：第一次因沙箱临时目录只读失败，授权执行后因未安装 Playwright Chromium 可执行文件失败，**没有浏览器级通过结果**。不要将此结果写成真机或完全兼容验收。

## v0.7.1 — 2026-10-25

基线提交：5032478d529f02cef3a68a06550e57f450bb4681。

执行 `node --test tests/core.test.mjs tests/startup.test.mjs tests/social.test.mjs`，**55/55通过**；index.js、bootstrap.js 和浏览器脚本语法检查通过。

新增验证：

- 表情包库初始为空，跨角色、模块重载后仍读取同一账号扩展设置，保留其他设置和聊天数据；重复图片去重、非法图片及保存错误处理。
- 模拟模型调用验证 user 与 char 均发送图片表情包；只接受库中ID，模型未知ID不会变成外部图片；标签参与上下文，不要求视觉API；GIF/表情标记备份往返保留。
- 默认扫描只调用当前char绑定书及当前user绑定书；额外书仅在明确选择后调用，不枚举全库、不读取手机选中的文风书；本人、别名、禁用条目及文风规则排除，人设中已命名的朋友仍能识别。
- 当前人设随宿主设置更新；在NPC会话上下文从「我」发朋友圈，仍写入当前故事公共动态，不覆盖主角色/NPC旧消息。
- 真实mount绑定的文件选择/弹窗取消/Escape事件在受控DOM测试中保留对话、草稿和滚动位置；检查「我」与「发现」职责及通讯录布局。

浏览器脚本已扩充真实文件上传、表情包双方发送、从「我」发动态到「发现」、选图取消事件。**本版未获得浏览器通过结果**：前版在同一本机环境尝试启动Edge时，进程在页面加载前退出。上述55项使用宿主/DOM/模型替身，不能代替原生文件选择器和Termux真机验证。

真机追加检查：

- [ ] 安装后表情包为空，上传图片后换角色仍可见；刷新仍保存。
- [ ] 点击图片发送、角色选图回复、收藏/改名/删除、GIF显示与聊天导出导入正常。
- [ ] 「我」显示当前人设；切换酒馆人设再进入「我」正确刷新。
- [ ] 「我」发布后，「发现」可见且刷新保留；换故事不混入。
- [ ] 安卓系统相册不选图片直接返回后，手机仍停在原对话、草稿保留；随后还能正常选图和关闭手机。
- [ ] 默认扫描不读无关世界书、不加入自己，文风不成为人物；额外书只能手选。

人设读取使用官方context.powerUserSettings的persona_description及persona_description_lorebook。参考：[1.18.0 context](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/st-context.js)、[persona绑定](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/personas.js)。姓名排除依赖当前名称及资料中的明确别名，不声称完整理解任意格式的人设。

## v0.7.0 历史记录

日期：2026-10-25。基线提交：71f1951f9e6f201902fbf0ed33c8f677bc5f2600。

## 问题与修复依据

基线 41 项测试，35 通过、6 失败。新增朋友圈事件引用未登记的 nodes.momentsPost，导致 mount 抛错并阻断其后的 installWandEntry；还需登记 renderMoments 使用的 myIdentity。新测试执行真实 mount 与模板绑定，并核对所有 nodes 引用，避免只检查 HTML 字符串。

旧测试失败涉及版本号未更新、三处 VM 测试换行转义错误，以及新故事默认陌生人后两处旧好友测试夹具失效。已修正夹具，保留新故事非好友及旧存档好友兼容测试，没有放宽关系门槛来迁就测试。

官方源码核对（固定版本）：

- [1.18.0 extensions.js](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/extensions.js)
- [1.19.0 extensions.js](https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/extensions.js)

两版均支持 manifest 生命周期钩子；魔法棒模板异步添加 #extensionsMenu，扩展自行添加菜单项。本扩展不要求 APP_READY 再次触发。这是源码核对，不是安装运行验证，不能证明朋友设备上的唯一原因。

## 已执行

`node --test tests/core.test.mjs tests/startup.test.mjs`：**45/45 通过**。

覆盖旧 v1 消息/字段/好友状态、主角色与 NPC 隔离、保存失败回滚、发送防重复、关系门槛、NPC 错误词组过滤、user 世界书朋友、图片 JSON 往返、四栏/工具模板、真实 mount 控件绑定、菜单迟到/替换、失败清理、禁用后不补入口、重启用、导入中禁用、并发加载去重和失败重试。

启动测试使用受控 DOM 与宿主替身；渲染未运行完整酒馆，弹窗/API 测试同样为替身。“手机主屏未进入可见区域”是预期负向测试日志。

## 未完成实测

tests/browser.test.cjs 使用真实 Chromium DOM、390×844 视口和模拟酒馆上下文，覆盖菜单晚于 20 秒出现、打开弹窗、四栏、发表动态、旧数据及启用/禁用。已尝试运行，但 Edge 在页面加载前退出（crashpad / named pipe 错误），故**没有浏览器通过结果**。留待有可运行 Chromium 的环境复跑。

未安装运行完整 SillyTavern 1.18/1.19；未验证 Termux 安卓真机、SillyDroid、真实模型 API、触屏键盘及文件下载。

## 真机验收（1.18.x 和 1.19.x 分别记录）

- [ ] 记录酒馆完整版本、浏览器/WebView、插件 0.7.0。
- [ ] 更新刷新后魔法棒只有一个入口，能打开，无默认悬浮入口。
- [ ] 旧消息/备注/头像/NPC 私聊仍在，切换存档不污染。
- [ ] 新故事默认非好友，扫描不自动成为好友；手动确认或明确交换线索后可申请。
- [ ] 扫描 {{user}} 世界书中已命名的朋友，核对姓名、来源和关系；“与同学”不成为人名。
- [ ] 四栏可切换，朋友圈文本刷新后仍在。
- [ ] 表情、引用、图片、剧情电话/转账/地点可操作；图片导出再导入仍在。
- [ ] 实际发送、重试、切换聊天、键盘弹出及关闭弹窗正常。
- [ ] 禁用后入口/界面消失，启用恢复，刷新不重复。

关系扫描仍为规则识别，复杂否定/第三人称可能误判，不等于完整剧情理解。本版没有自动生成收到的申请或 NPC 自动朋友圈功能。
