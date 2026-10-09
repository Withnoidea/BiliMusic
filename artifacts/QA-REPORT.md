# BiliMusic 1.0.2 产品级重构验收

## 结论

**PASS — 最终类型检查、前端编译、Electron / NSIS 打包均退出码 0，无编译／打包错误。**

- `npm run build`：前端与主进程 TypeScript 检查、Vite 构建、两份 preload 同步成功。
- `npm run electron:build`：生成 Windows x64 免安装目录与 NSIS 安装包；最后一次包含播放启动超时兜底。
- `npm test`：5 项通过、0 失败。
- `scripts/smoke-electron.cjs --packaged`：隔离用户目录，加载交付包内 `app.asar`，14 项验收通过，渲染器 console error 为 0。
- `node scripts/verify-release.cjs`：28 项前端／主进程构建文件与 ASAR 逐字节一致；主窗口和辅助窗口 preload 与源码一致。
- 免安装 ZIP：74 个文件清单及逐文件 SHA-256 与 `win-unpacked` 完全一致。

## 功能交付

- 正式环境默认关闭远程调试，只在开发模式或显式 `--debug` 时开启回环地址端口。
- 鉴权 Cookie 仅保存在主进程专用 session；去除 Cookie 获取桥，扫码返回值剥离敏感信息；请求走受限主进程网关。
- 下载目录必须由原生文件夹选择器授权；路径、文件名、符号链接、CDN 地址及重定向均校验。
- 本地文件经大小与摘要校验后通过不暴露文件路径的流式协议优先播放；支持 Range / HEAD。旧下载兼容记录大小和 MP4 文件头检查。
- CDN 错误／停滞／启动超时自动有限次数刷新，保持进度；全局下载 2 并发，真实百分比、失败原因与重试入口。
- 注册系统媒体 Play/Pause、Next、Previous；验证隐藏窗口下控制链路。
- 封面主色氛围光、进度／音量提示、键盘调节、响应式图标侧栏、骨架屏及统一空状态。
- 切歌和跳进度采用约 150ms 音量曲线；长于 15 分钟的音频保存断点；播放器持久化节流。
- 主窗口、托盘和歌词窗口均启用 sandbox / contextIsolation、关闭 Node 集成；辅助页内联脚本使用哈希 CSP。

## 自动化覆盖

单元测试覆盖：路径授权、IPC 来源、CDN allowlist、流式下载与原子提交、截断清理、并发上限、文件篡改拒绝、本地 Range 零网络请求、凭据剥离、长音频断点、淡入淡出取消、启动超时／取消。

真实 Electron 冒烟覆盖：默认调试关闭、无凭据桥、下载成功、本地播放不请求 playUrl、换链恢复 8 秒进度、680/720px 无横向溢出、歌曲信息不竖排、全局媒体键注册、后台暂停／恢复、键盘滑块提示、原生目录选择与打开授权、越权路径拒绝、所有窗口隔离。

## 产物

| 文件 | 字节 | MiB |
|---|---:|---:|
| `release/BiliMusic-Setup-1.0.2-x64.exe` | 92,117,573 | 87.85 |
| `release/BiliMusic-1.0.2-win-x64-portable.zip` | 130,472,692 | 124.43 |
| `release/win-unpacked/BiliMusic.exe` | 202,754,048 | 193.36 |
| `release/BiliMusic-Setup-1.0.2-x64.exe.blockmap` | 97,385 | 0.09 |
| `release/latest.yml` | 354 | 0.00 |

免安装目录总计 **351,933,459 字节 / 335.63 MiB**，共 74 个文件。使用免安装版时需保留完整目录，不能只复制 EXE。

完整构建文件清单、时间与 SHA-256：`release/release-manifest.json`。
截图和机器可读结果：`artifacts/qa-packaged/`；构建输出：`artifacts/final-build.log`。

## 验收边界与提示

- 音频与 B站响应使用确定性测试数据，未使用真实账号登录；真实 CDN 限流、硬件媒体键物理按键、安装向导人工点击没有冒充已验收。
- 测试日志中“下载目录未授权”是主动访问 `C:\Windows` 的预期安全拒绝，不是构建失败。
- Electron Builder 的 Node `DEP0190` 是第三方构建工具弃用警告，构建退出码仍为 0；不宣称零警告。
- 安装包未提供 Authenticode 代码签名证书，Windows 可能显示未知发布者／SmartScreen 提醒。
- 校验本地音频不会请求 B站播放地址或 CDN；封面、歌词、发现等独立在线功能不属于“本地音轨零网络请求”的范围。
- 保留原有项目的 React 19 和既有未提交功能，不做破坏性的版本降级或覆盖。
