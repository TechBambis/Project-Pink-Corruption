# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Exercise bridge authentication, exact template forwarding and sanitized upstream failure."""
import importlib.util
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path

spec=importlib.util.spec_from_file_location('counter',Path(__file__).resolve().parents[1]/'scripts/cloud/token-counter.py')
counter=importlib.util.module_from_spec(spec);spec.loader.exec_module(counter)

class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.received=[];self.broken=False;test=self
        class Native(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):self.reply({'data':[{'id':'test-model'}]})
            def do_POST(self):
                body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                test.received.append((self.path,body,self.headers.get('Authorization')))
                if test.broken:self.send_error(500,'Sensitive upstream prompt');return
                self.reply({'prompt':'exact native template'} if self.path=='/apply-template' else {'tokens':[1,2,3,4]})
            def reply(self,body):
                self.send_response(200);self.end_headers();self.wfile.write(json.dumps(body).encode())
        self.native=ThreadingHTTPServer(('127.0.0.1',0),Native)
        self.bridge=ThreadingHTTPServer(('127.0.0.1',0),counter.handler('test-key',f'http://127.0.0.1:{self.native.server_port}'))
        for server in [self.native,self.bridge]:threading.Thread(target=server.serve_forever,daemon=True).start()
    def tearDown(self):
        for server in [self.bridge,self.native]:server.shutdown();server.server_close()
    def request(self,body=None,key='test-key',path='/token-count'):
        req=urllib.request.Request(f'http://127.0.0.1:{self.bridge.server_port}'+path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(req,timeout=3) as response:return response.status,json.load(response)
        except urllib.error.HTTPError as error:return error.code,json.load(error)
    def test_exact_count_and_model(self):
        messages=[{'role':'user','content':'Synthetic message'}]
        self.assertEqual(self.request({'messages':messages,'model':'test-model'}),(200,{'count':4,'model':'test-model'}))
        self.assertEqual(self.received,[('/apply-template',{'messages':messages,'add_generation_prompt':True},'Bearer test-key'),('/tokenize',{'content':'exact native template','add_special':False},'Bearer test-key')])
        self.assertEqual(self.request({'messages':messages,'model':'wrong'})[0],409)
    def test_auth_validation_and_sanitized_failure(self):
        body={'messages':[{'role':'user','content':'Synthetic message'}],'model':'test-model'}
        self.assertEqual(self.request(body,key='wrong')[0],401)
        self.assertEqual(self.request({'messages':[{'role':'unknown','content':'x'}],'model':'test-model'})[0],400)
        self.broken=True
        self.assertEqual(self.request(body),(502,{'error':'Native tokenizer is unavailable'}))
        self.assertEqual(self.request(path='/health'),(200,{'service':'bambi-token-counter','version':1}))

if __name__=='__main__':unittest.main()
