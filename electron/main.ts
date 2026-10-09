import { clampLyricBounds } from './lyricGeometry'
import { app, BrowserWindow, Tray, ipcMain, nativeImage, net, protocol, screen, session, shell, dialog, globalShortcut } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { registerBiliApiHandlers, initializeBiliAuth } from './biliApi'
import { registerLyricsApiHandlers } from './lyricsApi'
import { initUpdates, getActiveRendererRoot } from './updater'
import { registerWebdavHandlers } from './webdav'
import { registerPlaylistImportHandlers } from './playlistImportApi'

import { assertTrustedSender, grantDirectory, downloadDirectory, validateAbsolutePath, isWithin } from './security'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const isHarmonyOS = (process.platform as string) === 'openharmony'

// 单实例锁：防止多开多个 exe 进程
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  console.log('[BiliMusic] 检测到已有实例正在运行，自动退出当前进程')
  app.quit()
  process.exit(0)
}


// 统一 userData 目录：dev（应用名 bilimusic）与打包版（productName BiliMusic）默认各用一套
// userData，导致歌单/收藏/登录态（localStorage + Cookie）在两套存储间互相看不见——
// 例如 dev 里导入的歌单，打包版里"消失"。统一到固定目录即可跨构建共享；
// 同时把旧打包版目录（BiliMusic）的数据一次性迁移过来，避免已有数据丢失。
if (!isHarmonyOS) {
  const userDataDir = path.join(app.getPath('appData'), 'bilimusic')
  app.setPath('userData', userDataDir)
  const legacyDir = path.join(app.getPath('appData'), 'BiliMusic')
  try {
    if (!fs.existsSync(userDataDir) && fs.existsSync(legacyDir)) {
      fs.cpSync(legacyDir, userDataDir, { recursive: true })
      console.log('[BiliMusic] 已迁移旧目录数据:', legacyDir, '→', userDataDir)
    }
  } catch {
    // 迁移失败不阻塞启动（首次无旧数据时正常跳过）
  }
}

