import type { BrowserWindow } from 'electron'

// 推给渲染层的统一更新事件（整包 electron-updater + 渲染热补丁共用 updater:event 通道）
export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'unavailable'; message: string }
  | { type: 'up-to-date'; version: string }
  | { type: 'available'; version: string; notes?: string }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'manual'; url: string }
  | { type: 'renderer-available'; version: string }
  | { type: 'renderer-progress'; percent: number }
  | { type: 'renderer-ready-to-apply'; version: string }
  | { type: 'error'; message: string }

let getWindow: () => BrowserWindow | null = () => null

export function setUpdaterWindow(fn: () => BrowserWindow | null): void {
  getWindow = fn
}

export function emitUpdater(event: UpdaterEvent): void {
  getWindow()?.webContents.send('updater:event', event)
}

// 诊断日志：桌面进终端/DevTools，鸿蒙进 hilog（可用 keyword "BiliMusic-OTA" 过滤）
export function ulog(...args: unknown[]): void {
  console.log('[BiliMusic-OTA]', ...args)
}
