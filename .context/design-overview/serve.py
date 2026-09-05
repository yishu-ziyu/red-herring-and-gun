from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote,urlsplit
import json,mimetypes
OUT=Path(__file__).resolve().parent; ROOT=OUT.parents[1]
allowed=set(json.loads((OUT/'allowlist.json').read_text()))
class H(BaseHTTPRequestHandler):
 def do_GET(self):
  route=unquote(urlsplit(self.path).path)
  if route in {'/','/index.html'}:p=OUT/'index.html'
  elif (OUT/route.lstrip('/')).is_file():p=OUT/route.lstrip('/')
  elif route=='/manifest.json':p=OUT/'manifest.json'
  elif route.startswith('/files/') and route[7:] in allowed:p=ROOT/route[7:]
  else:self.send_error(404);return
  if not p.is_file():self.send_error(404);return
  b=p.read_bytes();self.send_response(200)
  kind='text/plain' if p.suffix in {'.md','.tsx','.ts','.css'} else mimetypes.guess_type(p.name)[0] or 'application/octet-stream'
  if p.suffix=='.css':kind='text/css'
  self.send_header('Content-Type',kind+'; charset=utf-8' if kind.startswith('text/') else kind)
  self.send_header('Content-Length',str(len(b)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(b)
 def log_message(self,*args):pass
print('http://127.0.0.1:51911/',flush=True)
ThreadingHTTPServer(('127.0.0.1',51911),H).serve_forever()
