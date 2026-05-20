import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = 3010;
app.use(cors());
app.use(express.json());

// ── Helper: fetch con timeout via AbortController ─────────────────────────────
function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

// ── Token ML en memoria (se refresca automáticamente) ──────────────────────────
let _mlToken = null;
let _mlTokenExpiry = 0;

async function getMLToken(clientId, clientSecret) {
  if (_mlToken && Date.now() < _mlTokenExpiry) return _mlToken;

  const res = await fetchWithTimeout(
    'https://api.mercadolibre.com/oauth/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    },
    10000,
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ML Auth ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  _mlToken = data.access_token;
  _mlTokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
  console.log(`[ML] Token obtenido. Válido por ${Math.round(data.expires_in / 3600)}h`);
  return _mlToken;
}

// ── Credenciales en memoria (se setean vía /api/ml/credentials) ───────────────
let _mlCredentials = { clientId: '', clientSecret: '' };

// ── Búsqueda ML real con token ─────────────────────────────────────────────────
async function mlSearch(q, { limit = 24, minPrice, maxPrice } = {}) {
  const { clientId, clientSecret } = _mlCredentials;
  if (!clientId || !clientSecret) {
    throw { code: 'NO_CREDENTIALS', message: 'Credenciales de MercadoLibre no configuradas.' };
  }

  const token = await getMLToken(clientId, clientSecret);

  const params = new URLSearchParams({ q, category: 'MLA1744', limit: String(limit), access_token: token });
  if (minPrice) params.append('price_min', String(minPrice));
  if (maxPrice) params.append('price_max', String(maxPrice));

  const res = await fetchWithTimeout(
    `https://api.mercadolibre.com/sites/MLA/search?${params}`,
    { headers: { Accept: 'application/json', 'User-Agent': 'ChulaCars/1.0' } },
    10000,
  );

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) { _mlToken = null; _mlTokenExpiry = 0; }
    throw new Error(`ML Search ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

// ── GET /api/ml/search ─────────────────────────────────────────────────────────
app.get('/api/ml/search', async (req, res) => {
  const { q = 'auto', limit = '24', minPrice, maxPrice } = req.query;
  console.log(`\n[API] Búsqueda: "${q}"`);

  try {
    const data = await mlSearch(q, {
      limit: parseInt(limit),
      minPrice: minPrice ? parseFloat(minPrice) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
    });

    let results = data.results || [];
    if (minPrice) results = results.filter(r => r.price >= parseFloat(minPrice));
    if (maxPrice) results = results.filter(r => r.price <= parseFloat(maxPrice));

    const usd = results.filter(r => r.currency_id === 'USD' && r.price > 0);
    const avgUsd = usd.length ? usd.reduce((s, r) => s + r.price, 0) / usd.length : 0;

    console.log(`[ML] ✓ ${results.length} resultados (total ML: ${data.paging?.total})`);
    res.json({ results, total: data.paging?.total || results.length, market: { avgUsd }, source: 'live' });

  } catch (err) {
    if (err.code === 'NO_CREDENTIALS') {
      return res.status(401).json({ error: err.message, code: 'NO_CREDENTIALS', results: [] });
    }
    console.error('[ML] Error:', err.message);
    res.status(502).json({ error: err.message, results: [], total: 0 });
  }
});

// ── POST /api/ml/credentials ──────────────────────────────────────────────────
app.post('/api/ml/credentials', async (req, res) => {
  const { clientId, clientSecret } = req.body;
  if (!clientId || !clientSecret) {
    return res.status(400).json({ ok: false, error: 'Faltan clientId o clientSecret.' });
  }

  try {
    _mlToken = null; _mlTokenExpiry = 0;
    _mlCredentials = { clientId, clientSecret };
    await getMLToken(clientId, clientSecret);
    console.log('[ML] Credenciales válidas ✓');
    res.json({ ok: true, message: 'Credenciales válidas. MercadoLibre conectado.' });
  } catch (err) {
    _mlCredentials = { clientId: '', clientSecret: '' };
    console.error('[ML] Credenciales inválidas:', err.message);
    res.status(401).json({ ok: false, error: `Credenciales inválidas: ${err.message}` });
  }
});

// ── GET /api/ml/status ─────────────────────────────────────────────────────────
app.get('/api/ml/status', (_, res) => {
  const configured = !!(_mlCredentials.clientId && _mlCredentials.clientSecret);
  const tokenValid = configured && !!_mlToken && Date.now() < _mlTokenExpiry;
  res.json({
    configured,
    tokenValid,
    tokenExpiresIn: tokenValid ? Math.round((_mlTokenExpiry - Date.now()) / 60000) : 0,
  });
});

// ── GET /api/health ────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true, port: PORT }));

// ── GET /api/market-index — índice de precios de mercado (debug) ───────────────
app.get('/api/market-index', (_, res) => {
  if (!_marketIndex) return res.json({ ready: false, message: 'No hay índice aún. Refrescá el catálogo primero.' });
  const entries = Object.entries(_marketIndex).map(([key, v]) => {
    const [brand, model] = key.split('|');
    return { brand, model, ...v };
  }).sort((a, b) => b.count - a.count);
  res.json({
    ready: true,
    models: entries.length,
    source: _mlCredentials.clientId ? 'MercadoLibre' : 'internal',
    expiresIn: Math.round((_marketIndexExpiry - Date.now()) / 60000) + ' min',
    index: entries,
  });
});

// ── Tipo de cambio USD/ARS (dólar blue) ────────────────────────────────────────
let _usdRate = null, _usdRateExpiry = 0;

async function getUsdRate() {
  if (_usdRate && Date.now() < _usdRateExpiry) return _usdRate;
  try {
    const r = await fetchWithTimeout(
      'https://mercados.ambito.com/dolar/informal/variacion',
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'application/json' } },
      5000,
    );
    const d = await r.json();
    const compra = parseFloat((d.compra || '0').replace(',', '.'));
    const venta  = parseFloat((d.venta  || '0').replace(',', '.'));
    if (compra > 0 && venta > 0) {
      _usdRate = Math.round((compra + venta) / 2);
      console.log(`[USD] Dólar blue (Ámbito): $${_usdRate} (compra $${compra} / venta $${venta})`);
    }
  } catch (e) {
    console.warn('[USD] Ámbito error:', e.message);
  }
  if (!_usdRate) _usdRate = 1420; // fallback actualizado
  _usdRateExpiry = Date.now() + 3_600_000; // 1 hora
  return _usdRate;
}

// ── Marcas prioritarias (aparecen primero en el catálogo) ─────────────────────
const PRIORITY_BRANDS = ['volkswagen', 'vw', 'audi', 'mercedes', 'bmw', 'toyota'];
function prioritizeBrands(cars) {
  const rank = b => {
    const n = (b || '').toLowerCase();
    const i = PRIORITY_BRANDS.findIndex(p => n.includes(p));
    return i === -1 ? PRIORITY_BRANDS.length : i;
  };
  return [...cars].sort((a, b) => rank(a.brand) - rank(b.brand));
}

// ── Índice de precios de mercado ──────────────────────────────────────────────
// Costos reales de transacción en Argentina (USD)
const COST_TRANSFER   = 350;  // gestoria + transferencia dominio
const COST_DETAILING  = 150;  // limpieza y preparación para venta
function costRepair(km) {
  return km > 150_000 ? 800 : km > 100_000 ? 500 : km > 60_000 ? 250 : 100;
}

let _marketIndex = null, _marketIndexExpiry = 0, _marketIndexP = null;

// Normaliza strings para comparación: "Volkswagen" === "volkswagen" === "VOLKSWAGEN"
function norm(s) {
  return (s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

// Construye índice interno desde el catálogo (fallback sin ML)
function buildInternalIndex(cars) {
  const groups = {};
  for (const c of cars) {
    if (!c.brand || c.price <= 0) continue;
    const key = `${norm(c.brand)}|${norm(c.model || '')}`;
    (groups[key] = groups[key] || []).push(c.price);
  }
  const idx = {};
  for (const [key, prices] of Object.entries(groups)) {
    if (prices.length < 2) continue;
    prices.sort((a, b) => a - b);
    const n = prices.length;
    idx[key] = {
      avg:    Math.round(prices.reduce((s, p) => s + p, 0) / n),
      median: prices[Math.floor(n / 2)],
      p25:    prices[Math.floor(n * 0.25)],
      p75:    prices[Math.floor(n * 0.75)],
      count:  n,
      source: 'internal',
    };
  }
  console.log(`[Market] Índice interno: ${Object.keys(idx).length} modelos de ${cars.length} autos`);
  return idx;
}

// Construye índice desde ML (requiere credenciales configuradas)
async function buildMLIndex(cars) {
  if (!_mlCredentials.clientId) return null;

  // Combos únicos marca+modelo del catálogo, priorizando los que tienen más autos
  const freq = {};
  for (const c of cars) {
    if (!c.brand) continue;
    const key = `${norm(c.brand)}|${norm(c.model || '')}`;
    freq[key] = (freq[key] || 0) + 1;
  }
  const combos = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 35)
    .map(([k]) => k);

  console.log(`[Market] Consultando ML para ${combos.length} modelos...`);

  const idx = {};
  // Batches de 5 para no saturar la API
  for (let i = 0; i < combos.length; i += 5) {
    const batch = combos.slice(i, i + 5);
    await Promise.allSettled(batch.map(async combo => {
      const [brand, model] = combo.split('|');
      try {
        const data = await mlSearch(`${brand} ${model}`, { limit: 50 });
        const prices = (data.results || [])
          .filter(r => r.currency_id === 'USD' && r.price > 1000 && r.price < 250_000)
          .map(r => r.price)
          .sort((a, b) => a - b);
        if (prices.length < 3) return;
        const n = prices.length;
        // Recorte IQR: eliminar outliers extremos (fuera de 1.5×IQR)
        const q1 = prices[Math.floor(n * 0.25)];
        const q3 = prices[Math.floor(n * 0.75)];
        const iqr = q3 - q1;
        const filtered = prices.filter(p => p >= q1 - 1.5 * iqr && p <= q3 + 1.5 * iqr);
        if (filtered.length < 3) return;
        const fn = filtered.length;
        idx[combo] = {
          avg:    Math.round(filtered.reduce((s, p) => s + p, 0) / fn),
          median: filtered[Math.floor(fn / 2)],
          p25:    filtered[Math.floor(fn * 0.25)],
          p75:    filtered[Math.floor(fn * 0.75)],
          count:  data.paging?.total || fn,  // total de listings en ML
          source: 'ml',
        };
      } catch {}
    }));
  }
  console.log(`[Market] Índice ML: ${Object.keys(idx).length}/${combos.length} modelos con datos`);
  return idx;
}

async function getMarketIndex(cars) {
  if (_marketIndex && Date.now() < _marketIndexExpiry) return _marketIndex;
  if (_marketIndexP) return _marketIndexP;

  _marketIndexP = (async () => {
    const mlIdx = await buildMLIndex(cars).catch(() => null);
    const internalIdx = buildInternalIndex(cars);
    // Fusionar: ML tiene prioridad, interno como fallback por modelo
    const merged = { ...internalIdx };
    if (mlIdx) {
      for (const [k, v] of Object.entries(mlIdx)) {
        merged[k] = v; // ML sobreescribe interno
      }
    }
    _marketIndex = merged;
    _marketIndexExpiry = Date.now() + (_mlCredentials.clientId ? 4 : 0.5) * 3_600_000;
    return merged;
  })().finally(() => { _marketIndexP = null; });

  return _marketIndexP;
}

// Enriquece cada auto con datos reales de mercado y ganancia neta
function enrichWithMarket(cars, index) {
  // Precio promedio global como último fallback
  const allPrices = cars.filter(c => c.price > 0).map(c => c.price);
  const globalAvg = allPrices.length
    ? Math.round(allPrices.reduce((s, p) => s + p, 0) / allPrices.length * 1.05)
    : 15000;

  return cars.map(car => {
    const key = `${norm(car.brand)}|${norm(car.model || '')}`;
    const brandKey = `${norm(car.brand)}|`;
    const market = index[key]
      || Object.entries(index).find(([k]) => k.startsWith(brandKey))?.[1]
      || null;

    const marketAvg = market?.median || globalAvg;
    const marketCount = market?.count || 0;
    const marketSource = market?.source || 'global';

    const margin = marketAvg > car.price && car.price > 0
      ? parseFloat(((marketAvg - car.price) / marketAvg * 100).toFixed(1))
      : 0;

    const km          = car.km || 0;
    const grossProfit = Math.max(0, marketAvg - car.price);
    const costs       = COST_TRANSFER + COST_DETAILING + costRepair(km);
    const netProfit   = Math.round(grossProfit - costs);
    const roi         = car.price > 0 ? parseFloat(((netProfit / car.price) * 100).toFixed(1)) : 0;

    // Investment score basado en ganancia neta real (no en margin bruto)
    const investmentScore = netProfit > 4000 ? 5 : netProfit > 2000 ? 4 : netProfit > 800 ? 3 : netProfit > 0 ? 2 : 1;

    // Overall score: 40% precio, 35% condición, 15% liquidez, 10% marca
    const priceScore  = Math.min(100, 50 + margin * 2.5);
    const year        = car.year || new Date().getFullYear() - 3;
    const kmScore     = km < 30_000 ? 95 : km < 60_000 ? 85 : km < 100_000 ? 72 : km < 150_000 ? 58 : 40;
    const yearScore   = year >= 2023 ? 95 : year >= 2020 ? 85 : year >= 2017 ? 72 : year >= 2014 ? 60 : 48;
    const condScore   = Math.round((kmScore + yearScore) / 2);
    const liquidity   = marketCount > 50 ? 90 : marketCount > 20 ? 75 : marketCount > 5 ? 60 : 50;
    const brandBonus  = PRIORITY_BRANDS.some(p => norm(car.brand).includes(p)) ? 85 : 70;
    const overallScore = Math.round(priceScore * 0.40 + condScore * 0.35 + liquidity * 0.15 + brandBonus * 0.10);

    return {
      ...car,
      marketAvg,
      marketCount,
      marketSource,
      margin,
      grossProfit,
      netProfit,
      costs,
      roi,
      investmentScore,
      overallScore: Math.min(99, Math.max(10, overallScore)),
      risk: netProfit > 2000 ? 'low' : netProfit > 0 ? 'medium' : 'high',
      speed: km < 60_000 && year >= 2019 ? 'fast' : km < 100_000 ? 'medium' : 'slow',
    };
  });
}

// ── Cache del catálogo ────────────────────────────────────────────────────────
let _catalogCache = null, _catalogExpiry = 0;
// Promise en vuelo — todos los callers esperan el mismo resultado
let _catalogRefreshPromise = null;

async function refreshCatalog() {
  if (_catalogRefreshPromise) return _catalogRefreshPromise;

  _catalogRefreshPromise = (async () => {
    const usdRateP = getUsdRate(); // arranca YA, sin await
    const [romeraR, autobiliariaR, tiendacarsR] = await Promise.allSettled([
      scrapeRomera(usdRateP),
      scrapeAutobiliaria(usdRateP),
      scrapeTiendaCars(usdRateP),
    ]);
    const usdRate = await usdRateP.catch(() => _usdRate || 1200);
    const raw = [
      ...(romeraR.status === 'fulfilled' ? romeraR.value : []),
      ...(autobiliariaR.status === 'fulfilled' ? autobiliariaR.value : []),
      ...(tiendacarsR.status === 'fulfilled' ? tiendacarsR.value : []),
    ].filter(c => c.price > 500 && c.price < 1_000_000);

    // Construir índice de precios y enriquecer antes de cachear
    const marketIdx = await getMarketIndex(raw).catch(() => buildInternalIndex(raw));
    const enriched  = enrichWithMarket(raw, marketIdx);
    const cars      = prioritizeBrands(enriched);
    const result = {
      cars, total: cars.length, usdRate,
      sources: {
        romera: romeraR.status === 'fulfilled' ? romeraR.value.length : 0,
        autobiliaria: autobiliariaR.status === 'fulfilled' ? autobiliariaR.value.length : 0,
        tiendacars: tiendacarsR.status === 'fulfilled' ? tiendacarsR.value.length : 0,
      },
      updatedAt: new Date().toISOString(),
    };
    console.log(`[Catalog] ${cars.length} autos — Romera:${result.sources.romera} Autobiliaria:${result.sources.autobiliaria} TiendaCars:${result.sources.tiendacars}`);
    if (cars.length > 0) {
      _catalogCache = result;
      _catalogExpiry = Date.now() + 30 * 60_000; // 30 min
    }
    return result;
  })().finally(() => { _catalogRefreshPromise = null; });

  return _catalogRefreshPromise;
}

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
};

// ── Parseo de número argentino: "22.500.000" → 22500000 ───────────────────────
function parseArNum(str = '') {
  return parseInt(str.replace(/\./g, '').replace(/,/g, '')) || 0;
}

// ── Scraper: Romera Hermanos ───────────────────────────────────────────────────
function parseRomeraHtml(html, usdRate, idOffset = 0) {
  const cars = [];
  for (const [fullTag, block] of html.matchAll(/<a\s[^>]*class="nada"[^>]*>([\s\S]*?)<\/a>/g)) {
    try {
      const href     = fullTag.match(/href="([^"]+)"/)?.[1] || '';
      const title    = block.match(/<b>([^<]+)<\/b>/)?.[1]?.trim() || '';
      const h4raw    = block.match(/<h4>([\s\S]*?)<\/h4>/)?.[1] || '';
      const priceARS = parseInt(h4raw.replace(/&nbsp;/g, '').replace(/\s/g, '').replace(/[^\d]/g, '')) || 0;
      const km       = parseArNum(block.match(/KMS:\s*([\d.]+)/)?.[1] || '0');
      const year     = parseInt(block.match(/Año:\s*(\d{4})/)?.[1]) || 0;
      const img      = block.match(/src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i)?.[1] || '';
      if (!title || !href || priceARS === 0) continue;
      const priceUSD = Math.round(priceARS / usdRate);
      const parts    = title.split(/\s+/).filter(Boolean);
      cars.push({
        id: `romera-${idOffset + cars.length}`,
        brand: parts[0] || 'Sin marca', model: parts[1] || '',
        version: parts.slice(2).join(' '),
        year: year || new Date().getFullYear() - 3,
        km, price: priceUSD, currency: 'USD', priceARS,
        province: 'Buenos Aires', city: 'Mar del Plata',
        platform: 'Romera Hermanos', source: 'romera',
        url: href.startsWith('http') ? href : `https://romerahnos.com${href}`,
        thumbnail: img || null,
        daysListed: 1, urgent: false, verified: true,
      });
    } catch {}
  }
  return cars;
}

