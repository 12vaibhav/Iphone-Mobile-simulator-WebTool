import gzip
import http.server
import socketserver
import urllib.request
import urllib.parse
import re

PORT = 8080

# ---------------------------------------------------------------------------
# Request headers — mimic real mobile Safari so CDNs don't block resources.
# IMPORTANT: Do NOT include 'br' in Accept-Encoding — Python's urllib cannot
# decompress brotli natively, which would cause garbled CSS/HTML responses
# and break all URL rewriting.
# ---------------------------------------------------------------------------
def build_request_headers(target_url, resource_type='html'):
    parsed = urllib.parse.urlparse(target_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    accept_map = {
        'font': '*/*',
        'css':  'text/css,*/*;q=0.1',
        'html': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }

    return {
        'User-Agent': (
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
            'AppleWebKit/605.1.15 (KHTML, like Gecko) '
            'Version/17.0 Mobile/15E148 Safari/604.1'
        ),
        'Accept':          accept_map.get(resource_type, accept_map['html']),
        'Accept-Language': 'en-US,en;q=0.9',
        # Request no compression — Python's urllib does NOT auto-decompress gzip.
        # Servers that return compressed bytes mixed with our injected plain-text
        # produce unrenderable documents (black screen in the iframe).
        'Accept-Encoding': 'identity',
        'Referer':         origin + '/',
        'Origin':          origin,
        'Sec-Fetch-Dest':  'font' if resource_type == 'font' else ('style' if resource_type == 'css' else 'document'),
        'Sec-Fetch-Mode':  'cors' if resource_type in ('font', 'css') else 'navigate',
        'Sec-Fetch-Site':  'same-origin',
    }


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------
def make_proxy_url(asset_url):
    """Return a /proxy?url=... path for any absolute asset URL."""
    return f'/proxy?url={urllib.parse.quote(asset_url, safe="")}'


def resolve_to_absolute(raw, base_url):
    """
    Resolve a raw URL string (relative, root-relative, protocol-relative,
    or absolute) against base_url.  Returns None for URLs that must NOT
    be proxied (data URIs, already-proxied, anchors, etc.).
    """
    raw = raw.strip()
    if (not raw
            or raw.startswith('data:')
            or raw.startswith('/proxy?')
            or raw.startswith('#')
            or raw.startswith('about:')):
        return None

    parsed_base = urllib.parse.urlparse(base_url)
    base_origin  = f"{parsed_base.scheme}://{parsed_base.netloc}"

    if raw.startswith('//'):
        return parsed_base.scheme + ':' + raw
    elif raw.startswith('/'):
        return base_origin + raw
    elif raw.startswith('http://') or raw.startswith('https://'):
        return raw
    else:
        return urllib.parse.urljoin(base_url, raw)


# ---------------------------------------------------------------------------
# CSS rewriting — rewrites ALL url() and @import references
# ---------------------------------------------------------------------------
def rewrite_css_urls(css_text, base_url):
    """
    Rewrite every url(...) and @import statement in CSS so that assets
    (fonts, background images, sprites, icon sets …) are fetched through
    the proxy.  This fixes both font loading AND background-image loading.
    """
    def replace_url(m):
        quote = m.group(1)
        raw   = m.group(2)
        abs_url = resolve_to_absolute(raw, base_url)
        if abs_url is None:
            return m.group(0)
        return f'url({quote}{make_proxy_url(abs_url)}{quote})'

    # url("..."), url('...'), url(...)
    css_text = re.sub(r'url\((["\']?)([^)"\'\s]+)\1\)', replace_url, css_text)

    # @import "..." and @import '...' (without the url() wrapper)
    def replace_import(m):
        quote   = m.group(1)
        raw     = m.group(2)
        abs_url = resolve_to_absolute(raw, base_url)
        if abs_url is None:
            return m.group(0)
        return f'@import {quote}{make_proxy_url(abs_url)}{quote}'

    css_text = re.sub(r'@import\s+(["\'])([^"\']+)\1', replace_import, css_text)

    return css_text


# ---------------------------------------------------------------------------
# HTML rewriting helpers
# ---------------------------------------------------------------------------
def rewrite_style_tags(html_text, base_url):
    """
    Rewrite url() inside every <style>...</style> block.
    Preserves the original <style ...> tag attributes.
    """
    def replace_block(m):
        open_tag = m.group(1)   # e.g. <style type="text/css">
        css      = m.group(2)
        css      = rewrite_css_urls(css, base_url)
        return f'{open_tag}{css}</style>'

    return re.sub(
        r'(<style[^>]*>)([\s\S]*?)</style>',
        replace_block,
        html_text,
        flags=re.IGNORECASE
    )


def rewrite_style_attributes(html_text, base_url):
    """
    Rewrite url() inside inline style="..." attributes.
    This fixes background-image, background, list-style-image, etc. set
    directly on HTML elements — <base href> does NOT fix these.
    """
    def replace_dq(m):
        return f'style="{rewrite_css_urls(m.group(1), base_url)}"'

    def replace_sq(m):
        return f"style='{rewrite_css_urls(m.group(1), base_url)}'"

    html_text = re.sub(r'style="([^"]*)"', replace_dq, html_text, flags=re.IGNORECASE)
    html_text = re.sub(r"style='([^']*)'", replace_sq, html_text, flags=re.IGNORECASE)
    return html_text


def rewrite_link_tags(html_text, base_url):
    """
    Proxy <link> tags that are either:
      - rel="stylesheet"  (CSS files — so their @font-face & background urls get rewritten)
      - rel="preload" as="font"  (font preload hints that would bypass the proxy)
    Also removes <link rel="preconnect"> to font CDNs since those connections
    bypass the proxy and cause browsers to fetch fonts directly.
    """
    def replace_link(m):
        tag = m.group(0)

        # Remove preconnect hints — they make the browser connect directly
        if re.search(r'rel=["\']preconnect["\']', tag, re.IGNORECASE):
            return ''

        is_stylesheet   = bool(re.search(r'rel=["\'][^"\']*stylesheet[^"\']*["\']', tag, re.IGNORECASE))
        is_font_preload = (
            bool(re.search(r'rel=["\'][^"\']*preload[^"\']*["\']', tag, re.IGNORECASE)) and
            bool(re.search(r'as=["\']font["\']', tag, re.IGNORECASE))
        )

        if not is_stylesheet and not is_font_preload:
            return tag

        href_m = re.search(r'href=(["\'])([^"\']+)\1', tag, re.IGNORECASE)
        if not href_m:
            return tag

        raw     = href_m.group(2)
        abs_url = resolve_to_absolute(raw, base_url)
        if abs_url is None:
            return tag

        # Replace just the href value, keep everything else intact
        new_tag = tag[:href_m.start(2)] + make_proxy_url(abs_url) + tag[href_m.end(2):]
        return new_tag

    return re.sub(r'<link[^>]+>', replace_link, html_text, flags=re.IGNORECASE)


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
class SimulatorServer(http.server.SimpleHTTPRequestHandler):

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path != '/proxy':
            super().do_GET()
            return

        query      = urllib.parse.parse_qs(parsed.query)
        target_url = query.get('url', [None])[0]

        if not target_url:
            self.send_error(400, "Missing 'url' parameter")
            return

        if not target_url.startswith(('http://', 'https://')):
            target_url = 'https://' + target_url

        try:
            # Detect resource type by extension for better request headers
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
                final_url    = resp.geturl()
                data         = resp.read()
                content_type = resp.headers.get('Content-Type', 'text/html; charset=utf-8')

                # Safety net: some servers ignore Accept-Encoding: identity and
                # still return gzip. Decompress here so our rewriting works on
                # plain text (raw gzip bytes + injected HTML = black screen).
                content_encoding = resp.headers.get('Content-Encoding', '')
                if 'gzip' in content_encoding.lower():
                    try:
                        data = gzip.decompress(data)
                    except Exception:
                        pass  # already plain text or unknown encoding

                # ---- HTML: rewrite links, styles, inline style attrs ----
                if 'text/html' in content_type.lower():
                    try:
                        encoding  = resp.headers.get_content_charset() or 'utf-8'
                        html_text = data.decode(encoding, errors='replace')

                        # 1. Proxy <link rel="stylesheet"> and font preload hrefs
                        html_text = rewrite_link_tags(html_text, final_url)

                        # 2. Rewrite url() inside <style> blocks (fonts + bg images)
                        html_text = rewrite_style_tags(html_text, final_url)

                        # 3. Rewrite url() inside style="..." attributes (bg images)
                        html_text = rewrite_style_attributes(html_text, final_url)

                        # 4. Inject simulator utilities
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
                        if '<head' in html_text.lower():
                            html_text = re.sub(
                                r'(<head[^>]*>)', r'\1' + injection,
                                html_text, count=1, flags=re.IGNORECASE
                            )
                        else:
                            html_text = injection + html_text

                        data = html_text.encode(encoding, errors='replace')
                    except Exception:
                        pass  # fallback to raw bytes

                # ---- CSS: rewrite ALL url() and @import refs ----
                elif 'text/css' in content_type.lower():
                    try:
                        encoding  = resp.headers.get_content_charset() or 'utf-8'
                        css_text  = data.decode(encoding, errors='replace')
                        css_text  = rewrite_css_urls(css_text, final_url)
                        data      = css_text.encode(encoding, errors='replace')
                    except Exception:
                        pass

                # ---- Fonts / images / other binaries: pass straight through ----

                self.send_response(200)
                self.send_header('Content-Type',                   content_type)
                self.send_header('Content-Length',                 str(len(data)))
                self.send_header('Access-Control-Allow-Origin',    '*')
                self.send_header('Access-Control-Allow-Methods',   'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers',   '*')
                self.send_header('Cross-Origin-Resource-Policy',   'cross-origin')
                self.send_header('Timing-Allow-Origin',            '*')
                self.end_headers()
                self.wfile.write(data)

        except Exception as err:
            self.send_error(502, f"Proxy error loading {target_url}: {err}")

    def log_message(self, format, *args):
        # Only log errors (4xx / 5xx) to keep the console clean
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
