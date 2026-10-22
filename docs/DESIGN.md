# 智慧树自动听课 —— 设计与实施计划（B 方案：极小化足迹）

> 状态：**已实现并在真实课程上跑通**（2026-10-21 晚，见第 10 节）。第 0–9 节是最初的设计与实测依据，保留作背景；实现细节以第 10 节与 README.md 为准。

---

## 0. 当前硬事实（决定一切）

| 事实 | 证据 |
|---|---|
| 账号 userId **908402579** 被平台上报一次脚本异常 | collector2c 上报体：`module=SHARECOURSE_SCRIPTS, code=101, courseId=1000158939, recruitId=477311, videoId=94593539, lessionId=1002323419, createTime=2026/10/21 16:26:21` |
| 现场表现 | 点进课程 → 提示「检测到异常脚本」→ 约 3 秒后自动跳回主界面 |
| 处罚 | **学习进度没有掉**（用户确认） |
| 触发原因 | 不是无头/藏屏，是**行为**：探针在页面内 `el.click()` 点了 16 次随机 DOM（`isTrusted=false`）+ 700ms 全量 DOM 扫描。第一轮「零点击零注入」10 分钟零上报 |
| 弹题契约（重大收获） | `POST /gateway/t/v1/popupAnswer/loadVideoPointerInfo` → `{"questionPoint":[{"timeSec":425,"questionIds":"1097920778"},{"timeSec":1259,"questionIds":"1097920779"}]}` —— **题目时间点与题号提前下发** |
| 第一轮 0 弹题的原因 | 视频从 427.99s 开始，已越过 425s 那个弹题点 |
| `navigator.webdriver` | 加 `--disable-blink-features=AutomationControlled` 后为 `false`；实测平台**不查**这一项（第一轮 true 也零上报） |

**门禁：账号是否已解封，必须先由用户在自己日常用的 Chrome 里手动点进课程确认。未解封前不做任何自动化验证。**

---

## 1. B 方案三条铁律

1. **页面内零注入**：不放 MutationObserver、不放 setInterval、不改 DOM。被动数据一律靠 CDP 的 Network 事件（不触碰页面 JS）。
2. **点击只发生在真弹题的瞬间**，且只点对话框内的「选项」和「提交」两个元素，走 Playwright 真实输入（`isTrusted=true`）。绝不用 `el.click()`。
3. **平时完全待机**：靠 `loadVideoPointerInfo` 拿到的 `timeSec` 列表，只在 `timeSec-15s ~ timeSec+60s` 窗口内进入待命态，其余时间一秒钟一次只读轮询（`video.currentTime` + `#playTopic-dialog` 可见性）。

> 为什么第 3 条关键：第一轮 10 分钟零上报证明「只播放 + 低频只读采样」是安全的；第二轮被上报证明「乱点乱扫」是致命的。把行为限制在「人也会做的事」上，是唯一可行的边界。

---

## 2. 进程架构

```
┌────────────────────────────────────────────┐
│  ui (Vue3 + Vite, 构建为静态)                │
│  127.0.0.1:<port>/?t=<one-time-token>      │
└───────────────┬────────────────────────────┘
                │ HTTP + SSE（单向状态推送）
┌───────────────▼────────────────────────────┐
│  server (Node ESM 单进程)                    │
│  ├ http.mjs      路由 / 静态托管 / token 校验  │
│  ├ errors.mjs    错误码 → 中文人话（不透堆栈）  │
│  ├ store.mjs     state.json 原子写 / 断点续学  │
│  └ supervisor.mjs 管理 worker 生命周期+重启   │
└───────────────┬────────────────────────────┘
                │ child_process IPC（崩溃隔离）
┌───────────────▼────────────────────────────┐
│  worker (Node, 独占 Playwright)              │
│  ├ session.mjs   启动 Chrome / 登录 / 持久化  │
│  ├ course.mjs    课程列表 / 任务点 / 未听完筛选 │
│  ├ player.mjs    播放主状态机 + 弹题窗口       │
│  ├ pointer.mjs   解析 loadVideoPointerInfo    │
│  └ answer.mjs    取题 / 随机作答 / 提交       │
└────────────────────────────────────────────┘
```

**为什么 worker 独立进程**：Playwright 崩溃、Chrome 崩溃、页面跳转异常都只杀 worker，server 与 UI 不动，supervisor 自动拉起（限速：每小时最多 3 次）。这是「禁止崩溃」要求的落地方式。

---

## 3. 目录结构

```
zhihuishu-auto/
├─ start.bat                  一键启动（双击）
├─ package.json               根：脚本编排
├─ server/
│  ├─ package.json
│  └─ src/
│     ├─ index.mjs            HTTP + SSE + 静态托管
│     ├─ errors.mjs           ErrorCode → 用户文案
│     ├─ store.mjs            data/state.json 原子读写
│     ├─ supervisor.mjs       worker 拉起/看护/重启限速
│     └─ worker/
│        ├─ main.mjs          IPC 入口，全部 try/catch
│        ├─ session.mjs       Chrome 启动参数 / 登录策略
│        ├─ course.mjs        课程与任务点解析
│        ├─ player.mjs        播放 + 弹题状态机
│        └─ answer.mjs        答题（随机）
├─ web/                       Vue3 + Vite
│  ├─ src/App.vue
│  ├─ src/api.js              fetch + token
│  └─ src/views/{Login,Courses,Player,Settings}.vue
└─ data/                      【可整删】profile/ logs/ state.json
```

