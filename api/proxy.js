// Helper: build rich browser-like headers so font CDNs don't block requests
function buildHeaders(targetUrl, resourceType = 'html') {
  const parsed = new URL(targetUrl);
  const origin = `${parsed.protocol}//${parsed.hostname}`;

  const acceptMap = {
    font: '*/*',
    css: 'text/css,*/*;q=0.1',
    html: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  return {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
      'Version/17.0 Mobile/15E148 Safari/604.1',
    Accept: acceptMap[resourceType] || acceptMap.html,
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    Referer: origin + '/',
    Origin: origin,
    'Sec-Fetch-Dest':
      resourceType === 'font' ? 'font' : resourceType === 'css' ? 'style' : 'document',
    'Sec-Fetch-Mode': resourceType === 'font' || resourceType === 'css' ? 'cors' : 'navigate',
    'Sec-Fetch-Site': 'same-origin',
  };
}

// Helper: build a /api/proxy?url=... path for a given absolute URL
function makeProxyUrl(absUrl) {
  return `/api/proxy?url=${encodeURIComponent(absUrl)}`;
}

// Rewrite url(...) references in CSS so fonts route through the proxy
function rewriteUrlsInCss(cssText, baseUrl) {
  const parsed = new URL(baseUrl);
  const baseOrigin = `${parsed.protocol}//${parsed.hostname}`;

  return cssText.replace(/url\((['"]?)([^)'"\s]+)\1\)/g, (match, quote, raw) => {
    if (raw.startsWith('data:') || raw.startsWith('/api/proxy?')) return match;

    let absUrl;
    if (raw.startsWith('//')) absUrl = parsed.protocol + raw;
    else if (raw.startsWith('/')) absUrl = baseOrigin + raw;
    else if (/^https?:\/\//i.test(raw)) absUrl = raw;
    else absUrl = new URL(raw, baseUrl).href;

    return `url(${quote}${makeProxyUrl(absUrl)}${quote})`;
  });
}

// Rewrite <style> blocks in HTML so @font-face URLs go through the proxy
function rewriteInlineStyles(htmlText, baseUrl) {
  return htmlText.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, css) => {
    return `<style>${rewriteUrlsInCss(css, baseUrl)}</style>`;
  });
}

// Rewrite <link rel="stylesheet"> hrefs so CSS is fetched through the proxy
function rewriteStylesheetLinks(htmlText, baseUrl) {
  const parsed = new URL(baseUrl);
  const baseOrigin = `${parsed.protocol}//${parsed.hostname}`;

  return htmlText.replace(/<link[^>]+>/gi, (tag) => {
    if (!/rel=["']stylesheet["']/i.test(tag) && !/rel=["'][^"']*stylesheet[^"']*["']/i.test(tag)) {
      return tag;
    }
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) return tag;

    const raw = hrefMatch[1];
    if (raw.startsWith('data:') || raw.startsWith('/api/proxy?')) return tag;

    let absUrl;
    if (raw.startsWith('//')) absUrl = parsed.protocol + raw;
    else if (raw.startsWith('/')) absUrl = baseOrigin + raw;
    else if (/^https?:\/\//i.test(raw)) absUrl = raw;
    else absUrl = new URL(raw, baseUrl).href;

    return tag.replace(hrefMatch[1], makeProxyUrl(absUrl));
  });
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing "url" parameter');
  }

  let finalTarget = targetUrl;
  if (!/^https?:\/\//i.test(finalTarget)) {
    finalTarget = 'https://' + finalTarget;
  }

  try {
    // Detect resource type for smarter headers
    const lowPath = finalTarget.toLowerCase().split('?')[0];
    let resourceType = 'html';
    if (/\.(woff2?|ttf|otf|eot)$/.test(lowPath)) resourceType = 'font';
    else if (lowPath.endsWith('.css')) resourceType = 'css';

    const response = await fetch(finalTarget, {
      headers: buildHeaders(finalTarget, resourceType),
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || 'text/html';
    const finalUrl = response.url || finalTarget;

    // ---- Rewrite HTML ----
    if (contentType.includes('text/html')) {
      let htmlText = await response.text();

      // 1. Rewrite stylesheet <link> hrefs through the proxy
      htmlText = rewriteStylesheetLinks(htmlText, finalUrl);

      // 2. Rewrite @font-face URLs in inline <style> blocks
      htmlText = rewriteInlineStyles(htmlText, finalUrl);

      // 3. Inject simulator utilities
      const injection = `
<base href="${finalUrl}">
<style id="simulator-mobile-styles">
  * { cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='34' height='34' viewBox='0 0 34 34'%3E%3Ccircle cx='17' cy='17' r='14' fill='rgba(255,255,255,0.35)' stroke='rgba(255,255,255,0.95)' stroke-width='2'/%3E%3Ccircle cx='17' cy='17' r='3' fill='%23ffffff'/%3E%3C/svg%3E") 17 17, auto !important; }
  ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; background: transparent !important; }
  ::-webkit-scrollbar-track { background: transparent !important; }
  ::-webkit-scrollbar-thumb { background: transparent !important; }
  html, body { -ms-overflow-style: none !important; scrollbar-width: none !important; overflow-x: hidden !important; max-width: 100% !important; }
</style>
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
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
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
        htmlText = htmlText.replace(/(<head[^>]*>)/i, `$1${injection}`);
      } else {
        htmlText = injection + htmlText;
      }

      res.setHeader('Content-Type', contentType);
      return res.status(200).send(htmlText);

    // ---- Rewrite CSS (@font-face src URLs) ----
    } else if (contentType.includes('text/css')) {
      let cssText = await response.text();
      cssText = rewriteUrlsInCss(cssText, finalUrl);
      res.setHeader('Content-Type', contentType);
      return res.status(200).send(cssText);

    // ---- Pass-through for fonts & other binary assets ----
    } else {
      const buffer = await response.arrayBuffer();
      res.setHeader('Content-Type', contentType);
      return res.status(200).send(Buffer.from(buffer));
    }

  } catch (error) {
    return res.status(502).send(`Proxy error loading ${finalTarget}: ${error.message}`);
  }
}
