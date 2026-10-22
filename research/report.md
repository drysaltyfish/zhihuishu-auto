**智慧树 video learning / 弹题 / anti-automation — public-source report** (S1–S5 = sources linked inline)

**1. Course types**
- 共享课·学分课 (知到): `studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=…` — chapters → videos + 作业 + 考试; only videos carry watch progress ([S1](https://github.com/eplayn/zhihuishu-protocol-research), [S2](https://github.com/huanweide/zhihuishu-helper)).
- 校内课 (hike): `zhihuishu.com/aidedteaching/sourceLearning`, `hike.zhihuishu.com`; separate MD5-signed API (S3/S4).
- 翻转课: `fusioncourseh5.zhihuishu.com/stuStudy` — S2's page table labels it "翻转课/AI课"; OCSJS classes it FusionCourseH5.
- 新形态课程 (AI 智慧课): `ai-smart-course-student-pro.zhihuishu.com/{learnPage,singleCourse}`; progress keyed per 知识点+资源 (same video counted per knowledge point) (S1).
- 2025+ shells: `studyplush5`, `studywisdomh5`, `wisdom-mooc.zhihuishu.com/study/index` ([S3](https://github.com/ocsjs/ocsjs)).
- 直播/见面课: separate track — risk counters list 会课异常 (直播/见面课) apart from 考试异常, so not video-watch progress (S1).

**2. Player, delivery, progress**
- Player = top-level SPA page (`stuStudy`), not an iframe; homework/exam pages are iframed and their iframes are rebuilt on task switch (S2 §4.2; S3 line 3146).
- Play URL: JSONP `GET newbase.zhihuishu.com/video/initVideo?jsonpCallBack=result&videoID=<id>&_=<ts>`. m3u8/HLS, segment encryption, URL signing: **unconfirmed**.
- Business calls: `POST studyservice-api.zhihuishu.com/gateway/t/v1<path>`, form `secretStr=Base64(AES(json))&dateFormate=<ms>`, Origin/Referer `studyvideoh5.zhihuishu.com` (S1).
- Timers (deobfuscated): watchPoint sample 1990 ms; heartbeat 4990 ms, `totalStudyTime += 5*playRate`, playRate clamped 1.8; cache save 180 s; main save **300 s** (not 30 s) (S1 §3.8).
- Endpoints: `/learning/prelearningNote`, `/learning/saveDatabaseIntervalTimeV2` {`ewssw`,`sdsew`,`zwsds`,`courseId`}, `/learning/saveCacheIntervalTimeV2`, `/learning/queryStuyInfo`, `/learning/currentSystemTime` (S1).
- `sdsew` (10 fields): recruitId, lessonId, smallLessonId, videoId, chapterId, studyStatus, playTimes delta, totalStudyTime, player position, `uuid+"zhs"` (S1).
- No wall-clock validation: server does `studyTotalTime += playTimes`; resending an older cumulative value → `code:-8 学习总时长下降了`. Client threshold 0x51 = 81%; authority is `watchState==1` (S1 §3.9). 学习习惯 = local 1500 s timer + server time (S1 §5).

**3. 弹题**
- Questions are **predefined per video and server-served with timestamps**, not randomly pushed: `/popupAnswer/loadVideoPointerInfo` (list + timepoints), `/popupAnswer/lessonPopupExam` (content/options), `/popupAnswer/saveLessonPopupExamSaveAnswer` (one question per call) (S1 §3.10).
- Answers are obtainable **before playback**: the correct option carries `result == '1'` (S1). Quirk: `questionIds` must be a comma-string.
- DOM: top-level `#playTopic-dialog` overlay — pager `.el-pager .number`, options `ul .topic-item`, radio `ul > li:nth-child(N)`, close `.close-btn/.btn`; blocks/pauses video (S2 §4; S3 `handleTestDialog`).
- OCSJS ignores the answer, clicks a **random** option, closes, re-polls every 3 s (S3) (conflicts with S1's harvestable answer flag).
- Attempts / countdown / rewind-on-wrong: **unconfirmed**.

**4. Anti-automation (documented)**
- DevTools: attaching CDP breaks the page (`document.documentElement` null, readyState stuck "loading"); logic = `setInterval(checkout,60000)` native-API check + `isTrusted` checks on Pointer/Mouse events → `notTrustScript` posts to `collector2c.zhihuishu.com/public/jsonp/collect`, pauses player, redirects (S1 §2.2). Browser-layer only; API clients unaffected.
- Server: `-10` concurrent videos, `-9` time window exceeded, `-12` 滑块 required (session-scoped, does not decay), `-8` total-time decrease (S1 §4).
- 滑块 = 易盾 `yidun_popup`; password login needs a valid `validate` token (`status:-4`), so QR login is the only browserless path; OCR exists ([zhihuishuAPI](https://github.com/wangshaoxinya/zhihuishuAPI)).
- Speed: in-page playRate clamped 1.8; tools use 1.25–2.0 ([pjm314159/zhs](https://github.com/pjm314159/zhs)).
- 切屏 detection, `navigator.webdriver`, canvas/font fingerprinting, 人脸识别/随机抓拍: **unconfirmed** (only tender docs mention 人脸识别).

**5. Login**
- `login.zhihuishu.com?origin=zhs` → `POST user.zhihuishu.com/zhsuser/login/account` (AES body `{account,password,validate}`) → CAS `passport.zhihuishu.com/login?pwd=&service=…` → `cloudapi.polymas.com` sets `CASLOGC` + `jt-cas` JWT (24 h) (S1 §3.2).
- QR: `passport…/qrCodeLogin/getLoginQrImg` + `getLoginQrInfo?qrToken=` (status -1/0/1/2/3) (S1). 学校统一身份认证 uses the same CAS `service=` hop. CAPTCHA: 易盾 slider, password login only. WeChat/QQ QR: **unconfirmed**.

**6. Named projects** (GitHub API, 2026-10-21)
- [ocsjs/ocsjs](https://github.com/ocsjs/ocsjs) TS ★3.9k, 2026-10-13, active — 5 page families, DOM-only, random 弹题 clicks.
- [VermiIIi0n/fuckZHS](https://github.com/VermiIIi0n/fuckZHS) Py ★2.5k, 2025-10-28, **stale** (44 open issues); pure-API AES/WatchPoint/ev.
- [yhgeo/fuckZHS](https://github.com/yhgeo/fuckZHS) fork, 2026-10-06 — merges 6 orphaned PRs, browserless server deploy.
- [CXRunfree/Autovisor](https://github.com/CXRunfree/Autovisor) Py/Playwright ★1k, 2026-09-24.
- [pjm314159/zhs](https://github.com/pjm314159/zhs) (PyPI `zhs` 0.1.4.3), 2026-10-16 — QR login, API playback, 弹窗答题.
- [ScriptCat 8267](https://scriptcat.org/zh-CN/script-show-page/8267) "智慧树助手" v1.0.4, 928 installs, external 题库 `tk.n1t.cn`. Dead: perhaps-yo/zhihuishu, wangzexi/ZhiHuiShu-Assistant (2019), cxmooc-tools (archived 2022).

**7. Request signing**
- 校内课: `sign = md5("o6xpt3b#Qy$Z" + uuid + courseId + fileId + studyTotalTime + startDate + endDate + endWatchTime + startWatchTime + uuid)` ([sign.py](https://github.com/yhgeo/fuckZHS/blob/master/sign.py)).
- 共享课: AES-128-CBC/PKCS7, fixed IV `1g3qqdh4jvbskb9x`, per-module keys (`azp53h0kft7qi78q` study, `7q9oko0vqb3la20r` home, `hw2fdlwcj4cs1mx7` AI, `onbfhdyvz8x7otrp` exam, `kcGOlISPkYKRksSK` Q&A); `dateFormate = floor(now/1000)*1000` (last three digits 000) (S1 §3.5, [S4](https://github.com/yhgeo/fuckZHS)).
- `sdsew` encoding: XOR with cycling key `zzpttjd`, hex, keep last 4 chars (S1 §3.6; S4 `getEv`).
- AI 智慧课: constant per-session header = AES(user id + module key); module keys arrive "signed" with a hardcoded public key; same IV (S1 §7–8). No `x-zse`-style header seen.

**Open/unconfirmed:** HLS encryption + URL signing, 弹题 attempts/countdown/rewind, 人脸识别 scope, WeChat/QQ login, 切屏 & fingerprint checks.