import http.server
import socketserver
import urllib.request
import urllib.parse
import re
import sys

PORT = 8080

class SimulatorServer(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Allow cross-origin embedding & framing
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/proxy':
            query = urllib.parse.parse_qs(parsed.query)
            target_url = query.get('url', [None])[0]
            if not target_url:
                self.send_error(400, "Missing 'url' parameter")
                return

            if not target_url.startswith(('http://', 'https://')):
                target_url = 'https://' + target_url

            try:
                # Format request with mobile user-agent
                req = urllib.request.Request(
                    target_url,
                    headers={
                        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    }
                )
                with urllib.request.urlopen(req, timeout=12) as resp:
                    final_url = resp.geturl()
                    data = resp.read()
                    content_type = resp.headers.get('Content-Type', 'text/html; charset=utf-8')

                    if 'text/html' in content_type.lower():
                        # Try decoding to inject base tag and mobile touch cursor styles
                        try:
                            encoding = resp.headers.get_content_charset() or 'utf-8'
                            html_text = data.decode(encoding, errors='replace')

                            # Native hardware SVG circular touch cursor (0ms latency), scrollbar removal, and in-page anchor scroll fix
                            injection = f'''
<base href="{final_url}">
<style id="simulator-mobile-styles">
  * {{ cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='34' height='34' viewBox='0 0 34 34'%3E%3Ccircle cx='17' cy='17' r='14' fill='rgba(255,255,255,0.35)' stroke='rgba(255,255,255,0.95)' stroke-width='2'/%3E%3Ccircle cx='17' cy='17' r='3' fill='%23ffffff'/%3E%3C/svg%3E") 17 17, auto !important; }}
  ::-webkit-scrollbar {{ display: none !important; width: 0 !important; height: 0 !important; background: transparent !important; }}
  ::-webkit-scrollbar-track {{ background: transparent !important; }}
  ::-webkit-scrollbar-thumb {{ background: transparent !important; }}
  html, body {{ -ms-overflow-style: none !important; scrollbar-width: none !important; overflow-x: hidden !important; max-width: 100% !important; }}
</style>
<script id="simulator-anchor-fix">
  document.addEventListener('click', function(e) {{
    const anchor = e.target.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (href && (href.startsWith('#') || href.startsWith('/#') || href === '')) {{
      e.preventDefault();
      const hash = href.includes('#') ? href.substring(href.indexOf('#')) : '';
      if (!hash || hash === '#' || hash === '#top') {{
        window.scrollTo({{ top: 0, behavior: 'smooth' }});
      }} else {{
        try {{
          const targetEl = document.querySelector(hash) || document.getElementById(hash.substring(1));
          if (targetEl) {{
            targetEl.scrollIntoView({{ behavior: 'smooth', block: 'start' }});
          }}
        }} catch (err) {{
          const idEl = document.getElementById(hash.substring(1));
          if (idEl) idEl.scrollIntoView({{ behavior: 'smooth', block: 'start' }});
        }}
      }}
    }}
  }}, true);
</script>
'''
                            if '<head>' in html_text.lower():
                                html_text = re.sub(r'(<head[^>]*>)', r'\1' + injection, html_text, count=1, flags=re.IGNORECASE)
                            else:
                                html_text = injection + html_text

                            data = html_text.encode(encoding, errors='replace')
                        except Exception as e:
                            pass # fallback to raw bytes if decoding fails
                    
                    self.send_response(200)
                    self.send_header('Content-Type', content_type)
                    self.send_header('Content-Length', str(len(data)))
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(data)
            except Exception as err:
                self.send_error(502, f"Proxy error loading {target_url}: {err}")
        else:
            # Serve local static files
            super().do_GET()

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), SimulatorServer) as httpd:
        print(f"Wedding Mobile Studio running at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
            httpd.server_close()
