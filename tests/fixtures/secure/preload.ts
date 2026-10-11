import { ipcRenderer as renderer, contextBridge } from 'electron';
import { channels } from '@shared/index';
contextBridge.exposeInMainWorld('app', {
  version: () => renderer.invoke(channels.version),
  ping: () => renderer.send(channels.ping),
  onUpdate: (callback: (value: number) => void) => renderer.on('updates', (_event, value) => callback(value)),
});
