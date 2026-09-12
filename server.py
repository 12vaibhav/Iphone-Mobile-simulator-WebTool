import http.server
import socketserver
import urllib.request
import urllib.parse
import re
import sys

PORT = 8080

# Headers that closely mimic a real mobile browser — critical for font CDNs
# that validate Referer/Origin or require Accept-Encoding to serve woff2.
def build_request_headers(target_url, resource_type='html'):
    parsed = urllib.parse.urlparse(target_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    if resource_type == 'font':
        accept = '*/*'
    elif resource_type == 'css':
        accept = 'text/css,*/*;q=0.1'
    else:
        accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

    return {
        'User-Agent': (
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
            'AppleWebKit/605.1.15 (KHTML, like Gecko) '
            'Version/17.0 Mobile/15E148 Safari/604.1'
        ),
        'Accept': accept,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': origin + '/',
        'Origin': origin,
        'Sec-Fetch-Dest': 'font' if resource_type == 'font' else ('style' if resource_type == 'css' else 'document'),
        'Sec-Fetch-Mode': 'cors' if resource_type in ('font', 'css') else 'navigate',
        'Sec-Fetch-Site': 'same-origin',
    }


def make_proxy_url(asset_url):
    """Return a /proxy?url=... URL for any absolute asset URL."""
    return f'/proxy?url={urllib.parse.quote(asset_url, safe="")}'


def rewrite_font_faces_in_css(css_text, base_url):
    """
    Rewrite all url(...) references inside @font-face blocks so they route
    through this proxy.  Handles both absolute and root-relative paths.
    """
    parsed_base = urllib.parse.urlparse(base_url)
    base_origin = f"{parsed_base.scheme}://{parsed_base.netloc}"

    def replace_url(m):
        # Group 1 = optional quote char, Group 2 = the raw URL value
        quote = m.group(1)
        raw = m.group(2).strip()

        # Skip data-URIs and already-proxied URLs
        if raw.startswith('data:') or raw.startswith('/proxy?'):
            return m.group(0)

        # Build absolute URL
        if raw.startswith('//'):
            abs_url = parsed_base.scheme + ':' + raw
        elif raw.startswith('/'):
            abs_url = base_origin + raw
        elif raw.startswith('http://') or raw.startswith('https://'):
            abs_url = raw
        else:
            # Relative path — resolve against the base URL
            abs_url = urllib.parse.urljoin(base_url, raw)

        proxied = make_proxy_url(abs_url)
        return f'url({quote}{proxied}{quote})'

    # Match url("..."), url('...'), url(...)
    css_text = re.sub(
        r'url\((["\']?)([^)"\'\s]+)\1\)',
        replace_url,
        css_text
    )
    return css_text


def rewrite_inline_styles_in_html(html_text, base_url):
    """
    Find every <style>...</style> block in the HTML and rewrite font-face
    src URLs inside them so they route through the proxy.
    """
    def replace_style_block(m):
        css = m.group(1)
        css = rewrite_font_faces_in_css(css, base_url)
        return f'<style>{css}</style>'

    html_text = re.sub(
        r'<style[^>]*>(.*?)</style>',
        replace_style_block,
        html_text,
        flags=re.DOTALL | re.IGNORECASE
    )
    return html_text


def rewrite_link_stylesheets_in_html(html_text, base_url):
    """
    Rewrite <link rel="stylesheet" href="..."> so external CSS files are
    also fetched through the proxy (which will then rewrite their font URLs).
    """
    parsed_base = urllib.parse.urlparse(base_url)
    base_origin = f"{parsed_base.scheme}://{parsed_base.netloc}"

    def replace_link(m):
        full_tag = m.group(0)
        href_match = re.search(r'href=["\']([^"\']+)["\']', full_tag, re.IGNORECASE)
        if not href_match:
            return full_tag
        raw = href_match.group(1).strip()

        if raw.startswith('data:') or raw.startswith('/proxy?'):
            return full_tag

        if raw.startswith('//'):
            abs_url = parsed_base.scheme + ':' + raw
        elif raw.startswith('/'):
            abs_url = base_origin + raw
        elif raw.startswith('http://') or raw.startswith('https://'):
            abs_url = raw
        else:
            abs_url = urllib.parse.urljoin(base_url, raw)

        proxied = make_proxy_url(abs_url)
        new_tag = full_tag.replace(href_match.group(1), proxied)
        return new_tag

    html_text = re.sub(
        r'<link[^>]+rel=["\']stylesheet["\'][^>]*>',
        replace_link,
        html_text,
        flags=re.IGNORECASE
    )
    # Also handle <link href="..." rel="stylesheet"> (href before rel)
    html_text = re.sub(
        r'<link[^>]+href=["\'][^"\']+["\'][^>]*rel=["\']stylesheet["\'][^>]*>',
        replace_link,
        html_text,
        flags=re.IGNORECASE
    )
    return html_text


# Headers to strip from proxied responses that break iframe / font loading
BLOCKED_RESPONSE_HEADERS = {
    'x-frame-options',
    'content-security-policy',
    'content-security-policy-report-only',
    'x-content-security-policy',
    'x-webkit-csp',
    'cross-origin-opener-policy',
    'cross-origin-embedder-policy',
    'cross-origin-resource-policy',
}


class SimulatorServer(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Allow cross-origin embedding & framing
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

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
                # Detect resource type for smarter headers
                low = target_url.lower().split('?')[0]
                if any(low.endswith(ext) for ext in ('.woff', '.woff2', '.ttf', '.otf', '.eot')):
                    resource_type = 'font'
                elif low.endswith('.css'):
                    resource_type = 'css'
                else:
                    resource_type = 'html'

                req = urllib.request.Request(
                    target_url,
                    headers=build_request_headers(target_url, resource_type)
                )

                with urllib.request.urlopen(req, timeout=15) as resp:
                    final_url = resp.geturl()
                    data = resp.read()
                    content_type = resp.headers.get('Content-Type', 'text/html; charset=utf-8')

                    # ---- Rewrite HTML ----
                    if 'text/html' in content_type.lower():
                        try:
                            encoding = resp.headers.get_content_charset() or 'utf-8'
                            html_text = data.decode(encoding, errors='replace')

                            # 1. Rewrite <link rel="stylesheet"> hrefs through proxy
                            html_text = rewrite_link_stylesheets_in_html(html_text, final_url)

                            # 2. Rewrite font-face src URLs in inline <style> blocks
                            html_text = rewrite_inline_styles_in_html(html_text, final_url)

                            # 3. Inject simulator utilities after <head>
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
                            pass  # fallback to raw bytes if decoding fails

                    # ---- Rewrite CSS files (@font-face src URLs) ----
                    elif 'text/css' in content_type.lower():
                        try:
                            encoding = resp.headers.get_content_charset() or 'utf-8'
                            css_text = data.decode(encoding, errors='replace')
                            css_text = rewrite_font_faces_in_css(css_text, final_url)
                            data = css_text.encode(encoding, errors='replace')
                        except Exception:
                            pass

                    self.send_response(200)
                    self.send_header('Content-Type', content_type)
                    self.send_header('Content-Length', str(len(data)))
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                    self.send_header('Access-Control-Allow-Headers', '*')
                    # Allow cross-origin font loading
                    self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
                    self.end_headers()
                    self.wfile.write(data)

            except Exception as err:
                self.send_error(502, f"Proxy error loading {target_url}: {err}")
        else:
            # Serve local static files
            super().do_GET()

    def log_message(self, format, *args):
        # Suppress noisy access logs; only print errors
        if args and len(args) >= 2 and str(args[1]).startswith(('4', '5')):
            super().log_message(format, *args)


if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), SimulatorServer) as httpd:
        print(f"Mobile Simulator running at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
            httpd.server_close()

