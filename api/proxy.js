function makeProxyUrl(assetUrl) {
  return `/api/proxy?url=${encodeURIComponent(assetUrl)}`;
}

function rewriteFontFacesInCss(cssText, baseUrl) {
  try {
    const parsedBase = new URL(baseUrl);
    const baseOrigin = parsedBase.origin;

    return cssText.replace(/url\((["']?)([^)"'\s]+)\1\)/gi, (match, quote, raw) => {
      const trimmed = raw.trim();
      if (trimmed.startsWith('data:') || trimmed.startsWith('/api/proxy') || trimmed.startsWith('/proxy')) {
        return match;
      }

      let absUrl;
      if (trimmed.startsWith('//')) {
        absUrl = parsedBase.protocol + trimmed;
      } else if (trimmed.startsWith('/')) {
        absUrl = baseOrigin + trimmed;
      } else if (/^https?:\/\//i.test(trimmed)) {
        absUrl = trimmed;
      } else {
        absUrl = new URL(trimmed, baseUrl).href;
      }

      const proxied = makeProxyUrl(absUrl);
      return `url(${quote}${proxied}${quote})`;
    });
  } catch (e) {
    return cssText;
  }
}

function rewriteInlineStylesInHtml(htmlText, baseUrl) {
  return htmlText.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, css) => {
    const rewritten = rewriteFontFacesInCss(css, baseUrl);
    return `<style>${rewritten}</style>`;
  });
}

function rewriteLinkStylesheetsInHtml(htmlText, baseUrl) {
  try {
    const parsedBase = new URL(baseUrl);
    const baseOrigin = parsedBase.origin;

    return htmlText.replace(/<link[^>]+>/gi, (match) => {
      if (!/rel=["']stylesheet["']/i.test(match)) return match;
      const hrefMatch = match.match(/href=["']([^"']+)["']/i);
      if (!hrefMatch) return match;

      const raw = hrefMatch[1].trim();
      if (raw.startsWith('data:') || raw.startsWith('/api/proxy') || raw.startsWith('/proxy')) {
        return match;
      }

      let absUrl;
      if (raw.startsWith('//')) {
        absUrl = parsedBase.protocol + raw;
      } else if (raw.startsWith('/')) {
        absUrl = baseOrigin + raw;
      } else if (/^https?:\/\//i.test(raw)) {
        absUrl = raw;
      } else {
        absUrl = new URL(raw, baseUrl).href;
      }

      const proxied = makeProxyUrl(absUrl);
      return match.replace(hrefMatch[1], proxied);
    });
  } catch (e) {
    return htmlText;
  }
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
    let parsedTarget;
    try {
      parsedTarget = new URL(finalTarget);
    } catch (err) {
      return res.status(400).send('Invalid URL');
    }

    const low = parsedTarget.pathname.toLowerCase();
    let resourceType = 'html';
    if (/\.(woff|woff2|ttf|otf|eot)$/i.test(low)) {
      resourceType = 'font';
    } else if (/\.css$/i.test(low)) {
      resourceType = 'css';
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept': resourceType === 'font' ? '*/*' : (resourceType === 'css' ? 'text/css,*/*;q=0.1' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': parsedTarget.origin + '/',
      'Origin': parsedTarget.origin,
      'Sec-Fetch-Dest': resourceType === 'font' ? 'font' : (resourceType === 'css' ? 'style' : 'document'),
      'Sec-Fetch-Mode': resourceType === 'html' ? 'navigate' : 'cors',
      'Sec-Fetch-Site': 'same-origin'
    };

    const response = await fetch(finalTarget, {
      headers,
      redirect: 'follow'
    });

    const contentType = response.headers.get('content-type') || 'text/html';
    const finalUrl = response.url || finalTarget;

    if (contentType.includes('text/html')) {
      let htmlText = await response.text();

      htmlText = rewriteLinkStylesheetsInHtml(htmlText, finalUrl);
      htmlText = rewriteInlineStylesInHtml(htmlText, finalUrl);

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
    } else if (contentType.includes('text/css')) {
      let cssText = await response.text();
      cssText = rewriteFontFacesInCss(cssText, finalUrl);
      res.setHeader('Content-Type', contentType);
      return res.status(200).send(cssText);
    } else {
      const buffer = await response.arrayBuffer();
      res.setHeader('Content-Type', contentType);
      return res.status(200).send(Buffer.from(buffer));
    }
  } catch (error) {
    return res.status(502).send(`Proxy error loading ${finalTarget}: ${error.message}`);
  }
}
