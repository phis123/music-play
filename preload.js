const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  scan: (dir) => ipcRenderer.invoke('library:scan', dir),
  lyrics: (filePath) => ipcRenderer.invoke('lyrics:get', filePath),
  cover: (filePath) => ipcRenderer.invoke('cover:get', filePath),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  info: () => ipcRenderer.invoke('app:info'),
  winMin: () => ipcRenderer.send('win:minimize'),
  winMax: () => ipcRenderer.send('win:toggle-max'),
  winClose: () => ipcRenderer.send('win:close'),
  floatToggle: () => ipcRenderer.invoke('float:toggle'),
  floatIsOpen: () => ipcRenderer.invoke('float:isOpen'),
  floatPush: (payload) => ipcRenderer.send('float:push', payload),
  floatLock: (locked) => ipcRenderer.send('float:lock', locked),
  floatClose: () => ipcRenderer.send('float:close'),
  floatResize: (h) => ipcRenderer.send('float:resize', h),
  onFloatUpdate: (cb) => ipcRenderer.on('float:update', (_e, p) => cb(p)),
  onFloatLocked: (cb) => ipcRenderer.on('float:locked', (_e, v) => cb(v)),
})
