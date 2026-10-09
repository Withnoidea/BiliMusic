<div align="center">
  <img src="./src/assets/icon.png" width="112" height="112" alt="BiliMusic Logo" />
  <h1>BiliMusic · Enhanced Edition</h1>
  <p>
    <strong>把 Bilibili 变成一座精致、灵动、支持离线秒播的 Apple Music 风格桌面音乐资料库。</strong>
  </p>
  <p>
    <em>本项目基于原作者 <a href="https://github.com/HanversionOvO/BiliMusic">@HanversionOvO/BiliMusic</a> 进行深度二次开发与体验重构</em>
  </p>
  <p>
    <a href="#-二创增强特性亮点">二创增强亮点</a>
    ·
    <a href="#-功能全景与界面">功能展示</a>
    ·
    <a href="#-快速开始">快速开始</a>
    ·
    <a href="#-构建与打包">构建与打包</a>
    ·
    <a href="https://github.com/Withnoidea/BiliMusic">GitHub</a>
  </p>
  <p>
    <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=111" />
    <img alt="Electron" src="https://img.shields.io/badge/Electron-36-47848F?style=for-the-badge&logo=electron&logoColor=fff" />
    <img alt="Vite" src="https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=fff" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=fff" />
    <img alt="License" src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" />
  </p>
</div>

<br />

<div align="center">
  <table>
    <tr>
      <td align="center" width="25%">
        <h3>🎵 本地离线秒播</h3>
        <p>下载完整性校验，已缓存音频 0 流量 0 延迟秒播，断网无忧。</p>
      </td>
      <td align="center" width="25%">
        <h3>📥 批量队列下载</h3>
        <p>多选批量下载、全局 2 并发温和调度、原子写入防止文件损坏。</p>
      </td>
      <td align="center" width="25%">
        <h3>✨ 沉浸动态光晕</h3>
        <p>智能提取封面主色，自适应底栏流光氛围与细腻淡入淡出。</p>
      </td>
      <td align="center" width="25%">
        <h3>📋 外部歌单智能导入</h3>
        <p>支持外部歌单迁移，基于歌名/歌手/时长的智能模糊候选匹配。</p>
      </td>
    </tr>
  </table>
</div>

<br />

## 🌟 二创增强特性亮点 (What's Enhanced)

在原作者优秀的前端架构与 Apple Music 设计语言之上，针对长期日常听歌的**稳定性、音质播放流、离线能力与交互细节**进行了全方位的深度打磨与工程重构：

### 1. 本地音频离线秒播链路 (Local Priority Playback)
- **0 流量秒开**：点击播放时优先探测本地下载库，通过哈希与文件完整性校验后，以主进程安全流直接驱动播放，彻底摆脱 B 站 CDN 波动与网络依赖。
- **平滑换链兜底**：本地未下载时自动请求 B 站流媒体，若遇到 CDN 鉴权过期或流阻断，后台具备静默刷新与超时重试兜底，切歌不再报错卡死。

### 2. 批量下载管理与文件防护
- **多选批量下载**：支持在“我喜欢”及各大歌单中一键开启多选模式，批量提交下载任务。
- **并发与反爬保护**：采用全局 2 并发调度队列，防止瞬间并发过高触发 B 站 412/429 访问限制。
- **原子提交写盘**：下载临时文件校验成功后再执行原子替换，杜绝断网或强退导致的半截破损音频。支持自定义下载目录与一键在资源管理器中定位。

### 3. 现代化视听微交互与动效
- **封面自适应氛围光 (Ambient Light)**：底栏播放器实时提取当前封面主色阶，呈现呼吸感柔和背景光晕。
- **150ms 软性 Crossfade**：切歌与跳转进度时微调淡入淡出曲线，消除数字音频突兀起音的爆音不适。
- **长音频断点记忆**：针对电台、播客、长合集（>15分钟）自动记录播放位置，二次进入平滑续播。

### 4. 独立置顶桌面歌词 (Desktop Lyrics)
- 独立置顶透明歌词窗口，支持流光字色与阴影渲染。
- 支持锁定穿透、无干扰拖拽停靠与双行歌词预读，全屏游戏或码字时听歌更沉浸。

### 5. 跨平台歌单迁移助手 (Smart Playlist Import)
- 支持外部平台歌单 JSON / 文本导入。
- 内置多维模糊匹配算法（歌名 + 歌手 + 时长置信度打分），并提供清晰的手动修正候选浮窗。

