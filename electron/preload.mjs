import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronUpdater', {
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_e, info) => cb(info)),
  onUpdateNotAvailable: (cb) => ipcRenderer.on('update-not-available', (_e, info) => cb(info)),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (_e, err) => cb(err)),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  restartAndInstall: () => ipcRenderer.send('restart-and-install'),
})

contextBridge.exposeInMainWorld('electronApp', {
  quit: () => ipcRenderer.send('quit-app'),
})

contextBridge.exposeInMainWorld('electronBiometrics', {
  available: () => ipcRenderer.invoke('biometrics-available'),
  prompt: (reason) => ipcRenderer.invoke('biometrics-prompt', reason),
})

contextBridge.exposeInMainWorld('electronLocalUpdate', {
  trigger: () => ipcRenderer.send('local-update'),
  onProgress: (cb) => ipcRenderer.on('local-update-progress', (_e, msg) => cb(msg)),
  onDone: (cb) => ipcRenderer.on('local-update-done', (_e, ok, err) => cb(ok, err)),
})