// 生产环境用自定义 app:// 协议加载渲染层：file:// 下 ESM(type=module) 脚本会被
// Chromium 的 CORS 策略拦截（file:// 为不透明源）导致页面空白。自定义标准安全协议
// 提供合法 origin，模块脚本与相对资源即可正常加载。须在 app ready 之前注册。
protocol.registerSchemesAsPrivileged([
  { scheme: 'bilimusic-audio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

// Chrome MCP 远程调试（开发时使用）
const debugEnabled = process.env.NODE_ENV === 'development' || process.argv.includes('--debug')
if (debugEnabled) {
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
  app.commandLine.appendSwitch('remote-debugging-port', '17689')
  app.commandLine.appendSwitch('remote-allow-origins', 'http://localhost:17689,http://127.0.0.1:17689')
} else {
  app.commandLine.removeSwitch('remote-debugging-port')
  app.commandLine.removeSwitch('remote-debugging-pipe')
  app.commandLine.removeSwitch('remote-allow-origins')
}
app.on('will-quit', () => globalShortcut.unregisterAll())

// B站请求头处理
//
// 注意：Electron 每个 session 的 webRequest 事件只允许注册一个监听器，
// 重复调用 onBeforeSendHeaders 会覆盖之前的。因此资源 CDN 与 API 的请求头
// 处理必须合并在同一个监听器内，否则后注册的会让前者失效（音频 CDN 拿不到
// Referer → 403）。
function setupBiliHeaders() {
  // 覆盖 B站所有资源/接口域名（图片、音频 CDN、API、登录）
  const biliUrls = [
    'https://*.hdslb.com/*',
    'https://*.bilivideo.com/*',
    'https://*.bilivideo.cn/*',
    'https://*.akamaized.net/*',
    'https://*.bilibili.com/*',
  ]

  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: biliUrls }, (details, callback) => {
    const headers = details.requestHeaders
    delete headers.Cookie
    delete headers.cookie
    headers.Referer = 'https://www.bilibili.com'
    callback({ requestHeaders: headers })
  })

}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let trayWindow: BrowserWindow | null = null
let trayWindowReady = false
let pendingTrayShow: { x: number; y: number } | null = null
let isQuitting = false
let lyricWindow: BrowserWindow | null = null
let lyricLocked = true // 锁定 = 鼠标穿透，只能从设置里解锁拖动

type TrayCommand = 'toggle-play' | 'next' | 'prev' | 'show-window' | 'quit'

interface TrayPlayerState {
  hasTrack: boolean
  title: string
  artist: string
  coverUrl: string
  isPlaying: boolean
  queueLength: number
  theme: 'light' | 'dark'
}

let trayPlayerState: TrayPlayerState = {
  hasTrack: false,
  title: '未在播放',
  artist: '搜索并播放音乐',
  coverUrl: '',
  isPlaying: false,
  queueLength: 0,
  theme: 'dark',
}

// 应用图标：dev 时从 electron 源目录加载，打包后从 dist-electron 同级加载（由 copy 脚本随构建复制）
function loadAppIcon(fileName = 'icon.png') {
  const iconPath = process.env.VITE_DEV_SERVER_URL
    ? path.join(__dirname, '../electron', fileName)
    : path.join(__dirname, fileName)
  return nativeImage.createFromPath(iconPath)
}

function createTrayIcon() {
  const trayIcon = isHarmonyOS ? loadAppIcon('tray.png') : loadAppIcon()
  // 托盘图标尺寸较小，缩放到 32px 以兼顾标准与高 DPI 显示
  return trayIcon.resize({ width: 32, height: 32 })
}

function persistentStoreFile() {
  return path.join(app.getPath('userData'), 'renderer-persistent-store.json')
}

function readPersistentStore(): Record<string, string> {
  try {
    const file = persistentStoreFile()
    if (!fs.existsSync(file)) return {}
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

function writePersistentStore(store: Record<string, string>) {
  try {
    const file = persistentStoreFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(store, null, 2))
  } catch {
    // Persistence failures should not block the renderer.
  }
}

function showMainWindow() {
  if (!mainWindow) createWindow()
  if (process.platform === 'darwin') app.dock?.show()
  mainWindow?.show()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.focus()
}

function updateTrayState() {
  tray?.setToolTip(trayPlayerState.hasTrack
    ? `${trayPlayerState.isPlaying ? '正在播放' : '已暂停'}: ${trayPlayerState.title}`
    : 'BiliMusic')
  trayWindow?.webContents.send('tray:state', trayPlayerState)
}

function getTrayHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    /* 深色为默认，body.light 切换为浅色，跟随 app 主题 */
    :root {
      --tray-menu-bg: linear-gradient(180deg, rgba(38, 38, 42, .94), rgba(18, 18, 20, .96)), rgba(24, 24, 26, .96);
      --tray-menu-border: rgba(255, 255, 255, .12);
      --tray-menu-shadow: 0 28px 80px rgba(0, 0, 0, .44), inset 0 1px rgba(255, 255, 255, .12);
      --tray-text: #f7f7f8;
      --tray-now-bg: rgba(255, 255, 255, .075);
      --tray-now-border: rgba(255, 255, 255, .08);
      --tray-cover-fallback: rgba(255, 255, 255, .62);
      --tray-meta-sub: rgba(255, 255, 255, .48);
      --tray-status: rgba(255, 255, 255, .44);
      --tray-btn-bg: rgba(255, 255, 255, .1);
      --tray-btn-bg-hover: rgba(255, 255, 255, .16);
      --tray-btn-text: #fff;
      --tray-actions-border: rgba(255, 255, 255, .1);
      --tray-row-text: rgba(255, 255, 255, .82);
      --tray-row-hover: rgba(255, 255, 255, .1);
      --tray-count: rgba(255, 255, 255, .38);
    }
    body.light {
      --tray-menu-bg: linear-gradient(180deg, rgba(252, 252, 253, .95), rgba(244, 245, 248, .97)), rgba(255, 255, 255, .96);
      --tray-menu-border: rgba(24, 25, 28, .1);
      --tray-menu-shadow: 0 28px 80px rgba(24, 25, 28, .18), inset 0 1px rgba(255, 255, 255, .9);
      --tray-text: #18191C;
      --tray-now-bg: rgba(24, 25, 28, .04);
      --tray-now-border: rgba(24, 25, 28, .07);
      --tray-cover-fallback: rgba(24, 25, 28, .5);
      --tray-meta-sub: rgba(24, 25, 28, .5);
      --tray-status: rgba(24, 25, 28, .5);
      --tray-btn-bg: rgba(24, 25, 28, .06);
      --tray-btn-bg-hover: rgba(24, 25, 28, .1);
      --tray-btn-text: #18191C;
      --tray-actions-border: rgba(24, 25, 28, .08);
      --tray-row-text: rgba(24, 25, 28, .82);
      --tray-row-hover: rgba(24, 25, 28, .06);
      --tray-count: rgba(24, 25, 28, .4);
    }
    * { box-sizing: border-box; user-select: none; }
    body {
      width: 330px;
      height: 292px;
      margin: 0;
      overflow: hidden;
      color: var(--tray-text);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: transparent;
    }
    .menu {
      width: 100%;
      height: 100%;
      padding: 14px;
      border-radius: 22px;
      background: var(--tray-menu-bg);
      border: 1px solid var(--tray-menu-border);
      box-shadow: var(--tray-menu-shadow);
      backdrop-filter: blur(30px) saturate(160%);
    }
    .now {
      display: flex;
      gap: 12px;
      align-items: center;
      min-height: 76px;
      padding: 10px;
      border-radius: 16px;
      background: var(--tray-now-bg);
      border: 1px solid var(--tray-now-border);
    }
    .cover {
      width: 56px;
      height: 56px;
      display: grid;
      place-items: center;
      overflow: hidden;
      flex: 0 0 auto;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(255,55,95,.42), rgba(255,255,255,.08));
      box-shadow: 0 12px 30px rgba(0,0,0,.22);
    }
    .cover img { width: 100%; height: 100%; object-fit: cover; display: none; }
    .cover span { color: var(--tray-cover-fallback); font-size: 22px; }
    .meta { min-width: 0; flex: 1; }
    .meta strong, .meta small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta strong { font-size: 14px; line-height: 1.2; font-weight: 760; }
    .meta small { margin-top: 5px; color: var(--tray-meta-sub); font-size: 12px; font-weight: 560; }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 12px 2px 10px;
      color: var(--tray-status);
      font-size: 11px;
      font-weight: 680;
    }
    .dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #8e8e93;
      box-shadow: 0 0 0 transparent;
    }
    .status.is-playing .dot {
      background: #30d158;
      box-shadow: 0 0 14px rgba(48,209,88,.65);
    }
    .controls {
      display: grid;
      grid-template-columns: 1fr 1.25fr 1fr;
      gap: 10px;
      padding: 0 4px 12px;
    }
    button {
      height: 42px;
      border: 0;
      border-radius: 999px;
      color: var(--tray-btn-text);
      background: var(--tray-btn-bg);
      cursor: pointer;
      font: 780 13px/1 system-ui, sans-serif;
      transition: transform .16s ease, background .16s ease, opacity .16s ease;
    }
    button:hover { background: var(--tray-btn-bg-hover); transform: translateY(-1px); }
    button:active { transform: scale(.96); }
    button:disabled { opacity: .42; cursor: default; transform: none; }
    .play {
      background: #ff375f;
      color: #fff;
      box-shadow: 0 14px 30px rgba(255,55,95,.26);
      font-size: 16px;
    }
    .play:hover { background: #ff375f; }
    .actions {
      display: grid;
      gap: 8px;
      border-top: 1px solid var(--tray-actions-border);
      padding-top: 12px;
    }
    .row {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 13px;
      text-align: left;
      border-radius: 12px;
      background: transparent;
      color: var(--tray-row-text);
    }
    .row:hover { background: var(--tray-row-hover); }
    .row.danger { color: #ff6961; }
    .count { color: var(--tray-count); font-size: 12px; }
  </style>
</head>
<body>
  <div class="menu">
    <div class="now">
      <div class="cover"><img id="cover" /><span id="fallback">♪</span></div>
      <div class="meta">
        <strong id="title">未在播放</strong>
        <small id="artist">搜索并播放音乐</small>
      </div>
    </div>
    <div id="status" class="status"><span class="dot"></span><span id="statusText">空闲</span></div>
    <div class="controls">
      <button id="prev" title="上一首">⏮</button>
      <button id="play" class="play" title="播放/暂停">▶</button>
      <button id="next" title="下一首">⏭</button>
    </div>
    <div class="actions">
      <button class="row" id="show"><span>显示 BiliMusic</span><span class="count" id="queue">0 首</span></button>
      <button class="row danger" id="quit"><span>退出应用</span><span>⌘Q</span></button>
    </div>
  </div>
  <script>
    const ipcRenderer = window.auxiliaryIPC
    const $ = (id) => document.getElementById(id)
    let state = { hasTrack: false, title: '未在播放', artist: '搜索并播放音乐', coverUrl: '', isPlaying: false, queueLength: 0, theme: 'dark' }
    function render(next) {
      state = next || state
      document.body.classList.toggle('light', (state.theme || 'dark') === 'light')
      $('title').textContent = state.title || '未在播放'
      $('artist').textContent = state.artist || '搜索并播放音乐'
      $('status').className = 'status' + (state.isPlaying ? ' is-playing' : '')
      $('statusText').textContent = state.hasTrack ? (state.isPlaying ? '正在播放' : '已暂停') : '空闲'
      $('play').textContent = state.isPlaying ? '⏸' : '▶'
      $('queue').textContent = (state.queueLength || 0) + ' 首'
      $('prev').disabled = $('play').disabled = $('next').disabled = !state.hasTrack
      if (state.coverUrl) {
        $('cover').src = state.coverUrl
        $('cover').style.display = 'block'
        $('fallback').style.display = 'none'
      } else {
        $('cover').removeAttribute('src')
        $('cover').style.display = 'none'
        $('fallback').style.display = 'block'
      }
    }
    ipcRenderer.on('tray:state', (_event, next) => render(next))
    ipcRenderer.invoke('tray:get-state').then(render)
    $('prev').onclick = () => ipcRenderer.send('tray:command', 'prev')
    $('play').onclick = () => ipcRenderer.send('tray:command', 'toggle-play')
    $('next').onclick = () => ipcRenderer.send('tray:command', 'next')
    $('show').onclick = () => ipcRenderer.send('tray:command', 'show-window')
    $('quit').onclick = () => ipcRenderer.send('tray:command', 'quit')
  </script>
</body>
</html>`
}

// Static auxiliary pages run only their exact inline script, with a narrow isolated bridge.
function secureAuxiliaryHtml(html: string): string {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => "'sha256-" + createHash('sha256').update(match[1]).digest('base64') + "'").join(' ')
  return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${hashes}; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'">`)
}