**`data/` 是唯一可变目录**，UI 上有「清空全部数据」按钮（删 profile + logs + state），重置不需要重装。

---

## 4. 学习主状态机

```
IDLE
 └─> LAUNCHING ──> WAIT_LOGIN ──> COURSE_LIST ──> COURSE_PICK
                                                     │
                                                     v
                                                  PLAYING ──(ct 接近 timeSec)──> ARMED
                                                     ^                             │
                                                     │                       (弹窗出现)
                                                     │                             v
                                                     └──── ANSWERING(随机作答) <────┘
                                                     │
                                              (本章任务点完成)
                                                     v
                                                 NEXT_TASK ──> PLAYING
```

- **断点续学**：`state.json` = `{ courseId, recruitId, lessonId, taskPointId, lastCt, updatedAt }`，每次状态变化原子写（`.tmp` + rename）。
- **"从没听过的地方开始"**：不靠自己记，靠平台自己 —— 进课程后读 `loadVideoPointerInfo` 与任务点进度，自然落在未完成处。
- **任意时刻退出**：UI 点「停止」→ 向 worker 发 `SIGTERM` 语义的 IPC 消息 → worker 关 Chrome → 写最后一次 state → 退出。进程被杀也能靠 state.json 恢复。

---

## 5. 多登录方式（统一 `LoginStrategy` 接口）

| 方式 | 实现 | 备注 |
|---|---|---|
| 扫码（微信/QQ） | 打开有头窗口，SSE 通知前端"去扫码"，轮询登录 cookie | 最稳，首选 |
| 手机号 + 密码 | 有头窗口自动填写；**不落盘明文** | 平台可能弹滑块 |
| 手机号 + 短信码 | 前端输入验证码回传 worker 填入 | 备用 |

登录成功判据：cookie `^(CASLOGC|jt-cas|SERVERID_CAS)$` 且值长度 > 10（`SERVERID` 是负载均衡 cookie，**不能**当登录标志，已踩过坑）。

---

## 6. 用户信息保护

- HTTP 只监听 `127.0.0.1`，启动生成一次性 token 放 URL hash，所有 API 校验，防别的网页 CSRF 打本地端口。
- 不存明文密码；不存 apikey（LLM 已废弃）。
- `secretStr` / cookie 值进日志一律打码（只留长度与前后 4 字符）。
- UI 提供「清空全部数据」。

---

## 7. 错误包装（报错不直抛）

```js
// errors.mjs
{ code: 'LOGIN_TIMEOUT', message: '登录没完成，请重新扫码', hint: '确认手机端已确认登录', retryable: true }
```
worker 内任何异常 → 只上报 `{code, message, hint}`，堆栈仅写本地日志文件，**永不进前端**。

---

## 8. 待验证清单（下次有 30 分钟时的顺序）

| # | 验证项 | 判据 | 风险 |
|---|---|---|---|
| V1 | 账号是否解封 | 日常 Chrome 手动点进课程，不再提示、不再跳回 | 无（手动） |
| V2 | 干净 profile + 零注入，进课程并播放 10 分钟 | collector2c 上报 = 0 | 低（复刻第一轮） |
| V3 | 走到 `timeSec`（如 425s）时弹题 | 抓到 `#playTopic-dialog` 结构、题目文本、选项、提交前后 `currentTime` | 中（必须真弹） |
| V4 | 故意答错 | 看是否回退 / 重弹 / 进度不记 | 中 |
| V5 | `loadVideoPointerInfo` 能否在页面内重复调用 | 能 → 可预取题目；不能 → 只能靠弹窗出现再读 | 低 |

**V3/V4 是唯一还没验证的环节，也是整个项目的成败点。**

---

## 9. 待确认的三个决策（默认值已给，回「默认」即按此实现）

| # | 决策 | 默认 |
|---|---|---|
| D1 | 单账号单实例 / 多账号 | **单账号单实例**（个人自用，进程内一个 Chrome） |
| D2 | 后端语言 | **Node ESM**（与 Playwright 同运行时，一键启动只需一个 node） |
| D3 | 一键启动形态 | **构建后由后端托管静态，单进程单端口**（不用 dev 双进程；双击 start.bat 就开） |

---

## 10. 已实现（2026-10-21 晚，真实课程验证）

### 10.1 自动跳节（默认开，可关）

课程树 DOM 的三种状态（`li.clearfix.video` 内）：

| 状态 | DOM 标记 | 处理 |
|---|---|---|
| 已看完 | `b.time_icofinish`，文本只剩时长、无百分比 | 跳过，不再重播 |
| 看了一半 | `b.time_ico_half` + `[role=progressbar][aria-valuenow]`（如 55） | 优先接着看 |
| 未开始 | 两者都无 | 备选 |

- `readCourseInfo()` 采集每节 {code,name,pct,durSec,current,chapter,icons,finished,half,doneAttr}，patch 到 state.lessons 与 summary.chapter/course。
- `pickAutoLesson()`：排除当前节后，优先 pct 在 1..99 的，其次 pct 为空或 0 且未完成的。
- `currentLooksDone()`：doneAttr 或 pct>=100。
- `maybeAdvanceLesson(force)`：15 秒节流；主循环每 tick 调 maybeAdvanceLesson(false)，video.ended 调 (true)。**force 时即使平台还没刷新成已完成也按播完处理**（这是修过的 bug：曾经永远不跳）。
- 没有下一节时一次性提示「这门课能自动听的节都听完了」；autoAdvance 关闭时 ended 停下等你手动选。