async function scrapeRomera(usdRateP) {
  // Página 1 (GET) y página 2 (POST) en paralelo
  const [page1Res, page2Res, usdRate] = await Promise.all([
    fetchWithTimeout('https://romerahnos.com/usados', { headers: SCRAPE_HEADERS }, 15000),
    fetchWithTimeout('https://romerahnos.com/usados', {
      method: 'POST',
      headers: { ...SCRAPE_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'page=2',
    }, 15000),
    usdRateP,
  ]);

  const [html1, html2] = await Promise.all([page1Res.text(), page2Res.text()]);
  const page1Cars = parseRomeraHtml(html1, usdRate, 0);
  const page2Cars = parseRomeraHtml(html2, usdRate, page1Cars.length);

  // Deduplicar por href
  const seen = new Set(page1Cars.map(c => c.url));
  const newPage2 = page2Cars.filter(c => !seen.has(c.url));
  const cars = [...page1Cars, ...newPage2];
  console.log(`[Romera] ${cars.length} autos (p1:${page1Cars.length} p2:${newPage2.length})`);
  return cars;
}

// ── Scraper: Autobiliaria ─────────────────────────────────────────────────────
function parseAutobiliariaHtml(html, usdRate) {
  const cars = [];
  const seen = new Set();
  const aTagRegex = /<a\s[^>]*href="(\/vehiculo\/\d+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const [, href, block] of html.matchAll(aTagRegex)) {
    if (seen.has(href)) continue;
    seen.add(href);
    if (block.length < 80) continue;
    try {
      const title = block.match(/<h3[^>]*>([^<]+)<\/h3>/)?.[1]?.trim() || '';
      if (!title) continue;
      const usdMatch = block.match(/USD[\s\S]{0,30}?([\d]+[.,][\d]+)/i);
      const arsMatch = block.match(/\$[\s\S]{0,20}?([\d]+[.,][\d]+)/);
      let priceUSD = 0;
      if (usdMatch) {
        priceUSD = parseArNum(usdMatch[1]);
        if (priceUSD > 500000) priceUSD = Math.round(priceUSD / usdRate);
      } else if (arsMatch) {
        priceUSD = Math.round(parseArNum(arsMatch[1]) / usdRate);
      }
      if (priceUSD === 0) continue;
      const kmMatch = block.match(/([\d.]+)<!--[\s\S]*?-->\s*km/i) || block.match(/<span>([\d.]+)\s*km<\/span>/i);
      const km    = kmMatch ? parseArNum(kmMatch[1]) : 0;
      const year  = parseInt(title.match(/\b(20\d{2})\b/)?.[1]) || new Date().getFullYear() - 2;
      const img   = block.match(/src="(https?:\/\/cdn\.autobiliaria[^"]+)"/)?.[1] || '';
      const bm    = title.match(/^([A-Za-záéíóúÁÉÍÓÚ]+)\s+([A-Za-záéíóúÁÉÍÓÚ\d\-]+)/);
      cars.push({
        id: `autobiliaria-${href.match(/\d+/)[0]}`,
        brand: bm?.[1] || title.split(' ')[0], model: bm?.[2] || title.split(' ')[1] || '',
        version: title, year, km, price: priceUSD, currency: 'USD',
        province: 'Buenos Aires', city: 'Mar del Plata',
        platform: 'Autobiliaria', source: 'autobiliaria',
        url: `https://www.autobiliaria.com${href}`,
        thumbnail: img || null, daysListed: 1, urgent: false, verified: true,
      });
    } catch {}
  }
  return cars;
}

