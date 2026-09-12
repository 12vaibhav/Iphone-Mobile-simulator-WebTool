function rewriteCssUrls(cssText, base) {
  // 1. Rewrite @import rules (e.g. @import url(...) or @import "...")
  const importRegex = /@import\s+(?:url\(['"]?([^'"\)]+)['"]?\)|['"]([^'"]+)['"])/gi;
  cssText = cssText.replace(importRegex, (match, url1, url2) => {
    const rawUrl = (url1 || url2 || '').trim();
    if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('/proxy')) return match;
    try {
      const fullUrl = new URL(rawUrl, base).href;
      return `@import url("/proxy?url=${encodeURIComponent(fullUrl)}")`;
    } catch (e) {
      return match;
    }
  });

  // 2. Rewrite all url(...) in CSS
  const urlRegex = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi;
  cssText = cssText.replace(urlRegex, (match, quote, rawUrl) => {
    const trimmed = rawUrl.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:') || trimmed.startsWith('/proxy')) {
      return match;
    }
    try {
      const fullUrl = new URL(trimmed, base).href;
      // If it is a font, route through /proxy so it gets CORS headers
      if (/\.(?:woff2?|ttf|otf|eot)(?:\?[^'")]+)?$/i.test(trimmed)) {
        return `url("/proxy?url=${encodeURIComponent(fullUrl)}")`;
      }
      // If it's an image, webp, svg, or any other asset, resolve to absolute URL so it loads directly with zero 404s
      return `url("${fullUrl}")`;
    } catch (e) {
      return match;
    }
  });

  return cssText;
}

export default async function handler(req, res) {
  // Enable full Cross-Origin Access for all assets
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

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
    const response = await fetch(finalTarget, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': '*/*'
      },
      redirect: 'follow'
    });

    let contentType = response.headers.get('content-type') || 'text/html';
    const finalUrl = response.url || finalTarget;
    const cleanPath = finalUrl.split('?')[0].toLowerCase();

    // 1. HTML Processing: Rewrite stylesheets, inline font/image declarations & inject simulator controls
    if (contentType.includes('text/html')) {
      let htmlText = await response.text();

      // Rewrite stylesheet links to proxy so their @font-face rules and images are correctly handled
      const linkRegex = /<link\s+[^>]*rel=['"]stylesheet['"][^>]*>|<link\s+[^>]*href=['"][^'"]+\.css[^'"]*['"][^>]*>/gi;
      htmlText = htmlText.replace(linkRegex, (match) => {
        const hrefMatch = match.match(/href=(['"])(.*?)\1/i);
        if (!hrefMatch) return match;
        const rawHref = hrefMatch[2].trim();
        if (rawHref.startsWith('data:') || rawHref.startsWith('javascript:') || rawHref.startsWith('/proxy')) {
          return match;
        }
        try {
          const fullCssUrl = new URL(rawHref, finalUrl).href;
          return match.replace(hrefMatch[0], `href="/proxy?url=${encodeURIComponent(fullCssUrl)}"`);
        } catch (e) {
          return match;
        }
      });

      // Rewrite fonts and background URLs in inline <style> tags
      const styleTagRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
      htmlText = htmlText.replace(styleTagRegex, (match, styleContent) => {
        return `<style>${rewriteCssUrls(styleContent, finalUrl)}</style>`;
      });

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

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(htmlText);
    } 
    // 2. CSS Processing: Rewrite fonts to proxy AND resolve all background images to absolute URLs
    else if (contentType.includes('text/css') || cleanPath.endsWith('.css')) {
      let cssText = await response.text();
      cssText = rewriteCssUrls(cssText, finalUrl);
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      return res.status(200).send(cssText);
    } 
    // 3. Asset & Font Content-Type normalization for maximum browser compatibility
    else {
      if (cleanPath.endsWith('.woff2')) {
        contentType = 'font/woff2';
      } else if (cleanPath.endsWith('.woff')) {
        contentType = 'font/woff';
      } else if (cleanPath.endsWith('.ttf')) {
        contentType = 'font/ttf';
      } else if (cleanPath.endsWith('.otf')) {
        contentType = 'font/otf';
      } else if (cleanPath.endsWith('.eot')) {
        contentType = 'application/vnd.ms-fontobject';
      } else if (cleanPath.endsWith('.webp')) {
        contentType = 'image/webp';
      } else if (cleanPath.endsWith('.png')) {
        contentType = 'image/png';
      } else if (cleanPath.endsWith('.jpg') || cleanPath.endsWith('.jpeg')) {
        contentType = 'image/jpeg';
      } else if (cleanPath.endsWith('.svg')) {
        contentType = 'image/svg+xml';
      }

      const buffer = await response.arrayBuffer();
      res.setHeader('Content-Type', contentType);
      return res.status(200).send(Buffer.from(buffer));
    }
  } catch (error) {
    return res.status(502).send(`Proxy error loading ${finalTarget}: ${error.message}`);
  }
}