### 10.2 手动选节（POST /api/lesson）

- 前端课程目录点击 → server/index.mjs → real-engine.control(lesson, data) → worker 的 cmd=lesson 分支 → clickLesson(code)。
- `clickLesson`：先关掉挡路的弹题弹窗 → 已在目标节则直接返回 → `page.locator("li.video")` 按 "code + 空格" 前缀找项 → scrollIntoViewIfNeeded → **page.mouse.click（isTrusted=true）** → 最多 3 轮等待视频 key 变化，失败才 dump 截图。
- **铁律**：永不用 `element.click()`。合成事件会触发「检测到异常脚本」并强制跳回学堂，曾实测触发。

### 10.3 答题（server/llm.mjs）

- `pickLetter()` 四级解析（行首字母 → 答案/选项引导词 → 唯一字母）；`buildPrompt()` 只给题干+选项；`askLLM(llm,{question,options})` 用 temperature:0、max_tokens>=256（默认 1024）、30s 超时，content 为空时回落 reasoning_content。
- **deepseek-flash 是推理模型**：max_tokens:8 会让 8 个 token 全花在 reasoning 上、content 为空 —— 这是曾出现的「模型没给字母」根因。
- 答案字母与选项 label 比对得对错，写 history，界面「最近答题」展示；模型自检 POST /api/llmcheck 用固定样题（正确答案 B）。
- 没配 key 时**不随机作答**（避免平台记错分），只提示并暂停。

### 10.4 反脚本自愈

- `detectAbnormal()` 扫可见的 .el-message-box / .el-dialog / .layui-layer 文本是否含「异常脚本」或「关闭插件」；
- `recoverFromAbnormal(why)` 30 秒限流 → goto 上次 stuStudy URL（模块级 lastStudyUrl）→ 重新 findVideo → readCourseInfo → applyPlaying。

### 10.5 已验证的链路（真实课程 21:24 / 21:45 / 21:51）

1. 已登录态 → 自动回上次课程 → 当前节已完成 → 2 秒内自动切到 55% 的 1.3；
2. 弹题点 214/406 提前下发 → 406s 处弹题（已答过）识别为「已提交 正确 正确答案 C」→ 只关弹窗 → 回到 PLAYING；
3. 新弹题走 LLM：LLM 选择 C.（模型回：C）→ 答对了（我选 C，正确答案 C）→ 关闭 → 继续播；
4. 全程播放时间与墙钟 1:1，无反脚本提示；
5. 手动切节 2.1 与 1.3 互切均在 3–5 秒内生效。

### 10.6 运维注意

- 长期跑服务：先设置环境变量 ZHS_DEBUG=1，再用 pwsh 的 Start-Process 起 `node server/index.mjs`（-WindowStyle Hidden，输出重定向到 data/server.log）；用 bash 里 detached spawn 起会被脚本退出连坐杀掉。
- 自检/联调必须设置 ZHS_DATA=data/selftest-xxx，否则会覆盖真实服务的 data/server.url（token 只在内存，覆盖后只能重启服务）。
- batch 文件必须 GBK(cp936)+CRLF，改完用 scripts/to-gbk.ps1 转换，否则 cmd 会乱码报错。

### 10.7 课程级选择（2026-10-21 晚）

- worker 的 `listCourses()` 新开一个标签进 `LEARN_HOME = https://onlineweb.zhihuishu.com/onlinestuh5`，从 `.item-left-course` 卡片里读课程名 / 老师 / 学校 / `.processNum` 进度 / `recruitId`，读完关标签；结果放进 `state.courses`。
- `switchCourse(index)`：用**真实鼠标**点那张卡片的 `.courseName`（实测点了就会跳到 `studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=...`，不需要解析那串加密 id），再把页面换成新打开的 stuStudy 页，重置节/弹题点状态，重读课程树。
- 三条必须记住的坑：
  1. `ctx.on('page')` 不能顺手把全局 `page` 改成新标签——助手标签被关后全局 page 指向死页面，主循环会刷「页面已关闭」。改成 `watchPage()` 只挂监听、`setPage()` 显式指定当前页。
  2. 切课时关标签页只能关自己的导航标签和旧的 stuStudy 页，**不能关助手标签**（`helperPages` 集合保护），否则会把并发跑的 `listCourses` 标签关掉。
  3. 读课程列表 / 探针标签一律不许 close 主播放页（早期探针关过一次，直接让主循环报 `Target page, context or browser has been closed`）。
- 接口：`POST /api/courses`（读列表）、`POST /api/course {index}`（切课）；空闲/已退出时都返回 409 + 中文 hint。

### 10.8 人机验证（风控挑战）——2026-10-21 深夜

触发：短时间反复重启 / 连续点课程树 / 来回切课，腾讯 tcaptcha 弹出「请完成安全验证」（点选式：按提示点击指定字形）。
实测（22:37）它会把课程树点击全部吃掉，worker 表现为 `点了 6.1 但视频没变`，如果不处理就会一直重试、继续加重风控。

**为什么不自动解**
- 用用户截图实测 deepseek-flash 视觉：能读对提示原文（「请点击灰色小写 k朝向一样的小写i」）和 6 个字符的颜色/字形/相对位置，
  但**不知道真实像素尺寸**（把 2048×1156 猜成 1920×1080），坐标只能估；要求输出 JSON 时 reasoning 把 4096 token 烧完、
  content 为空（推理模型特性），单次 20s。用于点选验证码命中率不可接受。
