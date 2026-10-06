// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
const {app,BrowserWindow,dialog,Menu,session,ipcMain}=require('electron');
const {spawn,spawnSync}=require('node:child_process');
const {mkdirSync,openSync,closeSync}=require('node:fs');
const {resolve,join}=require('node:path');
const {randomBytes}=require('node:crypto');
const {runtimeEnvironment}=require('./runtime-environment.cjs');
const windows=process.platform==='win32';

if(app.commandLine.hasSwitch('no-sandbox')||app.commandLine.hasSwitch('disable-setuid-sandbox')){console.error('Bambi Local requires its Chromium sandbox.');app.exit(64);return;}
app.enableSandbox();
const alpha=app.getVersion().includes('-alpha.');
app.setName(alpha?'Bambi Local':'Bambi Local Smoke');
const option=name=>process.argv.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1);
process.umask(0o077);
const data=resolve(option('--bambi-user-data')||join(windows&&process.env.LOCALAPPDATA||app.getPath('appData'),alpha?'bambi-local-alpha':'bambi-local-smoke'));
if(windows){
 const secure=spawnSync(join(process.resourcesPath,'backend','native','ownership','bambi-job.exe'),['--secure-data',data],{windowsHide:true,timeout:5000,encoding:'utf8',env:{SystemRoot:process.env.SystemRoot||process.env.WINDIR}});
 if(secure.error||secure.status!==0){dialog.showErrorBox('Bambi Local user data',secure.error?.message||secure.stderr?.trim()||'The private Windows user-data directory could not be prepared.');app.exit(64);return;}
}else mkdirSync(data,{recursive:true,mode:0o700});
app.setPath('userData',data);
app.setPath('sessionData',join(data,'browser'));
let owner=null,window=null,quitting=false,stopped=false,backendPid=null,quitDeadline=null,fallbackActive=false;
function finishQuit(){app.quit();setTimeout(()=>app.exit(0),1000);}
const port=Number(option('--bambi-port')||6969),origin=`http://127.0.0.1:${port}`;
const resources=join(process.resourcesPath,'backend');
const accelerator=option('--bambi-accelerator')||'auto';
const env=runtimeEnvironment(process.env,{resources,data,port,alpha,accelerator,tokens:{instance:randomBytes(32).toString('hex'),llama:randomBytes(32).toString('hex'),speech:randomBytes(32).toString('hex')}});
for(const path of [env.TMPDIR,join(data,'logs'),join(data,'data')])mkdirSync(path,{recursive:true,mode:0o700});
if(!app.requestSingleInstanceLock())app.quit();
else {
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
 app.on('before-quit',event=>{
  if(stopped||!owner)return;
  event.preventDefault();if(quitting)return;quitting=true;
  window?.destroy();if(owner.connected)owner.send({type:'stop'});
  // A stopped/hung supervisor must not make Quit unbounded. Only our leased group is signalled.
  quitDeadline=setTimeout(()=>{
   fallbackActive=true;
   if(!windows&&backendPid)try{process.kill(-backendPid,'SIGTERM');}catch{}
   owner.kill('SIGKILL');
   setTimeout(()=>{if(!windows&&backendPid)try{process.kill(-backendPid,'SIGKILL');}catch{}stopped=true;finishQuit();},800);
  },3500);
 });
 app.on('window-all-closed',()=>app.quit());
 app.whenReady().then(async()=>{
  if(!Number.isInteger(port)||port<1024||port>(alpha?65533:65535))throw Error('Choose a loopback port between 1024 and '+(alpha?65533:65535)+'.');
  if(!['auto','cpu'].includes(accelerator))throw Error('Choose --bambi-accelerator=auto or cpu.');
  process.umask(0o077);
  const log=openSync(join(data,'logs','backend.log'),'w',0o600);
  owner=spawn(join(resources,'node','bin',windows?'node.exe':'node'),[join(resources,'apps','desktop',windows?'windows-supervisor.mjs':'supervisor.mjs')],{cwd:data,env,windowsHide:true,stdio:['ignore',log,log,'ipc']});closeSync(log);
  backendPid=await new Promise((accept,reject)=>{
   const deadline=setTimeout(()=>reject(Error('Backend launcher exceeded its 10 second deadline.')),10000);
   owner.once('error',error=>{clearTimeout(deadline);reject(error);});
   owner.once('exit',()=>{clearTimeout(deadline);reject(Error('Backend launcher stopped. See logs/backend.log in your app data.'));});
   owner.once('message',message=>{clearTimeout(deadline);if(message.type==='started')accept(message.pid);else reject(Error('Invalid backend ownership response.'));});
  });
  let ready=false;
  owner.on('message',message=>{if(message.type==='stopped'&&quitting){stopped=true;if(quitDeadline)clearTimeout(quitDeadline);finishQuit();}});
  owner.on('exit',()=>{stopped=true;if(quitDeadline)clearTimeout(quitDeadline);if(quitting&&!fallbackActive)finishQuit();else if(!quitting&&ready){dialog.showErrorBox('Bambi Local stopped','The owned backend stopped. Quit and reopen the app. Your data is retained.');finishQuit();}});
  for(let attempt=0;attempt<80&&!quitting;attempt++){
   if(owner.exitCode!==null)break;
   try{
    const response=await fetch(origin+'/api/desktop/identity',{headers:{'x-bambi-instance':env.BAMBI_INSTANCE_TOKEN},signal:AbortSignal.timeout(250)});
    if(response.ok){const identity=await response.json();ready=identity.app==='bambi-local'&&identity.service==='backend'&&identity.desktopProtocol===1&&identity.pid===backendPid&&identity.instance===env.BAMBI_INSTANCE_TOKEN&&identity.node==='v24.18.1';if(!ready)throw Error('Backend identity mismatch');}
   }catch{}
   if(ready)break;await new Promise(accept=>setTimeout(accept,100));
  }
  if(quitting)return;
  if(!ready)throw Error(`The owned backend could not start on port ${port}. Another application may already use it. No unrelated process was stopped. See logs/backend.log; retry with --bambi-port=6970.`);
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(alpha&&contents===window?.webContents&&contents.getURL().startsWith(origin+'/')&&permission==='media'&&details.mediaTypes?.length===1&&details.mediaTypes[0]==='audio'));
  session.defaultSession.setPermissionCheckHandler((contents,permission,requestingOrigin,details)=>alpha&&contents===window?.webContents&&requestingOrigin===origin&&permission==='media'&&details.mediaType==='audio');
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
   const url=details.url;callback({cancel:!url.startsWith(origin+'/')&&!url.startsWith(`ws://127.0.0.1:${port}/`)&&!url.startsWith('blob:')&&!url.startsWith('data:')});
  });
  session.defaultSession.webRequest.onHeadersReceived((details,callback)=>callback({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':["default-src 'self'; script-src 'self' "+(alpha?"'wasm-unsafe-eval' ":'')+"; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws://127.0.0.1:"+port+"; worker-src 'self' blob:; object-src 'none'; frame-src 'none'"]}}));
  window=new BrowserWindow({width:1200,height:820,title:alpha?'Bambi Local · Local AI alpha':'Bambi Local · Packaging smoke',webPreferences:{...(alpha?{preload:join(__dirname,'preload.cjs')}:{}),nodeIntegration:false,nodeIntegrationInWorker:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  if(alpha)ipcMain.handle('bambi:copy-model-data',async event=>{
   if(event.sender!==window?.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==origin+'/setup')throw Error('Open Setup to choose model data.');
   const picked=await dialog.showOpenDialog(window,{title:'Choose a folder containing the reviewed public model and speech assets',properties:['openDirectory']});
   if(picked.canceled)return {cancelled:true};
   const response=await fetch(origin+'/api/desktop/setup/copy',{method:'POST',headers:{'Content-Type':'application/json','x-bambi-instance':env.BAMBI_INSTANCE_TOKEN},body:JSON.stringify({directory:picked.filePaths[0]})});return response.json();
  });
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&input.control&&!input.alt&&input.key.toLowerCase()==='q'){event.preventDefault();app.quit();}});
  window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/'))event.preventDefault();});
  window.webContents.on('render-process-gone',()=>app.quit());
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Bambi Local',submenu:[{label:'Quit',accelerator:'Control+Q',click:()=>app.quit()}]},{label:'Edit',submenu:[{role:'undo'},{role:'redo'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'View',submenu:[{role:'reload'},{role:'togglefullscreen'}]}]));
  await window.loadURL(origin);
 }).catch(error=>{dialog.showErrorBox('Bambi Local startup',error.message);if(owner?.exitCode!==null)stopped=true;app.quit();});
}