async function scrapeAutobiliaria(usdRateP) {
  // Scraper homepage y /oportunidades en paralelo
  const [resHome, resOport, usdRate] = await Promise.all([
    fetchWithTimeout('https://www.autobiliaria.com/', { headers: SCRAPE_HEADERS }, 15000),
    fetchWithTimeout('https://www.autobiliaria.com/oportunidades', { headers: SCRAPE_HEADERS }, 15000),
    usdRateP,
  ]);

  const [htmlHome, htmlOport] = await Promise.all([resHome.text(), resOport.text()]);

  const homeCars   = parseAutobiliariaHtml(htmlHome, usdRate);
  const oportCars  = parseAutobiliariaHtml(htmlOport, usdRate);

  // Deduplicar por id (que incluye el vehiculo ID)
  const seenIds = new Set(homeCars.map(c => c.id));
  const newOport = oportCars.filter(c => !seenIds.has(c.id));
  const cars = [...homeCars, ...newOport];
  console.log(`[Autobiliaria] ${cars.length} autos (home:${homeCars.length} oport:${newOport.length} nuevos)`);
  return cars;
}

// ── Scraper: Tienda Cars (WooCommerce, todas las páginas) ────────────────────
function parseTiendaCarsPage(html, usdRate, idOffset = 0) {
  // Extraer precios exactos del wpmDataLayer embebido en el JS de la página
  const wpmMap = {};
  for (const [, jsonStr] of html.matchAll(/window\.wpmDataLayer\.products\[\d+\]\s*=\s*(\{[^;]+\});/g)) {
    try {
      const p = JSON.parse(jsonStr);
      if (p.name && p.price > 0) wpmMap[p.name.trim()] = p.price;
    } catch {}
  }

  // Imagen principal: alt="Nombre del producto" — mismo key que wpmMap
  const imgMap = {};
  for (const [, imgAttrs] of html.matchAll(/<img\s([^>]*class="[^"]*attachment-woocommerce_thumbnail[^"]*"[^>]*)\/?>/g)) {
    const src = imgAttrs.match(/\bsrc="([^"]+)"/)?.[1];
    const alt = imgAttrs.match(/\balt="([^"]+)"/)?.[1];
    if (src && alt && !imgMap[alt.trim()]) imgMap[alt.trim()] = src.split('?')[0];
  }

  const titleRe = /woocommerce-loop-product__title">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  const titles  = [...html.matchAll(titleRe)];
  const cars    = [];

  for (let i = 0; i < titles.length; i++) {
    try {
      const url      = titles[i][1];
      const title    = titles[i][2].replace(/&#215;/g, 'x').replace(/&[^;]+;/g, '').trim();
      if (!title || !url) continue;
      const priceARS = wpmMap[title] || 0;
      if (priceARS === 0) continue;
      const priceUSD = Math.round(priceARS / usdRate);
      const year     = parseInt(title.match(/\b(20\d{2}|19\d{2})\b/)?.[1]) || new Date().getFullYear() - 3;
      const parts    = title.split(/\s+/);
      const img      = imgMap[title] || null;
      const isCVT    = /\bCVT\b/i.test(title);
      const isManual = /\b(?:MT|manual)\b/i.test(title) && !isCVT;
      const isDiesel = /\b(?:TD|TDI|diesel)\b/i.test(title);
      cars.push({
        id: `tiendacars-${idOffset + i}`,
        brand: parts[0] || 'Sin marca', model: parts[1] || '',
        version: parts.slice(2).join(' '),
        year, km: 0,
        price: priceUSD, currency: 'USD', priceARS,
        province: 'Buenos Aires', city: 'Mar del Plata',
        fuel: isDiesel ? 'Diesel' : 'Nafta',
        transmission: isCVT ? 'CVT' : isManual ? 'Manual' : 'Automático',
        platform: 'Tienda Cars', source: 'tiendacars',
        url, thumbnail: img,
        daysListed: 1, urgent: false, verified: true,
      });
    } catch {}
  }
  return cars;
}

