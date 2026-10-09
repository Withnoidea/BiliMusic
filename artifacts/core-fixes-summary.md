# 六项核心缺陷修复验收（2026-10-09）

## 修复范围
- 扫码成功：完整解析 Set-Cookie（保留值中的 `=`、Expires / Max-Age），双会话写入并 flushStore；启动时双向同步、不再删除主会话凭据；退出时清除双会话。nav 校验返回 isLogin/isLoggedIn、uid、uname、face，不向 renderer 暴露凭据。
- 登录弹窗：串行轮询、旧请求作废、成功立即关闭；AuthContext 更新头像并通知歌单/收藏刷新。
- 发现：右上角“换一换 / 刷新”，轮换热门/原创/最新投稿；下一轮加载下一页，旧请求不会覆盖新结果。
- 推荐：保留秒数/文本时长，解析 mm:ss/hh:mm:ss；缺失时读取关联视频/视频详情，最大4并发并缓存；真正未知时显示 --:--，不伪造时长。
- 播放队列：Favorites、Playlists（实际的歌单详情文件）、Recommend、Discover 点击曲目时全表入队；顺序下一首/上一首对齐；Fisher-Yates 洗牌以点击曲目开头，元信息更新不会重洗牌；队列点击索引与展示一致。
- 桌面歌词：闲置提示、设置变化即时预览、固定最大宽度/单行省略、当前/下一句颜色和阴影；窗口完整限制在工作区，四边4 DIP留白；原生DIP光标相对固定起点拖动，pointer capture、全局释放/cancel/blur、心跳超时兜底，提示层不拦截指针。

## 验证结果
- `npm test`：9/9 通过。
- `npm run build`：通过，两个 TypeScript 工程 0 错误，Vite 构建完成。
- `npm run electron:build`：通过，Windows x64 NSIS + win-unpacked 已重新生成。
- `scripts/smoke-electron.cjs --packaged`：22项检查通过；加载最终 app.asar 中的代码，在隔离 Electron 测试档案内执行，不使用真实用户数据。
- `node scripts/verify-release.cjs`：通过，28份打包资源与 dist/dist-electron 逐字节一致。
- 免安装 ZIP：重新生成，CRC全部通过，内含 app.asar SHA-256 与 win-unpacked 一致。
- 截图和结构化测试报告：`artifacts/qa-packaged/`。
- 文件大小和 SHA-256 清单：`release/release-manifest.json`。

## 验证边界
扫码、排行榜和音频使用确定性模拟服务响应；真实 B站账号的手机扫码确认及线上接口风控仍需用户实测。安装程序已生成但未在本机执行安装；包未数字签名，Windows 可能显示 SmartScreen 提示。测试日志中的“下载目录未授权”是有意验证越权路径被拒绝，不是测试失败。
