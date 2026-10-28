"""Serve the generated fixture site, loopback only. No application backend."""
import argparse,http.server,functools
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8765);args=parser.parse_args()
root=Path(__file__).resolve().parent/'public'
class Handler(http.server.SimpleHTTPRequestHandler):
 def end_headers(self):
  self.send_header('Cache-Control','no-store')
  super().end_headers()
server=http.server.ThreadingHTTPServer(('127.0.0.1',args.port),functools.partial(Handler,directory=str(root)))
print(f'Refuge RGAA : http://127.0.0.1:{args.port}/',flush=True)
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:server.server_close()