async function scrapeTiendaCars(usdRateP) {
  try {
    const TC_HEADERS = { ...SCRAPE_HEADERS, Referer: 'https://www.google.com.ar/' };
    // Traer todas las páginas en paralelo (descubiertas: 8 páginas)
    const pageUrls = [
      'https://tiendacars.com/productos/',
      ...Array.from({ length: 7 }, (_, i) => `https://tiendacars.com/productos/page/${i + 2}/`),
    ];

    const [pageResponses, usdRate] = await Promise.all([
      Promise.allSettled(pageUrls.map(url => fetchWithTimeout(url, { headers: TC_HEADERS }, 15000))),
      usdRateP,
    ]);

    const htmlPages = await Promise.all(
      pageResponses.map(r => r.status === 'fulfilled' && r.value.ok ? r.value.text() : Promise.resolve('')),
    );

    const cars = [];
    for (const html of htmlPages) {
      if (!html) continue;
      const pageCars = parseTiendaCarsPage(html, usdRate, cars.length);
      cars.push(...pageCars);
    }

    // Deduplicar por URL (puede haber solapamiento entre páginas)
    const seen = new Set();
    const unique = cars.filter(c => { if (seen.has(c.url)) return false; seen.add(c.url); return true; });
    console.log(`[TiendaCars] ${unique.length} autos (${htmlPages.filter(Boolean).length} páginas)`);
    return unique;
  } catch (e) {
    console.warn(`[TiendaCars] Error: ${e.message}`);
    return [];
  }
}

