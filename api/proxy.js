// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** Build an /api/proxy?url=... path for a given absolute asset URL. */
function makeProxyUrl(absUrl) {
  return `/api/proxy?url=${encodeURIComponent(absUrl)}`;
}

/**
 * Resolve a raw URL (relative, root-relative, protocol-relative, or absolute)
 * against baseUrl.  Returns null for URLs that must NOT be proxied.
 */
function resolveToAbsolute(raw, baseUrl) {
  raw = raw.trim();
  if (!raw || raw.startsWith('data:') || raw.startsWith('/api/proxy?') ||
      raw.startsWith('#') || raw.startsWith('about:')) {
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
// Request headers — mimic real mobile Safari so CDNs serve the right assets.
// ---------------------------------------------------------------------------
function buildHeaders(targetUrl, resourceType = 'html') {
  let origin;
  try { origin = new URL(targetUrl).origin; } catch { origin = ''; }

  const acceptMap = {
    font: '*/*',
    css:  'text/css,*/*;q=0.1',
    html: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  return {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
      'Version/17.0 Mobile/15E148 Safari/604.1',
    'Accept':          acceptMap[resourceType] || acceptMap.html,
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',   // Node fetch handles brotli fine
    'Referer':         origin + '/',
    'Origin':          origin,
    'Sec-Fetch-Dest':
      resourceType === 'font' ? 'font' : resourceType === 'css' ? 'style' : 'document',
    'Sec-Fetch-Mode':  (resourceType === 'font' || resourceType === 'css') ? 'cors' : 'navigate',
    'Sec-Fetch-Site':  'same-origin',
  };
}

// ---------------------------------------------------------------------------
// CSS rewriting — rewrites ALL url() and @import references
// ---------------------------------------------------------------------------

/**
 * Rewrite every url(...) and @import statement in CSS so that ALL assets
 * (fonts, background images, sprites, icon sets …) load through the proxy.
 * This is the single most important fix — <base href> does NOT affect CSS url().
 */
function rewriteCssUrls(cssText, baseUrl) {
  // url("..."), url('...'), url(...)
  cssText = cssText.replace(/url\((['"]?)([^)'"\s]+)\1\)/g, (match, quote, raw) => {
    const abs = resolveToAbsolute(raw, baseUrl);
    if (!abs) return match;
    return `url(${quote}${makeProxyUrl(abs)}${quote})`;
  });

  // @import "..." and @import '...' (without url() wrapper — common in Google Fonts CSS)
  cssText = cssText.replace(/@import\s+(['"])([^'"]+)\1/g, (match, quote, raw) => {
    const abs = resolveToAbsolute(raw, baseUrl);
    if (!abs) return match;
    return `@import ${quote}${makeProxyUrl(abs)}${quote}`;
  });

  return cssText;
}

// ---------------------------------------------------------------------------
// HTML rewriting helpers
// ---------------------------------------------------------------------------

/**
 * Rewrite url() inside every <style>...</style> block.
 * Preserves original <style> tag attributes (type, scoped, etc.).
 */
function rewriteStyleTags(htmlText, baseUrl) {
  return htmlText.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (match, openTag, css, closeTag) =>
      `${openTag}${rewriteCssUrls(css, baseUrl)}${closeTag}`
  );
}

/**
 * Rewrite url() inside inline style="..." attributes on HTML elements.
 * Fixes background-image, background, list-style-image, mask-image, etc.
 * <base href> does NOT fix these — browsers resolve CSS urls against the
 * CSS file/document location, NOT the <base> tag.
 */
function rewriteStyleAttributes(htmlText, baseUrl) {
  // Double-quoted style attributes
  htmlText = htmlText.replace(/style="([^"]*)"/gi,
    (match, val) => `style="${rewriteCssUrls(val, baseUrl)}"`
  );
  // Single-quoted style attributes
  htmlText = htmlText.replace(/style='([^']*)'/gi,
    (match, val) => `style='${rewriteCssUrls(val, baseUrl)}'`
  );
  return htmlText;
}

/**
 * Proxy <link> tags that are:
 *   - rel="stylesheet"        → must go through proxy so their CSS gets rewritten
 *   - rel="preload" as="font" → font preload hints that would bypass the proxy
 * Also removes <link rel="preconnect"> hints — these make the browser open
 * direct connections to font CDNs, causing fonts to load cross-origin without
 * our CORS headers.
 */
function rewriteLinkTags(htmlText, baseUrl) {
  return htmlText.replace(/<link[^>]+>/gi, (tag) => {
    // Drop preconnect hints entirely
    if (/rel=['"]preconnect['"]/i.test(tag)) return '';

    const isStylesheet   = /rel=['"][^'"]*stylesheet[^'"]*['"]/i.test(tag);
    const isFontPreload  = /rel=['"][^'"]*preload[^'"]*['"]/i.test(tag) &&
                           /as=['"]font['"]/i.test(tag);

    if (!isStylesheet && !isFontPreload) return tag;

    const hrefMatch = tag.match(/href=(['"])([^'"]+)\1/i);
    if (!hrefMatch) return tag;

    const abs = resolveToAbsolute(hrefMatch[2], baseUrl);
    if (!abs) return tag;

    // Replace only the href value, keep all other attributes intact
    return tag.slice(0, hrefMatch.index + 6) +          // 'href=' prefix
           hrefMatch[1] + makeProxyUrl(abs) + hrefMatch[1] +
           tag.slice(hrefMatch.index + hrefMatch[0].length);
  });
}

// ---------------------------------------------------------------------------
// Vercel serverless handler
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

  try {
    // Detect resource type by file extension for smarter request headers.
    // Note: Google Fonts URLs end in e.g. /css2?family=... — no .css extension,
    // but their Content-Type response is text/css, so rewriting still applies.
    const lowPath = finalTarget.toLowerCase().split('?')[0];
    let resourceType = 'html';
    if (/\.(woff2?|ttf|otf|eot)(\?|$)/.test(lowPath)) resourceType = 'font';
    else if (lowPath.endsWith('.css'))                  resourceType = 'css';

    const response = await fetch(finalTarget, {
      headers:  buildHeaders(finalTarget, resourceType),
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || 'text/html';
    const finalUrl    = response.url || finalTarget;

    // ---- HTML ----
    if (contentType.includes('text/html')) {
      let htmlText = await response.text();

      // 1. Proxy <link rel="stylesheet"> and font preload hrefs
      htmlText = rewriteLinkTags(htmlText, finalUrl);

      // 2. Rewrite url() inside <style> blocks (covers fonts + background images)
      htmlText = rewriteStyleTags(htmlText, finalUrl);

      // 3. Rewrite url() inside inline style="..." attributes (background images)
      htmlText = rewriteStyleAttributes(htmlText, finalUrl);

      // 4. Inject simulator utilities + runtime font proxy
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
/* Runtime font proxy — intercepts JS-dynamically-inserted <link>/<style> elements
   that bypass server-side rewriting (React, Next.js, Vue chunk CSS, CSS-in-JS).
   Uses document.baseURI (which respects <base href>) for correct URL resolution. */
(function(){
  var PFX = location.origin + '/api/proxy?url=';

  function alreadyProxied(u) {
    return !u || u.indexOf('/api/proxy?url=') > -1 || u.startsWith('data:') || u.startsWith('blob:');
  }

  function toProxy(rawUrl) {
    if (alreadyProxied(rawUrl)) return rawUrl;
    try {
      var abs = new URL(rawUrl, document.baseURI).href;
      return PFX + encodeURIComponent(abs);
    } catch(e) { return rawUrl; }
  }

  function patchLink(el) {
    try {
      var rel = (el.getAttribute('rel') || '').toLowerCase();
      var isSheet = rel.indexOf('stylesheet') > -1;
      var isFont  = rel.indexOf('preload') > -1 && el.getAttribute('as') === 'font';
      if (!isSheet && !isFont) return;
      var h = el.getAttribute('href');
      if (h && !alreadyProxied(h)) el.setAttribute('href', toProxy(h));
    } catch(e) {}
  }

  function patchStyle(el) {
    try {
      var t = el.textContent;
      if (!t || t.indexOf('url(') < 0) return;
      var rewritten = t.replace(/url\((['"]?)([^)'"\s]+)\1\)/g, function(m, q, raw) {
        if (alreadyProxied(raw) || raw.startsWith('data:')) return m;
        try {
          var abs = new URL(raw, document.baseURI).href;
          return 'url(' + q + PFX + encodeURIComponent(abs) + q + ')';
        } catch(e) { return m; }
      });
      if (rewritten !== t) el.textContent = rewritten;
    } catch(e) {}
  }

  function patchNode(n) {
    if (!n || n.nodeType !== 1) return;
    var tag = n.tagName ? n.tagName.toUpperCase() : '';
    if (tag === 'LINK')  patchLink(n);
    if (tag === 'STYLE') patchStyle(n);
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
      m.addedNodes.forEach(function(n) {
        patchNode(n);
        if (n.querySelectorAll) {
          n.querySelectorAll('link').forEach(patchLink);
          n.querySelectorAll('style').forEach(patchStyle);
        }
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
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
          if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (err) {
          const idEl = document.getElementById(hash.substring(1));
          if (idEl) idEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }
  }, true);
</script>
`;
      if (/<head[^>]*>/i.test(htmlText)) {
        // Use a function so backslashes in 'injection' are literal, not replacement patterns
        htmlText = htmlText.replace(/(<head[^>]*>)/i, (m, tag) => tag + injection);
      } else {
        htmlText = injection + htmlText;
      }

      res.setHeader('Content-Type', contentType);
      return res.status(200).send(htmlText);

    // ---- CSS: rewrite ALL url() and @import refs ----
    } else if (contentType.includes('text/css')) {
      let cssText = await response.text();
      cssText = rewriteCssUrls(cssText, finalUrl);
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
