# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Download the pinned model with resume and checksum verification. Run on the cloud workspace."""
import argparse, hashlib, json, os, pathlib, socket, sys, time, urllib.error, urllib.parse, urllib.request
class Redirect308(urllib.request.HTTPRedirectHandler):
    """Support permanent GET/HEAD redirects on Python 3.10 as well as newer versions."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return super().redirect_request(req, fp, 307 if code == 308 else code, msg, headers, newurl)
    http_error_308 = urllib.request.HTTPRedirectHandler.http_error_302

urllib.request.install_opener(urllib.request.build_opener(Redirect308()))
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('destination',nargs='?',help='Optional output path; otherwise models/cloud under the setup folder.')
parser.add_argument('--ipv4',action='store_true',help='Use IPv4 when the workspace has no working IPv6 route.')
args=parser.parse_args()
endpoint=os.environ.get('HF_ENDPOINT','https://huggingface.co').rstrip('/')
parsed_endpoint=urllib.parse.urlsplit(endpoint)
if parsed_endpoint.scheme!='https' or not parsed_endpoint.hostname or parsed_endpoint.username or parsed_endpoint.password or parsed_endpoint.query or parsed_endpoint.fragment or parsed_endpoint.path:
    parser.error('HF_ENDPOINT must be an HTTPS base address without a path, credentials or query.')
if args.ipv4:
    original_getaddrinfo=socket.getaddrinfo
    def ipv4_addresses(host,port,family=0,type=0,proto=0,flags=0):
        return original_getaddrinfo(host,port,socket.AF_INET,type,proto,flags)
    socket.getaddrinfo=ipv4_addresses
root=pathlib.Path(__file__).resolve().parents[2]
pin=json.loads((root/'docs/cydonia-cloud-model.json').read_text())
destination=pathlib.Path(args.destination) if args.destination else root/'models/cloud'/pin['file']
destination.parent.mkdir(parents=True,exist_ok=True)
def verified(path):
    if not path.exists() or path.stat().st_size!=pin['bytes']: return False
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(8*1024*1024),b''): digest.update(block)
    return digest.hexdigest()==pin['sha256']
if verified(destination): print('Pinned model is already verified.');sys.exit(0)
partial=destination.with_suffix(destination.suffix+'.part')
offset=partial.stat().st_size if partial.exists() else 0
if offset>pin['bytes']: raise RuntimeError('Partial file exceeds expected model size; inspect it before retrying.')
if offset<pin['bytes']:
    url=endpoint+'/'+pin['repository']+'/resolve/'+pin['revision']+'/' +urllib.parse.quote(pin['file'])
    request=urllib.request.Request(url,headers={'Range':f'bytes={offset}-'} if offset else {})
    try:
        response=urllib.request.urlopen(request,timeout=120)
    except urllib.error.URLError as error:
        detail=f'HTTP {error.code}' if isinstance(error,urllib.error.HTTPError) else 'connection unavailable'
        raise SystemExit(f'Model download failed ({detail}). Run python3 scripts/cloud/check-network.py to check endpoint reachability. Partial files are retained; no model was activated.') from None
    with response:
        if offset and response.status!=206: offset=0
        if offset and not response.headers.get('Content-Range','').startswith(f'bytes {offset}-'): raise RuntimeError('Unexpected download range')
        downloaded=offset;last_report=0.0
        with partial.open('ab' if offset else 'wb') as stream:
            for block in iter(lambda:response.read(8*1024*1024),b''):
                if downloaded+len(block)>pin['bytes']: raise RuntimeError('Download exceeds pinned model size; no model was activated.')
                stream.write(block);downloaded+=len(block)
                if time.monotonic()-last_report>=10:
                    print(f'Downloaded {downloaded/1e9:.2f} / {pin["bytes"]/1e9:.2f} GB ({downloaded/pin["bytes"]:.1%})',flush=True)
                    last_report=time.monotonic()
print('Verifying model size and SHA-256...',flush=True)
if not verified(partial): raise RuntimeError('Model checksum verification failed; no model was activated.')
partial.replace(destination)
print('Pinned Cydonia Q5_K_M downloaded and verified.')
