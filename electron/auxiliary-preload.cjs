const { contextBridge, ipcRenderer } = require('electron')
const sends = new Set(['tray:command', 'desktop-lyrics:drag:start', 'desktop-lyrics:drag:move', 'desktop-lyrics:drag:end'])
const events = new Set(['tray:state', 'desktop-lyrics:state', 'desktop-lyrics:drag:ended'])
contextBridge.exposeInMainWorld('auxiliaryIPC', {
  send(channel, ...args) { if (sends.has(channel)) ipcRenderer.send(channel, ...args) },
  invoke(channel) { return channel === 'tray:get-state' ? ipcRenderer.invoke(channel) : Promise.reject(new Error('Unsupported channel')) },
  on(channel, callback) {
    if (!events.has(channel) || typeof callback !== 'function') return
    const handler = (_event, payload) => callback(null, payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
})