function createTrayWindow() {
  if (isHarmonyOS) return null
  if (trayWindow) return trayWindow
  trayWindowReady = false
  trayWindow = new BrowserWindow({
    width: 330,
    height: 292,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: '#00000000',
    opacity: 0,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, process.env.VITE_DEV_SERVER_URL ? '../electron/auxiliary-preload.cjs' : 'auxiliary-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  trayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  trayWindow.webContents.on('will-navigate', event => event.preventDefault())
  trayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(secureAuxiliaryHtml(getTrayHtml()))}`)
  trayWindow.once('ready-to-show', () => {
    trayWindowReady = true
    if (pendingTrayShow) {
      const pos = pendingTrayShow
      pendingTrayShow = null
      showTrayWindowAt(pos.x, pos.y)
    }
  })
  trayWindow.on('blur', () => {
    trayWindow?.setOpacity(0)
    trayWindow?.hide()
  })
  trayWindow.on('closed', () => {
    trayWindow = null
    trayWindowReady = false
    pendingTrayShow = null
  })
  return trayWindow
}

function showTrayWindowAt(x: number, y: number) {
  const win = createTrayWindow()
  if (!win) return
  if (!trayWindowReady) {
    pendingTrayShow = { x, y }
    return
  }
  win.setPosition(x, y, false)
  updateTrayState()
  win.setOpacity(0)
  win.showInactive()
  setTimeout(() => {
    if (!trayWindow?.isVisible()) return
    trayWindow.setOpacity(1)
    trayWindow.focus()
  }, 20)
}

function toggleTrayWindow() {
  if (isHarmonyOS) return
  if (!tray) return
  const win = createTrayWindow()
  if (!win) return
  if (win.isVisible()) {
    win.setOpacity(0)
    win.hide()
    return
  }

  const bounds = tray.getBounds()
  const { workArea } = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
  const width = 330
  const height = 292
  const x = Math.round(Math.min(Math.max(bounds.x + bounds.width / 2 - width / 2, workArea.x + 8), workArea.x + workArea.width - width - 8))
  const aboveY = bounds.y - height - 10
  const belowY = bounds.y + bounds.height + 10
  const y = aboveY >= workArea.y ? aboveY : Math.min(belowY, workArea.y + workArea.height - height - 8)

  showTrayWindowAt(x, Math.round(y))
}

function createTray() {
  if (tray) return
  tray = new Tray(createTrayIcon())
  tray.setToolTip('BiliMusic')
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
  if (!isHarmonyOS) {
    tray.on('right-click', toggleTrayWindow)
    createTrayWindow()
  }
}

function hideToTray() {
  mainWindow?.hide()
  if (process.platform === 'darwin') app.dock?.hide()
}

// ===== 桌面歌词窗口 =====
//
// 独立透明置顶窗口，渲染当前/下一行歌词。锁定时 setIgnoreMouseEvents(true)
// 鼠标穿透（不挡桌面操作），解锁后可拖动/点击。样式由渲染进程通过 IPC 推送。

export interface DesktopLyricState {
  visible: boolean
  line: string
  nextLine: string
  isPlaying: boolean
  hasTrack: boolean
  locked: boolean
  style: Record<string, string | number | boolean>
}

let lyricState: DesktopLyricState = {
  visible: false,
  line: '',
  nextLine: '',
  isPlaying: false,
  hasTrack: false,
  locked: true,
  style: {},
}

function getLyricHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    html, body { background: transparent; overflow: hidden; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    #root {
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: default;
    }
    /* 拖动条与歌词同在一个 flex 流里，间距恒定 —— 与窗口高度无关，
       避免过去"badge 钉顶部 + 歌词居中"导致间距随窗口高度变化。 */
    .stack {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      position: relative;
      width: 100%;
      max-width: 100%;
      padding: 4px;
      touch-action: none;
      min-width: 0;
    }
    #dragBar {
      position: absolute; top: 4px; right: 8px; z-index: 2;
      padding: 3px 8px; border-radius: 8px;
      background: rgba(0,0,0,.6); color: rgba(255,255,255,.8);
      font-size: 10px; pointer-events: none;
      opacity: 0; transition: opacity .15s;
    }
    body.unlocked.hint #dragBar { opacity: 1; }
    body.unlocked #root { cursor: grab; touch-action: none; }
    body.dragging #root { cursor: grabbing; }
    body.dragging #dragBar { opacity: 0; }
    .lyric-box {
      width: 100%;
      min-width: 0;
      max-width: 100%;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .line { display: block; width: 100%; max-width: 100%; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 2px 12px rgba(0,0,0,.65); }
    .line.preview { opacity: .65; }
    .line.next { opacity: .55; font-size: .72em; margin-top: 2px; }
    body.unlocked .lyric-box {
      outline: 1px dashed rgba(255, 255, 255, .4);
      outline-offset: -1px;
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="stack">
      <div id="dragBar">按住歌词拖动 · 在设置中锁定</div>
      <div class="lyric-box">
        <span class="line current" id="line"></span>
        <span class="line next" id="nextLine"></span>
      </div>
    </div>
  </div>
  <script>
    const ipcRenderer = window.auxiliaryIPC
    const lineEl = document.getElementById('line')
    const nextEl = document.getElementById('nextLine')
    const dragTarget = document.getElementById('root')

    let style = {}
    let dragging = false
    let pointerId = -1
    let heartbeat = null
    let hintTimer = null

    function applyStyle(s) {
      style = s || {}
      const box = document.querySelector('.lyric-box')
      const line = lineEl
      box.style.fontSize = Math.min(72, Math.max(16, Number(style.fontSize) || 28)) + 'px'
      line.style.fontWeight = style.bold ? '800' : '600'
      box.style.color = style.color || '#ff375f'
      if (style.outline) {
        const ow = style.outlineWidth || 2
        const oc = style.outlineColor || 'rgba(0,0,0,.85)'
        line.style.textShadow = [0,1,2,3,4,5,6,7,8].flatMap(dx =>
          [0,1,2,3,4,5,6,7,8].map(dy =>
            (dx*dx+dy*dy <= ow*ow && (dx||dy)) ? \`\${dx}px \${dy}px 0 \${oc}\` : []
          )
        ).filter(Boolean).join(',') + ', 0 2px 12px rgba(0,0,0,.4)'
      } else {
        line.style.textShadow = style.shadow === false ? 'none' : '0 2px 12px rgba(0,0,0,.5)'
      }
      if (style.showBg) {
        box.style.background = style.bgColor || 'rgba(0,0,0,.35)'
        box.style.padding = '8px 18px'
        box.style.borderRadius = (style.bgRadius || 12) + 'px'
      } else {
        box.style.background = 'transparent'
        box.style.padding = '0'
        box.style.borderRadius = '0'
      }
    }

    // Native cursor coordinates are sampled by the main process in DIP coordinates.
    // Pointer capture + window-level release/cancel/blur cover releases outside the text.
    function endDrag(notify = true) {
      if (!dragging) return
      dragging = false
      clearInterval(heartbeat)
      heartbeat = null
      document.body.classList.remove('dragging')
      try { if (pointerId >= 0) dragTarget.releasePointerCapture(pointerId) } catch (_) {}
      pointerId = -1
      if (notify) ipcRenderer.send('desktop-lyrics:drag:end')
    }
    dragTarget.addEventListener('pointerenter', () => {
      document.body.classList.add('hint')
      clearTimeout(hintTimer)
      hintTimer = setTimeout(() => document.body.classList.remove('hint'), 1400)
    })
    dragTarget.addEventListener('pointerleave', () => document.body.classList.remove('hint'))
    dragTarget.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !document.body.classList.contains('unlocked')) return
      endDrag()
      dragging = true
      pointerId = e.pointerId
      document.body.classList.add('dragging')
      try { dragTarget.setPointerCapture(pointerId) } catch (_) { endDrag(); return }
      ipcRenderer.send('desktop-lyrics:drag:start')
      heartbeat = setInterval(() => ipcRenderer.send('desktop-lyrics:drag:move'), 100)
      e.preventDefault()
    })
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return
      if (!(e.buttons & 1)) { endDrag(); return }
      ipcRenderer.send('desktop-lyrics:drag:move')
    }, true)
    for (const name of ['pointerup', 'pointercancel', 'mouseup', 'blur', 'pagehide']) {
      window.addEventListener(name, () => endDrag(), true)
    }
    window.addEventListener('mousemove', e => { if (dragging && !(e.buttons & 1)) endDrag() }, true)
    dragTarget.addEventListener('lostpointercapture', () => endDrag())
    document.addEventListener('visibilitychange', () => { if (document.hidden) endDrag() })
    document.addEventListener('keydown', e => { if (e.key === 'Escape') endDrag() })
    ipcRenderer.on('desktop-lyrics:drag:ended', () => endDrag(false))

    ipcRenderer.on('desktop-lyrics:state', (_e, s) => {
      if (!s) return
      if (s.style) applyStyle(s.style)
      const preview = !s.hasTrack || !s.line
      lineEl.textContent = preview ? 'BiliMusic · 桌面歌词已就绪' : s.line
      lineEl.classList.toggle('preview', preview)
      nextEl.textContent = s.hasTrack ? s.nextLine || '' : ''
      nextEl.style.display = s.hasTrack && s.nextLine ? 'block' : 'none'
      if (s.locked || !s.visible) endDrag()
      document.body.classList.toggle('unlocked', !s.locked)
      document.body.classList.toggle('locked', Boolean(s.locked))
    })

    applyStyle({})
    lineEl.textContent = 'BiliMusic · 桌面歌词已就绪'
    lineEl.classList.add('preview')
    nextEl.style.display = 'none'
  </script>
</body>
</html>`
}

// 固定最大宽度，按字体和行数计算高度；短句切成长句时不会改变横向锚点。
const LYRIC_W = 900
const LYRIC_H = 140
const LYRIC_BOUNDS_KEY = 'desktop_lyrics_position'

function readLyricPosition(): { x: number; y: number } | null {
  try {
    const raw = readPersistentStore()[LYRIC_BOUNDS_KEY]
    if (!raw) return null
    const p = JSON.parse(raw)
    if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) return { x: p.x, y: p.y }
    return null
  } catch {
    return null
  }
}

