// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * Build a fully-qualified proxy URL for a given absolute asset URL.
 * Using the proxy's full origin ensures <base href="..."> on the target document
 * does NOT resolve this URL against the remote target domain!
 */
function makeProxyUrl(absUrl, proxyOrigin = '') {
  const pfx = proxyOrigin ? proxyOrigin.replace(/\/+$/, '') : '';
  return `${pfx}/api/proxy?url=${encodeURIComponent(absUrl)}`;
}

/**
 * Resolve a raw URL (relative, root-relative, protocol-relative, or absolute)
 * against baseUrl. Returns null for URLs that must NOT be proxied.
 */
function resolveToAbsolute(raw, baseUrl) {
  raw = (raw || '').trim();
  if (!raw || raw.startsWith('data:') || raw.includes('/api/proxy?') || raw.includes('/proxy?') ||
      raw.startsWith('#') || raw.startsWith('about:') || raw.startsWith('javascript:')) {
    return null;
  }
  try {
    const base = new URL(baseUrl);
    if (raw.startsWith('//')) return base.protocol + raw;
    if (raw.startsWith('/'))  return base.origin + raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    return new URL(raw, baseUrl).href;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resource Detection & Headers
// ---------------------------------------------------------------------------

function detectResourceType(targetUrl, contentType = '') {
  const low = targetUrl.toLowerCase().split('?')[0].split('#')[0];
  const ct = (contentType || '').toLowerCase();

  if (/\.(woff2?|ttf|otf|eot)(\?|$)/.test(low) || ct.includes('font')) return 'font';
  if (low.endsWith('.css') || ct.includes('text/css')) return 'css';
  if (/\.(png|jpe?g|webp|avif|gif|svg|ico|bmp|cur)(\?|$)/.test(low) || ct.includes('image/')) return 'image';
  return 'html';
}

function buildHeaders(targetUrl, resourceType = 'html') {
  let origin = '';
  try { origin = new URL(targetUrl).origin; } catch { origin = ''; }

  const acceptMap = {
    font:  '*/*',
    css:   'text/css,*/*;q=0.1',
    image: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    html:  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  const destMap = {
    font:  'font',
    css:   'style',
    image: 'image',
    html:  'document',
  };

  const modeMap = {
    font:  'cors',
    css:   'cors',
    image: 'no-cors',
    html:  'navigate',
  };

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
      'Version/17.0 Mobile/15E148 Safari/604.1',
    'Accept':          acceptMap[resourceType] || acceptMap.html,
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer':         targetUrl,
    'Sec-Fetch-Dest':  destMap[resourceType] || 'empty',
    'Sec-Fetch-Mode':  modeMap[resourceType] || 'cors',
    'Sec-Fetch-Site':  'cross-site',
  };

  if (resourceType === 'font' || resourceType === 'css') {
    headers['Origin'] = origin;
  }

  return headers;
}

function getSafeContentType(targetUrl, upstreamCt) {
  const low = targetUrl.toLowerCase().split('?')[0].split('#')[0];
  const ct = (upstreamCt || '').trim();

  const fontMimes = {
    '.woff2': 'font/woff2',
    '.woff':  'font/woff',
    '.ttf':   'font/ttf',
    '.otf':   'font/otf',
    '.eot':   'application/vnd.ms-fontobject',
  };
  const imageMimes = {
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
  };

  for (const [ext, mime] of Object.entries(fontMimes)) {
    if (low.endsWith(ext)) return mime;
  }
  for (const [ext, mime] of Object.entries(imageMimes)) {
    if (low.endsWith(ext)) return mime;
  }

  if ((!ct || ct.toLowerCase().startsWith('text/plain') || ct.toLowerCase().startsWith('application/octet-stream')) && low.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }

  return ct || 'text/html; charset=utf-8';
}

// ---------------------------------------------------------------------------
// CSS Rewriting
// ---------------------------------------------------------------------------

const CSS_URL_PATTERN = /url\(\s*(?:(['"]|&quot;|&#39;)(.*?)\1|([^)'"\s]+))\s*\)/gi;

function rewriteCssUrls(cssText, baseUrl, proxyOrigin = '') {
  cssText = cssText.replace(CSS_URL_PATTERN, (match, q, quotedUrl, unquotedUrl) => {
    const raw = quotedUrl !== undefined ? quotedUrl : unquotedUrl;
    if (!raw) return match;
    const abs = resolveToAbsolute(raw, baseUrl);
    if (!abs) return match;
    const quote = (q === "'" || q === '"') ? q : '"';
    return `url(${quote}${makeProxyUrl(abs, proxyOrigin)}${quote})`;
  });

  // @import "..." and @import '...' (without url() wrapper)
  cssText = cssText.replace(/@import\s+(['"]|&quot;|&#39;)([^"'\s;]+)\1/gi, (match, q, raw) => {
    const abs = resolveToAbsolute(raw, baseUrl);
    if (!abs) return match;
    return `@import "${makeProxyUrl(abs, proxyOrigin)}"`;
  });

  return cssText;
}

// ---------------------------------------------------------------------------
// HTML Rewriting Helpers
// ---------------------------------------------------------------------------

function stripMetaSecurityTags(htmlText) {
  return htmlText.replace(/<meta\b[^>]*http-equiv\s*=\s*['"]?(?:content-security-policy|x-frame-options)['"]?[^>]*>/gi, '');
}

function rewriteStyleTags(htmlText, baseUrl, proxyOrigin = '') {
  return htmlText.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (match, openTag, css, closeTag) =>
      `${openTag}${rewriteCssUrls(css, baseUrl, proxyOrigin)}${closeTag}`
  );
}

function rewriteStyleAttributes(htmlText, baseUrl, proxyOrigin = '') {
  htmlText = htmlText.replace(/style="([^"]*)"/gi,
    (match, val) => `style="${rewriteCssUrls(val, baseUrl, proxyOrigin)}"`
  );
  htmlText = htmlText.replace(/style='([^']*)'/gi,
    (match, val) => `style='${rewriteCssUrls(val, baseUrl, proxyOrigin)}'`
  );
  return htmlText;
}

function rewriteLinkTags(htmlText, baseUrl, proxyOrigin = '') {
  return htmlText.replace(/<link\b[^>]+>/gi, (tag) => {
    // Drop preconnect / dns-prefetch hints
    if (/rel=['"]?(?:preconnect|dns-prefetch)['"]?/i.test(tag)) return '';

    const isStylesheet = /rel=['"]?[^"'>]*stylesheet[^"'>]*['"]?/i.test(tag);
    const isPreload    = /rel=['"]?[^"'>]*preload[^"'>]*['"]?/i.test(tag);
    const asMatch      = tag.match(/as=['"]?(font|style|image)['"]?/i);

    if (!isStylesheet && !(isPreload && asMatch)) return tag;

    const hrefMatch = tag.match(/href=(['"]?)([^"'\s>]+)\1/i);
    if (!hrefMatch) return tag;

    const abs = resolveToAbsolute(hrefMatch[2], baseUrl);
    if (!abs) return tag;

    const quote = hrefMatch[1] || '"';
    const newHref = `href=${quote}${makeProxyUrl(abs, proxyOrigin)}${quote}`;
    return tag.slice(0, hrefMatch.index) + newHref + tag.slice(hrefMatch.index + hrefMatch[0].length);
  });
}

// ---------------------------------------------------------------------------
// Vercel Serverless Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  // CORS + CORP headers on every response
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Timing-Allow-Origin',          '*');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing "url" parameter');

  let finalTarget = targetUrl;
  if (!/^https?:\/\//i.test(finalTarget)) finalTarget = 'https://' + finalTarget;

  // Determine proxy origin so rewritten URLs are fully-qualified
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proxyOrigin = `${proto}://${host}`;

  try {
    const resourceType = detectResourceType(finalTarget);

    const response = await fetch(finalTarget, {
      headers:  buildHeaders(finalTarget, resourceType),
      redirect: 'follow',
    });

    const rawContentType = response.headers.get('content-type') || '';
    const finalUrl       = response.url || finalTarget;
    const contentType    = getSafeContentType(finalUrl, rawContentType);

    // ---- HTML ----
    if (contentType.includes('text/html')) {
      let htmlText = await response.text();

      // Strip CSP & frame-ancestors meta tags that block fonts/iframes
      htmlText = stripMetaSecurityTags(htmlText);

      // Proxy <link rel="stylesheet">, preload as="font|style|image"
      htmlText = rewriteLinkTags(htmlText, finalUrl, proxyOrigin);

      // Rewrite url() inside <style> blocks (covers fonts + background images)
      htmlText = rewriteStyleTags(htmlText, finalUrl, proxyOrigin);

      // Rewrite url() inside inline style="..." attributes (background images)
      htmlText = rewriteStyleAttributes(htmlText, finalUrl, proxyOrigin);

      // Inject simulator utilities + runtime font proxy
      const injection = `
<base href="${finalUrl}">
<style id="simulator-mobile-styles">
  * { cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='34' height='34' viewBox='0 0 34 34'%3E%3Ccircle cx='17' cy='17' r='14' fill='rgba(255,255,255,0.35)' stroke='rgba(255,255,255,0.95)' stroke-width='2'/%3E%3Ccircle cx='17' cy='17' r='3' fill='%23ffffff'/%3E%3C/svg%3E") 17 17, auto !important; }
  ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; background: transparent !important; }
  ::-webkit-scrollbar-track { background: transparent !important; }
  ::-webkit-scrollbar-thumb { background: transparent !important; }
  html, body { -ms-overflow-style: none !important; scrollbar-width: none !important; overflow-x: hidden !important; max-width: 100% !important; }
</style>
<script id="simulator-font-proxy">
/* Runtime font & asset proxy: intercepts JS-dynamically-inserted <link>/<style>,
   inline styles, CSSStyleSheet insertRule, and FontFace constructor. */
(function(){
  var PFX = location.origin + '/api/proxy?url=';

  function alreadyProxied(u) {
    return !u || u.indexOf('/proxy?url=') > -1 || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('javascript:');
  }

  function toProxy(rawUrl) {
    if (alreadyProxied(rawUrl)) return rawUrl;
    try {
      var abs = new URL(rawUrl, document.baseURI).href;
      return PFX + encodeURIComponent(abs);
    } catch(e) { return rawUrl; }
  }

  function rewriteCssString(css) {
    if (!css || css.indexOf('url(') === -1) return css;
    return css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi, function(m, raw) {
      raw = (raw || '').trim().replace(/^(&quot;|&#39;)/, '').replace(/(&quot;|&#39;)$/, '');
      if (alreadyProxied(raw)) return m;
      try {
        var abs = new URL(raw, document.baseURI).href;
        return 'url("' + PFX + encodeURIComponent(abs) + '")';
      } catch(e) { return m; }
    });
  }

  /* Intercept JavaScript FontFace constructor */
  if (window.FontFace) {
    var OrigFontFace = window.FontFace;
    window.FontFace = function(family, source, descriptors) {
      if (typeof source === 'string') {
        source = rewriteCssString(source);
      }
      return new OrigFontFace(family, source, descriptors);
    };
    window.FontFace.prototype = OrigFontFace.prototype;
  }

  /* Intercept CSSStyleSheet.prototype.insertRule for CSS-in-JS frameworks */
  var _ir = CSSStyleSheet.prototype.insertRule;
  CSSStyleSheet.prototype.insertRule = function(rule, idx) {
    try {
      if (typeof rule === 'string' && rule.indexOf('url(') > -1) {
        rule = rewriteCssString(rule);
      }
    } catch(e) {}
    return _ir.call(this, rule, idx);
  };

  /* Patch <link> */
  function patchLink(el) {
    try {
      var rel = (el.getAttribute('rel') || '').toLowerCase();
      var asAttr = (el.getAttribute('as') || '').toLowerCase();
      var isSheet = rel.indexOf('stylesheet') > -1;
      var isPreload = rel.indexOf('preload') > -1 && (asAttr === 'font' || asAttr === 'style' || asAttr === 'image');
      if (!isSheet && !isPreload) return;
      var h = el.getAttribute('href');
      if (h && !alreadyProxied(h)) el.setAttribute('href', toProxy(h));
    } catch(e) {}
  }

  /* Patch <style> */
  function patchStyle(el) {
    try {
      var t = el.textContent;
      if (!t || t.indexOf('url(') < 0) return;
      var rewritten = rewriteCssString(t);
      if (rewritten !== t) el.textContent = rewritten;
    } catch(e) {}
  }

  /* Patch inline style attributes */
  function patchElementStyle(el) {
    try {
      if (!el || !el.getAttribute) return;
      var s = el.getAttribute('style');
      if (s && s.indexOf('url(') > -1) {
        var rewritten = rewriteCssString(s);
        if (rewritten !== s) el.setAttribute('style', rewritten);
      }
    } catch(e) {}
  }

  function patchNode(n) {
    if (!n || n.nodeType !== 1) return;
    var tag = n.tagName ? n.tagName.toUpperCase() : '';
    if (tag === 'LINK') patchLink(n);
    else if (tag === 'STYLE') patchStyle(n);
    patchElementStyle(n);
  }

  var _ac = Element.prototype.appendChild;
  var _ib = Element.prototype.insertBefore;
  var _pp = Element.prototype.prepend;

  Element.prototype.appendChild = function(c) {
    try { patchNode(c); } catch(e) {}
    return _ac.call(this, c);
  };
  Element.prototype.insertBefore = function(c, r) {
    try { patchNode(c); } catch(e) {}
    return _ib.call(this, c, r);
  };
  Element.prototype.prepend = function() {
    try { for (var i=0; i<arguments.length; i++) patchNode(arguments[i]); } catch(e) {}
    return _pp.apply(this, arguments);
  };

  new MutationObserver(function(muts) {
    muts.forEach(function(m) {
      if (m.type === 'attributes' && m.attributeName === 'style') {
        patchElementStyle(m.target);
      }
      m.addedNodes.forEach(function(n) {
        patchNode(n);
        if (n.querySelectorAll) {
          n.querySelectorAll('link').forEach(patchLink);
          n.querySelectorAll('style').forEach(patchStyle);
          n.querySelectorAll('[style*="url("]').forEach(patchElementStyle);
        }
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
})();
</script>
<script id="simulator-anchor-fix">
  document.addEventListener('click', function(e) {
    const anchor = e.target.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (href && (href.startsWith('#') || href.startsWith('/#') || href === '')) {
      e.preventDefault();
      const hash = href.includes('#') ? href.substring(href.indexOf('#')) : '';
      if (!hash || hash === '#' || hash === '#top') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        try {
          const targetEl = document.querySelector(hash) || document.getElementById(hash.substring(1));
          if (targetEl) {
            const currentY = window.pageYOffset || document.documentElement.scrollTop || 0;
            const targetY = targetEl.getBoundingClientRect().top + currentY;
            window.scrollTo({ top: targetY, behavior: 'smooth' });
          }
        } catch (err) {
          const idEl = document.getElementById(hash.substring(1));
          if (idEl) {
            const currentY = window.pageYOffset || document.documentElement.scrollTop || 0;
            const targetY = idEl.getBoundingClientRect().top + currentY;
            window.scrollTo({ top: targetY, behavior: 'smooth' });
          }
        }
      }
    }
  }, true);
</script>
`;
      if (/<head[^>]*>/i.test(htmlText)) {
        htmlText = htmlText.replace(/(<head[^>]*>)/i, (m, tag) => tag + injection);
      } else {
        htmlText = injection + htmlText;
      }

      res.setHeader('Content-Type', contentType);
      return res.status(200).send(htmlText);

    // ---- CSS: rewrite ALL url() and @import refs ----
    } else if (contentType.includes('text/css')) {
      let cssText = await response.text();
      cssText = rewriteCssUrls(cssText, finalUrl, proxyOrigin);
      res.setHeader('Content-Type', contentType);
      return res.status(200).send(cssText);

    // ---- Fonts / images / other binaries: pass straight through ----
    } else {
      const buffer = await response.arrayBuffer();
      res.setHeader('Content-Type', contentType);
      return res.status(200).send(Buffer.from(buffer));
    }

  } catch (error) {
    return res.status(502).send(`Proxy error loading ${finalTarget}: ${error.message}`);
  }
}
