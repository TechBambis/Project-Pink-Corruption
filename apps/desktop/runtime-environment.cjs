// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
const {join,win32}=require('node:path');

function runtimeEnvironment(source,{resources,data,port,alpha,tokens,platform=process.platform,ownerPid=process.pid,accelerator='auto'}){
 const env={},windows=platform==='win32';
 for(const key of ['HOME','USER','LOGNAME','LANG','LC_ALL','LC_CTYPE','TZ','XDG_RUNTIME_DIR'])if(source[key])env[key]=source[key];
 if(windows){
  // Keep exactly one spelling for each case-insensitive Windows name.
  // Loader/tool/provider variables never cross the desktop boundary.
  for(const name of ['SystemRoot','WINDIR','USERPROFILE','LOCALAPPDATA','APPDATA','HOMEDRIVE','HOMEPATH','USERNAME']){
   const key=Object.keys(source).find(key=>key.toLowerCase()===name.toLowerCase());if(key&&source[key])env[name]=source[key];
  }
  if(!env.SystemRoot||!win32.isAbsolute(env.SystemRoot))throw Error('Windows SystemRoot is required for the owned native services.');
 }
 const pathJoin=windows?win32.join:join;
 Object.assign(env,{PATH:pathJoin(resources,'node','bin'),TMPDIR:pathJoin(data,'cache'),BAMBI_PORT:String(port),BAMBI_DATABASE:pathJoin(data,'data','bambi.sqlite'),BAMBI_INSTANCE_TOKEN:tokens.instance});
 if(windows)Object.assign(env,{TEMP:env.TMPDIR,TMP:env.TMPDIR,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',BAMBI_ELECTRON_PID:String(ownerPid)});
 if(alpha)Object.assign(env,{BAMBI_DESKTOP_ALPHA:'1',BAMBI_DATA_ROOT:data,BAMBI_RESOURCE_ROOT:resources,BAMBI_MODELS_ROOT:pathJoin(data,'models'),BAMBI_LLM_PORT:String(port+1),BAMBI_LLM_URL:`http://127.0.0.1:${port+1}`,BAMBI_LLM_TOKEN:tokens.llama,BAMBI_TTS_PORT:String(port+2),BAMBI_TTS_URL:`http://127.0.0.1:${port+2}`,BAMBI_TTS_TOKEN:tokens.speech,BAMBI_DESKTOP_ACCELERATOR:accelerator});
 else env.BAMBI_DESKTOP_SMOKE='1';
 return env;
}
module.exports={runtimeEnvironment};