- 代价不对称：点错会升级风控（更严验证/短信），而人工点一次只要 3 秒。

**实现（server/worker/main.mjs）**
- `detectVerify()`：遍历 frames，匹配「在屏幕内」的验证码容器文本（`/请完成安全验证|拖动滑块|按住滑块|请依次点击/`）
  或 `iframe[src*=captcha|verify|turing\.]`。
  **坑**：腾讯 tcaptcha 的 iframe `#tcaptcha_iframe_dy` 是常驻的，平时放在 `y=-1000000`，
  只判断 offsetWidth/Height>0 会误报；必须用 `getBoundingClientRect()` 判断在视口内（`bottom>0 && right>0 && top<vh && left<vw && top>-200`）
  且尺寸 `>80×40`。
- 命中：`pauseVideoQuiet()` → 截图 `verify-<ts>.png` → `patch({phase:'WAIT_VERIFY', verifyHint, notice:...})` → 每 2s 重检，"卡在这里"不入其它分支。
- 消失后：`patch({phase:'PLAYING', verifyHint:'', notice:'人机验证已通过，继续听课'})` + `applyPlaying()`。
- 重启/继续时清 `verifyHint`，避免界面残留旧提示。
- 前端：`PHASE_LABEL.WAIT_VERIFY='等待人机验证'`、状态文字优先显示它、提示条新增紫色 `.hintbar.act` 样式（不 7 秒淡出）。
- 调试：`ZHS_DEBUG=1` 时 `POST /api/control {action:'verifyprobe'}` 会把所有 iframe/候选容器的 src、class、位置尺寸存到
  `data/debug/verifyprobe-*.json` + 截图（用来区分常驻 iframe 与真弹出）。

### 10.9 「播完卡在 100%」与僵死兜底（2026-10-21 深夜 23:30 实测通过）

**现象**：2.5 节播放到 `ct=534.73 === dur=534.73`、`paused=true`，界面仍显示「播放中」，日志自 23:12:14 起 4 分钟无输出，课程树里该节已 100%。

**根因**：智慧树播放器在播完时只把视频暂停在 100%，**没有把 `video.ended` 置 true**。主循环只认 `if (v.ended)`，于是永远不进「切下一节」分支，反而落进「暂停就 `ensurePlaying()`」的循环里空转——看起来就是卡死。

**修复（`server/worker/main.mjs` 主循环）**：
```js
// 有的播放器播完不会把 ended 置 true，只是暂停在 100%（实测 2.5 卡在这里），按「到结尾」处理
const atEnd = v.dur > 0 && v.ct >= v.dur - 1.5;
...
if (v.ended || atEnd) { ... 走切下一节 ... }
```
日志会区分两种来源：`本节视频播完了`（ended 为真）/ `视频停在结尾（已到 100% 但没触发 ended）`（atEnd 命中）。

**僵死兜底（防其它"暂停但没播完"的情况无声卡住）**：模块级 `frozenCt = -1` / `frozenTicks = 0`（与大循环其它状态量放一起）。暂停且无弹窗的分支里，进度不动就累加 `frozenTicks`：
- 每 60 拍（约 60 秒）→ 日志「视频暂停且进度不动（Ns / Ns），再试着播一次」+ 提示条 + `ensurePlaying()`；
- 超过 300 拍（约 5 分钟）→ 置 `phase='PAUSED'`，提示「视频像是卡住了：请在浏览器窗口里点一下播放键，或点『重启』」并清零计数；
- 正常播放分支里两个变量复位。

**另两处加固（`server/real-engine.mjs`）**：
1. 退出后立刻重新开始时，旧 worker 的 `exit` 事件会落在新一轮上，误判成「后台异常退出（code=0），4 秒后自动恢复」并覆盖 `notice`。加了 `let childSeq = 0`，`spawnWorker()` 里 `const me = ++childSeq`，`child.on('exit', (code) => { if (me !== childSeq) return; onExit(code); })`。
2. 更关键的一条：`/api/control {action:'quit'}` 之后立刻点「开始听课」时，旧 worker 还没退出，`spawnWorker()` 因 `if (child) return` 直接跳过，`send('start')` 发给了正在死的进程 → 报「后台进程错误：Channel closed」，任务停死在 STOPPED。修法：`start()` 里若 `child` 还在，置 `expectExit = true`，`child.once('exit', () => { expectExit = false; go(); })` 等旧进程真正退出再起新的；`onExit` 里**先把 `child = null` 清干净再 `if (expectExit) return;`**（顺序反了会导致新 worker 也起不来）。实测日志顺序：`正在退出后台…` → `等上一个后台退出后重新启动…` → `已退出，断点已保存` → `正在启动后台浏览器…` → 登录 → PLAYING，无「异常退出」。

**验证**：2026-10-21 23:30:34 真实课程 2.6 节（539s）播到结尾 →
`视频停在结尾（已到 100% 但没触发 ended），看看有没有下一节可切` → `本节 2.6 已看完，自动切到 3.1（还没开始）` → `已切到 3.1，时长 729s，从 0s 继续`，全程无人工介入。

### 10.10 用户体验三处修正（2026-10-22 上午）

用户反馈：①「下一题」不实时，新视频开始还显示「已到达本段末尾」，要等答完一题才更新；② 提示条不是浮空的，出现时页面元素被挤动，也没有手动关闭按钮；③ 误关前端网页后没有任何办法重新打开，服务端只是个没有标题的黑框。

