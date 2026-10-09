import { app, ipcMain, net } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'
import { emitUpdater, ulog } from './updaterBus'
import { PROJECT_REPOSITORY, RELEASE_DOWNLOAD_BASE } from '../src/config/project'

// 渲染热补丁：从 GitHub Releases 下发 renderer-<version>.asar，校验后由 app:// 从可写沙箱加载。
// 单文件 asar（桌面端 net.fetch 读 asar 内部已被现有打包路径证明可用），无需解压、原子可回滚。
// 鸿蒙：原生移植层能力（沙箱可写 / net.fetch 读 asar / 外网下载）未知 —— 全程防御化，
// 任一能力缺失即优雅降级到包内 dist，绝不崩；坏包经 ready 心跳缺失自动回滚并加入黑名单。
const RELEASE_BASE = RELEASE_DOWNLOAD_BASE
export const OTA_MANIFEST_URL = `${RELEASE_BASE}/ota.json`

export interface OtaManifest {
  rendererVersion: string
  shellVersion: string
  minShellVersion: string
  file: string
  sha512: string
  size?: number
  notes?: string
}

interface OtaState {
  activeVersion: string | null // 当前生效的 OTA 渲染版本（null = 用包内 dist）
  activeFile: string | null
  verified: boolean // active 版本是否已通过渲染层 ready 心跳（未通过则下次启动回滚）
  pendingVersion: string | null // 已下载、待下次启动或手动重载生效
  pendingFile: string | null
  failedVersions: string[] // 套用后未通过验证被回滚的版本，不再重复下发
}

const state: OtaState = {
  activeVersion: null,
  activeFile: null,
  verified: false,
  pendingVersion: null,
  pendingFile: null,
  failedVersions: [],
}
let otaRoot: string | null = null // 可写 OTA 目录；null = 当前环境不支持 OTA（降级到包内 dist）
let bundledRoot = ''
let reloadWindow: () => void = () => {}
let staging = false

function statePath(): string {
  return path.join(otaRoot as string, 'state.json')
}
function readState(): void {
  if (!otaRoot) return
  try {
    const saved = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as OtaState
    // Only newer bundles in this fork's namespace may override the shipped UI.
    state.failedVersions = Array.isArray(saved.failedVersions) ? saved.failedVersions.filter(v => typeof v === 'string') : []
    if (validBundle(saved.activeVersion, saved.activeFile) && semverGt(saved.activeVersion!, app.getVersion())) {
      state.activeVersion = saved.activeVersion
      state.activeFile = saved.activeFile
      state.verified = saved.verified === true
    }
    if (validBundle(saved.pendingVersion, saved.pendingFile) && semverGt(saved.pendingVersion!, currentRendererVersion())) {
      state.pendingVersion = saved.pendingVersion
      state.pendingFile = saved.pendingFile
    }
  } catch {
    /* 首次无状态文件，用默认值 */
  }
}
function writeState(): void {
  if (!otaRoot) return
  try {
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2))
  } catch {
    /* 持久化失败不致命 */
  }
}

// 仅比较 x.y.z 主体，忽略 -alpha 之类后缀；a > b 返回 true
export function semverGt(a: string, b: string): boolean {
  const pa = a.split('-')[0].split('.').map((n) => Number(n) || 0)
  const pb = b.split('-')[0].split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true
    if ((pa[i] || 0) < (pb[i] || 0)) return false
  }
  return false
}

// 当前生效的渲染层根：OTA asar（存在）否则包内 dist。app:// 处理器据此 join 资源路径。
export function getActiveRendererRoot(): string {
  if (otaRoot && state.activeVersion && state.activeFile) {
    const p = path.join(otaRoot, state.activeFile)
    if (fs.existsSync(p)) return p
  }
  return bundledRoot
}

function currentRendererVersion(): string {
  return state.activeVersion || app.getVersion()
}

// 该 manifest 的渲染补丁是否可下发：环境支持 OTA + 非黑名单 + 版本更新 + 外壳满足 minShell
export function rendererUpdateAvailable(manifest: OtaManifest, appVersion: string): boolean {
  if (!otaRoot) return false
  if (state.failedVersions.includes(manifest.rendererVersion)) return false
  if (!semverGt(manifest.rendererVersion, currentRendererVersion())) return false
  if (semverGt(manifest.minShellVersion || '0.0.0', appVersion)) return false
  return true
}

const VERSION = /^\d+\.\d+\.\d+$/
function validBundle(version: unknown, file: unknown): boolean {
  return typeof version === 'string' && VERSION.test(version) && file === `renderer-${version}.asar`
}

function validateManifest(manifest: OtaManifest): void {
  if (!manifest || !validBundle(manifest.rendererVersion, manifest.file)
    || !VERSION.test(manifest.shellVersion || '') || !VERSION.test(manifest.minShellVersion || '')
    || typeof manifest.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(manifest.sha512)) {
    throw new Error('更新清单格式无效，请检查 fork Release 中的 ota.json')
  }
}

