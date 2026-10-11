import { ipcMain, BrowserWindow, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
ipcMain.handle('save', (_event, value) => writeFile('/tmp/document', value));
ipcMain.handle('save', () => 'other');
ipcMain.on('mismatch', () => {});
const window = new BrowserWindow({webPreferences: {nodeIntegration: true, contextIsolation: false, sandbox: false, webSecurity: false, allowRunningInsecureContent: true, webviewTag: true}});
window.loadURL('http://example.test');
shell.openExternal(getURL());
