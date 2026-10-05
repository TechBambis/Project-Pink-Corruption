// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/* Retry only while an explicitly opened overlay exists. Never replay output. */
const api=typeof browser!=='undefined'?browser:chrome;
const connections=new Map();
function deliver(tabId,data){return api.tabs.sendMessage(tabId,{bambiEvent:data}).catch(()=>{});}
function disconnect(tabId){const entry=connections.get(tabId);connections.delete(tabId);if(entry){clearTimeout(entry.timer);entry.socket?.close();}}
function connect(tabId,entry){
 if(connections.get(tabId)!==entry)return;
 const socket=new WebSocket('ws://127.0.0.1:6969/ws');entry.socket=socket;
 socket.onopen=()=>{entry.attempt=0;};
 socket.onmessage=event=>{if(connections.get(tabId)===entry&&entry.socket===socket){try{deliver(tabId,JSON.parse(event.data));}catch{deliver(tabId,{type:'error',text:'Invalid local server response.'});}}};
 socket.onclose=()=>{if(connections.get(tabId)!==entry||entry.socket!==socket)return;deliver(tabId,{type:'offline'});entry.timer=setTimeout(()=>connect(tabId,entry),Math.min(30000,1000*2**entry.attempt++));};
 socket.onerror=()=>deliver(tabId,{type:'error',text:'Start the local app to connect your companion.'});
}
api.browserAction.onClicked.addListener(async tab=>{if(!tab.id)return;try{await api.tabs.executeScript(tab.id,{file:'content.js'});}catch{console.warn('Bambi Local cannot open on this browser page.');}});
api.runtime.onMessage.addListener(async(message,sender)=>{
 const tabId=sender.tab?.id;if(!tabId)return;
 if(message.type==='bambi-connect'){if(!connections.has(tabId)){const entry={socket:null,timer:null,attempt:0};connections.set(tabId,entry);connect(tabId,entry);}return;}
 if(message.type==='bambi-disconnect'){disconnect(tabId);return;}
 if(message.type==='bambi-send'){const socket=connections.get(tabId)?.socket;if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message.data));}
});
api.tabs.onRemoved.addListener(disconnect);
api.tabs.onUpdated.addListener((tabId,change)=>{if(change.status==='loading')disconnect(tabId);});
