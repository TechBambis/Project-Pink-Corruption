// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readReleaseNotes,renderReleaseNotes,validateReleaseText} from '../scripts/release-notes.mjs';
import {announce,announcement,webhookUrl,channelId,guildId} from '../scripts/discord-release.mjs';

const tag='v0.1.0-alpha.42',repository='example/app';
const body="A little update is ready to try.\n\n- Setup now explains which download to choose.\n- Your saved settings stay in place when you reopen the app.\n\nStill a test build, so expect a few rough edges.";
const release={id:42,tag_name:tag,draft:false,published_at:'2026-10-22T00:00:00Z',html_url:`https://github.com/${repository}/releases/tag/${tag}`,body};
const webhook='https://discord.com/api/webhooks/123/test-token';
const receipt=`<!-- discord-changelog:${channelId}:789 -->`;

test('each exact tag needs its own completed, brief, emoji-free release note',t=>{
 const project=mkdtempSync(join(tmpdir(),'bambi-release-notes-'));t.after(()=>rmSync(project,{recursive:true,force:true}));
 mkdirSync(join(project,'release-notes'));writeFileSync(join(project,'release-notes',tag+'.md'),body);
 assert.equal(readReleaseNotes(tag,project),body);
 assert.throws(()=>readReleaseNotes('v0.1.0-alpha.43',project),/Codex must write/);
 assert.throws(()=>readReleaseNotes('../escape',project),/version tag/);
 for(const invalid of [body+' 🙂',body+' 🇩🇪',body+' @everyone',body+'\n<!-- hidden -->',body+'\n```code```',body+'\nTODO',body.replaceAll('- ','')])assert.throws(()=>validateReleaseText(invalid));
 assert.throws(()=>validateReleaseText(body+'x'.repeat(1800)),/characters/);
 const smoke=renderReleaseNotes({tag,version:tag.slice(1),phase:'smoke',repository},project);
 assert(smoke.startsWith(body));assert(smoke.includes("Local AI and voice aren't included yet."));assert(smoke.includes('/releases/download/'+tag+'/'));
 assert.equal(renderReleaseNotes({tag},project),body+'\n');
});

test('only the matching published release becomes a Discord message',()=>{
 assert.equal(announcement(release,repository,tag),`**${tag}**\n\n${body}\n\n${release.html_url}`);
 assert.equal(announcement({...release,body:body+'\n\n'+receipt},repository,tag),announcement(release,repository,tag));
 for(const change of [{draft:true},{tag_name:'v0.1.0'},{published_at:null},{html_url:'https://example.com'},{body:body+' 🙂'}])assert.throws(()=>announcement({...release,...change},repository,tag));
 for(const value of ['http://discord.com/api/webhooks/123/token','https://discord.com.evil.test/api/webhooks/123/token',webhook+'?token=elsewhere','https://discord.com/api/webhooks/123/token/messages/1'])assert.throws(()=>webhookUrl(value));
 assert.equal(webhookUrl(webhook),webhook);
});

function mock({saved=false,changed=false,wrongChannel=false,receiptFails=false,sendFails=false,draft=false}={}){
 const calls=[],current={...release,body:body+(saved?'\n\n'+receipt:''),draft};
 const request=async(url,options)=>{
  calls.push({url,...options});
  assert.equal(options.redirect,'error');
  if(url.startsWith('https://api.github.com/')){
   assert.equal(options.headers.Authorization,'Bearer github-test-token');
   if(options.method==='PATCH'){
    if(receiptFails)return new Response('{}',{status:403});
    current.body=JSON.parse(options.body).body;
   }
   return Response.json(current);
  }
  assert.equal(options.headers.Authorization,undefined,'GitHub credential must never reach Discord');
  if(url===webhook)return Response.json({id:'123',channel_id:wrongChannel?'999':channelId,guild_id:guildId});
  if(url===webhook+'?wait=true'){
   if(sendFails)throw Error('Internal transport detail containing a secret');
   return Response.json({id:'789',channel_id:channelId});
  }
  if(url===webhook+'/messages/789')return Response.json({id:'789',channel_id:channelId,content:changed?'old text':announcement(current,repository,tag)});
  throw Error('Unexpected request');
 };
 return {calls,current,request};
}
const run=options=>announce({repository,tag,token:'github-test-token',webhook,...options});

test('confirmed delivery records a hidden receipt and suppresses mentions and link previews',async()=>{
 const m=mock();assert.deepEqual(await run(m),{status:'posted',messageId:'789'});
 const post=m.calls.find(c=>c.method==='POST'),payload=JSON.parse(post.body);
 assert.equal(payload.content,announcement(release,repository,tag));
 assert.deepEqual(payload.allowed_mentions,{parse:[]});assert.equal(payload.flags,4);
 assert(m.current.body.includes(receipt));assert.equal(m.calls.filter(c=>c.method==='POST').length,1);
});

test('reruns reuse a verified Discord message; edited notes update it without another post',async()=>{
 const same=mock({saved:true});assert.equal((await run(same)).status,'already-posted');assert(!same.calls.some(c=>c.method==='POST'||c.method==='PATCH'));
 const changed=mock({saved:true,changed:true});assert.equal((await run(changed)).status,'updated');assert(!changed.calls.some(c=>c.method==='POST'));assert(changed.calls.some(c=>c.method==='PATCH'&&c.url.startsWith(webhook)));
});

test('wrong channels and drafts never send; uncertain sends are not automatically retried',async()=>{
 for(const options of [{wrongChannel:true},{draft:true}]){
  const m=mock(options);await assert.rejects(run(m));assert(!m.calls.some(c=>c.method==='POST'||c.method==='PATCH'));
 }
 const m=mock({sendFails:true});await assert.rejects(run(m),e=>e.message.includes('inspect the channel')&&!e.message.includes('secret'));
 assert.equal(m.calls.filter(c=>c.method==='POST').length,1);assert(!m.calls.some(c=>c.method==='PATCH'));
});

test('a failed receipt write reports the confirmed message so retries can be recovered',async()=>{
 const m=mock({receiptFails:true});await assert.rejects(run(m),e=>e.message.includes('was sent')&&e.message.includes(receipt));
 assert.equal(m.calls.filter(c=>c.method==='POST').length,1);
});
