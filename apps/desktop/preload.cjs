// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('bambiDesktop',Object.freeze({copyModelData:()=>ipcRenderer.invoke('bambi:copy-model-data'),chooseModelSource:kind=>ipcRenderer.invoke('bambi:choose-model-source',kind),openPrivacyPolicy:()=>ipcRenderer.invoke('bambi:open-privacy-policy')}));
