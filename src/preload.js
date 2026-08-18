const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  app: {
    checkForUpdate: () => ipcRenderer.invoke('app:checkForUpdate'),
    openRelease: (releaseUrl) => ipcRenderer.invoke('app:openRelease', releaseUrl),
    openExternal: (externalUrl) => ipcRenderer.invoke('app:openExternal', externalUrl),
  },
  tasks: {
    create: (task) => ipcRenderer.invoke('tasks:create', task),
    getAll: () => ipcRenderer.invoke('tasks:getAll'),
    get: (id) => ipcRenderer.invoke('tasks:get', id),
    update: (id, updates) => ipcRenderer.invoke('tasks:update', id, updates),
    delete: (id) => ipcRenderer.invoke('tasks:delete', id),
    archiveAllDone: () => ipcRenderer.invoke('tasks:archiveAllDone'),
    getDraft: (id) => ipcRenderer.invoke('tasks:getDraft', id),
    saveDraft: (id, data) => ipcRenderer.invoke('tasks:saveDraft', id, data),
    deleteDraft: (id) => ipcRenderer.invoke('tasks:deleteDraft', id),
  },
});
