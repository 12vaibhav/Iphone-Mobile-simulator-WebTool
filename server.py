import gzip
import http.server
import re
import socketserver
import ssl
import urllib.parse
import urllib.request
import zlib

try:
    import brotli
except ImportError:
    brotli = None

PORT = 8080

# Permissive SSL context for proxy fetches (avoids failing on self-signed/expired certs on assets/staging CDNs)
ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------
def make_proxy_url(asset_url, proxy_origin=''):
    """
    Return a fully-qualified or origin-prefixed proxy URL for any absolute asset URL.
    Using the full proxy origin ensures <base href="..."> on the target document
    does NOT resolve this URL against the remote target domain!
    """
    pfx = proxy_origin.rstrip('/') if proxy_origin else ''
    return f'{pfx}/proxy?url={urllib.parse.quote(asset_url, safe="")}'


def resolve_to_absolute(raw, base_url):
    """
    Resolve a raw URL string (relative, root-relative, protocol-relative,
    or absolute) against base_url. Returns None for URLs that must NOT
    be proxied (data URIs, already-proxied, anchors, javascript, etc.).
    """
    raw = (raw or '').strip()
    if (not raw
            or raw.startswith('data:')
            or '/proxy?url=' in raw
            or raw.startswith('#')
            or raw.startswith('about:')
            or raw.startswith('javascript:')):
        return None

    parsed_base = urllib.parse.urlparse(base_url)
    base_origin = f"{parsed_base.scheme}://{parsed_base.netloc}"

    if raw.startswith('//'):
        return parsed_base.scheme + ':' + raw
    elif raw.startswith('/'):
        return base_origin + raw
    elif raw.startswith(('http://', 'https://')):
        return raw
    else:
        return urllib.parse.urljoin(base_url, raw)


# ---------------------------------------------------------------------------
# Resource Detection & Request Headers
# ---------------------------------------------------------------------------
def detect_resource_type(target_url, content_type=''):
    low = target_url.lower().split('?')[0].split('#')[0]
    ct = (content_type or '').lower()

    if any(low.endswith(ext) for ext in ('.woff', '.woff2', '.ttf', '.otf', '.eot')) or 'font' in ct:
        return 'font'
    if low.endswith('.css') or 'text/css' in ct:
        return 'css'
    if any(low.endswith(ext) for ext in ('.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg', '.ico', '.bmp', '.cur')) or 'image/' in ct:
        return 'image'
    return 'html'


def build_request_headers(target_url, resource_type='html'):
    parsed = urllib.parse.urlparse(target_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    accept_map = {
        'font': '*/*',
        'css': 'text/css,*/*;q=0.1',
        'image': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'html': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }

    dest_map = {
        'font': 'font',
        'css': 'style',
        'image': 'image',
        'html': 'document',
    }

    mode_map = {
        'font': 'cors',
        'css': 'cors',
        'image': 'no-cors',
        'html': 'navigate',
    }

    encodings = ['gzip', 'deflate']
    if brotli:
        encodings.append('br')

    headers = {
        'User-Agent': (
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
            'AppleWebKit/605.1.15 (KHTML, like Gecko) '
            'Version/17.0 Mobile/15E148 Safari/604.1'
        ),
        'Accept': accept_map.get(resource_type, accept_map['html']),
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': ', '.join(encodings),
        'Referer': target_url,
        'Sec-Fetch-Dest': dest_map.get(resource_type, 'empty'),
        'Sec-Fetch-Mode': mode_map.get(resource_type, 'cors'),
        'Sec-Fetch-Site': 'cross-site',
    }

    if resource_type in ('font', 'css'):
        headers['Origin'] = origin

    return headers


def decompress_data(data, encoding_header):
    """Decompresses gzip, brotli, or deflate payload if present."""
    enc = (encoding_header or '').lower()
    if 'gzip' in enc:
        try:
            return gzip.decompress(data)
        except Exception:
            pass
    if 'br' in enc and brotli:
        try:
            return brotli.decompress(data)
        except Exception:
            pass
    if 'deflate' in enc:
        try:
            return zlib.decompress(data)
        except Exception:
            try:
                return zlib.decompress(data, -zlib.MAX_WBITS)
            except Exception:
                pass
    return data


def get_safe_content_type(target_url, upstream_ct):
    """Ensure font and image files have the exact required MIME type."""
    low = target_url.lower().split('?')[0].split('#')[0]
    ct = (upstream_ct or '').strip()

    font_mime_map = {
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
        '.ttf': 'font/ttf',
        '.otf': 'font/otf',
        '.eot': 'application/vnd.ms-fontobject',
    }
    image_mime_map = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.avif': 'image/avif',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
    }

    for ext, mime in font_mime_map.items():
        if low.endswith(ext):
            return mime
    for ext, mime in image_mime_map.items():
        if low.endswith(ext):
            return mime

    if (not ct or ct.lower().startswith(('text/plain', 'application/octet-stream'))) and low.endswith('.css'):
        return 'text/css; charset=utf-8'

    return ct or 'text/html; charset=utf-8'