// ── GET /api/catalog ──────────────────────────────────────────────────────────
app.get('/api/catalog', async (req, res) => {
  if (_catalogCache && Date.now() < _catalogExpiry && req.query.refresh !== '1') {
    return res.json({ ..._catalogCache, cached: true });
  }

  // Cache vencido → devolver lo viejo YA y refrescar en background
  if (_catalogCache && req.query.refresh !== '1') {
    refreshCatalog().catch(e => console.error('[Catalog] BG refresh error:', e.message));
    return res.json({ ..._catalogCache, cached: true, stale: true });
  }

  try {
    const result = await refreshCatalog();
    res.json(result || { cars: [], total: 0 });
  } catch (err) {
    console.error('[Catalog] Error:', err.message);
    res.status(502).json({ error: err.message, cars: [], total: 0 });
  }
});

// ── GET /api/catalog/stream — SSE, entrega autos por fuente a medida que llegan ─
app.get('/api/catalog/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let closed = false;
  req.on('close', () => { closed = true; });
  const send = (obj) => { if (!closed) res.write(`data: ${JSON.stringify(obj)}\n\n`); };

  // Caché válido → devolver inmediatamente como 'done'
  if (_catalogCache && Date.now() < _catalogExpiry && req.query.refresh !== '1') {
    send({ type: 'done', ..._catalogCache, cached: true });
    return res.end();
  }

  // Si ya hay un refresh en vuelo (vía /api/catalog), esperarlo
  if (_catalogRefreshPromise) {
    const result = await _catalogRefreshPromise.catch(() => null);
    send({ type: 'done', ...(result || _catalogCache || { cars: [], total: 0 }) });
    return res.end();
  }

  // Refresh propio con streaming — los 3 scrapers + cotización arrancan en paralelo
  const usdRateP = getUsdRate();
  const streamedCars = [];
  const sources = { romera: 0, autobiliaria: 0, tiendacars: 0 };

  await Promise.allSettled([
    scrapeRomera(usdRateP).then(cars => {
      const ok = cars.filter(c => c.price > 500 && c.price < 1_000_000);
      streamedCars.push(...ok);
      sources.romera = ok.length;
      send({ type: 'partial', source: 'romera', cars: ok, total: streamedCars.length });
    }).catch(e => {
      console.warn('[Stream] Romera error:', e.message);
      send({ type: 'source_error', source: 'romera' });
    }),

    scrapeAutobiliaria(usdRateP).then(cars => {
      const ok = cars.filter(c => c.price > 500 && c.price < 1_000_000);
      streamedCars.push(...ok);
      sources.autobiliaria = ok.length;
      send({ type: 'partial', source: 'autobiliaria', cars: ok, total: streamedCars.length });
    }).catch(e => {
      console.warn('[Stream] Autobiliaria error:', e.message);
      send({ type: 'source_error', source: 'autobiliaria' });
    }),

    scrapeTiendaCars(usdRateP).then(cars => {
      const ok = cars.filter(c => c.price > 500 && c.price < 1_000_000);
      streamedCars.push(...ok);
      sources.tiendacars = ok.length;
      send({ type: 'partial', source: 'tiendacars', cars: ok, total: streamedCars.length });
    }).catch(e => {
      console.warn('[Stream] TiendaCars error:', e.message);
      send({ type: 'source_error', source: 'tiendacars' });
    }),
  ]);

  const usdRate = await usdRateP.catch(() => _usdRate || 1200);

  // Enriquecer con datos de mercado antes de enviar el resultado final
  const marketIdx = await getMarketIndex(streamedCars).catch(() => buildInternalIndex(streamedCars));
  const enriched  = enrichWithMarket(streamedCars, marketIdx);
  const result = {
    cars: prioritizeBrands(enriched), total: enriched.length, usdRate, sources,
    marketSource: _mlCredentials.clientId ? 'ml' : 'internal',
    updatedAt: new Date().toISOString(),
  };

  if (enriched.length > 0) {
    _catalogCache = result;
    _catalogExpiry = Date.now() + 30 * 60_000;
    console.log(`[Stream] ${enriched.length} autos — Romera:${sources.romera} Autobiliaria:${sources.autobiliaria} TiendaCars:${sources.tiendacars} | marketSource:${result.marketSource}`);
  }

  send({ type: 'done', ...result });
  res.end();
});

app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║   ChulaCars API Server  :${PORT}          ║`);
  console.log(`╚════════════════════════════════════════╝\n`);
  console.log('Configurá tus credenciales ML en Perfil → Ajustes MercadoLibre\n');
  // Pre-cargar catálogo al iniciar para que el primer usuario no espere
  refreshCatalog().catch(e => console.error('[Startup] Error pre-cargando catálogo:', e.message));
});
