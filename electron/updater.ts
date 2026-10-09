import { app, BrowserWindow, ipcMain, net, shell } from 'electron'
import { emitUpdater, setUpdaterWindow, ulog } from './updaterBus'
import {
  fetchManifest,
  getActiveRendererRoot,
  initOtaUpdater,
  rendererUpdateAvailable,
  semverGt,
  stageRendererUpdate,
} from './otaUpdater'

import { GITHUB_OWNER, GITHUB_REPO, PROJECT_REPOSITORY, LATEST_RELEASE_API, RELEASES_URL } from '../src/config/project'
const CHECK_INTERVAL = 6 * 60 * 60 * 1000
const STARTUP_DELAY = 10 * 1000

// 供 main.ts 的 app:// 处理器解析当前生效渲染层根目录
export { getActiveRendererRoot }

let busy = false
let manualRequested = false

// 整包自动更新依赖系统级安装器与签名：mac 未签名不可用，鸿蒙非 Electron 安装器。
function canAutoUpdateShell(): boolean {
  if (process.platform === 'darwin') return false
  if ((process.platform as string) === 'openharmony') return false
  return true
}

// electron-updater 仅 Win/Linux 用，且为外部依赖（鸿蒙 resfile 无 node_modules）。
// 动态 import 延迟加载：鸿蒙/mac 永不触发解析，避免 main.js 在鸿蒙上加载失败。
type AutoUpdater = (typeof import('electron-updater'))['autoUpdater']
let autoUpdaterPromise: Promise<AutoUpdater> | null = null

function loadAutoUpdater(): Promise<AutoUpdater> {
  if (!autoUpdaterPromise) {
    autoUpdaterPromise = import('electron-updater').then((mod) => {
      const updater = (mod.default ?? mod).autoUpdater
      updater.setFeedURL({ provider: 'github', owner: GITHUB_OWNER, repo: GITHUB_REPO })
      updater.autoDownload = true
      updater.autoInstallOnAppQuit = true
      updater.on('update-available', (info) =>
        emitUpdater({
          type: 'available',
          version: info.version,
          notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
        }),
      )
      updater.on('update-not-available', () => emitUpdater({ type: 'up-to-date', version: app.getVersion() }))
      updater.on('download-progress', (p) => emitUpdater({ type: 'progress', percent: Math.round(p.percent) }))
      updater.on('update-downloaded', (info) => emitUpdater({ type: 'downloaded', version: info.version }))
      updater.on('error', (err) =>
        emitUpdater({ type: 'error', message: err instanceof Error ? err.message : String(err) }),
      )
      return updater
    })
  }
  return autoUpdaterPromise
}

// Forks may publish installers without OTA. Missing ota.json is not evidence of being up to date.
async function checkReleaseWithoutManifest(): Promise<void> {
  const response = await net.fetch(LATEST_RELEASE_API, {
    cache: 'no-store', signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (response.status === 404) {
    if (manualRequested) emitUpdater({ type: 'unavailable', message: `${PROJECT_REPOSITORY} 暂无可用的正式发布版本，请查看版本发布页。` })
    return
  }
  if (!response.ok) throw new Error(`获取 fork 发布信息失败 HTTP ${response.status}`)
  const release = await response.json() as { tag_name?: string; draft?: boolean; prerelease?: boolean }
  const version = release.tag_name?.replace(/^v/, '')
  if (!version || !/^\d+\.\d+\.\d+$/.test(version) || release.draft || release.prerelease) {
    throw new Error('fork 发布版本号无效，请使用 v主版本.次版本.修订号 的正式 Release')
  }
  if (manualRequested) {
    if (semverGt(version, app.getVersion())) {
      await shell.openExternal(RELEASES_URL)
      emitUpdater({ type: 'manual', url: RELEASES_URL })
    } else emitUpdater({ type: 'up-to-date', version: app.getVersion() })
  }
}

// Prefer a new shell when available: UI-only patches cannot repair main-process bugs.
export async function checkForUpdates(manual: boolean): Promise<void> {
  // A manual click during the startup check must receive its final result too.
  if (manual) {
    manualRequested = true
    emitUpdater({ type: 'checking' })
  }
  if (busy) return
  busy = true
  try {
    // 开发态判据用 dev server 是否存在（比 app.isPackaged 可靠：鸿蒙 .hap 上 isPackaged 可能为 false）
    if (process.env.VITE_DEV_SERVER_URL) {
      if (manualRequested) emitUpdater({ type: 'unavailable', message: '开发模式不检查更新，请使用打包后的客户端或查看版本发布页。' })
      return
    }

    const manifest = await fetchManifest()
    ulog('check: manifest=', manifest ? `renderer=${manifest.rendererVersion} shell=${manifest.shellVersion} minShell=${manifest.minShellVersion}` : 'none', '| appV=', app.getVersion())
    if (!manifest) {
      await checkReleaseWithoutManifest()
      return
    }

    const appV = app.getVersion()

    // 2) 需要整包（新外壳）
    if (semverGt(manifest.shellVersion, appV)) {
      ulog('check: -> shell update, canAutoUpdate=', canAutoUpdateShell())
      // electron-updater 需真实安装包的 app-update.yml，仅打包态加载（electron:start 等非打包运行跳过）
      if (canAutoUpdateShell() && app.isPackaged) {
        const updater = await loadAutoUpdater() // 仅 Win/Linux 才动态加载 electron-updater
        await updater.checkForUpdates()
      } else if (manualRequested) {
        await shell.openExternal(RELEASES_URL) // mac 未签名 / 鸿蒙：引导手动下载
        emitUpdater({ type: 'manual', url: RELEASES_URL })
      }
      return
    }

    // 外壳已满足时再检查渲染补丁（全平台，含 mac/鸿蒙）：环境支持 OTA + 版本更新 + 满足 minShell + 非黑名单
    if (rendererUpdateAvailable(manifest, appV)) {
      ulog('check: -> renderer patch', manifest.rendererVersion)
      await stageRendererUpdate(manifest)
      return
    }

    // 3) 已最新
    if (manualRequested) emitUpdater({ type: 'up-to-date', version: appV })
  } catch (err) {
    emitUpdater({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  } finally {
    busy = false
    manualRequested = false
  }
}

export function initUpdates(opts: {
  window: () => BrowserWindow | null
  bundledRendererRoot: string
  reload: () => void
}): void {
  setUpdaterWindow(opts.window)
  initOtaUpdater({ bundledRendererRoot: opts.bundledRendererRoot, reload: opts.reload })

  ipcMain.handle('updater:check', () => {
    void checkForUpdates(true)
  })
  ipcMain.on('updater:quit-and-install', () => {
    if (canAutoUpdateShell()) void loadAutoUpdater().then((u) => u.quitAndInstall())
  })
  ipcMain.handle('app:get-version', () => app.getVersion())

  // 非开发态：启动后延迟首检 + 周期检查（含鸿蒙 .hap；dev server 运行时跳过）
  if (!process.env.VITE_DEV_SERVER_URL) {
    setTimeout(() => {
      void checkForUpdates(false)
    }, STARTUP_DELAY)
    setInterval(() => {
      void checkForUpdates(false)
    }, CHECK_INTERVAL)
  }
}