function saveLyricPosition() {
  if (!lyricWindow || lyricWindow.isDestroyed()) return
  const b = lyricWindow.getBounds()
  const store = readPersistentStore()
  store[LYRIC_BOUNDS_KEY] = JSON.stringify({ x: b.x, y: b.y })
  writePersistentStore(store)
}

// Keep the complete fixed-width text area visible, including on small/negative-origin displays.
function clampLyricPosition(x: number, y: number, display = screen.getDisplayNearestPoint({
  x: Math.round(x + LYRIC_W / 2), y: Math.round(y + LYRIC_H / 2),
})): Electron.Rectangle {
  const font = Math.min(72, Math.max(16, Number(lyricState.style.fontSize) || 28))
  const height = Math.min(display.workArea.height - 8, Math.ceil(font * 1.35 * (lyricState.nextLine ? 1.72 : 1) + (lyricState.style.showBg ? 18 : 2) + 8))
  return clampLyricBounds(x, y, Math.min(LYRIC_W, display.workArea.width - 8), height, display.workArea)
}

function createLyricWindow() {
  if (lyricWindow && !lyricWindow.isDestroyed()) return lyricWindow
  lyricWindow = new BrowserWindow({
    width: LYRIC_W,
    height: LYRIC_H,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, process.env.VITE_DEV_SERVER_URL ? '../electron/auxiliary-preload.cjs' : 'auxiliary-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  lyricWindow.setAlwaysOnTop(true, 'screen-saver')
  lyricWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  lyricWindow.webContents.on('will-navigate', event => event.preventDefault())
  lyricWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(secureAuxiliaryHtml(getLyricHtml()))}`)
  lyricWindow.once('ready-to-show', () => {
    if (lyricState.visible) { showLyricWindow(); pushLyricState() }
  })
  lyricWindow.on('blur', endLyricDrag)
  lyricWindow.on('hide', endLyricDrag)
  lyricWindow.webContents.on('render-process-gone', endLyricDrag)
  lyricWindow.on('closed', () => { endLyricDrag(); lyricWindow = null })
  return lyricWindow
}

function applyLyricLock() {
  if (!lyricWindow || lyricWindow.isDestroyed()) return
  if (lyricState.locked) {
    // 锁定 = 鼠标穿透，不挡桌面操作
    lyricWindow.setIgnoreMouseEvents(true, { forward: true })
  } else {
    // 解锁 = 接收鼠标事件，由拖动条上的 pointer 事件驱动移动
    lyricWindow.setIgnoreMouseEvents(false)
  }
}

function showLyricWindow() {
  const win = createLyricWindow()
  if (!win.isVisible()) {
    const saved = readLyricPosition()
    const { workArea } = screen.getPrimaryDisplay()
    const fallback = {
      x: workArea.x + (workArea.width - LYRIC_W) / 2,
      y: workArea.y + workArea.height - LYRIC_H - 120,
    }
    const target = clampLyricPosition(saved?.x ?? fallback.x, saved?.y ?? fallback.y)
    // 完整约束尺寸与位置，小屏也不会越界
    win.setBounds(target)
    win.showInactive()
  }
  applyLyricLock()
}

function hideLyricWindow() {
  lyricWindow?.hide()
}

function pushLyricState() {
  if (!lyricWindow || lyricWindow.isDestroyed()) return
  if (!lyricDragging) {
    const bounds = lyricWindow.getBounds()
    lyricWindow.setBounds(clampLyricPosition(bounds.x, bounds.y, screen.getDisplayMatching(bounds)))
  }
  lyricWindow.webContents.send('desktop-lyrics:state', lyricState)
}

// ===== Drag from an immutable native cursor/window origin, never accumulated deltas =====
let lyricDragging = false
let lyricDragOrigin: { cursor: Electron.Point; bounds: Electron.Rectangle } | null = null
let lyricDragTimer: ReturnType<typeof setTimeout> | null = null

function endLyricDrag() {
  if (!lyricDragging) return
  lyricDragging = false
  lyricDragOrigin = null
  if (lyricDragTimer) { clearTimeout(lyricDragTimer); lyricDragTimer = null }
  if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.webContents.send('desktop-lyrics:drag:ended')
  saveLyricPosition()
}
function armLyricDragTimeout() {
  if (lyricDragTimer) clearTimeout(lyricDragTimer)
  // Heartbeats keep stationary holds alive, but a crashed/hidden renderer cannot leave a drag active.
  lyricDragTimer = setTimeout(endLyricDrag, 1000)
}
ipcMain.on('desktop-lyrics:drag:start', event => {
  if (!lyricWindow || lyricWindow.isDestroyed() || event.sender !== lyricWindow.webContents || lyricState.locked) return
  lyricDragOrigin = { cursor: screen.getCursorScreenPoint(), bounds: lyricWindow.getBounds() }
  lyricDragging = true
  armLyricDragTimeout()
})
ipcMain.on('desktop-lyrics:drag:move', event => {
  if (!lyricWindow || lyricWindow.isDestroyed() || event.sender !== lyricWindow.webContents) return
  if (!lyricDragging || !lyricDragOrigin || lyricState.locked) return
  const cursor = screen.getCursorScreenPoint()
  const { bounds, cursor: start } = lyricDragOrigin
  const next = clampLyricPosition(bounds.x + cursor.x - start.x, bounds.y + cursor.y - start.y, screen.getDisplayNearestPoint(cursor))
  lyricWindow.setBounds(next)
  armLyricDragTimeout()
})
ipcMain.on('desktop-lyrics:drag:end', event => {
  if (event.sender === lyricWindow?.webContents) endLyricDrag()
})

// 桌面歌词 IPC
ipcMain.on('desktop-lyrics:set-state', (_event, patch: Partial<DesktopLyricState>) => {
  if (!patch || typeof patch !== 'object') return
  const prevVisible = lyricState.visible
  const prevLocked = lyricState.locked
  lyricState = { ...lyricState, ...patch }
  // 重新锁定或隐藏时，强制结束可能残留的拖动态
  if ((lyricState.locked && !prevLocked) || !lyricState.visible) endLyricDrag()
  if (lyricState.visible && !prevVisible) showLyricWindow()
  if (!lyricState.visible && prevVisible) hideLyricWindow()
  if (lyricState.visible) {
    createLyricWindow() // 隐藏时窗口可能尚未创建，先确保存在
    applyLyricLock()
    pushLyricState()
  }
})

ipcMain.on('desktop-lyrics:toggle-lock', () => {
  lyricState.locked = !lyricState.locked
  if (lyricState.locked) endLyricDrag()
  applyLyricLock()
  pushLyricState()
})


function sendTrayCommand(command: TrayCommand) {
  if (command === 'show-window') {
    showMainWindow()
    trayWindow?.hide()
    return
  }
  if (command === 'quit') {
    isQuitting = true
    trayWindow?.close()
    mainWindow?.destroy()
    app.quit()
    return
  }
  mainWindow?.webContents.send('tray:player-command', command)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'BiliMusic',
    width: 1280,
    height: 800,
    minWidth: 680,
    minHeight: 640,
    frame: false,
    minimizable: true,
    maximizable: true,
    closable: true,
    ...(!isHarmonyOS ? { titleBarStyle: 'hidden' as const } : {}),
    backgroundColor: '#F6F7F9',
    icon: loadAppIcon(),
    webPreferences: {
      preload: process.env.VITE_DEV_SERVER_URL
        ? path.join(__dirname, '../electron/preload.cjs')
        : path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadURL('app://local/index.html')
  }

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    hideToTray()
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const dev = process.env.VITE_DEV_SERVER_URL
    if (!url.startsWith('app://local/') && !(dev && new URL(url).origin === new URL(dev).origin)) event.preventDefault()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const sendMaximizeState = () => {
    mainWindow?.webContents.send('window:maximized-change', Boolean(mainWindow?.isMaximized() || mainWindow?.isFullScreen()))
  }
  const sendFullscreenState = () => {
    mainWindow?.webContents.send('window:fullscreen-change', Boolean(mainWindow?.isFullScreen()))
  }
  mainWindow.on('maximize', sendMaximizeState)
  mainWindow.on('unmaximize', sendMaximizeState)
  mainWindow.on('enter-full-screen', () => {
    sendMaximizeState()
    sendFullscreenState()
  })
  mainWindow.on('leave-full-screen', () => {
    sendMaximizeState()
    sendFullscreenState()
  })
}

// 窗口控制 IPC
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window:close', hideToTray)
ipcMain.handle('window:isMaximized', () => Boolean(mainWindow?.isMaximized() || mainWindow?.isFullScreen()))
ipcMain.on('window:toggle-fullscreen', () => {
  if (!mainWindow) return
  const next = !mainWindow.isFullScreen()
  mainWindow.setFullScreen(next)
  mainWindow.webContents.send('window:fullscreen-change', next)
  mainWindow.webContents.send('window:maximized-change', Boolean(mainWindow.isMaximized() || next))
})
ipcMain.on('window:set-button-visibility', (_event, visible: boolean) => {
  if (!isHarmonyOS) return
  const next = Boolean(visible)
  const setWindowButtonVisibility = (mainWindow as unknown as {
    setWindowButtonVisibility?: (visible: boolean) => void
  } | null)?.setWindowButtonVisibility
  if (typeof setWindowButtonVisibility === 'function') {
    setWindowButtonVisibility.call(mainWindow, next)
  }
  mainWindow?.setTitle(`__BILIMUSIC_WINDOW_BUTTONS__:${next ? 'show' : 'hide'}`)
})
ipcMain.handle('window:isFullscreen', () => Boolean(mainWindow?.isFullScreen()))
ipcMain.on('tray:player-state', (_event, state: TrayPlayerState) => {
  trayPlayerState = {
    hasTrack: Boolean(state?.hasTrack),
    title: String(state?.title || '未在播放'),
    artist: String(state?.artist || '搜索并播放音乐'),
    coverUrl: String(state?.coverUrl || ''),
    isPlaying: Boolean(state?.isPlaying),
    queueLength: Number(state?.queueLength || 0),
    theme: state?.theme === 'light' ? 'light' : 'dark',
  }
  updateTrayState()
})
ipcMain.on('tray:command', (_event, command: TrayCommand) => sendTrayCommand(command))
ipcMain.handle('tray:get-state', () => trayPlayerState)
ipcMain.on('persistent-storage:get', (event, key: string) => {
  if (typeof key !== 'string') {
    event.returnValue = null
    return
  }
  event.returnValue = readPersistentStore()[key] ?? null
})
ipcMain.on('persistent-storage:set', (_event, key: string, value: string) => {
  if (typeof key !== 'string' || typeof value !== 'string') return
  const store = readPersistentStore()
  store[key] = value
  writePersistentStore(store)
})
ipcMain.on('persistent-storage:remove', (_event, key: string) => {
  if (typeof key !== 'string') return
  const store = readPersistentStore()
  delete store[key]
  writePersistentStore(store)
})
// 用系统默认浏览器打开外部链接（仅放行 http/https，避免任意协议执行）
// 打开本地文件夹或文件
ipcMain.handle('dialog:openDirectory', async (event) => {
  assertTrustedSender(event)
  if (!mainWindow) return null
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: '选择下载目录',
  })
  if (res.canceled || !res.filePaths.length) return null
  return grantDirectory(res.filePaths[0])
})

ipcMain.handle('dialog:selectFolder', async (event, defaultPath?: string) => {
  assertTrustedSender(event)
  if (defaultPath) defaultPath = validateAbsolutePath(defaultPath)
  if (!mainWindow) return null
  const res = await dialog.showOpenDialog(mainWindow, {
    defaultPath: typeof defaultPath === 'string' && defaultPath.trim() ? defaultPath : undefined,
    properties: ['openDirectory', 'createDirectory'],
    title: '选择下载目录',
  })
  if (res.canceled || !res.filePaths.length) return null
  return grantDirectory(res.filePaths[0])
})

ipcMain.handle('shell:open-path', async (event, targetPath: string) => {
  assertTrustedSender(event)
  return shell.openPath(await downloadDirectory(targetPath))
})

ipcMain.handle('shell:open-external', (_event, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url)
})

app.on('second-instance', () => {
  // 当第二个实例试图启动时，唤醒并聚焦到已有主窗口
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  await initializeBiliAuth()
  // 生产环境注册 app:// 协议，映射到打包后的 dist 目录（asar 内 file:// 读取透明支持）
  if (!process.env.VITE_DEV_SERVER_URL) {
    protocol.handle('app', async (request) => {
      const { pathname } = new URL(request.url)
      // 渲染层根目录可能是包内 dist 或已生效的 OTA asar（net.fetch 透明读 asar 内部）
      const root = path.resolve(getActiveRendererRoot())
      const filePath = path.resolve(root, '.' + decodeURIComponent(pathname))
      if (new URL(request.url).hostname !== 'local' || !isWithin(root, filePath)) return new Response(null, { status: 403 })
      try {
        return await net.fetch(pathToFileURL(filePath).toString())
      } catch (err) {
        // 关键诊断：鸿蒙上若读沙箱 asar 失败会在此命中（filePath 含 .asar）
        console.log('[BiliMusic-OTA] app:// fetch FAILED:', filePath, '—', err instanceof Error ? err.message : String(err))
        throw err
      }
    })
  }
  for (const [key, command] of [['MediaPlayPause', 'toggle-play'], ['MediaNextTrack', 'next'], ['MediaPreviousTrack', 'prev']] as const) {
    if (!globalShortcut.register(key, () => sendTrayCommand(command))) console.warn(`[Media] ${key} unavailable; MediaSession fallback remains active`)
  }
  setupBiliHeaders()
  registerBiliApiHandlers()
  registerLyricsApiHandlers()
  registerWebdavHandlers()
  registerPlaylistImportHandlers()
  // 更新模块须在创建窗口前初始化：bootReconcile 先定下生效的渲染层根目录，供 app:// 加载
  initUpdates({
    window: () => mainWindow,
    bundledRendererRoot: path.join(__dirname, '../dist'),
    reload: () => {
      mainWindow?.loadURL('app://local/index.html')
    },
  })
  if (isHarmonyOS) {
    // OpenHarmony 上窗口显示/隐藏与托盘强相关，需先创建托盘再创建主窗口。
    createTray()
    createWindow()
  } else {
    createWindow()
    createTray()
  }
})

app.on('window-all-closed', () => {
  if (isQuitting && process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) createWindow()
  else showMainWindow()
})