**① 下一题改成前端自己算**
原来「下一题」只读 worker 推来的 `state.nextQuestion`（`server/worker/main.mjs` 里算），切视频后 worker 要等到下一次 tick/一次作答才会重算，中间就一直是旧值。现在 `web/src/App.vue` 增加 `nextQ` computed，直接由「本节 `questionPoints`（未答、时间在当前位置之后的最小者）+ `video.ct`」推导：

```js
const nextQ = computed(() => {
  const s = S.value; if (!s) return null;
  const ct = (s.video && s.video.ct) || 0;
  const list = (s.questionPoints || []).filter((p) => !p.answered && p.state !== 'done');
  const ahead = list.filter((p) => p.timeSec >= ct - 0.5).sort((a, b) => a.timeSec - b.timeSec);
  if (!ahead.length) return null;
  const q = ahead[0];
  return { atSec: q.timeSec, questionId: q.questionIds, etaSec: Math.max(0, q.timeSec - ct) };
});
```

面板分支顺序（避免答题瞬间显示「0 秒」）：`ANSWERING/ARMED` →「正在弹题」；有 `nextQ` → 倒计时；`!pointsLoaded` →「读取中」；都没有 →「本节没有更多题目」/「本节已播完，正在切下一节」。**不再出现误导性的「已到达本段末尾」**。

**② 提示条改成浮空 + 可关闭**
`.hintbar` 原来是 header 与 main 之间的正常流元素，出现/消失会把整页挤一下。改为外层 `.hintwrap{position:fixed;left:20px;bottom:20px;z-index:60;width:min(560px,calc(100vw - 40px))}`，内部照旧分 warn/act/bad 三种配色，末尾加 `button.hint-x`（×）。关闭用文本级记忆：`hintDismissed` 存被关掉的那条文案，`hintShow` 只在文案变化后重新显示（这样同一条不会被反复弹回来，新提醒照常出现）。带 `<transition name="fade">`。

**③ 界面重新打开 + 服务窗口有名字**
- 新增 `打开界面.bat`：读 `data/server.url`（里面是带 token 的地址），确认 127.0.0.1:8731 在 LISTENING，然后 `start "" "%ZHSURL%"`；服务没跑就提示先双击 start.bat。GBK + CRLF 编码。
- `start.bat` 起服务的方式从 `start "" /min cmd /c "node server\index.mjs > data\server.log 2>&1"` 改成 `start "智慧树自动听课 - 服务运行中（关掉这个窗口=停止服务）" /min cmd /k "node server\index.mjs"`：任务栏有明确标题、日志在这个窗口里可见（不再是无名黑框），失败诊断也从 `data\runtime.log` 兜底读取。
- 启动成功提示里写明：界面关了双击 `打开界面.bat`，或再双击一次 start.bat（已在跑会直接开界面）。

**验证（2026-10-22 10:1x）**
- 无头浏览器测 mock：提示条 `position:fixed`，出现前后 `.top/.grid/.card.course/.nextq` 坐标完全一致（只有日志卡因为新增一行日志变高 20px，属预期）；点 × 后提示条消失；切到 2.1 后「下一题」立即变成 `视频走到 03:43 · 题号 mock-2.1-0`（新视频的弹题点），不再停留在旧视频。
- `node scripts/selftest.mjs` → **41/41 PASS**（新增：提示条浮空显示、提示条可手动关闭、提示条开关不引起重排、下一题面板不误报「本段末尾」）。
- `打开界面.bat` 实测：服务在跑时打印带 token 地址并打开浏览器；服务没跑时给出中文提示。

### 10.11 脚本瘦身与 npm test（2026-10-22）

**背景**：`scripts/` 里长期堆着写一次就忘的调试脚本——30 个 `tmp-*.mjs`、3 个 `debug-advance*.mjs`，外加 `dbg.bat`、`dbg.bat.utf8`、`peek.mjs`、`quit.mjs`、`shot-live.mjs`。它们只在当时的某次排错里跑过，留着既不维护也容易误跑（其中几个会连真实服务、点真实课程树）。

**删前核查**：全仓库 grep 这些文件名（README.md、docs/*.md、server/、web/、test/、package.json，两个 .bat 是 GBK，转 UTF-8 后再查）——零引用才删。结论：没有任何脚本/文档/bat 引用它们。

**保留（7 个，长期有用）**：
- `selftest.mjs` —— 41 项端到端自检，唯一的长期回归入口；
- `boottest.mjs` —— 真实 worker 拉 Chrome 的启动验证（不登录、不进课程）；
- `waitfor.mjs` / `watch.mjs` —— 联调时等 phase、盯 SSE 事件流；
- `shot.mjs` —— 截仪表盘到 `docs/ui-preview*.png`（`shot-live.mjs` 的用途被它覆盖，删）；
- `to-gbk.ps1` —— bat 的 GBK/CRLF 铁律工具（10.6）；
- `run-bat.ps1` —— 脱离当前终端启动 start.bat，避免父窗口退出连坐。

**npm test 接线**：`package.json` 加 `"test": "node --test"`。
**坑**：必须裸 `node --test`，不能写成 `node --test test/`——Node 24 下带目录参数会报 `MODULE_NOT_FOUND`；裸跑时 Node 自己递归发现 `test/**/*.test.mjs`，也天然跳过 `node_modules`。

**现状**：本任务提交时 5 个测试文件 53 项全绿——`answer-strategy` 8 / `page-scripts` 9 / `question-points` 12 / `tick` 17 / `web-next-question` 7。前四个是候选 01/02 把 worker 主循环决策、页内提取脚本、答题策略、弹题点推理抽成纯函数后的回归；最后一个是候选 04 拆 `App.vue` 后 `nextQ` 算法的回归。候选 05 拆 `server/lib/` 时又给 actions / logs / router / sse-hub / llm-check 补了单测，具体项数以 `npm test` 输出的 `# pass` 行为准。

