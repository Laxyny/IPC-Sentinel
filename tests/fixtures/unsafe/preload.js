const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('api', {
  send: ipcRenderer.send,
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  subscribe: (callback) => ipcRenderer.on('updates', callback),
});
ipcRenderer.invoke('missing');
ipcRenderer.invoke('mismatch');
ipcRenderer.send(dynamicChannel);
