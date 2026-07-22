// preload.js
// بيوصل واجهة window.electronAPI بالتطبيق (index.html) بشكل آمن عبر contextBridge،
// بنفس أسماء الدوال بالظبط اللي التطبيق مبرمج عليها أصلاً (نفس التوقيعات
// المستخدمة في النسخة الاحتياطية الخاصة بالمتصفح/الموبايل)، عشان الكود
// الأساسي في index.html يشتغل من غير أي تعديل.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    saveFile: (args) => ipcRenderer.invoke('saveFile', args),
    listFiles: (args) => ipcRenderer.invoke('listFiles', args),
    readFile: (args) => ipcRenderer.invoke('readFile', args),
    getFileUrl: (args) => ipcRenderer.invoke('getFileUrl', args),
    deleteFile: (args) => ipcRenderer.invoke('deleteFile', args),
    downloadFile: (args) => ipcRenderer.invoke('downloadFile', args),
    openFileNative: (args) => ipcRenderer.invoke('openFileNative', args),
    chooseStorageFolder: () => ipcRenderer.invoke('chooseStorageFolder'),
    getStoragePath: () => ipcRenderer.invoke('getStoragePath'),
    readClipboard: () => ipcRenderer.invoke('readClipboard'),
    writeClipboard: (args) => ipcRenderer.invoke('writeClipboard', args),
    scanStorageFolders: () => ipcRenderer.invoke('scanStorageFolders'),
    importCaseFolder: (args) => ipcRenderer.invoke('importCaseFolder', args)

    // ملحوظة: تعمدنا عدم إضافة saveData/loadData هنا. بيانات القضايا والأحكام
    // بتفضل بتتزامن حصريًا عبر Firebase (بنفس طريقة الموبايل بالظبط)، وده اللي
    // بيخلي نسخة اللاب توب مرتبطة ببيانات الموبايل تلقائيًا بدون أي فرق.
});