**与 selftest 的分工**：
- `npm test`：纯函数、无浏览器、无端口、毫秒级，改完代码就应跑；
- `node scripts/selftest.mjs`：41 项端到端（真实引擎空闲页 + mock 全流程 + 人机验证提示 + 提示条/下一题回归），要 Chrome、要 `ZHS_DATA=data/selftest-xxx`（10.6），慢，发版前跑。
- selftest 会留下 `data/selftest-*`，`data/` 已在 `.gitignore` 里。

### 10.12 服务端入口拆分：路由表与 lib 模块（2026-10-22）

**背景**：`server/index.mjs` 267 行里塞了三件事——组合根（装配日志/状态/引擎/SSE）、HTTP 适配（json/静态文件/读 body）、业务规则（哪些动作允许、什么相位能点、失败怎么包装）。130 行 `if (url.pathname === …)` 链里，相位守卫写了 4 次、失败包装写了 4 次、`readJson` 写了 4 次；`/api/llmcheck` 在 handler 里同步 `fs.readFileSync` 配置并硬编码样题。更麻烦的是**引擎缝隙里的三个哑弹**：

1. `/api/control` 回执是 `{ ok: !!okc || true }` —— 恒为 true，引擎拒绝对前端永远不可见；
2. 起点要等 worker ready，靠 `setTimeout(…, 1500)` 赌，赌输了开关就丢；而 `real-engine` 的补发槽 **只有一个**，start 后连推两条设置会互相覆盖；
3. SSE 其实是 2Hz 全量快照轮询（`setInterval 500ms` + `if (dirty || MOCK)`），且帧格式在三处各拼一遍。

**改法（新目录 `server/lib/`，入口只剩装配 + 每接口几行）**：

| 模块 | 职责 | 关键接口 |
|---|---|---|
| `lib/http.mjs` | JSON 响应、带用户提示的错误、读请求体、静态文件 | `httpError(status,message,hint)`（`expose=true`）、`json/fail/readJson/serveStatic` |
| `lib/router.mjs` | 找路由 → 校验令牌 → 校验方法 → 读 body → 调 handler → 统一包装错误 | `createRouter({routes,token,log,context})` |
| `lib/actions.mjs` | 动作表：允许清单 + 相位守卫 + 成功后的乐观补丁 | `resolveControl(name,{phase,mock,debug})`、`actionPatch(name)`、`requireRunning(state,hint)` |
| `lib/sse.mjs` | 只有状态/日志真的变了才推；帧格式只拼一次 | `createHub({getState,getLogs})` → `addClient/stateChanged/logsChanged` |
| `lib/logs.mjs` | 日志环（最近 300 条）+ 落 `data/runtime.log`（超 2MB 清空） | `createLogRing({dataDir,onChange})` |
| `lib/config.mjs` | 按 mtime+size 缓存 `data/config.json`，首启写模板但绝不覆盖 | `createConfigStore({dataDir,log})` → `llm()/ensureTemplate()` |
| `lib/llm-check.mjs` | 「测试模型」的样题与判定 | `runLlmCheck(llm,{ask})` |

**三个哑弹的修法**：
- `/api/control`：`engine.control` 不抛就回 `{ok:true}`，抛了由 router 包装成 `{code,message,hint}`——不再有恒真回执；
- 起点：引擎契约补 `ready()`。`startTask()` 里 `engine.ready().then(() => engine.control('settings', {autoAnswer, autoAdvance}))`；`real-engine` 把单槽 `pending` 换成 `queue`（上限 50，ready 后按序 flush，崩溃退出时清空并 settle，避免调用方永远挂着）；
- SSE：`createHub` 用「状态 JSON 串 + 日志 length/末条签名」去重，首帧只写给新连接，不再广播重复帧。

**顺手修掉的**：
- `/api/llmcheck` 不再在请求里同步读文件，配置走 `config.llm()`，样题搬进 `lib/llm-check.mjs`；
- `server/state.mjs` 里 `verifyHint`/`courses` 的缩进错位（两个字段视觉上掉出了对象，只是恰好仍合法）；
- `mock-engine.mjs` 重写为同一契约（`start/ready/control/stop`，去掉只有 index 认识的 `demo`），`tickOnce()` 抽出、`control` 用 try/finally 保证每次都广播；`start()` 结尾补一次 `emit()`（旧版靠 2Hz 轮询兜住，改成变化推送后必须自己广播）。

**新增单测（`npm test` 里 5 个文件）**：`actions`（9 项：未知动作/相位守卫/乐观补丁/透出错误）、`router`（10 项：404/403/405/坏 JSON/500 不泄内部信息/expose 透出）、`logs`（7 项：截断/上限/落盘/不可写不炸）、`sse-hub`（8 项：首帧/去重/多客户端/断开摘除/序列化失败不崩）、`llm-check`（6 项）。全部用 stub req/res，不占端口、不启浏览器。

