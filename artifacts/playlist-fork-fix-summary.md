# BiliMusic 1.0.4：删除歌单与 fork 更新修复验证

验证时间：2026-10-09T07:54:07.522232+00:00

## 修复内容

- 删除/缺失歌单的空数组依赖保持稳定，下载状态不变时不触发重渲染；切换歌单隔离页面状态，删除后 replace 导航，缺失页可返回。
- 更新清单、发布 API、整包 updater、关于项目和发布页统一使用 Withnoidea/BiliMusic；中文/英文 README 和发布说明已同步，保留上游作者署名与原应用 ID。
- GitHub 实测 fork 仓库公开存在；latest Release 与 ota.json 均为 HTTP 404。客户端明确提示暂无正式发布；无 OTA 但有较新 Release 时引导 fork 发布页。
- 为清单/发布检查添加超时，支持网络失败后重试，手动检查能接收正在执行的启动检查结果，避免一直停在检查中。
- 使用独立 OTA 缓存目录，忽略上游及旧于内置版本的缓存，验证文件名与 SHA-512；优先升级新外壳，防止主进程修复被纯界面补丁遗漏。

## 已执行验证

- `npm test`：26/26 通过（包含此前扫码登录 Cookie 合并、落盘失败重试等回归）。
- `npm run build`：主进程/渲染层 TypeScript 0 错误，Vite 通过。
- `npm run electron:build`：通过，生成 Windows x64 NSIS 安装包与 win-unpacked。
- Electron 加载最终安装包 ASAR：28 项检查全部通过，无跳过。使用隔离资料目录与模拟 API，不接触真实歌单及账号。
- 原生鼠标点击：删除普通/空歌单后，9 个页面导航可用；缺失歌单和同步删除不出现渲染循环；更新错误/重试/新版本回退均可用。
- `node scripts/build-ota.mjs`：生成 OTA ASAR 和清单；minShellVersion=1.0.4。
- `node scripts/verify-release.cjs`：最终 ASAR 与 28 个构建文件逐字节一致，匹配测试时 SHA-256；更新配置 owner=Withnoidea，OTA 内容及 SHA-512 校验通过。
- portable.zip：CRC 检查通过，内含 ASAR 与最终包相同。
- `git diff --check`：通过。

## 产物

| 路径 | 字节 | MiB |
|---|---:|---:|
| `release/BiliMusic-Setup-1.0.4-x64.exe` | 92,120,795 | 87.85 |
| `release/BiliMusic-1.0.4-win-x64-portable.zip` | 130,473,848 | 124.43 |
| `release/win-unpacked`（74 文件） | 351,946,526 | 335.64 |

## 指纹

- 最终 app.asar SHA-256：`0ea960380bac6c15e5e549efcc51432af3eeffc6958b8b40e40d3d51c184cc29`
- BiliMusic-Setup-1.0.4-x64.exe SHA-256：`3e02afd6d60688b874d000e242e348128324f1757a544fbced2592e0c8bed7bd`
- BiliMusic-1.0.4-win-x64-portable.zip SHA-256：`2cf36e876f234435a3f60b3c53ca17e7c1d9d04f439566c4df6f8804b904c974`

## 验证边界

- 安装包未签名（Authenticode=NotSigned），未在真实用户系统执行安装/卸载。
- Electron 回归使用最终 ASAR，由测试 Electron 宿主载入并提供包版本元数据；不是一次真实安装器升级。
- fork 暂无正式 Release，真实联网验证了 404 行为；新版本下载/更新状态分支通过模拟服务与自动测试验证，未实际从 GitHub 安装新版本。
- 此轮未进行真实手机扫码登录；登录验证为已有确定性 Cookie/网络/界面回归。
- 未向 GitHub 推送代码、创建 tag 或发布 Release。发布步骤见 `docs/RELEASING.md`。

截图：`artifacts/qa-packaged/playlist-delete-responsive.png`、`artifacts/qa-packaged/fork-updates.png`。
完整清单：`release/release-manifest.json`；回归报告：`artifacts/qa-packaged/smoke-result.json`。
