const { contextBridge, ipcRenderer } = require('electron')

console.log('[preload] Electron preload script starting...')

const biliApi = {
  request: (path) => ipcRenderer.invoke('bili:request', path),
  localAudio: (filename, customDir, size) => ipcRenderer.invoke('bili:localAudio', filename, customDir, size),
  onDownloadProgress: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('bili:downloadProgress', listener)
    return () => ipcRenderer.removeListener('bili:downloadProgress', listener)
  },
  search: (keyword, page, pageSize) =>
    ipcRenderer.invoke('bili:search', keyword, page, pageSize),

  videoDetail: (bvid) =>
    ipcRenderer.invoke('bili:videoDetail', bvid),

  playUrl: (bvid, cid) =>
    ipcRenderer.invoke('bili:playUrl', bvid, cid),

  nav: () =>
    ipcRenderer.invoke('bili:nav'),

  popular: (ps, pn) =>
    ipcRenderer.invoke('bili:popular', ps, pn),

  recommend: (ps) =>
    ipcRenderer.invoke('bili:recommend', ps),

  musicRanking: (options) =>
    ipcRenderer.invoke('bili:musicRanking', options),

  favorites: (mid) =>
    ipcRenderer.invoke('bili:favorites', mid),

  extractAudio: (bvid) =>
    ipcRenderer.invoke('bili:extractAudio', bvid),

  downloadAudio: (audioUrl, filename, customDir, metadata) =>
    ipcRenderer.invoke('bili:downloadAudio', audioUrl, filename, customDir, metadata),
  getDownloadDir: (customDir) => ipcRenderer.invoke('bili:getDownloadDir', customDir),
  deleteDownloadedFile: (filename, customDir) => ipcRenderer.invoke('bili:deleteDownloadedFile', filename, customDir),
  checkDownloadedFiles: (filenames, customDir) => ipcRenderer.invoke('bili:checkDownloadedFiles', filenames, customDir),

  // 扫码登录
  qrGenerate: () =>
    ipcRenderer.invoke('bili:qrGenerate'),

  qrPoll: (qrcodeKey) =>
    ipcRenderer.invoke('bili:qrPoll', qrcodeKey),

  getLoginStatus: () =>
    ipcRenderer.invoke('bili:getLoginStatus'),

  logout: () =>
    ipcRenderer.invoke('bili:logout'),
}

const lyricsApi = {
  // 搜索 QQ 音乐歌词候选
  search: (keyword, page, limit) =>
    ipcRenderer.invoke('lyrics:search', keyword, page, limit),

  // 获取指定歌曲的 LRC 歌词
  get: (id, format) =>
    ipcRenderer.invoke('lyrics:get', id, format),
}

const playlistApi = {
  // 获取网易云歌单
  netease: (id) =>
    ipcRenderer.invoke('playlist:netease', id),

  // 获取QQ音乐歌单
  qq: (id) =>
    ipcRenderer.invoke('playlist:qq', id),
}

const persistentStorage = {
  getItem: (key) => ipcRenderer.sendSync('persistent-storage:get', key),
  setItem: (key, value) => ipcRenderer.send('persistent-storage:set', key, value),
  removeItem: (key) => ipcRenderer.send('persistent-storage:remove', key),
}

const desktopLyrics = {
  // 渲染进程推送歌词状态（可见性、当前行、样式等）
  setState: (patch) => ipcRenderer.send('desktop-lyrics:set-state', patch),
  // 解锁/锁定切换（锁定 = 鼠标穿透）
  toggleLock: () => ipcRenderer.send('desktop-lyrics:toggle-lock'),
}

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  toggleFullscreen: () => ipcRenderer.send('window:toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
  setWindowButtonVisibility: (visible) => ipcRenderer.send('window:set-button-visibility', Boolean(visible)),
  onMaximizedChange: (callback) => {
    const listener = (_event, value) => callback(Boolean(value))
    ipcRenderer.on('window:maximized-change', listener)
    return () => ipcRenderer.removeListener('window:maximized-change', listener)
  },
  onFullscreenChange: (callback) => {
    const listener = (_event, value) => callback(Boolean(value))
    ipcRenderer.on('window:fullscreen-change', listener)
    return () => ipcRenderer.removeListener('window:fullscreen-change', listener)
  },
  updateTrayPlayerState: (state) => ipcRenderer.send('tray:player-state', state),
  onTrayPlayerCommand: (callback) => {
    const listener = (_event, command) => callback(command)
    ipcRenderer.on('tray:player-command', listener)
    return () => ipcRenderer.removeListener('tray:player-command', listener)
  },
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  openPath: (path) => ipcRenderer.invoke('shell:open-path', path),
  selectFolder: (defaultPath) => ipcRenderer.invoke('dialog:selectFolder', defaultPath),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  checkForUpdate: () => ipcRenderer.invoke('updater:check'),
  quitAndInstall: () => ipcRenderer.send('updater:quit-and-install'),
  applyRendererUpdate: () => ipcRenderer.send('updater:apply-now'),
  notifyRendererReady: () => ipcRenderer.send('updater:renderer-ready'),
  onUpdaterEvent: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('updater:event', listener)
    return () => ipcRenderer.removeListener('updater:event', listener)
  },
  configureWebdav: (cfg) => ipcRenderer.invoke('webdav:configure', cfg),
  getWebdavConfig: () => ipcRenderer.invoke('webdav:get-config'),
  testWebdav: () => ipcRenderer.invoke('webdav:test'),
  webdavGet: (relPath) => ipcRenderer.invoke('webdav:get', relPath),
  webdavPut: (relPath, content, etag) => ipcRenderer.invoke('webdav:put', relPath, content, etag),
  clearWebdav: () => ipcRenderer.invoke('webdav:clear'),
  platform: process.platform,
  persistentStorage,
  desktopLyrics,
  biliApi,
  lyricsApi,
  playlistApi,
})
