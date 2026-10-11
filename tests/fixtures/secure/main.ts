import { ipcMain as main, BrowserWindow } from 'electron';
import { channels } from '@shared/index';
main.handle(channels.version, () => '1.0.0');
main.on(channels.ping, () => {});
main.on(channels.ping, () => {});
const preferences = { contextIsolation: true, sandbox: true, nodeIntegration: false };
new BrowserWindow({webPreferences: {...preferences, webSecurity: true}});
