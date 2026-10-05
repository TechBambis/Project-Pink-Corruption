# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Authenticated loopback bridge for exact template-aware token counts in one network trip."""
import hmac
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

def handler(key, upstream='http://127.0.0.1:8080'):
    class Counter(BaseHTTPRequestHandler):
        protocol_version='HTTP/1.1'
        def log_message(self,*args):pass
        def reply(self,status,value):
            data=json.dumps(value).encode()
            self.send_response(status)
            self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(data)))
            if self.close_connection:self.send_header('Connection','close')
            self.end_headers();self.wfile.write(data)
        def authenticated(self):
            if hmac.compare_digest(self.headers.get('Authorization','').encode(),('Bearer '+key).encode()):return True
            self.close_connection=True
            self.reply(401,{'error':'Authentication required'})
            return False
        def do_GET(self):
            if not self.authenticated():return
            self.reply(200 if self.path=='/health' else 404,{'service':'bambi-token-counter','version':1})
        def upstream(self,path,body=None):
            request=urllib.request.Request(upstream+path,
                data=json.dumps(body).encode() if body is not None else None,
                headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
            with urllib.request.urlopen(request,timeout=20) as response:return json.load(response)
        def do_POST(self):
            if not self.authenticated():return
            if self.path!='/token-count':
                self.close_connection=True;self.reply(404,{'error':'Unknown route'});return
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0 < length <= 2*1024*1024:
                    self.close_connection=True;self.reply(413,{'error':'Request size limit exceeded'});return
                self.connection.settimeout(30)
                data=json.loads(self.rfile.read(length))
                messages=data['messages'];model=data['model']
                if not isinstance(model,str) or not isinstance(messages,list) or not 1 <= len(messages) <= 256:
                    raise ValueError('Invalid chat request')
                if any(not isinstance(m,dict) or m.get('role') not in ['system','user','assistant'] or not isinstance(m.get('content'),str) for m in messages):
                    raise ValueError('Invalid messages')
            except (OSError,ValueError,KeyError,TypeError):
                self.close_connection=True;self.reply(400,{'error':'Invalid token-count request'});return
            try:
                models=self.upstream('/v1/models')
                if not any(item.get('id')==model for item in models.get('data',[])):
                    self.reply(409,{'error':'Configured model is unavailable'});return
                rendered=self.upstream('/apply-template',{'messages':messages,'add_generation_prompt':True})
                tokens=self.upstream('/tokenize',{'content':rendered['prompt'],'add_special':False})['tokens']
                if not isinstance(tokens,list):raise ValueError('Invalid tokenizer response')
                self.reply(200,{'count':len(tokens),'model':model})
            except (OSError,ValueError,KeyError,TypeError):
                self.reply(502,{'error':'Native tokenizer is unavailable'})
    return Counter

def main():
    root=Path(__file__).resolve().parents[2]
    os.chdir(root)
    runtime=root/'.runtime';runtime.mkdir(exist_ok=True)
    key=(runtime/'cloud-api.key').read_text().strip()
    if not key:raise SystemExit('Private inference key is required')
    pidfile=runtime/'token-counter.pid'
    if '--ensure' in sys.argv:
        if pidfile.exists():
            pid=int(pidfile.read_text())
            path=Path(f'/proc/{pid}/cmdline')
            if path.exists():
                args=path.read_bytes().split(b'\0')
                if any(arg.endswith(b'/token-counter.py') for arg in args) and Path(f'/proc/{pid}/cwd').resolve()==root.resolve():return
        with (runtime/'token-counter.log').open('ab',buffering=0) as log:
            proc=subprocess.Popen([sys.executable,str(Path(__file__).resolve())],stdout=log,stderr=log,
                                  stdin=subprocess.DEVNULL,start_new_session=True)
        pidfile.write_text(str(proc.pid)+'\n')
        for _ in range(50):
            if proc.poll() is not None:raise SystemExit('Token counter did not start; inspect its log')
            try:
                request=urllib.request.Request('http://127.0.0.1:8082/health',headers={'Authorization':'Bearer '+key})
                with urllib.request.urlopen(request,timeout=1) as response:
                    if json.load(response).get('service')=='bambi-token-counter':return
            except OSError:pass
            time.sleep(.1)
        raise SystemExit('Token counter startup timed out')
    ThreadingHTTPServer(('127.0.0.1',8082),handler(key)).serve_forever()

if __name__=='__main__':main()
