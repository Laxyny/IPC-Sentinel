const { ipcRenderer: ipc } = require('electron');
ipc.invoke('app:' + 'version');