### 6. 系统级防御与进程健壮性
- **防多开守护**：单实例互斥锁（Single Instance Lock），重复双击自动唤醒已有主窗口，彻底解决后台多开堆叠。
- **生产级凭据与特权隔离**：生产包彻底禁用 `17689` 调试端口；B站登录凭据（SESSDATA / bili_jct）严格收敛于主进程安全会话；全窗口开启 `contextIsolation` 与原生路径白名单校验。

---

## 📸 功能全景与界面展示

> *（提示：下方预留了标准截图展示位，欢迎补充实际运行截图）*

### 1. 沉浸式音乐主界面与氛围光
<!-- [TODO: 截图] 主界面：展示 Apple Music 质感的深色毛玻璃侧栏、封面卡片流以及底栏播放器的动态光晕氛围 -->
> 📷 **[TODO: 截图 1 - 沉浸式主界面与底栏氛围光]**  
> *展示包含侧边栏导航、推荐歌曲流，以及正在播放时的封面主色自适应氛围底栏。*

### 2. 沉浸式播放器与歌词面板
<!-- [TODO: 截图] 展开后的全屏/沉浸播放页：左侧旋转黑胶唱片与大封面，右侧随时间滚动的逐字歌词 -->
> 📷 **[TODO: 截图 2 - 沉浸式播放器与同步歌词]**  
> *展示大封面背景虚化弥散、唱片动效与右侧高精细度歌词滚动联动界面。*

### 3. 歌单多选与批量离线下载
<!-- [TODO: 截图] 歌单多选操作界面：展示勾选框、批量下载进度浮窗以及已下载角标 -->
> 📷 **[TODO: 截图 3 - 歌单多选与下载队列调度]**  
> *展示点击“多选”后批量勾选歌曲，右上方弹出实时并发下载进度与百分比。*

### 4. 独立悬浮桌面歌词
<!-- [TODO: 截图] 桌面歌词效果图：展示置顶于桌面壁纸上的透明双行流光桌面歌词小部件 -->
> 📷 **[TODO: 截图 4 - 悬浮桌面歌词微件]**  
> *展示开启桌面歌词后的双行柔和阴影展示与停靠效果。*

### 5. 外部歌单智能匹配导入
<!-- [TODO: 截图] 歌单导入界面：展示外部歌单文本粘贴、匹配进度条与手动对齐候选曲目弹窗 -->
> 📷 **[TODO: 截图 5 - 歌单迁移与智能打分匹配]**  
> *展示将外部歌曲名称导入后，算法基于歌手与时长自动在 B站 寻找最佳曲目版本的匹配结果。*

---

## 🚀 快速开始

### 运行环境要求
- **Node.js**: >= 18.0.0
- **npm** 或 **pnpm**
- **操作系统**: Windows 10/11 x64 (macOS / Linux 亦支持前端开发)

### 本地启动与调试

```bash
# 1. 克隆本项目
git clone https://github.com/Withnoidea/BiliMusic.git
cd BiliMusic

# 2. 安装项目依赖
npm install

# 3. 启动本地开发服务（同时启动 Vite + Electron 窗口）
npm run electron:dev
```

---

## 📦 构建与打包

生产构建会自动进行 TypeScript 类型核验、Vite 前端压缩、preload 脚本同步与 Electron 打包：

```bash
# 执行前端与主进程编译检查
npm run build

# 执行自动化回归测试
npm test

# 打包产出 Windows 安装包与免安装版本
npm run electron:build
```

**打包构建产物将输出在 `release/` 目录下**：
- **免安装绿色便携版**：`release/BiliMusic-<version>-win-x64-portable.zip`
- **免安装解压目录**：`release/win-unpacked/BiliMusic.exe`
- **NSIS 独立安装包**：`release/BiliMusic-Setup-<version>-x64.exe`

---

## 🛠️ 项目技术栈

- **Core**: Electron 36 (全沙箱架构 + IPC 严格授权)
- **Frontend**: React 19 + TypeScript + Vite 6
- **UI & Motion**: Tailwind CSS + Framer Motion (弹性动效)
- **Iconography**: Lucide React
- **Audio & Media**: HTML5 Web Audio API + 自研安全流式音频网关
- **Test**: Node.js Test Runner + 包内 Electron 冒烟测试套件

---

## 🙏 致谢与开源协议

- **原始项目**：特别感谢原作者 [@HanversionOvO](https://github.com/HanversionOvO) 开源的原版 [BiliMusic](https://github.com/HanversionOvO/BiliMusic)，提供了优异的视觉设计与跨平台基础架构。
- **开源协议**：本项目沿用 [MIT License](./LICENSE) 开源协议。本软件仅供学习交流使用，音频版权归原视频创作者及哔哩哔哩平台所有。
