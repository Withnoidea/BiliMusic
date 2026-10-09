# 扫码确认后提前过期修复 — BiliMusic 1.0.3

## 已复现的原因
1. Electron 36.9.5 的 net-fetch 将多个 Set-Cookie 拼成一条。真实本机 HTTP 服务发送 3 个头，getSetCookie() 实际返回 1 条；旧解析仅在 getSetCookie 为空时拆分，因此漏掉凭据。
2. API 请求设置 www.bilibili.com Origin，而目标是 api.bilibili.com；默认 same-origin 凭据策略不会发送跨 Origin 的 Cookie。真实 Chromium 同站点跨 Origin 实验验证：默认不发送，credentials:include 发送。
3. 扫码确认后的 Cookie 保存异常被弹窗吞掉，随后继续请求已消费的二维码，将服务端返回的 86038 显示为提前过期。

## 修复
- 无论 getSetCookie 返回多少条，逐条拆分合并 Cookie，保留 Expires 的逗号、值中的等号与百分号编码；双会话写入并强制落盘。
- 二维码生成、轮询和认证 API 均显式 credentials:include。
- 在落盘/账号验证之前保存成功响应；同一二维码并发请求合并，确认后的重试仅执行保存与验证，不再调用上游扫码轮询。
- 保存或网络验证失败显示“重试完成登录”，不再冒充二维码过期；服务器确认过期仍正确显示过期。只有 nav 验证成功才向弹窗报告登录成功。
- 支持本地读取历史 HTTP passport 回调的凭据，不访问回调链接、不把 Cookie 传给渲染层，不混用不同账号的旧凭据。
- 弹窗本地倒计时仅作提示，不会取消正在完成的登录。

## 最终验证
- npm test：17/17 通过。
- scripts/probe-electron-cookies.cjs：真实 Electron HTTP/Cookie 行为检查通过（非 Response mock）。
- npm run build：TypeScript 两工程 0 错误，Vite 通过。
- npm run electron:build：最终原定 release 目录构建通过。
- scripts/smoke-electron.cjs --packaged：最终 app.asar 的 24 项界面检查全部通过，无跳过项。测试使用本机 HTTP 模拟扫码服务、真实 Chromium 合并响应头与真实 Cookie Store；故意注入落盘失败后等待，再点击重试，确认未再次请求已消费的二维码、弹窗关闭且头像/账号刷新。
- node scripts/verify-release.cjs：28 个构建资源与 ASAR 逐字节一致；测试报告绑定最终 ASAR 的 SHA-256。
- ZIP CRC 全部通过，ZIP 内 app.asar SHA-256 与 win-unpacked 一致。

## 最终产物
| 路径 | 字节 | 大小 |
| --- | ---: | ---: |
| release/BiliMusic-Setup-1.0.3-x64.exe | 92,120,077 | 87.85 MiB |
| release/win-unpacked | 351,943,419 | 335.64 MiB |
| release/BiliMusic-1.0.3-win-x64-portable.zip | 130,473,227 | 124.43 MiB |

免安装运行：release/win-unpacked/BiliMusic.exe。完整哈希清单：release/release-manifest.json。

## 测试边界与构建说明
- 没有代替用户进行真实手机确认，不能声称实际 B站账号的端到端登录已实测。请使用 1.0.3 再扫码确认一次，无需删除个人数据。
- NSIS 安装包已生成，但未执行系统安装，未数字签名（NotSigned）。
- 构建过程中旧版程序/Typora 持有旧 app.asar，曾导致打包失败；文件锁最终释放后，原定 release/win-unpacked 已重新生成并重新测试。release/login-fix-1.0.3 为中间构建，release/previous-unpacked-lock-backup 为旧文件保留目录，不作为最终交付入口。
- 测试日志中的“下载目录未授权”是安全拒绝用例；electron-builder 的依赖重复提示与 Node DEP0190 为非阻断警告。