**验证（2026-10-22）**
- `npm test` → **92/92 pass**（含此前 53 项）；
- `node scripts/selftest.mjs` → **41/41 PASS**（真实引擎空闲页 + mock 全流程 + 提示条/下一题回归，说明拆分没有改变对外行为）；
- `node scripts/boottest.mjs` → PASS（真实 worker 拉起 Chrome → WAIT_LOGIN → 退出 STOPPED，验证 `ready()` 与队列没把启动卡住）；
- mock 手动烟测：`/api/state` 正常、重复 start 回 409「任务已经在运行了」、未配 key 的 `/api/llmcheck` 回 `{ok:false, why:'未配置 API Key'}`、未知动作回 400「不支持的操作」、SSE 2 秒内收到 7 个事件、静态页 200。

### 10.13 章节「平时测试」自动答题（2026-10-22）

**目标（用户拍板）**：只做每章「平时测试」；答完自动点提交并确认；某章视频全部看完后自动做该章测试。

**模块**（worker 侧，全部可单测的纯逻辑 + 一层真实点击）：

| 文件 | 职责 |
|---|---|
| `worker/lib/quiz-scripts.mjs` | 试卷页只读提取：`QUIZ_PAPER`（题目/题型/题干/选项/勾选态/答题卡/按钮）、是否已交查看页 `review`、`QUIZ_RESULT` |
| `worker/lib/quiz-logic.mjs` | `buildQuizPrompt`、`normalizeType`、`parseLetters`、`chooseLetters`、`fallbackIdxs`、`planSelection`、`groupChapters`、`pickChapterToQuiz`、`quizListOf`、`platformDoneMap`、`parsePaperMeta`、`parseResult` |
| `worker/lib/quiz-runner.mjs` | 打开试卷 → 逐题（作答 → 下一题）→ 交卷；`run(key,{noSubmit})` 支持干跑 |
| `worker/lib/quiz-store.mjs` | `data/quizzes.json` 断点（按章节名存 status/score/total/count/answered/note） |
| `server/worker/main.mjs` | `autoQuiz/quizChapters/quizzes/testDone`、`runQuiz(key)`、`maybeAutoQuiz()`（8 秒节流，主循环里不阻塞）、`cmd quiz`（含 `dry` 调试） |
| `web/src/components/ChapterQuiz.vue` | 状态卡：自动开关、做题进度、每章 tag/得分/「现在做」 |

**关键实现点**

1. **勾选态不是原生 checked**：智慧树点选后给 `.ABCase` 与 `.node_detail` 加 class `onChecked`，`input.checked` 恒 false（未选 img src `e7778644…`、选中 `134c9fe7…`）。`QUIZ_PAPER.checked = (input ? !!input.checked : false) || !!lab.querySelector('.onChecked')`；`applySelection` 点完回读，两轮补点。
2. **点选项只选中，点「下一题」才保存**：逐题必须真的翻页；最后一题没有「下一题」是正常的（日志会 warn 一次）。
3. **已交卷子会打开成「查看」页**（URL `#/webExamList/checkHomework/…`，没有「提交作业」，每题带「本题的得分」）：`review = /checkHomework/i.test(location.href) || (graded && !hasSubmit)`，runner 命中直接返回 `{ok:true,status:'already'}`，绝不重答。
4. **课程树上的已交标记**：测试节点里有 `<b class="finish">` = 已交；没交是 `span.iconfont.iconbaizhoumoshi-zhangceshi-shubiaoyiru`。`COURSE_TREE` 的 `tests[]` 带 `{chapter,text,done}` → `platformDoneMap` → `quizListOf(chapters,quizzes,platformDone)`；平台标记优先，卡片显示「已交（之前）」；本地已记 done 的仍算 self（自己刚交的）。
5. **模型回复抠不出字母**：先按「答案/应选/字母打头/全文唯一字母」四规则解析；失败再问一次（prompt 追加「只回复选项字母」），仍失败才兜底。
6. **点测试入口有空点**：播放页正在切节/弹题时第一下可能不弹标签页，runner 等 3 秒、重读课程树再点一次。
7. **答案会被平台暂存**；干跑（`dry:true`）填完整份不提交，用来验证解析链路，正式跑整份覆盖。

**真实站点验证（2026-10-22 11:28–11:52，账号已登录）**

- 第一章 7 题 **14/14**、第二章 8 题 **16/16**（自动接力：第一章做完自己挑第二章）；第四章 6 题 **12/12**（全自动，未人工干预）。
- 第三章（用户此前自己交过）→ 点开后识别 `checkHomework` 查看页，2 秒内返回 `{status:'already', score:16}`，日志「平台显示已经交过了（得分 16），跳过」。
- 第五章干跑：7 题 30 秒填完、**零「点了但勾选状态不对」**（修复前每章连报 6~7 次并靠 repair 兜底）；只有最后一题 warn「翻页失败（没有下一题）」。
- 界面：`quizChapters` 13 章全部识别，已交章显示「已交」，未做章「未做（7 题 / 12 分）」。

**新增单测**：`quiz-logic`（解析/分章/已交合并）、`quiz-scripts`（真实试卷夹具含 onChecked、查看页 review）、`quiz-store`、`page-scripts` 的 `tests[].done`；`npm test` **129/129 pass**，`node scripts/selftest.mjs` **46/46 PASS**（新增章节测试卡片/进度/交卷 5 项）。

