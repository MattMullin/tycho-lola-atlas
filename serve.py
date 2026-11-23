from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
os.chdir(Path(__file__).resolve().parent)
server=ThreadingHTTPServer(('127.0.0.1',8766),SimpleHTTPRequestHandler)
print('http://127.0.0.1:8766/',flush=True)
server.serve_forever()