# ---------------------------------------------------------------------------
# CSS Rewriting Helpers
# ---------------------------------------------------------------------------
CSS_URL_PATTERN = re.compile(
    r'url\(\s*(?:([\'"]|&quot;|&#39;)(.*?)\1|([^)\'"\s]+))\s*\)',
    re.IGNORECASE
)

def rewrite_css_urls(css_text, base_url, proxy_origin=''):
    """
    Rewrite every url(...) and @import statement in CSS to fully-qualified
    proxy URLs so that assets (fonts, background images, sprites, icon sets)
    are fetched through the proxy and never collide with <base href>.
    """
    def replace_url(m):
        quote = m.group(1) or ''
        raw = m.group(2) if m.group(2) is not None else m.group(3)
        if not raw:
            return m.group(0)
        abs_url = resolve_to_absolute(raw, base_url)
        if abs_url is None:
            return m.group(0)
        q = quote if quote in ("'", '"') else '"'
        return f'url({q}{make_proxy_url(abs_url, proxy_origin)}{q})'

    css_text = CSS_URL_PATTERN.sub(replace_url, css_text)

    # Rewrite @import without url() e.g. @import "style.css";
    def replace_import(m):
        raw = m.group(2)
        if not raw:
            return m.group(0)
        abs_url = resolve_to_absolute(raw, base_url)
        if abs_url is None:
            return m.group(0)
        return f'@import "{make_proxy_url(abs_url, proxy_origin)}"'

    css_text = re.sub(r'@import\s+([\'"]|&quot;|&#39;)([^"\'\s;]+)\1', replace_import, css_text)
    return css_text


# ---------------------------------------------------------------------------
# HTML Rewriting Helpers
# ---------------------------------------------------------------------------
def strip_meta_security_tags(html_text):
    """
    Remove Content-Security-Policy and X-Frame-Options meta tags from upstream HTML.
    These tags can block proxied fonts and background images inside the simulator iframe.
    """
    return re.sub(
        r'<meta\b[^>]*http-equiv\s*=\s*["\']?(?:content-security-policy|x-frame-options)["\']?[^>]*>',
        '',
        html_text,
        flags=re.IGNORECASE
    )


def rewrite_style_tags(html_text, base_url, proxy_origin=''):
    """Rewrite url() inside every <style>...</style> block."""
    def replace_block(m):
        open_tag = m.group(1)
        css = m.group(2)
        css = rewrite_css_urls(css, base_url, proxy_origin)
        return f'{open_tag}{css}</style>'

    return re.sub(
        r'(<style[^>]*>)([\s\S]*?)</style>',
        replace_block,
        html_text,
        flags=re.IGNORECASE
    )