export async function fetchManifest(): Promise<OtaManifest | null> {
  const res = await net.fetch(OTA_MANIFEST_URL, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  if (res.status === 404) return null // Fork may not have published OTA assets yet.
  if (!res.ok) throw new Error(`获取更新信息失败 HTTP ${res.status}`)
  const manifest = (await res.json()) as OtaManifest
  validateManifest(manifest)
  return manifest
}

async function downloadBuffer(url: string, onProgress: (pct: number) => void): Promise<Buffer> {
  const res = await net.fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') || 0)
  const reader = res.body?.getReader()
  if (!reader) return Buffer.from(await res.arrayBuffer())
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      received += value.length
      if (total > 0) onProgress(Math.round((received / total) * 100))
    }
  }
  return Buffer.concat(chunks)
}

// 下载 + 校验 + 原子暂存为 pending（不立即套用，等下次启动或手动重载）
export async function stageRendererUpdate(manifest: OtaManifest): Promise<void> {
  validateManifest(manifest)
  if (!otaRoot || staging) return
  staging = true
  try {
    emitUpdater({ type: 'renderer-available', version: manifest.rendererVersion })
    const buf = await downloadBuffer(`${RELEASE_BASE}/${manifest.file}`, (pct) =>
      emitUpdater({ type: 'renderer-progress', percent: pct }),
    )
    const digest = crypto.createHash('sha512').update(buf).digest('base64')
    if (digest !== manifest.sha512) throw new Error('校验失败：渲染包指纹不匹配')
    ulog('renderer downloaded & sha512 ok:', manifest.file, `${(buf.length / 1048576).toFixed(2)}MB`)

    const tmp = path.join(otaRoot, `${manifest.file}.tmp`)
    const dest = path.join(otaRoot, manifest.file)
    await fsp.writeFile(tmp, buf)
    await fsp.rename(tmp, dest)

    state.pendingVersion = manifest.rendererVersion
    state.pendingFile = manifest.file
    writeState()
    emitUpdater({ type: 'renderer-ready-to-apply', version: manifest.rendererVersion })
  } finally {
    staging = false
  }
}

// 启动时对账：回滚未验证的坏包（加入黑名单）；套用上次已下载的 pending
function bootReconcile(): void {
  if (!otaRoot) return
  readState()
  // 1) 上次 active 未确认 ready → 视为坏包，删除、加入黑名单、回退包内 dist
  if (state.activeVersion && !state.verified) {
    ulog('rollback unverified renderer (asar serving may have failed):', state.activeVersion)
    if (!state.failedVersions.includes(state.activeVersion)) {
      state.failedVersions = [...state.failedVersions, state.activeVersion]
    }
    if (state.activeFile) {
      try {
        fs.rmSync(path.join(otaRoot, state.activeFile), { force: true })
      } catch {
        /* ignore */
      }
    }
    state.activeVersion = null
    state.activeFile = null
    state.verified = false
    writeState()
  }
  // 2) 有已下载 pending → 本次启动套用为 active（待 ready 心跳确认）
  if (state.pendingVersion && state.pendingFile) {
    if (!state.failedVersions.includes(state.pendingVersion) && fs.existsSync(path.join(otaRoot, state.pendingFile))) {
      state.activeVersion = state.pendingVersion
      state.activeFile = state.pendingFile
      state.verified = false
    }
    state.pendingVersion = null
    state.pendingFile = null
    writeState()
  }
}

// 渲染层挂载成功后回报：标记当前 active 为已验证，避免下次启动误回滚
export function markRendererVerified(): void {
  if (otaRoot && state.activeVersion && !state.verified) {
    state.verified = true
    writeState()
  }
}

// 手动「立即重载」：把 pending 提升为 active 并重载窗口
function applyNow(): void {
  if (!otaRoot || !state.pendingVersion || !state.pendingFile) return
  if (!fs.existsSync(path.join(otaRoot, state.pendingFile))) return
  state.activeVersion = state.pendingVersion
  state.activeFile = state.pendingFile
  state.verified = false
  state.pendingVersion = null
  state.pendingFile = null
  writeState()
  reloadWindow()
}

export function initOtaUpdater(opts: { bundledRendererRoot: string; reload: () => void }): void {
  bundledRoot = opts.bundledRendererRoot
  reloadWindow = opts.reload
  // 安全探测可写 OTA 目录：app.getPath / fs 在当前运行时（尤其鸿蒙 shim）可能不可用
  try {
    const dir = path.join(app.getPath('userData'), 'ota', PROJECT_REPOSITORY.replace('/', '-'))
    fs.mkdirSync(dir, { recursive: true })
    otaRoot = dir
  } catch (err) {
    otaRoot = null // OTA 不可用 → 始终用包内 dist
    ulog('OTA disabled: userData/fs unavailable —', err instanceof Error ? err.message : String(err))
  }
  bootReconcile()
  ulog('init done. otaRoot=', otaRoot ?? 'DISABLED', '| activeRenderer=', state.activeVersion ?? 'bundled')
  ulog('activeRendererRoot=', getActiveRendererRoot())
  ipcMain.on('updater:renderer-ready', () => markRendererVerified())
  ipcMain.on('updater:apply-now', () => applyNow())
}
