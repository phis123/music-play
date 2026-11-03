const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  scan: (dir) => ipcRenderer.invoke('library:scan', dir),
  lyrics: (filePath) => ipcRenderer.invoke('lyrics:get', filePath),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  info: () => ipcRenderer.invoke('app:info'),
  winMin: () => ipcRenderer.send('win:minimize'),
  winMax: () => ipcRenderer.send('win:toggle-max'),
  winClose: () => ipcRenderer.send('win:close'),
})
