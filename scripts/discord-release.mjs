// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {releaseTagPattern,validateReleaseText} from './release-notes.mjs';

export const channelId='1559980104560681035';
export const guildId='1559980103650386000';
const receiptPattern=/\n?<!-- discord-changelog:1559980104560681035:(\d+) -->/g;

export function webhookUrl(value){
 let url;
 try{url=new URL(value);}catch{throw Error('Configure the DISCORD_RELEASE_WEBHOOK repository secret.');}
 if(url.origin!=='https://discord.com'||url.search||url.hash||url.username||url.password||!/^\/api\/(?:v10\/)?webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname))throw Error('Invalid Discord release webhook URL.');
 return url.href;
}

export function announcement(release,repository,tag){
 if(!releaseTagPattern.test(tag??'')||!/^[\w.-]+\/[\w.-]+$/.test(repository??''))throw Error('Invalid repository or release tag.');
 const url=`https://github.com/${repository}/releases/tag/${tag}`;
 if(release?.draft!==false||!release.published_at||release.tag_name!==tag||release.html_url!==url||!Number.isSafeInteger(release.id))throw Error('Only the matching published release may be announced.');
 const body=validateReleaseText((release.body??'').replace(receiptPattern,''));
 const content=`**${tag}**\n\n${body}\n\n${url}`;
 if(content.length>2000)throw Error('The complete Discord post exceeds 2000 characters. Shorten the release notes.');
 return content;
}

export async function announce({repository,tag,token,webhook,request=fetch}){
 const url=webhookUrl(webhook),api=`https://api.github.com/repos/${repository}`;
 if(!token)throw Error('A repository GitHub token is required.');
 if(!/^[\w.-]+\/[\w.-]+$/.test(repository??'')||!releaseTagPattern.test(tag??''))throw Error('Invalid repository or release tag.');
 async function call(target,{method='GET',body,github=false}={}){
  let response;
  try{response=await request(target,{method,redirect:'error',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json',...(github?{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  catch{throw Error(`${github?'GitHub':'Discord'} request failed. A Discord send may have succeeded; inspect the channel before retrying.`);}
  if(!response.ok)throw Error(`${github?'GitHub':'Discord'} request failed (${response.status}).`);
  if(response.status===204)return undefined;
  return response.json();
 }
 const releasePath=`${api}/releases/tags/${encodeURIComponent(tag)}`;
 const release=await call(releasePath,{github:true}),content=announcement(release,repository,tag);
 const hook=await call(url);
 if(hook.channel_id!==channelId||hook.guild_id!==guildId)throw Error('The webhook belongs to a different Discord channel or server.');
 const receipts=[...(release.body??'').matchAll(receiptPattern)];
 if(receipts.length>1)throw Error('Ambiguous Discord delivery receipt.');
 const payload={content,allowed_mentions:{parse:[]},flags:4};
 if(receipts.length){
  const id=receipts[0][1],existing=await call(`${url}/messages/${id}`);
  if(existing.id!==id||existing.channel_id!==channelId)throw Error('The saved Discord message could not be verified.');
  if(existing.content!==content)await call(`${url}/messages/${id}`,{method:'PATCH',body:payload});
  return {status:existing.content===content?'already-posted':'updated',messageId:id};
 }
 // Do not automatically retry a POST: a timeout can occur after delivery.
 const message=await call(url+'?wait=true',{method:'POST',body:payload});
 if(!/^\d+$/.test(message?.id??'')||message.channel_id!==channelId)throw Error('Discord delivery could not be confirmed. Inspect the channel before retrying.');
 try{
  // Keep a hidden receipt on GitHub so reruns update the same Discord post.
  const current=await call(releasePath,{github:true});
  if(current.id!==release.id||current.body!==release.body)throw Error('Release notes changed during delivery.');
  await call(`${api}/releases/${release.id}`,{method:'PATCH',github:true,body:{body:(release.body??'').trimEnd()+`\n\n<!-- discord-changelog:${channelId}:${message.id} -->\n`}});
 }catch{throw Error(`Discord message ${message.id} was sent, but its GitHub receipt was not saved. Record <!-- discord-changelog:${channelId}:${message.id} --> in the release body before retrying.`);}
 return {status:'posted',messageId:message.id};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 const [tag,...extra]=process.argv.slice(2);
 if(extra.length)throw Error('Use: node scripts/discord-release.mjs TAG');
 const result=await announce({tag,repository:process.env.GITHUB_REPOSITORY,token:process.env.GH_TOKEN,webhook:process.env.DISCORD_RELEASE_WEBHOOK});
 console.log(`Discord changelog: ${result.status} (${result.messageId}).`);
}
