# Withnoidea/BiliMusic 发布与检查更新

## 更新源

- 仓库：https://github.com/Withnoidea/BiliMusic
- 正式发布页：https://github.com/Withnoidea/BiliMusic/releases
- OTA 清单：https://github.com/Withnoidea/BiliMusic/releases/latest/download/ota.json
- 无 OTA 时的回退检查：https://api.github.com/repos/Withnoidea/BiliMusic/releases/latest
- 运行时地址统一在 `src/config/project.ts`，打包发布配置在 `package.json` 的 `build.publish`，测试检查两者一致。

当前 fork 若没有正式 Release，检查更新会提示暂无发布。GitHub 网络错误、限流和清单损坏会明确报错；清单和发布检查各有 15 秒超时，可再次点击检查。不会连接原作者仓库寻找更新。

## 发布流程

1. 同步修改 `package.json` 与 `package-lock.json` 的版本，例如 `1.0.4`，运行 `npm test`、`npm run build`。
2. 本地 Windows：`npm run electron:build` 生成 `release/win-unpacked`、安装包、`latest.yml` 和 blockmap。`npm run build:ota` 生成 `release/ota/ota.json` 与 `renderer-<版本>.asar`。
3. 推荐在本 fork 启用 Actions，推送与 package 版本一致的 `v<版本>` tag（例如 `v1.0.4`）。`.github/workflows/build.yml` 构建多平台产物并发布到触发工作流的仓库。手动 workflow_dispatch 只构建，不发布 Release。
4. 若手动发布，把安装包、对应的 `latest*.yml`、blockmap、`ota.json` 和 `renderer-<版本>.asar` 全部上传到同一个正式 Release 的附件根目录。不要只上传源代码 zip 或把 OTA 附件藏在子目录中。
5. 发布为非 draft、非 prerelease，版本使用 `v主版本.次版本.修订号`。检查 `latest/download/ota.json`、`latest.yml` 和清单中安装包地址可访问。

## 客户端行为

- 检测到更高的外壳版本时优先升级整包，避免只热更界面而遗漏扫码、窗口等主进程修复。
- Windows/Linux 打包版通过 electron-updater 下载整包；未签名 macOS、鸿蒙及未打包运行时引导到本 fork 发布页手动下载。
- 外壳满足要求时才下发界面补丁，验证文件名和 SHA-512 后暂存，可立即重载或下次启动生效。补丁未回报启动成功则回滚。
- `minShellVersion` 默认当前 package 版本。只有确认旧外壳兼容时才通过 `OTA_MIN_SHELL` 降低，不应默认设置为 1.0.0。
- OTA 使用 `userData/ota/Withnoidea-BiliMusic` 独立目录；旧上游补丁不再加载，过期或低于内置版本的补丁也不加载。不删除歌单、下载或登录数据。
- 尚未提供 OTA 清单但存在较新正式 Release 时，引导手动下载。检查更新不等于自动为仓库创建 Release。

## 发布前验证

```powershell
npm test
npm run build
npm run electron:build
npm run build:ota
```

使用隔离数据目录运行 `scripts/smoke-electron.cjs --packaged` 验证实际 ASAR，包含删除后导航、缺失歌单、fork 更新提示、扫码 Cookie 重试、播放队列与桌面歌词。未签名包可能触发 Windows SmartScreen；不要把未进行的真实安装或手机扫码称作已验证。
