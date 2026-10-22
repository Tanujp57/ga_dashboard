#!/usr/bin/env python3
"""Serve the Georgia dashboard locally and open it in the browser."""
import http.server, os, threading, webbrowser

os.chdir(os.path.dirname(os.path.abspath(__file__)))
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler)
url = f"http://127.0.0.1:{srv.server_port}/index.html"
print(f"Dashboard at {url}  (Ctrl+C to quit)", flush=True)
threading.Timer(0.5, lambda: webbrowser.open(url)).start()
try:
    srv.serve_forever()
except KeyboardInterrupt:
    pass