def rewrite_style_attributes(html_text, base_url, proxy_origin=''):
    """Rewrite url() inside inline style="..." attributes."""
    def replace_dq(m):
        return f'style="{rewrite_css_urls(m.group(1), base_url, proxy_origin)}"'

    def replace_sq(m):
        return f"style='{rewrite_css_urls(m.group(1), base_url, proxy_origin)}'"

    html_text = re.sub(r'style="([^"]*)"', replace_dq, html_text, flags=re.IGNORECASE)
    html_text = re.sub(r"style='([^']*)'", replace_sq, html_text, flags=re.IGNORECASE)
    return html_text


def rewrite_link_tags(html_text, base_url, proxy_origin=''):
    """
    Proxy <link> tags that are:
      - rel="stylesheet"
      - rel="preload" as="font|style|image"
    Also removes <link rel="preconnect"> and <link rel="dns-prefetch"> to avoid direct non-CORS connections.
    """
    def replace_link(m):
        tag = m.group(0)

        # Drop preconnect / dns-prefetch hints
        if re.search(r'rel=["\']?(?:preconnect|dns-prefetch)["\']?', tag, re.IGNORECASE):
            return ''

        is_stylesheet = bool(re.search(r'rel=["\']?[^"\'>]*stylesheet[^"\'>]*["\']?', tag, re.IGNORECASE))
        is_preload = bool(re.search(r'rel=["\']?[^"\'>]*preload[^"\'>]*["\']?', tag, re.IGNORECASE))
        as_match = re.search(r'as=["\']?(font|style|image)["\']?', tag, re.IGNORECASE)

        if not is_stylesheet and not (is_preload and as_match):
            return tag

        href_m = re.search(r'href=(["\']?)([^"\'\s>]+)\1', tag, re.IGNORECASE)
        if not href_m:
            return tag

        raw = href_m.group(2)
        abs_url = resolve_to_absolute(raw, base_url)
        if abs_url is None:
            return tag

        quote = href_m.group(1) or '"'
        new_href = f'href={quote}{make_proxy_url(abs_url, proxy_origin)}{quote}'
        return tag[:href_m.start(0)] + new_href + tag[href_m.end(0):]

    return re.sub(r'<link\b[^>]+>', replace_link, html_text, flags=re.IGNORECASE)


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
class SimulatorServer(http.server.SimpleHTTPRequestHandler):

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
        self.send_header('Timing-Allow-Origin', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path != '/proxy':
            super().do_GET()
            return

        query = urllib.parse.parse_qs(parsed.query)
        target_url = query.get('url', [None])[0]

        if not target_url:
            self.send_error(400, "Missing 'url' parameter")
            return

        if not target_url.startswith(('http://', 'https://')):
            target_url = 'https://' + target_url

        # Determine origin of this proxy server (e.g. http://localhost:8080)
        host = self.headers.get('Host') or f'localhost:{PORT}'
        proto = 'https' if self.headers.get('X-Forwarded-Proto') == 'https' else 'http'
        proxy_origin = f'{proto}://{host}'

        try:
            resource_type = detect_resource_type(target_url)

            req = urllib.request.Request(
                target_url,
                headers=build_request_headers(target_url, resource_type)
            )

            with urllib.request.urlopen(req, timeout=20, context=ssl_context) as resp:
                final_url = resp.geturl()
                data = resp.read()
                raw_content_type = resp.headers.get('Content-Type', '')
                content_encoding = resp.headers.get('Content-Encoding', '')

                # Decompress response if upstream sent gzip, brotli, or deflate
                data = decompress_data(data, content_encoding)

                # Determine accurate Content-Type
                content_type = get_safe_content_type(final_url, raw_content_type)

                # ---- HTML: rewrite links, styles, inline style attrs, strip CSP ----
                if 'text/html' in content_type.lower():
                    try:
                        encoding = resp.headers.get_content_charset() or 'utf-8'
                        html_text = data.decode(encoding, errors='replace')

                        # Strip CSP & frame-ancestors meta tags that block fonts/iframes
                        html_text = strip_meta_security_tags(html_text)

                        # Proxy <link rel="stylesheet">, preload as="font|style|image"
                        html_text = rewrite_link_tags(html_text, final_url, proxy_origin)

                        # Rewrite url() inside <style> blocks (fonts + bg images)
                        html_text = rewrite_style_tags(html_text, final_url, proxy_origin)

                        # Rewrite url() inside style="..." attributes (bg images)
                        html_text = rewrite_style_attributes(html_text, final_url, proxy_origin)

                        # Inject simulator utilities + runtime font proxy
                        injection = f'''
<base href="{final_url}">
<style id="simulator-mobile-styles">
  * {{ cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='34' height='34' viewBox='0 0 34 34'%3E%3Ccircle cx='17' cy='17' r='14' fill='rgba(255,255,255,0.35)' stroke='rgba(255,255,255,0.95)' stroke-width='2'/%3E%3Ccircle cx='17' cy='17' r='3' fill='%23ffffff'/%3E%3C/svg%3E") 17 17, auto !important; }}
  ::-webkit-scrollbar {{ display: none !important; width: 0 !important; height: 0 !important; background: transparent !important; }}
  ::-webkit-scrollbar-track {{ background: transparent !important; }}
  ::-webkit-scrollbar-thumb {{ background: transparent !important; }}
  html, body {{ -ms-overflow-style: none !important; scrollbar-width: none !important; overflow-x: hidden !important; max-width: 100% !important; }}
</style>
<script id="simulator-font-proxy">
/* Runtime font & asset proxy: intercepts JS-dynamically-inserted <link>/<style>,
   inline styles, CSSStyleSheet insertRule, and FontFace constructor that bypass
   server-side rewriting (React, Next.js, Vue chunk CSS, CSS-in-JS, Emotion). */
(function(){{
  var PFX = location.origin + '/proxy?url=';

  function alreadyProxied(u) {{
    return !u || u.indexOf('/proxy?url=') > -1 || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('javascript:');
  }}

  function toProxy(rawUrl) {{
    if (alreadyProxied(rawUrl)) return rawUrl;
    try {{
      var abs = new URL(rawUrl, document.baseURI).href;
      return PFX + encodeURIComponent(abs);
    }} catch(e) {{ return rawUrl; }}
  }}

  function rewriteCssString(css) {{
    if (!css || css.indexOf('url(') === -1) return css;
    return css.replace(/url\\(\\s*(?:(['"]|&quot;|&#39;)(.*?)\\1|([^)'"\\\\s]+))\\s*\\)/gi, function(m, q, quotedUrl, unquotedUrl) {{
      var raw = quotedUrl !== undefined ? quotedUrl : unquotedUrl;
      if (alreadyProxied(raw)) return m;
      try {{
        var abs = new URL(raw, document.baseURI).href;
        var quote = (q === "'" || q === '"') ? q : '"';
        return 'url(' + quote + PFX + encodeURIComponent(abs) + quote + ')';
      }} catch(e) {{ return m; }}
    }});
  }}

  /* Intercept JavaScript FontFace constructor */
  if (window.FontFace) {{
    var OrigFontFace = window.FontFace;
    window.FontFace = function(family, source, descriptors) {{
      if (typeof source === 'string') {{
        source = rewriteCssString(source);
      }}
      return new OrigFontFace(family, source, descriptors);
    }};
    window.FontFace.prototype = OrigFontFace.prototype;
  }}

  /* Intercept CSSStyleSheet.prototype.insertRule for CSS-in-JS frameworks */
  var _ir = CSSStyleSheet.prototype.insertRule;
  CSSStyleSheet.prototype.insertRule = function(rule, idx) {{
    try {{
      if (typeof rule === 'string' && rule.indexOf('url(') > -1) {{
        rule = rewriteCssString(rule);
      }}
    }} catch(e) {{}}
    return _ir.call(this, rule, idx);
  }};

  /* Patch <link> */
  function patchLink(el) {{
    try {{
      var rel = (el.getAttribute('rel') || '').toLowerCase();
      var asAttr = (el.getAttribute('as') || '').toLowerCase();
      var isSheet = rel.indexOf('stylesheet') > -1;
      var isPreload = rel.indexOf('preload') > -1 && (asAttr === 'font' || asAttr === 'style' || asAttr === 'image');
      if (!isSheet && !isPreload) return;
      var h = el.getAttribute('href');
      if (h && !alreadyProxied(h)) el.setAttribute('href', toProxy(h));
    }} catch(e) {{}}
  }}

  /* Patch <style> */
  function patchStyle(el) {{
    try {{
      var t = el.textContent;
      if (!t || t.indexOf('url(') < 0) return;
      var rewritten = rewriteCssString(t);
      if (rewritten !== t) el.textContent = rewritten;
    }} catch(e) {{}}
  }}

  /* Patch inline style attributes */
  function patchElementStyle(el) {{
    try {{
      if (!el || !el.getAttribute) return;
      var s = el.getAttribute('style');
      if (s && s.indexOf('url(') > -1) {{
        var rewritten = rewriteCssString(s);
        if (rewritten !== s) el.setAttribute('style', rewritten);
      }}
    }} catch(e) {{}}
  }}

  function patchNode(n) {{
    if (!n || n.nodeType !== 1) return;
    var tag = n.tagName ? n.tagName.toUpperCase() : '';
    if (tag === 'LINK') patchLink(n);
    else if (tag === 'STYLE') patchStyle(n);
    patchElementStyle(n);
  }}

  /* Override DOM insertion methods */
  var _ac = Element.prototype.appendChild;
  var _ib = Element.prototype.insertBefore;
  var _pp = Element.prototype.prepend;

  Element.prototype.appendChild = function(c) {{
    try {{ patchNode(c); }} catch(e) {{}}
    return _ac.call(this, c);
  }};
  Element.prototype.insertBefore = function(c, r) {{
    try {{ patchNode(c); }} catch(e) {{}}
    return _ib.call(this, c, r);
  }};
  Element.prototype.prepend = function() {{
    try {{ for (var i=0; i<arguments.length; i++) patchNode(arguments[i]); }} catch(e) {{}}
    return _pp.apply(this, arguments);
  }};

  /* MutationObserver for dynamic updates */
  new MutationObserver(function(muts) {{
    muts.forEach(function(m) {{
      if (m.type === 'attributes' && m.attributeName === 'style') {{
        patchElementStyle(m.target);
      }}
      m.addedNodes.forEach(function(n) {{
        patchNode(n);
        if (n.querySelectorAll) {{
          n.querySelectorAll('link').forEach(patchLink);
          n.querySelectorAll('style').forEach(patchStyle);
          n.querySelectorAll('[style*="url("]').forEach(patchElementStyle);
        }}
      }});
    }});
  }}).observe(document.documentElement, {{ childList: true, subtree: true, attributes: true, attributeFilter: ['style'] }});
}})();
</script>
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
                                r'(<head[^>]*>)',
                                lambda m: m.group(1) + injection,
                                html_text, count=1, flags=re.IGNORECASE
                            )
                        else:
                            html_text = injection + html_text

                        data = html_text.encode(encoding, errors='replace')
                    except Exception:
                        pass

                # ---- CSS: rewrite ALL url() and @import refs ----
                elif 'text/css' in content_type.lower():
                    try:
                        encoding = resp.headers.get_content_charset() or 'utf-8'
                        css_text = data.decode(encoding, errors='replace')
                        css_text = rewrite_css_urls(css_text, final_url, proxy_origin)
                        data = css_text.encode(encoding, errors='replace')
                    except Exception:
                        pass

                # ---- Return response with CORS & CORP headers ----
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', '*')
                self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
                self.send_header('Timing-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(data)

        except Exception as err:
            self.send_error(502, f"Proxy error loading {target_url}: {err}")

    def log_message(self, format, *args):
        # Only log errors (4xx / 5xx) to keep console output clean
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
