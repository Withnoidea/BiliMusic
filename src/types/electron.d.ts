interface BiliApi {
  request: (path: string) => Promise<any>
  localAudio: (filename: string, customDir?: string, size?: number) => Promise<string | null>
  onDownloadProgress: (callback: (data: { filename: string; received: number; total: number; percent: number | null; phase?: 'downloading' | 'transcoding' | 'completed' }) => void) => () => void
  search: (keyword: string, page?: number, pageSize?: number) => Promise<any>
  videoDetail: (bvid: string) => Promise<any>
  playUrl: (bvid: string, cid: number) => Promise<any>
  nav: () => Promise<any>
  popular: (ps?: number, pn?: number) => Promise<any>
  recommend: (ps?: number) => Promise<any>
  musicRanking: (options?: { source?: 'hot' | 'original' | 'latest'; page?: number; pageSize?: number }) => Promise<any>
  favorites: (mid: number) => Promise<any>
  extractAudio: (bvid: string) => Promise<{
    bvid: string
    aid: number
    cid: number
    title: string
    artist: string
    coverUrl: string
    duration: number
    audioUrl: string
    audioQuality: number
    audioMimeType: string
    bandwidth: number
  }>
  getDownloadDir: (customDir?: string) => Promise<string>
  deleteDownloadedFile: (filename: string, customDir?: string) => Promise<{ success: boolean; error?: string }>
  checkDownloadedFiles: (filenames: string[], customDir?: string) => Promise<Record<string, { exists: boolean; size?: number }>>
  downloadAudio: (audioUrl: string, filename: string, customDir?: string, metadata?: { title: string; artist: string; album?: string; coverUrl?: string }) => Promise<{
    filePath: string
    size: number
  }>
  qrGenerate: () => Promise<{
    url: string
    qrcodeKey: string
  }>
  qrPoll: (qrcodeKey: string) => Promise<{
    confirmed?: boolean
    retryable?: boolean
    code: number
    status: number
    message: string
    url: string
  }>
  getLoginStatus: () => Promise<{
    isLoggedIn: boolean
    isLogin: boolean
    uid: string
    uname: string
    face: string
  }>
  logout: () => Promise<{ success: boolean }>
}

export interface OiapiSong {
  name: string
  singer: string[]
  album: string
  mid: string
  id: string | number
  album_mid: string
  duration: number
  image: string
}

export interface OiapiLyricData {
  content?: string
  conteng?: string
  base64?: string
  cache?: boolean
}

interface LyricsApi {
  search: (keyword: string, page?: number, limit?: number) => Promise<OiapiSong[]>
  get: (id: string | number, format?: 'lrc' | 'qrc' | 'ksc') => Promise<OiapiLyricData | null>
}

interface PlaylistApi {
  netease: (id: string) => Promise<any>
  qq: (id: string) => Promise<any>
}

interface PersistentStorageApi {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export interface DesktopLyricsStyle {
  fontSize: number
  bold: boolean
  color: string
  outline: boolean
  outlineWidth: number
  outlineColor: string
  showBg: boolean
  bgColor: string
  bgRadius: number
  shadow: boolean
}

export interface DesktopLyricsStatePatch {
  visible?: boolean
  line?: string
  nextLine?: string
  isPlaying?: boolean
  hasTrack?: boolean
  locked?: boolean
  style?: Partial<DesktopLyricsStyle>
}

interface DesktopLyricsApi {
  setState: (patch: DesktopLyricsStatePatch) => void
  toggleLock: () => void
}

export interface TrayPlayerState {
  hasTrack: boolean
  title: string
  artist: string
  coverUrl: string
  isPlaying: boolean
  queueLength: number
  theme: 'light' | 'dark'
}

export type TrayPlayerCommand = 'toggle-play' | 'next' | 'prev'

export interface WebdavConfigInput {
  url: string
  username: string
  password: string
}
export interface WebdavConfigInfo {
  url: string
  username: string
  configured: boolean
}
export interface WebdavResult {
  ok: boolean
  status: number
  etag: string | null
  content: string | null
  message?: string
}

// 统一更新事件（整包 electron-updater + 渲染热补丁共用此通道）
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

declare global {
  interface Window {
    electronAPI: {
      minimize: () => void
      maximize: () => void
      close: () => void
      isMaximized?: () => Promise<boolean>
      toggleFullscreen?: () => void
      isFullscreen?: () => Promise<boolean>
      setWindowButtonVisibility?: (visible: boolean) => void
      onMaximizedChange?: (callback: (isMaximized: boolean) => void) => () => void
      onFullscreenChange?: (callback: (isFullscreen: boolean) => void) => () => void
      updateTrayPlayerState?: (state: TrayPlayerState) => void
      onTrayPlayerCommand?: (callback: (command: TrayPlayerCommand) => void) => () => void
      openExternal: (url: string) => Promise<void>
      openPath: (path: string) => Promise<string>
      selectFolder?: (defaultPath?: string) => Promise<string | null>
      getAppVersion?: () => Promise<string>
      checkForUpdate?: () => Promise<void>
      quitAndInstall?: () => void
      applyRendererUpdate?: () => void
      notifyRendererReady?: () => void
      onUpdaterEvent?: (callback: (event: UpdaterEvent) => void) => () => void
      configureWebdav?: (cfg: WebdavConfigInput) => Promise<{ ok: boolean }>
      getWebdavConfig?: () => Promise<WebdavConfigInfo>
      testWebdav?: () => Promise<{ ok: boolean; message: string }>
      webdavGet?: (relPath: string) => Promise<WebdavResult>
      webdavPut?: (relPath: string, content: string, etag?: string) => Promise<WebdavResult>
      clearWebdav?: () => Promise<{ ok: boolean }>
      platform: string
      persistentStorage?: PersistentStorageApi
      desktopLyrics?: DesktopLyricsApi
      biliApi: BiliApi
      lyricsApi: LyricsApi
      playlistApi: PlaylistApi
    }
  }
}
