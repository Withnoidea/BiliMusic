# 播放、下载与音乐发现升级

## 使用与行为

- 底栏控制提供中文原生 `title` 和无障碍标签；循环模式为顺序 → 列表循环 → 单曲循环，并显示 Toast。单曲循环原地重播，不重新解析或切歌。列表循环遍历完整随机队列后回到开头，顺序模式末尾停止；保留「自动播放下一首」设置的约束，单曲循环优先。
- 麦克风按钮现在切换桌面歌词，封面/歌名区域仍打开应用内歌词。底栏和设置页状态同步。
- 下载默认 **MP3 / 320kbps**，设置页可以选择 **M4A 原流**。这是兼容性转码，不是无损升级。现有 M4A 仍可播放；改用 MP3 后重新点击下载会导出 MP3，不会把原来的 M4A 删除。
- MP3 写入 ID3v2.3 歌名、歌手、专辑和可用封面。B站缺少专辑名称时使用曲名作为单曲专辑名；缺少歌手信息时保留平台提供的 UP 主名。封面下载/编码失败会明确报错、可重试，不会偷偷标记完整下载成功。
- 并发上限 2，下载与转码状态分开。临时文件完成转码后再提交；大小、SHA-256、Range 播放 MIME 均基于最终导出文件。FFmpeg 以参数数组启动，无 shell，隐藏窗口，仅允许本地文件协议。封面网络仅允许 HTTPS `*.hdslb.com`，逐跳检查重定向，禁带 Cookie，限制 12MB；支持受限的 PNG/JPEG/WebP base64 图片。

## 推荐与发现

所有官方 API 继续通过现有鉴权网关，Cookie 不传到 renderer 或 CDN：

- `/x/web-interface/index/top/rcmd`：登录态首页推荐，携带递增 `fresh_idx`，并对有限数量的候选补视频详情以校验分区/描述。
- `/x/polymer/web-dynamic/v1/feed/all`：关注动态视频，使用平台返回的 `offset` 游标，只保留具有歌曲信号的内容。
- `/x/web-interface/archive/related`：随机选取最近 10 首播放历史之一，获取相关视频。
- 音乐中心新歌/热歌、音乐分区 `newlist`、WBI 搜索 `tids=3`：冷启动和动态补充池。

两页共用 `services/api.ts` 中的音乐过滤与多源交错排序。只接受 **60–600 秒（含边界）**；标题、描述、标签黑名单优先于白名单加权。通用的 Official/Live 文本本身不作为音乐分类证据。不同风格关键词轮换，关键词分页独立推进，候选不足时最多再抽样三轮，单接口失败不影响其他源。

`recommendationSession.ts` 维护整个渲染会话的 `seenTrackIds`，跨推荐/发现页面导航共享；只有实际提交展示的歌曲才记为已展示，过时请求不污染集合。不会为补足数量而清空集合或放宽音乐过滤。上游限流/候选耗尽时可能少于 21 首或显示可重试提示；基于元数据的规则不能绝对识别所有误标内容，也不能保证有限上游池永不耗尽。

## 开发验证

```powershell
npm install
npm run lint
npm run typecheck
npm test
npm run build
npx electron-builder --dir --config.directories.output=release/music-upgrade
# 隔离测试档案，B站/更新网络使用确定性夹具，实际 React、Electron、FFmpeg 与文件管道运行
.\node_modules\electron\dist\electron.exe scripts/smoke-electron.cjs --upgrade --packaged --release-dir=release/music-upgrade --allow-hotkey-conflict
```

- `tests/music-upgrade.test.cjs`：播放结束模式矩阵、音乐过滤/去重补池、默认格式迁移，以及真实 FFmpeg 转码/中文 ID3/APIC/解码/最终大小/哈希损坏/清理测试。
- `scripts/smoke-electron.cjs --upgrade`：独立输出到 `artifacts/qa-upgrade` 或 `artifacts/qa-upgrade-packaged`，不会覆盖旧 QA 证据；测试档案目录已加入 Git 忽略。
- 上述确定性测试不等于对个人账号线上推荐质量的验收；需要联网并登录后确认当前账号的 API 可用性及实际推荐效果。未登录时会使用公开音乐候选源。

## 发布注意

这是**主进程升级**，不能只给旧版外壳投递 renderer OTA。发布时需提升应用版本并分发完整桌面包，`OTA_MIN_SHELL` 必须指向包含本次下载 IPC 和转码器的外壳版本。

`ffmpeg-static` 外部化并配置 `asarUnpack`，执行路径会从 `app.asar` 映射到 `app.asar.unpacked`。二进制随目标平台的依赖安装，跨平台/架构发布必须在对应目标环境安装并验证，不能把 Windows FFmpeg 直接打进其他平台包。

FFmpeg/ffmpeg-static 的 GPL 许可证与二进制许可证文件随依赖打包；对外分发前需要审查并履行对应源码提供和许可证义务。FFmpeg 约增加 83MB 未压缩包体。