### 10.14 仪表盘改成一屏（2026-10-22）

**背景**：用户反馈「前端好丑，需要翻页，有大量空行」。改造前实测（1440×900）整页高 1454px 需要滚动：当前课程卡 539px（4 格进度总览平铺，底部大片留白）、课程目录 380px（内部再滚一道）、右栏 4 张卡 144+167+272+116+414 高矮不齐、日志卡固定 180px 几乎全空。

**布局架子（全局 CSS 换成 grid 三段）**
```css
.wrap{height:100vh;width:100%;max-width:1760px;margin:0 auto;display:grid;
  grid-template-rows:auto minmax(0,1fr) auto;gap:12px;padding:14px 18px}
.grid{grid-template-columns:minmax(0,1fr) 356px}   /* 主列 + 右栏 */
.col-main{grid-template-rows:auto minmax(0,1fr)}   /* 课程大卡 + 课程目录 */
.rail{grid-template-rows:auto auto minmax(0,1fr)}  /* 下一题 / 自动答题 / 章节测试 */
body{overflow:hidden}
```
整页固定一屏，滚动只发生在卡片内部（目录、章节测试列表、底部日志）；`max-width:1760px` 让 1920 宽屏两侧留边、不把内容拉散；`@media (max-width:1080px)` 才退回单列 + 整页滚动。窄屏（1240px）右栏 330px。

**新组件分工（原来 4 个卡片拆成 8 个，App.vue 只留编排）**

| 组件 | 位置 | 职责 |
|---|---|---|
| `CourseHero.vue` | 左主列 | 课程名/学校/章节/任务点 + 状态徽章 + 时钟（27px）+ 进度条 + 弹题点 chips + 底部内嵌进度总览 |
| `ProgressOverview.vue` | 大卡底部 | 改成一整条 `.ovstrip`（4 列小条），不再是独立卡片；`pct` 为 null 只显示「—」不显示「—%」 |
| `LessonTree.vue` | 左主列 | 课程目录多列铺开（见下），当前节高亮并滚到可见 |
| `NextQuestion.vue` | 右栏 | 「下一题」倒计时 / 作答中 / 读取中 / 本节没有更多题目 |
| `AutoPanel.vue` | 右栏 | 两个开关 + 答题模型自检 + 策略/今日已答 chips |
| `ChapterQuiz.vue` | 右栏 | 章节测试列表（模板重写，数据逻辑不动） |
| `CoursePicker.vue` | 顶栏胶囊点开 | 「我的课程」弹窗：刷新、课程行、当前课标记、Esc/✕ 关闭 |
| `BottomDock.vue` | 底部 | 常驻 104px 底栏，两个页签：运行日志 / 答题记录 |

删掉 `CoursePanel.vue`、`QuizPanel.vue`、`LogPanel.vue`；「我的课程」从右栏卡片改成顶栏胶囊 + 弹窗（右栏 356px 里放不下课程列表，且切课是低频操作）。

**课程目录多列：放弃 CSS multicol**
先试 `column-width:232px`，结果 `.ltree` `scrollWidth 1258 > clientWidth 1004`——固定高度容器里 multicol 会把放不下的内容**挤到第 5 列横向溢出**，不产生纵向滚动（单独实验：60×20px 内容 / 高 200 → `sh=201, sw=881`），第十~十三章直接看不见。
改成 **JS 分桶 + CSS grid 列**：`ResizeObserver` 量容器宽 `w` → `cols = clamp(1..6, floor((w+14)/244))`；分组按「每章课时数+1.2」加权后**顺序切成 N 段**（保持章节顺序、各列高度接近）；渲染 `.ltree{display:grid;grid-template-columns:repeat(cols,minmax(0,1fr));overflow-y:auto}` + 每列一个 `.lcol` flex 竖排。
实测 1440×900 四列正好放下 13 章 49 节（`ltree sh=ch=370`，无滚动、无横向溢出）；1920 六列 → 五列、内容更矮；1280×800 三列且目录内部滚动（高度不够，属预期）。

**卡片高度贴内容**
`.lessons,.quizcard{align-self:start;max-height:100%;overflow:hidden}`：数据少（mock 只有 5 节 2 章测试）时卡片缩到内容高度，不在卡里留一大片空白；数据多时封顶为可用高度、列表内部滚动。章节测试卡片的类名是 `.quizcard`（不是 `.quiz`），第一次写错选择器导致 mock 下卡片仍被拉满。

**底部日志**：`.dockbody` 顶部加 `mask-image` 渐隐，自动滚到底时半截的旧行不再显得脏；日志与答题记录共用底栏两个页签。

**验证**
- 三档分辨率（1440×900 / 1280×800 / 1920×1080）实测 `document.documentElement.scrollHeight === innerHeight`（整页不滚动），`.ltree scrollWidth <= clientWidth`（无横向溢出），1920 下 `.wrap` 宽 1724（`max-width` 生效）。
- 截图：`docs/ui-running.png`、`docs/ui-idle.png`、`docs/ui-stopped.png`、`docs/ui-verify.png` 由 selftest 重新生成（`docs/*.png` 不入库）。
- `node scripts/selftest.mjs` → **50/50 PASS**：新增「课程胶囊能打开我的课程弹窗」「弹窗可以关掉」「仪表盘一屏放下」「课程目录没有横向溢出」「课程目录一屏显示完」；原 46 项里「运行页有『我的课程』卡」改成点胶囊断言弹窗。
