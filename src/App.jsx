import React, { useState, useEffect, useReducer, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Car, Search, Heart, User, TrendingUp, Star, Zap, Shield,
  MapPin, Calendar, Gauge, Fuel, DollarSign, Bell, Filter, ChevronRight,
  ChevronDown, ChevronUp, X, Plus, Check, AlertTriangle, Info, BarChart2,
  Settings, Eye, ArrowUpRight, ArrowDownRight, Flame, Award, Target, Clock,
  Camera, Bookmark, Share2, SlidersHorizontal, Sparkles, CheckCircle2,
  XCircle, Activity, Percent, Home, Layers, RefreshCw, Lock, Cpu,
  Navigation, BookmarkCheck, BellRing, Trash2, ChevronLeft, MoreHorizontal,
  BadgeCheck, Lightbulb, Wallet, ThumbsUp, ThumbsDown, ArrowRight
} from 'lucide-react';
import {
  BarChart, Bar, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';

// ─────────────────────────────────────────────
// STORAGE LAYER
// ─────────────────────────────────────────────
const STORAGE_KEYS = {
  favorites: 'chulacars:favorites',
  searches: 'chulacars:searches',
  history: 'chulacars:history',
  settings: 'chulacars:settings',
  alerts: 'chulacars:alerts',
  user: 'chulacars:user',
};

const Storage = {
  _cache: {},
  async get(key) {
    try {
      if (this._cache[key] !== undefined) return this._cache[key];
      if (window.storage) {
        const val = await window.storage.get({ key, shared: false });
        this._cache[key] = val;
        return val;
      }
      const item = localStorage.getItem(key);
      const val = item ? JSON.parse(item) : null;
      this._cache[key] = val;
      return val;
    } catch { return null; }
  },
  async set(key, value) {
    try {
      this._cache[key] = value;
      if (window.storage) {
        await window.storage.set({ key, value, shared: false });
        return;
      }
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { console.error('Storage error:', e); }
  },
  async init() {
    const keys = Object.values(STORAGE_KEYS);
    await Promise.all(keys.map(k => this.get(k)));
  }
};

const BRANDS = ['Toyota','Volkswagen','Ford','Chevrolet','Honda','BMW','Mercedes-Benz','Audi','Renault','Peugeot','Fiat','Nissan','Jeep','Hyundai','Dodge'];

// ─────────────────────────────────────────────
// STATE MANAGEMENT
// ─────────────────────────────────────────────
const initialState = {
  activeTab: 'inicio',
  cars: [],
  filteredCars: [],
  favorites: [],
  searchHistory: [],
  alerts: [],
  settings: { apiKey: '', capital: '', minMargin: '10', riskLevel: 'medium', notifications: true },
  user: { name: 'Julián', searches: 0, analyzed: 0, saved: 0 },
  isLoading: false,
  selectedCar: null,
  filters: {
    search: '', brand: '', minYear: '', maxYear: '',
    maxKm: '', minPrice: '', maxPrice: '', province: '',
    fuel: '', transmission: '', minScore: '', sortBy: 'score',
    onlyUrgent: false, onlyVerified: false,
  },
  ui: { showFilters: false, showAiPanel: false, analysisLoading: false },
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_TAB': return { ...state, activeTab: action.payload };
    case 'SET_SELECTED_CAR': return { ...state, selectedCar: action.payload };
    case 'TOGGLE_FAVORITE': {
      const id = action.payload;
      const isFav = state.favorites.includes(id);
      const favorites = isFav ? state.favorites.filter(f => f !== id) : [...state.favorites, id];
      return { ...state, favorites };
    }
    case 'SET_FILTER': {
      const filters = { ...state.filters, [action.key]: action.value };
      const filteredCars = applyFilters(state.cars, filters);
      return { ...state, filters, filteredCars };
    }
    case 'CLEAR_FILTERS': {
      const filters = { ...initialState.filters };
      return { ...state, filters, filteredCars: state.cars };
    }
    case 'SET_CARS': {
      const filteredCars = applyFilters(action.payload, state.filters);
      return { ...state, cars: action.payload, filteredCars };
    }
    case 'SET_LOADING': return { ...state, isLoading: action.payload };
    case 'SET_UI': return { ...state, ui: { ...state.ui, ...action.payload } };
    case 'UPDATE_SETTINGS': return { ...state, settings: { ...state.settings, ...action.payload } };
    case 'LOAD_STORAGE': return { ...state, ...action.payload };
    default: return state;
  }
}

function applyFilters(cars, filters) {
  return cars.filter(car => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!`${car.brand} ${car.model} ${car.version} ${car.city}`.toLowerCase().includes(q)) return false;
    }
    if (filters.brand && car.brand !== filters.brand) return false;
    if (filters.minYear && car.year < parseInt(filters.minYear)) return false;
    if (filters.maxYear && car.year > parseInt(filters.maxYear)) return false;
    if (filters.maxKm && car.km > parseInt(filters.maxKm)) return false;
    if (filters.minPrice && car.price < parseInt(filters.minPrice)) return false;
    if (filters.maxPrice && car.price > parseInt(filters.maxPrice)) return false;
    if (filters.province && car.province !== filters.province) return false;
    if (filters.fuel && car.fuel !== filters.fuel) return false;
    if (filters.transmission && car.transmission !== filters.transmission) return false;
    if (filters.minScore && car.overallScore < parseInt(filters.minScore)) return false;
    if (filters.onlyUrgent && !car.urgent) return false;
    if (filters.onlyVerified && !car.verified) return false;
    return true;
  }).sort((a, b) => {
    switch (filters.sortBy) {
      case 'score': return b.overallScore - a.overallScore;
      case 'price_asc': return a.price - b.price;
      case 'price_desc': return b.price - a.price;
      case 'margin': return b.margin - a.margin;
      case 'profit': return b.profit - a.profit;
      case 'recent': return a.daysListed - b.daysListed;
      default: return b.overallScore - a.overallScore;
    }
  });
}

// ─────────────────────────────────────────────
// AI UTILITIES
// ─────────────────────────────────────────────
const OPENAI_KEY = import.meta.env.VITE_OPENAI_KEY || '';

const AI = {
  async _call(messages, maxTokens = 400) {
    const key = Storage._cache[STORAGE_KEYS.settings]?.apiKey || OPENAI_KEY;
    if (!key) throw new Error('API key de OpenAI no configurada.');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o', messages, max_tokens: maxTokens }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message || `OpenAI error ${res.status}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  },

  async analyze(car) {
    try {
      const below = car.marketAvg > car.price
        ? `El precio está ${((car.marketAvg - car.price) / car.marketAvg * 100).toFixed(1)}% por debajo del promedio de mercado (USD ${car.marketAvg}).`
        : `El precio está al nivel del mercado.`;
      return await this._call([
        { role: 'system', content: 'Eres un experto en compra y venta de autos usados en Argentina. Responde en español, de forma concisa y directa. Máximo 3 oraciones.' },
        { role: 'user', content: `Analiza esta oportunidad: ${car.brand} ${car.model} ${car.version || ''}, ${car.year}, ${car.km.toLocaleString()}km, USD ${car.price.toLocaleString()}. ${below} Plataforma: ${car.platform}. Provincia: ${car.province}.` },
      ]);
    } catch {
      return car.aiSummary;
    }
  },

  async analyzeText(rawText) {
    try {
      // GPT extrae datos cualitativos y el precio; las métricas numéricas se calculan acá
      const json = await this._call([
        {
          role: 'system',
          content: `Eres un experto en autos usados en Argentina. Analiza el texto y devuelve SOLO un JSON válido con esta estructura (sin texto extra):
{"brand":"Toyota","model":"Corolla","version":"XEI 2.0","year":2020,"km":45000,"price":23500,"currency":"USD","city":"Buenos Aires","province":"Buenos Aires","fuel":"Nafta","transmission":"Automático","owners":1,"marketAvg":27000,"aiSummary":"Resumen del análisis en 2 oraciones.","positives":["Punto 1","Punto 2"],"negatives":["Punto 1"]}`
        },
        { role: 'user', content: `Analiza esta publicación:\n\n${rawText}` },
      ], 600);
      const raw = JSON.parse(json.replace(/```json\n?|\n?```/g, '').trim());

      // Calcular todas las métricas desde datos reales, sin depender de GPT
      const km = raw.km || 0;
      const year = raw.year || new Date().getFullYear() - 3;
      const price = raw.price || 0;
      const marketAvg = raw.marketAvg && raw.marketAvg > price ? raw.marketAvg : Math.round(price * 1.1);
      const margin = marketAvg > price && price > 0
        ? parseFloat(((marketAvg - price) / marketAvg * 100).toFixed(1)) : 0;
      const profit = Math.max(0, Math.round((marketAvg - price) * 0.85));

      const kmScore = km < 30000 ? 95 : km < 60000 ? 85 : km < 100000 ? 72 : 55;
      const yearScore = year >= 2022 ? 95 : year >= 2019 ? 85 : year >= 2016 ? 72 : 56;
      const marginScore = Math.min(100, 50 + margin * 3);
      const overallScore = Math.round((kmScore + yearScore + marginScore) / 3);
      const investmentScore = margin > 15 ? 5 : margin > 10 ? 4 : margin > 5 ? 3 : margin > 0 ? 2 : 1;

      const yearBaseV = year >= 2023 ? 88 : year >= 2021 ? 80 : year >= 2019 ? 72 : year >= 2017 ? 62 : year >= 2015 ? 52 : 40;
      const kmPenaltyV = km < 30000 ? 0 : km < 60000 ? 6 : km < 100000 ? 14 : km < 150000 ? 24 : 35;
      const visualScore = Math.min(97, Math.max(20, yearBaseV - kmPenaltyV));

      const kmBaseM = km < 30000 ? 90 : km < 60000 ? 82 : km < 100000 ? 70 : km < 150000 ? 55 : 38;
      const yearBonusM = year >= 2022 ? 5 : year >= 2019 ? 2 : year >= 2016 ? 0 : -4;
      const fuelBonusM = (raw.fuel || '').toLowerCase().includes('diesel') ? 3 : 0;
      const mechanicalScore = Math.min(97, Math.max(20, kmBaseM + yearBonusM + fuelBonusM));

      const isUrgent = /\b(urgent|vendo|ofert|apuro|liquido|remato)\b/i.test(rawText);

      return {
        ...raw,
        marketAvg, margin, profit,
        investmentScore, overallScore,
        risk: margin > 15 ? 'low' : margin > 8 ? 'medium' : 'high',
        speed: km < 60000 && year >= 2019 ? 'fast' : km < 100000 ? 'medium' : 'slow',
        urgent: isUrgent,
        verified: false,
        visualScore, mechanicalScore,
        urgencyScore: isUrgent ? 85 : 50,
        tags: [raw.fuel, raw.transmission, `${year}`].filter(Boolean).slice(0, 3),
        daysListed: 1,
      };
    } catch (err) {
      console.error('AI text parse error:', err);
      return null;
    }
  },
};

// ─────────────────────────────────────────────
// CATALOG API (concesionarias reales)
// ─────────────────────────────────────────────
const CATALOG_API = {
  transform(items) {
    if (!items.length) return [];

    const platformColors = {
      'Romera Hermanos': 'from-blue-900/40 to-slate-900/60',
      'Autobiliaria':    'from-emerald-900/40 to-slate-900/60',
      'Tienda Cars':     'from-purple-900/40 to-slate-900/60',
    };

    return items.map((item, idx) => {
      const km   = item.km   || 0;
      const year = item.year || new Date().getFullYear() - 3;

      // ── Usar datos del servidor si ya vienen enriquecidos ──────────────────
      // El servidor calcula marketAvg, margin, netProfit, investmentScore,
      // overallScore, risk, speed con datos reales de ML o índice interno.
      // Solo recalculamos lo que el servidor NO provee (scores visuales/mecánicos).

      const marketAvg      = item.marketAvg      || 0;
      const margin         = item.margin         ?? 0;
      const netProfit      = item.netProfit       ?? Math.max(0, Math.round((marketAvg - item.price) * 0.85));
      const grossProfit    = item.grossProfit     ?? Math.max(0, marketAvg - item.price);
      const costs          = item.costs           ?? Math.round((marketAvg - item.price - netProfit));
      const roi            = item.roi             ?? 0;
      const investmentScore = item.investmentScore ?? (margin > 15 ? 5 : margin > 10 ? 4 : margin > 5 ? 3 : margin > 0 ? 2 : 1);
      const overallScore   = item.overallScore    ?? Math.round((
        Math.min(100, 50 + margin * 2.5) * 0.40 +
        ((km < 60000 ? 90 : km < 100000 ? 75 : 55) + (year >= 2020 ? 90 : year >= 2017 ? 75 : 60)) / 2 * 0.35 +
        60 * 0.25
      ));

      // ── Visual score (siempre calculado en frontend, no viene del server) ──
      const yearBaseV  = year >= 2023 ? 88 : year >= 2021 ? 80 : year >= 2019 ? 72 : year >= 2017 ? 62 : year >= 2015 ? 52 : 40;
      const kmPenaltyV = km < 30000 ? 0 : km < 60000 ? 6 : km < 100000 ? 14 : km < 150000 ? 24 : 35;
      const visualScore = Math.min(97, Math.max(20, yearBaseV - kmPenaltyV + (item.thumbnail ? 4 : 0)));

      // ── Mechanical score ────────────────────────────────────────────────────
      const kmBaseM      = km < 30000 ? 90 : km < 60000 ? 82 : km < 100000 ? 70 : km < 150000 ? 55 : 38;
      const yearBonusM   = year >= 2022 ? 5 : year >= 2019 ? 2 : year >= 2016 ? 0 : -4;
      const fuelBonusM   = (item.fuel || '').toLowerCase().includes('diesel') ? 3 : 0;
      const mechanicalScore = Math.min(97, Math.max(20, kmBaseM + yearBonusM + fuelBonusM));

      // ── Textos automáticos ─────────────────────────────────────────────────
      const marketSrc = item.marketSource === 'ml' ? 'MercadoLibre' : 'catálogo';
      const kmLabel = item.kmEstimated && km > 0 ? `~${fmt.km(km)} (est.)` : km > 0 ? fmt.km(km) : '';
      const aiSummary = netProfit > 0 && !item.marginSuspect
        ? `Publicación de ${item.platform}. ${margin > 0 ? `~${margin.toFixed(1)}% por debajo del mercado (fuente: ${marketSrc}).` : 'Precio competitivo.'} Ganancia neta estimada: ${fmt.usd(netProfit)} tras costos. ${kmLabel ? kmLabel + ' · ' : ''}${year}.`
        : item.marginSuspect
          ? `Publicación de ${item.platform}. Margen elevado — referencia de mercado con pocos datos (${marketSrc}). Verificar precio en persona. ${kmLabel ? kmLabel + ' · ' : ''}${year}.`
          : `Publicación de ${item.platform}. Precio al nivel del mercado (${marketSrc}). ${kmLabel ? kmLabel + ' · ' : ''}${year}. Verificar en persona.`;

      return {
        ...item,
        id:   item.id || `catalog-${idx}`,
        marketAvg, margin,
        profit: netProfit,   // backward compat con el UI que usa "profit"
        netProfit, grossProfit, costs, roi,
        investmentScore,
        overallScore: Math.min(99, Math.max(10, overallScore)),
        risk:  item.risk  || (netProfit > 2000 ? 'low' : netProfit > 0 ? 'medium' : 'high'),
        speed: item.speed || (km < 60000 && year >= 2019 ? 'fast' : km < 100000 ? 'medium' : 'slow'),
        tags:  [item.platform, km > 0 ? `${Math.round(km / 1000)}k km` : '', `${year}`].filter(Boolean).slice(0, 3),
        bgColor: platformColors[item.platform] || 'from-blue-900/40 to-slate-900/60',
        aiSummary,
        positives: [
          netProfit > 1500  ? `Ganancia neta estimada: ${fmt.usd(netProfit)}` : (margin > 5 ? `${margin.toFixed(1)}% bajo el mercado` : 'Precio competitivo'),
          item.verified ? `Concesionaria verificada (${item.platform})` : 'Publicación verificada',
          km < 60000 ? 'Bajo kilometraje' : km < 100000 ? 'Kilometraje razonable' : 'Kilometraje alto',
        ].filter(Boolean).slice(0, 3),
        negatives: [
          costs > 0 ? `Costos de entrada estimados: ${fmt.usd(costs)}` : 'Confirmar estado en persona',
          item.marginSuspect ? 'Margen elevado — verificar precio real' : null,
          item.kmEstimated ? 'Kilometraje estimado (no declarado)' : (km > 100000 ? 'Más de 100.000 km' : null),
          year < 2017 ? 'Vehículo con varios años' : null,
        ].filter(Boolean).slice(0, 3),
        visualScore, mechanicalScore,
        urgencyScore: item.urgent ? 90 : 50,
      };
    });
  },
};

// ─────────────────────────────────────────────
// MERCADOLIBRE API
// ─────────────────────────────────────────────
const ML_API = {
  async search(query, filters = {}) {
    const q = (query || 'auto').trim();
    const params = new URLSearchParams({ q, limit: '24' });
    if (filters.minPrice) params.append('minPrice', filters.minPrice);
    if (filters.maxPrice) params.append('maxPrice', filters.maxPrice);

    const res = await fetch(`/api/ml/search?${params}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const err = new Error(errData.error || `Error ${res.status} del servidor`);
      if (errData.code) err.code = errData.code;
      throw err;
    }
    const data = await res.json();
    return data; // { results, total, market, source }
  },

  _attrs(item) {
    const a = {};
    (item.attributes || []).forEach(x => { a[x.id] = x.value_name; });
    return a;
  },

  transform(items, marketStats = {}) {
    const usd = items.filter(i => i.currency_id === 'USD' && i.price > 0);
    const marketAvg = marketStats?.avgUsd
      || (usd.length > 2 ? usd.reduce((s, i) => s + i.price, 0) / usd.length : 0);

    return items.map(item => {
      const a = this._attrs(item);
      const km = parseInt((a.KILOMETERS || '0').replace(/\D/g, '')) || 0;
      const year = parseInt(a.VEHICLE_YEAR) || new Date().getFullYear() - 3;
      const price = item.price || 0;
      const currency = item.currency_id === 'USD' ? 'USD' : 'ARS';
      const avg = currency === 'USD' && marketAvg > 0 ? marketAvg : price * 1.1;
      const margin = avg > price ? parseFloat(((avg - price) / avg * 100).toFixed(1)) : 0;
      const profit = Math.max(0, Math.round((avg - price) * 0.85));

      const kmScore = km < 30000 ? 95 : km < 60000 ? 85 : km < 100000 ? 72 : 55;
      const yearScore = year >= 2022 ? 95 : year >= 2019 ? 85 : year >= 2016 ? 72 : 56;
      const marginScore = Math.min(100, 50 + margin * 3);
      const overallScore = Math.round((kmScore + yearScore + marginScore) / 3);
      const investmentScore = margin > 15 ? 5 : margin > 10 ? 4 : margin > 5 ? 3 : margin > 0 ? 2 : 1;

      const isUrgent = /\b(urgent|vendo|ofert|apuro|liquido|remato)\b/i.test(item.title);

      // Visual score: estado estético estimado por año y km
      const yearBaseV = year >= 2023 ? 88 : year >= 2021 ? 80 : year >= 2019 ? 72 : year >= 2017 ? 62 : year >= 2015 ? 52 : 40;
      const kmPenaltyV = km < 30000 ? 0 : km < 60000 ? 6 : km < 100000 ? 14 : km < 150000 ? 24 : 35;
      const visualScore = Math.min(97, Math.max(20, yearBaseV - kmPenaltyV + (item.thumbnail ? 4 : 0)));

      // Mechanical score: confiabilidad mecánica por km, año y combustible
      const fuelRaw = (a.FUEL_TYPE || '').toLowerCase();
      const kmBaseM = km < 30000 ? 90 : km < 60000 ? 82 : km < 100000 ? 70 : km < 150000 ? 55 : 38;
      const yearBonusM = year >= 2022 ? 5 : year >= 2019 ? 2 : year >= 2016 ? 0 : -4;
      const fuelBonusM = fuelRaw.includes('diesel') ? 3 : 0;
      const mechanicalScore = Math.min(97, Math.max(20, kmBaseM + yearBonusM + fuelBonusM));

      return {
        id: item.id,
        brand: a.BRAND || item.title.split(' ')[0] || 'Sin marca',
        model: a.MODEL || item.title.split(' ').slice(0, 2).join(' '),
        version: a.TRIM || item.title,
        year, km, price, marketAvg: avg, currency,
        province: item.location?.state?.name || 'Buenos Aires',
        city: item.location?.city?.name || 'CABA',
        neighborhood: '',
        fuel: a.FUEL_TYPE || 'Nafta',
        transmission: a.TRANSMISSION || 'Manual',
        color: a.COLOR || 'No especificado',
        owners: parseInt(a.VEHICLE_OWNER_COUNT) || 1,
        platform: 'MercadoLibre',
        daysListed: 1,
        urgent: isUrgent,
        verified: !!item.official_store_id,
        thumbnail: item.thumbnail,
        url: item.permalink,
        investmentScore, overallScore, margin, profit,
        risk: margin > 15 ? 'low' : margin > 8 ? 'medium' : 'high',
        speed: km < 60000 && year >= 2019 ? 'fast' : km < 100000 ? 'medium' : 'slow',
        tags: [a.FUEL_TYPE, a.TRANSMISSION, `${year}`].filter(Boolean).slice(0, 3),
        bgColor: 'from-blue-900/40 to-slate-900/60',
        aiSummary: margin > 8
          ? `Publicación ML con ~${margin.toFixed(1)}% margen potencial respecto al promedio del lote. ${km > 0 ? fmt.km(km) + ' · ' : ''}${year}.`
          : `Publicación de MercadoLibre. Precio al nivel del mercado. ${km > 0 ? fmt.km(km) + ' · ' : ''}${year}.`,
        positives: margin > 10 ? ['Por debajo del promedio del lote', 'Datos verificables en ML'] : ['Precio competitivo'],
        negatives: ['Sin análisis visual IA', 'Verificar estado mecánico en persona'],
        visualScore, mechanicalScore, urgencyScore: isUrgent ? 90 : 50,
      };
    });
  },
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const fmt = {
  usd: n => `USD ${n.toLocaleString('es-AR')}`,
  km: n => `${n.toLocaleString('es-AR')} km`,
  pct: n => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`,
};

const SCORE_CONFIG = {
  5: { label: 'Excelente', color: 'text-blue-400', bg: 'bg-blue-500/15', border: 'border-blue-500/30', glow: 'shadow-glow-blue' },
  4: { label: 'Muy Bueno', color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', glow: 'shadow-glow-green' },
  3: { label: 'Regular', color: 'text-amber-400', bg: 'bg-amber-500/15', border: 'border-amber-500/30', glow: '' },
  2: { label: 'Bajo', color: 'text-orange-400', bg: 'bg-orange-500/15', border: 'border-orange-500/30', glow: '' },
  1: { label: 'Evitar', color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/30', glow: '' },
};

const RISK_CONFIG = {
  low: { label: 'Bajo riesgo', color: 'text-emerald-400', icon: Shield },
  medium: { label: 'Riesgo medio', color: 'text-amber-400', icon: AlertTriangle },
  high: { label: 'Alto riesgo', color: 'text-red-400', icon: XCircle },
};

// ─────────────────────────────────────────────
// ATOM COMPONENTS
// ─────────────────────────────────────────────
const StarRating = ({ score, size = 14 }) => (
  <div className="flex items-center gap-0.5">
    {[1,2,3,4,5].map(i => (
      <Star key={i} size={size}
        className={i <= score ? 'fill-amber-400 text-amber-400' : 'text-slate-700'}
      />
    ))}
  </div>
);

const ScoreBadge = ({ score }) => {
  const cfg = SCORE_CONFIG[score] || SCORE_CONFIG[3];
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${cfg.bg} ${cfg.border} ${cfg.color}`}>
      <Sparkles size={10} />
      {cfg.label}
    </div>
  );
};

const RiskBadge = ({ risk }) => {
  const cfg = RISK_CONFIG[risk] || RISK_CONFIG.medium;
  const Icon = cfg.icon;
  return (
    <div className={`flex items-center gap-1 text-xs font-medium ${cfg.color}`}>
      <Icon size={11} />
      {cfg.label}
    </div>
  );
};

const PlatformBadge = ({ platform }) => {
  const colors = {
    'MercadoLibre': 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
    'Facebook Marketplace': 'bg-blue-500/15 text-blue-400 border-blue-500/25',
    'DeMotores': 'bg-purple-500/15 text-purple-400 border-purple-500/25',
    'OLX': 'bg-green-500/15 text-green-400 border-green-500/25',
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${colors[platform] || 'bg-slate-700 text-slate-400 border-slate-600'}`}>
      {platform}
    </span>
  );
};

const ScoreRing = ({ score, size = 56 }) => {
  const r = (size / 2) - 5;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 85 ? '#3B82F6' : score >= 70 ? '#10B981' : score >= 50 ? '#F59E0B' : '#EF4444';
  return (
    <svg width={size} height={size} style={{ minWidth: size }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: 'stroke-dashoffset 1s ease' }}
      />
      <text x={size/2} y={size/2 + 5} textAnchor="middle" fill="white"
        fontSize={size < 56 ? 10 : 13} fontWeight="700" fontFamily="Inter">
        {score}
      </text>
    </svg>
  );
};

const Skeleton = ({ className = '' }) => (
  <div className={`rounded-xl bg-white/5 shimmer-bg animate-shimmer ${className}`} />
);

const SkeletonCard = () => (
  <div className="card-base p-4 space-y-3">
    <Skeleton className="h-36 w-full rounded-xl" />
    <div className="space-y-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
    <div className="flex gap-2">
      <Skeleton className="h-7 w-20 rounded-full" />
      <Skeleton className="h-7 w-20 rounded-full" />
    </div>
  </div>
);

const EmptyState = ({ icon: Icon = Car, title, desc, action }) => (
  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
    className="flex flex-col items-center justify-center py-16 px-6 text-center">
    <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
      <Icon size={28} className="text-blue-400" />
    </div>
    <p className="text-base font-semibold text-white mb-1">{title}</p>
    <p className="text-sm text-slate-400 max-w-xs">{desc}</p>
    {action && <button onClick={action.fn} className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors">{action.label}</button>}
  </motion.div>
);

const Tag = ({ children, color = 'blue' }) => {
  const cls = {
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    slate: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cls[color] || cls.blue}`}>
      {children}
    </span>
  );
};

const GlowBtn = ({ onClick, children, className = '', variant = 'primary', size = 'md' }) => {
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500/50',
    secondary: 'bg-white/5 hover:bg-white/10 text-white border-white/10',
    danger: 'bg-red-600/80 hover:bg-red-600 text-white border-red-500/50',
    ghost: 'bg-transparent hover:bg-white/5 text-slate-400 hover:text-white border-transparent',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs rounded-xl',
    md: 'px-4 py-2 text-sm rounded-xl',
    lg: 'px-6 py-3 text-base rounded-2xl',
  };
  return (
    <button onClick={onClick}
      className={`font-semibold border transition-all duration-200 active:scale-95 ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </button>
  );
};

// ─────────────────────────────────────────────
// CAR IMAGE PLACEHOLDER
// ─────────────────────────────────────────────
const CarImagePlaceholder = ({ car, className = '', compact = false }) => {
  const [imgFailed, setImgFailed] = useState(false);
  const brandColors = {
    Toyota: ['#1B4F8A','#2563EB'], BMW: ['#1A1A2E','#4B0082'], Ford: ['#1C3D8C','#0052CC'],
    'Mercedes-Benz': ['#1A2332','#2D4A6E'], Honda: ['#8B0000','#CC0000'],
    Volkswagen: ['#003399','#0052CC'], Audi: ['#1A1A1A','#333333'],
    Renault: ['#7C3200','#B34500'], Peugeot: ['#003189','#0047CC'],
    Jeep: ['#1A4020','#2D6A35'], Chevrolet: ['#8B0000','#990000'],
    Dodge: ['#1A1A2E','#2D2D5E'], Fiat: ['#800000','#990000'],
    Nissan: ['#162F4B','#1D4070'], Hyundai: ['#002C5F','#003E85'],
  };
  const [c1, c2] = brandColors[car.brand] || ['#1a2332','#2d4a6e'];

  const Overlays = () => (
    <>
      {car.urgent && (
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full z-10">
          <Flame size={9} /> URGENTE
        </div>
      )}
      {car.verified && (
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-emerald-500/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-full z-10">
          <BadgeCheck size={9} /> Verificado
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-2 flex items-end justify-between z-10"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 100%)' }}>
        <div className="min-w-0">
          <p className="text-white/70 text-[9px] font-medium truncate">{car.brand}</p>
          <p className="text-white font-bold text-sm leading-tight truncate">{car.model}</p>
        </div>
        {!compact && (
          <div className="text-right flex-shrink-0 ml-1">
            <p className="text-white/70 text-[9px]">Score</p>
            <p className="text-white font-bold text-xs">{car.overallScore}</p>
          </div>
        )}
      </div>
    </>
  );

  if (car.thumbnail && !imgFailed) {
    return (
      <div className={`relative overflow-hidden ${className}`}>
        <img src={car.thumbnail} alt={`${car.brand} ${car.model}`}
          className="w-full h-full object-cover"
          onError={() => setImgFailed(true)} />
        <Overlays />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden flex items-end justify-between ${className}`}
      style={{ background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)` }}>
      <div className="absolute inset-0 opacity-20"
        style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, rgba(255,255,255,0.15) 0%, transparent 60%)' }} />
      <Overlays />
    </div>
  );
};

// ─────────────────────────────────────────────
// CAR CARD
// ─────────────────────────────────────────────
const CarCard = ({ car, onSelect, onFavorite, isFavorite }) => {
  const belowPct = ((car.marketAvg - car.price) / car.marketAvg * 100).toFixed(1);
  const isBelowMarket = car.price < car.marketAvg;
  return (
    <motion.div layout initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.98 }}
      className="card-base card-hover overflow-hidden cursor-pointer"
      onClick={() => onSelect(car)}>
      <CarImagePlaceholder car={car} className="h-44 w-full" />
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="text-xs text-slate-400 font-medium">{car.brand}</p>
            <h3 className="text-white font-bold text-base leading-tight">{car.model} {car.version}</h3>
          </div>
          <button onClick={e => { e.stopPropagation(); onFavorite(car.id); }}
            className="p-2 rounded-xl hover:bg-white/10 transition-colors">
            <Heart size={17} className={isFavorite ? 'fill-red-400 text-red-400' : 'text-slate-500'} />
          </button>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <StarRating score={car.investmentScore} />
          <ScoreBadge score={car.investmentScore} />
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Calendar size={11} className="text-slate-500" />
            {car.year}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Gauge size={11} className="text-slate-500" />
            {(car.km / 1000).toFixed(0)}k km
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <MapPin size={11} className="text-slate-500" />
            {car.city}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-white font-bold text-xl">{fmt.usd(car.price)}</p>
            {isBelowMarket && (
              <div className="flex items-center gap-1 mt-0.5">
                <ArrowDownRight size={11} className="text-emerald-400" />
                <p className="text-emerald-400 text-xs font-semibold">{belowPct}% bajo mercado</p>
              </div>
            )}
          </div>
          <div className="text-right">
            <p className="text-slate-400 text-[10px]">Ganancia est.</p>
            <p className="text-blue-400 font-bold text-sm">+{fmt.usd(car.profit)}</p>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
          <div className="flex gap-1.5 flex-wrap">
            {car.tags.slice(0,2).map(t => <Tag key={t}>{t}</Tag>)}
          </div>
          <div className="flex items-center gap-2">
            {car.url && (
              <a href={car.url} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-1 text-yellow-400 text-xs font-semibold hover:text-yellow-300 transition-colors">
                Ver pub. <ArrowUpRight size={11} />
              </a>
            )}
            <div className="flex items-center gap-1 text-slate-500 text-xs">
              <Clock size={10} />
              {car.daysListed}d
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// ─────────────────────────────────────────────
// OPPORTUNITY CARD (horizontal)
// ─────────────────────────────────────────────
const OpportunityCard = ({ car, rank, onSelect, onFavorite, isFavorite }) => {
  const belowPct = ((car.marketAvg - car.price) / car.marketAvg * 100).toFixed(1);
  const cfg = SCORE_CONFIG[car.investmentScore] || SCORE_CONFIG[3];
  return (
    <motion.div layout initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
      transition={{ delay: rank * 0.06 }}
      className="card-base card-hover overflow-hidden cursor-pointer"
      onClick={() => onSelect(car)}>
      <div className="flex items-stretch">
        <div className="relative w-28 flex-shrink-0">
          <CarImagePlaceholder car={car} className="h-full w-full min-h-[96px]" compact />
          <div className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">#{rank+1}</span>
          </div>
        </div>
        <div className="flex-1 p-3">
          <div className="flex items-start justify-between mb-1.5">
            <div>
              <p className="text-[10px] text-slate-500 font-medium">{car.brand} · {car.year}</p>
              <p className="text-white font-bold text-sm leading-tight">{car.model} {car.version.split(' ').slice(0,2).join(' ')}</p>
            </div>
            <button onClick={e => { e.stopPropagation(); onFavorite(car.id); }}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
              <Heart size={14} className={isFavorite ? 'fill-red-400 text-red-400' : 'text-slate-600'} />
            </button>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <StarRating score={car.investmentScore} size={11} />
            <span className={`text-[10px] font-bold ${cfg.color}`}>{cfg.label}</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-bold text-base">{fmt.usd(car.price)}</p>
              <div className="flex items-center gap-1">
                <ArrowDownRight size={10} className="text-emerald-400" />
                <p className="text-emerald-400 text-[10px] font-semibold">{belowPct}% bajo mercado</p>
              </div>
            </div>
            <div className={`px-2 py-1 rounded-xl border text-center ${cfg.bg} ${cfg.border}`}>
              <p className="text-[9px] text-slate-400">Margen</p>
              <p className={`text-xs font-bold ${cfg.color}`}>{car.margin.toFixed(1)}%</p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// ─────────────────────────────────────────────
// AI ANALYSIS PANEL
// ─────────────────────────────────────────────
const AiAnalysisPanel = ({ car, loading, onClose }) => {
  const listingUrl = car.url
    || (car.platform === 'MercadoLibre'
      ? `https://listado.mercadolibre.com.ar/${(car.brand + '-' + car.model).toLowerCase().replace(/[\s/]+/g, '-')}`
      : car.platform === 'Facebook Marketplace'
        ? `https://www.facebook.com/marketplace/category/vehicles`
        : null);
  const isDirectLink = !!car.url;

  const bars = [
    { label: 'Score Visual', value: car.visualScore, color: '#3B82F6' },
    { label: 'Score Mecánico', value: car.mechanicalScore, color: '#10B981' },
    { label: 'Urgencia Venta', value: car.urgencyScore, color: '#F59E0B' },
    { label: 'Score General', value: car.overallScore, color: '#8B5CF6' },
  ];
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="w-full sm:max-w-lg bg-[#0A1225] border border-white/10 rounded-t-3xl sm:rounded-3xl overflow-hidden max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-[#0A1225]/95 backdrop-blur-xl border-b border-white/8 p-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
              <Cpu size={15} className="text-blue-400" />
            </div>
            <div>
              <p className="text-white font-bold text-sm">Análisis IA</p>
              <p className="text-slate-400 text-xs">{car.brand} {car.model} · {car.year}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {listingUrl && (
              <a href={listingUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/15 border border-yellow-500/25 rounded-xl text-yellow-400 text-xs font-semibold hover:bg-yellow-500/25 transition-colors active:scale-95">
                {isDirectLink ? 'Ver pub.' : 'Buscar en ML'} <ArrowUpRight size={11} />
              </a>
            )}
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/10 transition-colors">
              <X size={18} className="text-slate-400" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {loading ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-4 bg-blue-500/10 rounded-2xl border border-blue-500/20">
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}>
                  <RefreshCw size={16} className="text-blue-400" />
                </motion.div>
                <p className="text-blue-300 text-sm font-medium">Analizando con IA...</p>
              </div>
              {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <>
              {listingUrl && (
                <a href={listingUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 w-full p-4 bg-yellow-500/10 border border-yellow-500/25 rounded-2xl hover:bg-yellow-500/18 transition-colors active:scale-[0.98]">
                  <div className="w-8 h-8 rounded-xl bg-yellow-400 flex items-center justify-center text-[11px] font-black text-black flex-shrink-0">ML</div>
                  <div className="flex-1 text-left">
                    <p className="text-yellow-300 text-sm font-bold">
                      {isDirectLink ? 'Ver publicación original' : `Buscar ${car.brand} ${car.model} en ML`}
                    </p>
                    <p className="text-slate-400 text-xs">
                      {isDirectLink ? 'Abre la publicación real en MercadoLibre' : 'Ver publicaciones similares en MercadoLibre'}
                    </p>
                  </div>
                  <ArrowUpRight size={16} className="text-yellow-400 flex-shrink-0" />
                </a>
              )}

              <div className="p-4 bg-blue-500/8 rounded-2xl border border-blue-500/20">
                <div className="flex items-start gap-3">
                  <Sparkles size={15} className="text-blue-400 mt-0.5 flex-shrink-0" />
                  <p className="text-slate-200 text-sm leading-relaxed">{car.aiSummary}</p>
                </div>
              </div>

              <div>
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">Scores de Análisis</p>
                <div className="space-y-3">
                  {bars.map(b => (
                    <div key={b.label}>
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-slate-300 text-xs font-medium">{b.label}</p>
                        <p className="text-white text-xs font-bold">{b.value}/100</p>
                      </div>
                      <div className="h-2 bg-white/8 rounded-full overflow-hidden">
                        <motion.div initial={{ width: 0 }} animate={{ width: `${b.value}%` }}
                          transition={{ duration: 0.8, delay: 0.2 }}
                          className="h-full rounded-full" style={{ background: b.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-emerald-500/8 rounded-2xl border border-emerald-500/20">
                  <p className="text-emerald-400 text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1">
                    <ThumbsUp size={10} /> A favor
                  </p>
                  <ul className="space-y-1.5">
                    {car.positives.map((p,i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-slate-300">
                        <CheckCircle2 size={11} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="p-3 bg-red-500/8 rounded-2xl border border-red-500/20">
                  <p className="text-red-400 text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1">
                    <ThumbsDown size={10} /> En contra
                  </p>
                  <ul className="space-y-1.5">
                    {car.negatives.map((n,i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-slate-300">
                        <XCircle size={11} className="text-red-400 mt-0.5 flex-shrink-0" />
                        {n}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="p-4 bg-white/4 rounded-2xl border border-white/8">
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">Datos de Mercado</p>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Tu precio', val: fmt.usd(car.price), color: 'text-white' },
                    { label: 'Promedio', val: fmt.usd(car.marketAvg), color: 'text-slate-300' },
                    { label: 'Ganancia est.', val: `+${fmt.usd(car.profit)}`, color: 'text-emerald-400' },
                  ].map(d => (
                    <div key={d.label} className="text-center">
                      <p className="text-slate-500 text-[10px] mb-1">{d.label}</p>
                      <p className={`text-sm font-bold ${d.color}`}>{d.val}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className={`p-3 rounded-2xl border text-center ${
                  car.risk === 'low' ? 'bg-emerald-500/10 border-emerald-500/25' :
                  car.risk === 'medium' ? 'bg-amber-500/10 border-amber-500/25' : 'bg-red-500/10 border-red-500/25'
                }`}>
                  <p className="text-slate-400 text-[10px] mb-1">Nivel de riesgo</p>
                  <RiskBadge risk={car.risk} />
                </div>
                <div className={`p-3 rounded-2xl border text-center ${
                  car.speed === 'fast' ? 'bg-blue-500/10 border-blue-500/25' :
                  car.speed === 'medium' ? 'bg-amber-500/10 border-amber-500/25' : 'bg-red-500/10 border-red-500/25'
                }`}>
                  <p className="text-slate-400 text-[10px] mb-1">Velocidad de reventa</p>
                  <p className={`text-xs font-bold ${car.speed === 'fast' ? 'text-blue-400' : car.speed === 'medium' ? 'text-amber-400' : 'text-red-400'}`}>
                    {car.speed === 'fast' ? '⚡ Rápida' : car.speed === 'medium' ? '⏱ Media' : '🐌 Lenta'}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

// ─────────────────────────────────────────────
// FILTER PANEL
// ─────────────────────────────────────────────
const FilterPanel = ({ filters, dispatch, onClose }) => {
  const InputRow = ({ label, children }) => (
    <div>
      <p className="text-slate-400 text-xs font-semibold mb-1.5">{label}</p>
      {children}
    </div>
  );
  const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500/50 transition-colors";
  const selectCls = inputCls + " appearance-none";
  const set = (key, val) => dispatch({ type: 'SET_FILTER', key, value: val });

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end bg-black/70 backdrop-blur-sm"
      onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="w-full bg-[#0A1225] border-t border-white/10 rounded-t-3xl max-h-[88vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-[#0A1225]/95 backdrop-blur-xl border-b border-white/8 p-4 flex items-center justify-between">
          <p className="text-white font-bold text-base">Filtros</p>
          <div className="flex items-center gap-2">
            <button onClick={() => dispatch({ type: 'CLEAR_FILTERS' })}
              className="text-blue-400 text-sm font-semibold hover:text-blue-300 transition-colors">
              Limpiar
            </button>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/10 transition-colors">
              <X size={18} className="text-slate-400" />
            </button>
          </div>
        </div>
        <div className="p-4 space-y-4">
          <InputRow label="Marca">
            <select value={filters.brand} onChange={e => set('brand', e.target.value)} className={selectCls}>
              <option value="">Todas las marcas</option>
              {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </InputRow>
          <div className="grid grid-cols-2 gap-3">
            <InputRow label="Año desde">
              <input type="number" placeholder="2015" value={filters.minYear} onChange={e => set('minYear', e.target.value)} className={inputCls} />
            </InputRow>
            <InputRow label="Año hasta">
              <input type="number" placeholder="2024" value={filters.maxYear} onChange={e => set('maxYear', e.target.value)} className={inputCls} />
            </InputRow>
          </div>
          <InputRow label="Km máximos">
            <select value={filters.maxKm} onChange={e => set('maxKm', e.target.value)} className={selectCls}>
              <option value="">Sin límite</option>
              {[30000,50000,80000,100000,150000].map(v => <option key={v} value={v}>{(v/1000)}k km</option>)}
            </select>
          </InputRow>
          <div className="grid grid-cols-2 gap-3">
            <InputRow label="Precio mín (USD)">
              <input type="number" placeholder="5000" value={filters.minPrice} onChange={e => set('minPrice', e.target.value)} className={inputCls} />
            </InputRow>
            <InputRow label="Precio máx (USD)">
              <input type="number" placeholder="50000" value={filters.maxPrice} onChange={e => set('maxPrice', e.target.value)} className={inputCls} />
            </InputRow>
          </div>
          <InputRow label="Provincia">
            <select value={filters.province} onChange={e => set('province', e.target.value)} className={selectCls}>
              <option value="">Todas</option>
              {['Buenos Aires','Córdoba','Santa Fe','Mendoza','Rosario'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </InputRow>
          <div className="grid grid-cols-2 gap-3">
            <InputRow label="Combustible">
              <select value={filters.fuel} onChange={e => set('fuel', e.target.value)} className={selectCls}>
                <option value="">Todos</option>
                {['Nafta','Diesel','Híbrido','Eléctrico','GNC'].map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </InputRow>
            <InputRow label="Transmisión">
              <select value={filters.transmission} onChange={e => set('transmission', e.target.value)} className={selectCls}>
                <option value="">Todas</option>
                <option value="Automático">Automático</option>
                <option value="Manual">Manual</option>
                <option value="CVT">CVT</option>
              </select>
            </InputRow>
          </div>
          <InputRow label="Score IA mínimo">
            <select value={filters.minScore} onChange={e => set('minScore', e.target.value)} className={selectCls}>
              <option value="">Todos</option>
              <option value="80">80+ (Excelente)</option>
              <option value="70">70+ (Muy bueno)</option>
              <option value="60">60+ (Bueno)</option>
            </select>
          </InputRow>
          <InputRow label="Ordenar por">
            <select value={filters.sortBy} onChange={e => set('sortBy', e.target.value)} className={selectCls}>
              <option value="score">Mayor score IA</option>
              <option value="margin">Mayor margen %</option>
              <option value="profit">Mayor ganancia</option>
              <option value="price_asc">Menor precio</option>
              <option value="price_desc">Mayor precio</option>
              <option value="recent">Más recientes</option>
            </select>
          </InputRow>
          <div className="space-y-3 pt-2">
            {[
              { key: 'onlyUrgent', label: 'Solo urgentes', desc: 'Publicaciones con urgencia de venta' },
              { key: 'onlyVerified', label: 'Solo verificados', desc: 'Publicaciones con verificación' },
            ].map(({ key, label, desc }) => (
              <button key={key} onClick={() => set(key, !filters[key])}
                className="w-full flex items-center justify-between p-3 bg-white/4 hover:bg-white/8 border border-white/8 rounded-2xl transition-colors">
                <div className="text-left">
                  <p className="text-white text-sm font-semibold">{label}</p>
                  <p className="text-slate-400 text-xs">{desc}</p>
                </div>
                <div className={`w-11 h-6 rounded-full transition-colors relative ${filters[key] ? 'bg-blue-600' : 'bg-white/10'}`}>
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${filters[key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
              </button>
            ))}
          </div>
          <GlowBtn onClick={onClose} className="w-full" size="lg">
            Aplicar filtros
          </GlowBtn>
        </div>
      </motion.div>
    </motion.div>
  );
};


// ─────────────────────────────────────────────
// STAT CARD
// ─────────────────────────────────────────────
const StatCard = ({ icon: Icon, label, value, sub, color = 'blue' }) => {
  const colorMap = {
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  };
  return (
    <div className="card-base p-4">
      <div className={`w-9 h-9 rounded-xl border flex items-center justify-center mb-3 ${colorMap[color]}`}>
        <Icon size={16} />
      </div>
      <p className="text-white font-bold text-2xl mb-0.5">{value}</p>
      <p className="text-slate-400 text-xs">{label}</p>
      {sub && <p className="text-slate-500 text-[10px] mt-1">{sub}</p>}
    </div>
  );
};

// ─────────────────────────────────────────────
// SCREENS
// ─────────────────────────────────────────────
const pageVariants = {
  initial: { opacity: 0, y: 16 },
  in: { opacity: 1, y: 0 },
  out: { opacity: 0, y: -8 },
};
const pageTransition = { type: 'tween', ease: [0.4, 0, 0.2, 1], duration: 0.28 };

// ─── DASHBOARD ───────────────────────────────
const DashboardScreen = ({ state, dispatch }) => {
  const { cars, favorites } = state;
  const topOpps = useMemo(() => [...cars].sort((a,b) => b.overallScore - a.overallScore).slice(0,3), [cars]);
  const todayStats = useMemo(() => ({
    total: cars.length,
    analyzed: cars.length,
    avgMargin: cars.length ? (cars.reduce((s,c) => s + c.margin, 0) / cars.length).toFixed(1) : '0',
    bestProfit: cars.length ? Math.max(...cars.map(c => c.profit)) : 0,
  }), [cars]);

  return (
    <motion.div variants={pageVariants} initial="initial" animate="in" exit="out" transition={pageTransition}
      className="min-h-full pb-24">
      {/* Hero */}
      <div className="relative overflow-hidden mx-4 mt-4 rounded-3xl p-6"
        style={{ background: 'linear-gradient(135deg, #1D4ED8 0%, #3B82F6 50%, #6366F1 100%)' }}>
        <div className="absolute inset-0 opacity-20"
          style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, white 0%, transparent 60%)' }} />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 bg-white/20 rounded-xl flex items-center justify-center">
              <Sparkles size={14} className="text-white" />
            </div>
            <span className="text-blue-100 text-xs font-semibold">IA activa · Analizando mercado</span>
          </div>
          <h1 className="text-white font-black text-2xl leading-tight mb-1">
            Hola, {state.user.name} 👋
          </h1>
          <p className="text-blue-100 text-sm mb-5">
            {cars.length === 0
              ? <span className="font-bold text-white">Cargando publicaciones reales...</span>
              : <><span className="font-bold text-white">{topOpps.length} oportunidades reales</span> de concesionarias de Mar del Plata</>
            }
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => dispatch({ type: 'SET_TAB', payload: 'oportunidades' })}
              className="flex items-center gap-2 bg-white text-blue-700 font-bold text-sm px-4 py-2.5 rounded-2xl hover:bg-blue-50 transition-colors active:scale-95">
              <Zap size={14} />
              Ver oportunidades
            </button>
            <button onClick={() => dispatch({ type: 'SET_TAB', payload: 'buscar' })}
              className="flex items-center gap-2 bg-white/15 text-white font-semibold text-sm px-4 py-2.5 rounded-2xl hover:bg-white/25 transition-colors active:scale-95">
              <Search size={14} />
              Buscar
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 mt-4 grid grid-cols-2 gap-3">
        <StatCard icon={BarChart2} label="Publicaciones cargadas" value={todayStats.total.toLocaleString()} color="blue" />
        <StatCard icon={Percent} label="Margen promedio" value={`${todayStats.avgMargin}%`} color="green" />
        <StatCard icon={DollarSign} label="Mejor ganancia est." value={fmt.usd(todayStats.bestProfit)} color="amber" />
        <StatCard icon={Target} label="Fuentes activas" value="3" color="purple" sub="Romera · Autobiliaria · TiendaCars" />
      </div>

      {/* Top Opportunities */}
      <div className="px-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-white font-bold text-base">Mejores Oportunidades</h2>
            <p className="text-slate-400 text-xs">Curadas por IA hoy</p>
          </div>
          <button onClick={() => dispatch({ type: 'SET_TAB', payload: 'oportunidades' })}
            className="flex items-center gap-1 text-blue-400 text-xs font-semibold hover:text-blue-300 transition-colors">
            Ver todas <ChevronRight size={13} />
          </button>
        </div>
        <div className="space-y-3">
          {topOpps.map((car, i) => (
            <OpportunityCard key={car.id} car={car} rank={i}
              onSelect={c => {
                dispatch({ type: 'SET_SELECTED_CAR', payload: c });
                dispatch({ type: 'SET_UI', payload: { showAiPanel: true, analysisLoading: true } });
                AI.analyze(c)
                  .then(summary => dispatch({ type: 'SET_SELECTED_CAR', payload: { ...c, aiSummary: summary } }))
                  .finally(() => dispatch({ type: 'SET_UI', payload: { analysisLoading: false } }));
              }}
              onFavorite={id => dispatch({ type: 'TOGGLE_FAVORITE', payload: id })}
              isFavorite={favorites.includes(car.id)} />
          ))}
        </div>
      </div>

      {/* Trending Tags */}
      <div className="px-4 mt-6">
        <div className="flex items-center gap-2 mb-3">
          <Flame size={15} className="text-orange-400" />
          <h2 className="text-white font-bold text-sm">Tendencias del momento</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {['Toyota Corolla','Ford Ranger 4x4','BMW Serie 3','VW Amarok V6','Hilux SRV','Golf GTI','Honda CR-V','Audi A3'].map(t => (
            <button key={t} onClick={() => { dispatch({ type: 'SET_FILTER', key: 'search', value: t }); dispatch({ type: 'SET_TAB', payload: 'buscar' }); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-blue-500/10 border border-white/8 hover:border-blue-500/25 rounded-full text-xs text-slate-300 hover:text-blue-300 transition-all">
              <TrendingUp size={10} />
              {t}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
};

// ─── Botón actualizar catálogo ────────────────
const CatalogRefreshBtn = ({ dispatch }) => {
  const [loading, setLoading] = useState(false);
  const [found, setFound] = useState(0);
  const esRef = useRef(null);

  const refresh = () => {
    if (esRef.current) esRef.current.close();
    setLoading(true);
    setFound(0);

    const es = new EventSource('/api/catalog/stream?refresh=1');
    esRef.current = es;

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'partial') {
        setFound(msg.total || 0);
      }
      if (msg.type === 'done') {
        if (msg.cars?.length) {
          dispatch({ type: 'SET_CARS', payload: CATALOG_API.transform(msg.cars) });
        }
        es.close();
        setLoading(false);
        setFound(0);
      }
      if (msg.type === 'error') {
        es.close();
        setLoading(false);
        setFound(0);
      }
    };
    es.onerror = () => { es.close(); setLoading(false); setFound(0); };
  };

  return (
    <button onClick={refresh} disabled={loading} className="flex items-center gap-1 p-1.5 rounded-xl hover:bg-white/10 transition-colors disabled:opacity-60">
      <RefreshCw size={13} className={`text-slate-400 ${loading ? 'animate-spin' : ''}`} />
      {loading && found > 0 && <span className="text-[10px] text-slate-500 tabular-nums">{found}</span>}
    </button>
  );
};

// ─── BUSCAR ───────────────────────────────────
const SearchScreen = ({ state, dispatch }) => {
  const { filteredCars, filters, favorites } = state;
  const [source, setSource] = useState('catalogo');
  const [mlResults, setMlResults] = useState([]);
  const [mlLoading, setMlLoading] = useState(false);
  const [mlError, setMlError] = useState('');
  const [mlErrorCode, setMlErrorCode] = useState('');
  const [mlSource, setMlSource] = useState('');
  const [textInput, setTextInput] = useState('');
  const [textLoading, setTextLoading] = useState(false);
  const [textResult, setTextResult] = useState(null);
  const [textError, setTextError] = useState('');
  const mlDebounce = useRef(null);

  const activeFilterCount = Object.entries(filters).filter(([k, v]) =>
    k !== 'sortBy' && k !== 'search' && v !== '' && v !== false
  ).length;

  const openCar = useCallback((car) => {
    dispatch({ type: 'SET_SELECTED_CAR', payload: car });
    dispatch({ type: 'SET_UI', payload: { showAiPanel: true, analysisLoading: true } });
    AI.analyze(car)
      .then(summary => dispatch({ type: 'SET_SELECTED_CAR', payload: { ...car, aiSummary: summary } }))
      .finally(() => dispatch({ type: 'SET_UI', payload: { analysisLoading: false } }));
  }, [dispatch]);

  const searchML = useCallback(async (q) => {
    const query = q.trim();
    if (!query) { setMlResults([]); return; }
    setMlLoading(true);
    setMlError('');
    setMlErrorCode('');
    setMlResults([]);
    setMlSource('');
    try {
      const { results: raw, market, source } = await ML_API.search(query, {
        minPrice: filters.minPrice || undefined,
        maxPrice: filters.maxPrice || undefined,
      });
      setMlSource(source || 'live');
      if (!raw?.length) {
        setMlError(`Sin resultados para "${query}" en MercadoLibre.`);
      } else {
        setMlResults(ML_API.transform(raw, market));
      }
    } catch (err) {
      if (err.code === 'NO_CREDENTIALS') {
        // Fallback: buscar en catálogo local
        setMlErrorCode('NO_CREDENTIALS');
        try {
          const params = new URLSearchParams({ q: query });
          if (filters.minPrice) params.append('minPrice', filters.minPrice);
          if (filters.maxPrice) params.append('maxPrice', filters.maxPrice);
          const r = await fetch(`/api/catalog/search?${params}`);
          const data = await r.json();
          if (data.results?.length) {
            setMlResults(CATALOG_API.transform(data.results));
            setMlSource('catalog');
          } else {
            setMlError(`Sin resultados para "${query}" en el catálogo.`);
          }
        } catch {
          setMlError(err.message);
        }
      } else {
        setMlError(err.message);
        setMlErrorCode(err.code || '');
      }
    } finally {
      setMlLoading(false);
    }
  }, [filters.minPrice, filters.maxPrice]);

  useEffect(() => {
    if (source !== 'mercadolibre') return;
    clearTimeout(mlDebounce.current);
    mlDebounce.current = setTimeout(() => searchML(filters.search || 'auto usado'), 600);
    return () => clearTimeout(mlDebounce.current);
  }, [filters.search, source, searchML]);

  const analyzeText = async () => {
    if (!textInput.trim()) return;
    setTextLoading(true);
    setTextError('');
    setTextResult(null);
    const result = await AI.analyzeText(textInput);
    if (!result) setTextError('No se pudo analizar el texto. Intentá con más información.');
    else setTextResult({ ...result, id: 'text-' + Date.now(), platform: 'Marketplace / Facebook', bgColor: 'from-blue-900/40 to-slate-900/60' });
    setTextLoading(false);
  };

  const SOURCES = [
    { id: 'catalogo', label: '🏢 Concesionarias', desc: 'Mar del Plata' },
    { id: 'mercadolibre', label: '🔍 MercadoLibre', desc: 'En tiempo real' },
    { id: 'texto', label: '📋 Analizar pub.', desc: 'Facebook / texto' },
  ];

  return (
    <motion.div variants={pageVariants} initial="initial" animate="in" exit="out" transition={pageTransition}
      className="min-h-full pb-24">
      {/* Source tabs */}
      <div className="px-4 pt-3 pb-2 flex gap-2 overflow-x-auto scrollbar-hide">
        {SOURCES.map(s => (
          <button key={s.id} onClick={() => setSource(s.id)}
            className={`flex-shrink-0 flex flex-col items-center px-4 py-2 rounded-2xl border text-xs font-semibold transition-all ${
              source === s.id
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
            }`}>
            <span>{s.label}</span>
            <span className={`text-[9px] font-normal mt-0.5 ${source === s.id ? 'text-blue-200' : 'text-slate-600'}`}>{s.desc}</span>
          </button>
        ))}
      </div>

      {/* ──── CONCESIONARIAS ──── */}
      {source === 'catalogo' && (
        <>
          <div className="sticky top-0 z-30 bg-[#060C1A]/95 backdrop-blur-xl border-b border-white/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-3 bg-white/6 border border-white/10 rounded-2xl px-4 py-3 focus-within:border-blue-500/40 transition-colors">
                <Search size={16} className="text-slate-400 flex-shrink-0" />
                <input type="text" placeholder="Buscar marca, modelo, versión..."
                  value={filters.search}
                  onChange={e => dispatch({ type: 'SET_FILTER', key: 'search', value: e.target.value })}
                  className="flex-1 bg-transparent text-white placeholder-slate-500 text-sm outline-none" />
                {filters.search && <button onClick={() => dispatch({ type: 'SET_FILTER', key: 'search', value: '' })}><X size={14} className="text-slate-400" /></button>}
              </div>
              <button onClick={() => dispatch({ type: 'SET_UI', payload: { showFilters: true } })}
                className="relative flex items-center gap-1.5 bg-white/6 border border-white/10 rounded-2xl px-3 py-3 hover:bg-white/10 transition-colors">
                <SlidersHorizontal size={16} className="text-slate-300" />
                {activeFilterCount > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-600 rounded-full text-[9px] text-white font-bold flex items-center justify-center">{activeFilterCount}</span>}
              </button>
            </div>
            <div className="flex gap-2 mt-3 overflow-x-auto scrollbar-hide pb-0.5">
              {[{val:'score',label:'⭐ Score'},{val:'margin',label:'📈 Margen'},{val:'profit',label:'💰 Ganancia'},{val:'price_asc',label:'↓ Precio'},{val:'recent',label:'🕐 Recientes'}].map(s => (
                <button key={s.val} onClick={() => dispatch({ type: 'SET_FILTER', key: 'sortBy', value: s.val })}
                  className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${filters.sortBy === s.val ? 'bg-blue-600 border-blue-500 text-white' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="px-4 pt-3">
            {/* Banner fuentes reales */}
            <div className="flex items-center gap-2 mb-3 p-3 bg-white/4 border border-white/8 rounded-2xl">
              <div className="flex -space-x-1">
                {['RH','AB','TC'].map((s,i) => (
                  <div key={i} className="w-6 h-6 rounded-full bg-blue-600 border-2 border-[#060C1A] flex items-center justify-center text-[8px] font-black text-white">{s}</div>
                ))}
              </div>
              <div className="flex-1">
                <p className="text-white text-xs font-semibold">Romera Hnos · Autobiliaria · Tienda Cars</p>
                <p className="text-slate-500 text-[10px]">Publicaciones reales de Mar del Plata</p>
              </div>
              <CatalogRefreshBtn dispatch={dispatch} />
            </div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-slate-400 text-xs"><span className="text-white font-semibold">{filteredCars.length}</span> publicaciones reales</p>
              {activeFilterCount > 0 && <button onClick={() => dispatch({ type: 'CLEAR_FILTERS' })} className="text-blue-400 text-xs font-semibold flex items-center gap-1"><X size={11} /> Limpiar</button>}
            </div>
            {filteredCars.length === 0 ? (
              <EmptyState icon={Search} title={state.cars.length === 0 ? 'Cargando publicaciones reales...' : 'Sin resultados'} desc={state.cars.length === 0 ? 'Esperá un momento mientras buscamos autos reales de las concesionarias.' : 'Intentá con otros filtros.'} action={state.cars.length > 0 ? { label: 'Limpiar filtros', fn: () => dispatch({ type: 'CLEAR_FILTERS' }) } : undefined} />
            ) : (
              <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <AnimatePresence>
                  {filteredCars.map(car => (
                    <CarCard key={car.id} car={car} onSelect={openCar}
                      onFavorite={id => dispatch({ type: 'TOGGLE_FAVORITE', payload: id })}
                      isFavorite={favorites.includes(car.id)} />
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </div>
        </>
      )}

      {/* ──── MERCADOLIBRE EN VIVO ──── */}
      {source === 'mercadolibre' && (
        <div className="px-4 pt-2">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex-1 flex items-center gap-3 bg-white/6 border border-white/10 rounded-2xl px-4 py-3 focus-within:border-yellow-500/40 transition-colors">
              <Search size={16} className="text-yellow-400 flex-shrink-0" />
              <input type="text" placeholder="Toyota Corolla, Ford Ranger, BMW..."
                value={filters.search}
                onChange={e => dispatch({ type: 'SET_FILTER', key: 'search', value: e.target.value })}
                className="flex-1 bg-transparent text-white placeholder-slate-500 text-sm outline-none" />
              {filters.search && <button onClick={() => dispatch({ type: 'SET_FILTER', key: 'search', value: '' })}><X size={14} className="text-slate-400" /></button>}
            </div>
            <button onClick={() => searchML(filters.search || 'auto usado')}
              className="p-3 bg-yellow-500/15 border border-yellow-500/30 rounded-2xl hover:bg-yellow-500/25 transition-colors">
              <RefreshCw size={16} className={`text-yellow-400 ${mlLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className={`flex items-center gap-2 mb-4 p-3 border rounded-2xl ${mlSource === 'catalog' ? 'bg-blue-500/8 border-blue-500/20' : 'bg-yellow-500/8 border-yellow-500/20'}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-black ${mlSource === 'catalog' ? 'bg-blue-400 text-white' : 'bg-yellow-400 text-black'}`}>
              {mlSource === 'catalog' ? '🏢' : 'ML'}
            </div>
            <div className="flex-1">
              <p className={`text-xs font-semibold ${mlSource === 'catalog' ? 'text-blue-200' : 'text-yellow-200'}`}>
                {mlSource === 'catalog' ? 'Buscando en catálogo local · Concesionarias MdP' : 'MercadoLibre Argentina · Autos y Camionetas'}
              </p>
              <p className={`text-[10px] mt-0.5 ${mlSource === 'catalog' ? 'text-slate-400' : 'text-emerald-400'}`}>
                {mlSource === 'catalog' ? 'Conectá ML en Perfil para buscar en todo el país' : 'Datos reales en tiempo real'}
              </p>
            </div>
            {mlSource === 'catalog' && (
              <button onClick={() => dispatch({ type: 'SET_TAB', payload: 'perfil' })}
                className="text-[10px] text-blue-400 font-semibold px-2 py-1 bg-blue-500/15 rounded-lg hover:bg-blue-500/25 transition-colors">
                Conectar
              </button>
            )}
          </div>

          {mlLoading && (
            <div className="space-y-3">
              {[1,2,3,4].map(i => <SkeletonCard key={i} />)}
            </div>
          )}

          {mlError && !mlLoading && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl space-y-3">
              <p className="text-red-400 text-sm font-semibold">
                {mlError.startsWith('Sin resultados') ? '🔍 Sin resultados' : '⚠️ Error'}
              </p>
              <p className="text-slate-300 text-xs leading-relaxed">{mlError}</p>
              {!mlError.startsWith('Sin resultados') && (
                <div className="p-3 bg-white/4 rounded-xl border border-white/8 text-xs text-slate-400 space-y-1">
                  <p className="font-semibold text-slate-300">¿El servidor API está corriendo?</p>
                  <p>Asegurate de ejecutar <code className="text-blue-400 bg-blue-500/10 px-1 py-0.5 rounded">npm run dev</code> (no solo vite).</p>
                  <p>Esto arranca tanto el frontend como el servidor API en el puerto 3010.</p>
                </div>
              )}
              <button onClick={() => searchML(filters.search || 'auto')}
                className="text-blue-400 text-xs font-semibold hover:text-blue-300 transition-colors">
                Reintentar →
              </button>
            </div>
          )}

          {!mlLoading && !mlError && mlResults.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-slate-400 text-xs">
                  <span className="text-white font-semibold">{mlResults.length}</span> publicaciones reales
                </p>
                <div className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                  <Activity size={10} /> En vivo · MercadoLibre
                </div>
              </div>
              <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {mlResults.map(car => (
                  <CarCard key={car.id} car={car} onSelect={openCar}
                    onFavorite={id => dispatch({ type: 'TOGGLE_FAVORITE', payload: id })}
                    isFavorite={favorites.includes(car.id)} />
                ))}
              </motion.div>
            </div>
          )}

          {!mlLoading && !mlError && !mlResults.length && (
            <EmptyState icon={Search} title="Buscá algo para ver resultados"
              desc="Escribí una marca o modelo arriba para buscar en MercadoLibre en tiempo real." />
          )}
        </div>
      )}

      {/* ──── ANALIZADOR DE TEXTO (Facebook Marketplace) ──── */}
      {source === 'texto' && (
        <div className="px-4 pt-2 space-y-4">
          <div className="p-4 bg-blue-500/8 border border-blue-500/20 rounded-2xl">
            <div className="flex items-center gap-2 mb-2">
              <Cpu size={14} className="text-blue-400" />
              <p className="text-white font-semibold text-sm">Analizador IA de publicaciones</p>
            </div>
            <p className="text-slate-400 text-xs leading-relaxed">
              Pegá el texto completo de cualquier publicación de Facebook Marketplace, WhatsApp, OLX, o cualquier fuente. La IA extrae los datos y analiza la oportunidad automáticamente.
            </p>
          </div>

          <div>
            <p className="text-slate-400 text-xs font-semibold mb-2">Texto de la publicación</p>
            <textarea
              rows={8}
              placeholder={`Ejemplo:\n\nVendo Toyota Corolla XEI 2020, 45.000km, único dueño, service al día, sin accidentes. Color blanco. Precio USD 23.500. CABA. Tel: 11-XXXX-XXXX`}
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-sm placeholder-slate-600 outline-none focus:border-blue-500/50 transition-colors resize-none"
            />
          </div>

          <GlowBtn onClick={analyzeText} className="w-full" size="lg">
            {textLoading
              ? <span className="flex items-center gap-2 justify-center"><motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}><RefreshCw size={15} /></motion.span> Analizando con GPT-4o...</span>
              : <span className="flex items-center gap-2 justify-center"><Sparkles size={15} /> Analizar con IA</span>
            }
          </GlowBtn>

          {textError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-2xl text-center">
              <p className="text-red-400 text-sm">{textError}</p>
            </div>
          )}

          {textResult && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                <CheckCircle2 size={15} /> Análisis completado
              </div>
              <CarCard car={textResult} onSelect={openCar}
                onFavorite={id => dispatch({ type: 'TOGGLE_FAVORITE', payload: id })}
                isFavorite={favorites.includes(textResult.id)} />
              <div className="p-4 card-base space-y-3">
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Análisis IA detallado</p>
                <p className="text-slate-200 text-sm leading-relaxed">{textResult.aiSummary}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-emerald-500/8 rounded-2xl border border-emerald-500/20">
                    <p className="text-emerald-400 text-[10px] font-bold uppercase mb-1">A favor</p>
                    {(textResult.positives || []).map((p,i) => <p key={i} className="text-xs text-slate-300 flex items-start gap-1"><CheckCircle2 size={10} className="text-emerald-400 mt-0.5 flex-shrink-0" />{p}</p>)}
                  </div>
                  <div className="p-3 bg-red-500/8 rounded-2xl border border-red-500/20">
                    <p className="text-red-400 text-[10px] font-bold uppercase mb-1">En contra</p>
                    {(textResult.negatives || []).map((n,i) => <p key={i} className="text-xs text-slate-300 flex items-start gap-1"><XCircle size={10} className="text-red-400 mt-0.5 flex-shrink-0" />{n}</p>)}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 pt-1">
                  {[
                    { label: 'Score IA', val: `${textResult.overallScore}/100`, color: 'text-blue-400' },
                    { label: 'Margen est.', val: `${textResult.margin || 0}%`, color: 'text-emerald-400' },
                    { label: 'Ganancia est.', val: fmt.usd(textResult.profit || 0), color: 'text-amber-400' },
                  ].map(d => (
                    <div key={d.label} className="text-center p-2 bg-white/4 rounded-xl border border-white/8">
                      <p className="text-slate-500 text-[9px] mb-0.5">{d.label}</p>
                      <p className={`text-sm font-bold ${d.color}`}>{d.val}</p>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      )}
    </motion.div>
  );
};

// ─── OPORTUNIDADES ───────────────────────────
const OpportunitiesScreen = ({ state, dispatch }) => {
  const { cars, favorites } = state;
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    let list = [...cars].sort((a,b) => b.overallScore - a.overallScore);
    if (filter === 'top') list = list.filter(c => c.investmentScore === 5);
    else if (filter === 'fast') list = list.filter(c => c.speed === 'fast');
    else if (filter === 'low_risk') list = list.filter(c => c.risk === 'low');
    else if (filter === 'urgent') list = list.filter(c => c.urgent);
    return list;
  }, [cars, filter]);

  const scoreDistribution = useMemo(() => [
    { range: 'Excelente (80+)', count: cars.filter(c => c.overallScore >= 80).length, color: '#3B82F6' },
    { range: 'Bueno (60-79)',   count: cars.filter(c => c.overallScore >= 60 && c.overallScore < 80).length, color: '#10B981' },
    { range: 'Medio (40-59)',   count: cars.filter(c => c.overallScore >= 40 && c.overallScore < 60).length, color: '#F59E0B' },
    { range: 'Bajo (<40)',      count: cars.filter(c => c.overallScore < 40).length, color: '#EF4444' },
  ], [cars]);

  const tabs = [
    { id:'all', label:'Todas' },
    { id:'top', label:'⭐ Top' },
    { id:'fast', label:'⚡ Rápidas' },
    { id:'low_risk', label:'🛡 Bajo riesgo' },
    { id:'urgent', label:'🔥 Urgentes' },
  ];

  return (
    <motion.div variants={pageVariants} initial="initial" animate="in" exit="out" transition={pageTransition}
      className="min-h-full pb-24">
      {/* Banner */}
      <div className="mx-4 mt-4 p-4 rounded-2xl border"
        style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(139,92,246,0.1) 100%)', borderColor: 'rgba(59,130,246,0.2)' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-500/20 rounded-2xl flex items-center justify-center flex-shrink-0">
            <Zap size={18} className="text-blue-400" />
          </div>
          <div>
            <p className="text-white font-bold text-sm">Motor de Oportunidades IA</p>
            <p className="text-slate-400 text-xs">{cars.length} publicaciones reales — {filtered.length} oportunidades detectadas</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          {[
            { label: 'Margen promedio', val: cars.length ? `${(cars.reduce((s,c)=>s+c.margin,0)/cars.length).toFixed(1)}%` : '—', color: 'text-blue-400' },
            { label: 'Mayor ganancia', val: cars.length ? fmt.usd(Math.max(...cars.map(c=>c.profit))) : '—', color: 'text-emerald-400' },
            { label: 'Score promedio', val: cars.length ? (cars.reduce((s,c)=>s+c.overallScore,0)/cars.length).toFixed(0) : '—', color: 'text-purple-400' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <p className={`text-base font-bold ${s.color}`}>{s.val}</p>
              <p className="text-slate-500 text-[10px]">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="px-4 mt-4 flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setFilter(t.id)}
            className={`flex-shrink-0 text-xs font-semibold px-4 py-2 rounded-full border transition-all ${
              filter === t.id ? 'bg-blue-600 border-blue-500 text-white' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Score distribution bar */}
      <div className="mx-4 mt-4 p-4 card-base">
        <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">Distribución de Score</p>
        <ResponsiveContainer width="100%" height={80}>
          <BarChart data={scoreDistribution} barSize={28}>
            <XAxis dataKey="range" tick={{ fill: '#64748B', fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              formatter={v => [v, 'Publicaciones']}
              contentStyle={{ background: '#0F1A35', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 8, fontSize: 12 }}
            />
            <Bar dataKey="count" radius={[6,6,0,0]}>
              {scoreDistribution.map((d,i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* List */}
      <div className="px-4 mt-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-white font-bold text-sm">{filtered.length} oportunidades</p>
          <p className="text-slate-500 text-xs">Ordenadas por score IA</p>
        </div>
        {filtered.map((car, i) => (
          <div key={car.id} className="card-base card-hover overflow-hidden">
            <div className="flex items-stretch cursor-pointer"
              onClick={() => { dispatch({ type: 'SET_SELECTED_CAR', payload: car }); dispatch({ type: 'SET_UI', payload: { showAiPanel: true, analysisLoading: true } }); AI.analyze(car).then(s => dispatch({ type: 'SET_SELECTED_CAR', payload: { ...car, aiSummary: s } })).finally(() => dispatch({ type: 'SET_UI', payload: { analysisLoading: false } })); }}>
              <div className="relative w-24 flex-shrink-0">
                <CarImagePlaceholder car={car} className="h-full w-full min-h-[80px]" compact />
              </div>
              <div className="flex-1 p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] text-slate-500">{car.brand} · {car.year} · {car.city}</p>
                    <p className="text-white font-bold text-sm">{car.model} {car.version.split(' ').slice(0,2).join(' ')}</p>
                  </div>
                  <ScoreRing score={car.overallScore} size={40} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div>
                    <p className="text-white font-bold">{fmt.usd(car.price)}</p>
                    <p className="text-emerald-400 text-xs font-semibold">+{fmt.usd(car.profit)} est.</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StarRating score={car.investmentScore} size={12} />
                    <RiskBadge risk={car.risk} />
                  </div>
                </div>
              </div>
            </div>
            <div className="border-t border-white/5 px-3 py-2 flex items-center justify-between">
              <p className="text-slate-500 text-[10px] leading-relaxed flex-1 line-clamp-1">{car.aiSummary}</p>
              <button onClick={() => dispatch({ type: 'TOGGLE_FAVORITE', payload: car.id })}
                className="ml-2 p-1.5 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0">
                <Heart size={13} className={favorites.includes(car.id) ? 'fill-red-400 text-red-400' : 'text-slate-500'} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
};

// ─── FAVORITOS ───────────────────────────────
const FavoritesScreen = ({ state, dispatch }) => {
  const { cars, favorites } = state;
  const favCars = useMemo(() => cars.filter(c => favorites.includes(c.id)), [cars, favorites]);

  return (
    <motion.div variants={pageVariants} initial="initial" animate="in" exit="out" transition={pageTransition}
      className="min-h-full pb-24 px-4 pt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-white font-bold text-xl">Favoritos</h2>
          <p className="text-slate-400 text-xs">{favCars.length} vehículos guardados</p>
        </div>
        {favCars.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 border border-blue-500/25 rounded-full">
            <Bookmark size={12} className="text-blue-400" />
            <span className="text-blue-400 text-xs font-semibold">{favCars.length}</span>
          </div>
        )}
      </div>

      {favCars.length === 0 ? (
        <EmptyState icon={Heart} title="Sin favoritos aún"
          desc="Guardá vehículos tocando el corazón en cualquier publicación para seguirlos aquí."
          action={{ label: 'Explorar vehículos', fn: () => dispatch({ type: 'SET_TAB', payload: 'buscar' }) }} />
      ) : (
        <div className="space-y-4">
          {favCars.map((car) => (
            <motion.div key={car.id} layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              className="card-base card-hover overflow-hidden cursor-pointer"
              onClick={() => { dispatch({ type: 'SET_SELECTED_CAR', payload: car }); dispatch({ type: 'SET_UI', payload: { showAiPanel: true, analysisLoading: true } }); AI.analyze(car).then(s => dispatch({ type: 'SET_SELECTED_CAR', payload: { ...car, aiSummary: s } })).finally(() => dispatch({ type: 'SET_UI', payload: { analysisLoading: false } })); }}>
              <CarImagePlaceholder car={car} className="h-40 w-full" />
              <div className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-xs text-slate-400">{car.brand} · {car.year}</p>
                    <h3 className="text-white font-bold text-base">{car.model} {car.version}</h3>
                  </div>
                  <button onClick={e => { e.stopPropagation(); dispatch({ type: 'TOGGLE_FAVORITE', payload: car.id }); }}
                    className="p-2 rounded-xl hover:bg-red-500/10 transition-colors">
                    <Trash2 size={15} className="text-red-400" />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <div>
                    <p className="text-white font-bold text-xl">{fmt.usd(car.price)}</p>
                    <p className="text-emerald-400 text-xs font-semibold">+{fmt.usd(car.profit)} ganancia est.</p>
                  </div>
                  <div className="text-right">
                    <StarRating score={car.investmentScore} />
                    <p className="text-slate-400 text-xs mt-1">{car.city} · {car.daysListed}d publicado</p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-white/5">
                  <p className="text-slate-400 text-xs line-clamp-2">{car.aiSummary}</p>
                </div>
              </div>
            </motion.div>
          ))}

          {/* Alert suggestion */}
          <div className="p-4 bg-amber-500/8 border border-amber-500/20 rounded-2xl flex items-start gap-3">
            <BellRing size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-300 text-sm font-semibold">Activá las alertas</p>
              <p className="text-slate-400 text-xs mt-0.5">Te avisamos cuando baje el precio o se elimine alguno de tus favoritos.</p>
              <button className="mt-2 text-amber-400 text-xs font-semibold hover:text-amber-300 transition-colors">
                Configurar alertas →
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

// ─── PERFIL ───────────────────────────────────
const ProfileScreen = ({ state, dispatch }) => {
  const [showApiInput, setShowApiInput] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(state.settings.apiKey);
  const [saved, setSaved] = useState(false);
  const [showMLInput, setShowMLInput] = useState(false);
  const [mlClientId, setMlClientId] = useState('');
  const [mlClientSecret, setMlClientSecret] = useState('');
  const [mlConnecting, setMlConnecting] = useState(false);
  const [mlConnectResult, setMlConnectResult] = useState(null);
  const [mlStatus, setMlStatus] = useState(null);

  useEffect(() => {
    fetch('/api/ml/status').then(r => r.json()).then(setMlStatus).catch(() => {});
  }, []);

  const saveApiKey = async () => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: { apiKey: apiKeyInput } });
    await Storage.set(STORAGE_KEYS.settings, { ...state.settings, apiKey: apiKeyInput });
    setSaved(true);
    setTimeout(() => { setSaved(false); setShowApiInput(false); }, 1500);
  };

  const connectML = async () => {
    if (!mlClientId.trim() || !mlClientSecret.trim()) {
      setMlConnectResult({ ok: false, message: 'Completá el App ID y el Secret Key.' });
      return;
    }
    setMlConnecting(true);
    setMlConnectResult(null);
    try {
      const res = await fetch('/api/ml/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: mlClientId.trim(), clientSecret: mlClientSecret.trim() }),
      });
      const data = await res.json();
      setMlConnectResult({ ok: data.ok, message: data.message || data.error });
      if (data.ok) {
        const status = await fetch('/api/ml/status').then(r => r.json()).catch(() => null);
        if (status) setMlStatus(status);
        setTimeout(() => { setMlConnectResult(null); setShowMLInput(false); }, 2500);
      }
    } catch {
      setMlConnectResult({ ok: false, message: 'No se pudo conectar con el servidor. ¿Está corriendo npm run dev?' });
    } finally {
      setMlConnecting(false);
    }
  };

  const statItems = [
    { icon: Eye, label: 'Publicaciones analizadas', val: state.cars.length },
    { icon: Zap, label: 'Oportunidades detectadas', val: state.cars.filter(c => c.investmentScore >= 4).length },
    { icon: Heart, label: 'Guardados en favoritos', val: state.favorites.length },
    { icon: Search, label: 'Fuentes activas', val: [...new Set(state.cars.map(c => c.source).filter(Boolean))].length || 0 },
  ];

  const settingItems = [
    { icon: Lock, label: 'Clave API OpenAI', desc: state.settings.apiKey ? '●●●●●●●●' + state.settings.apiKey.slice(-4) : 'No configurada', action: () => setShowApiInput(!showApiInput), color: 'blue' },
    { icon: Wallet, label: 'Capital disponible', desc: state.settings.capital ? fmt.usd(parseInt(state.settings.capital)) : 'No configurado', action: () => {}, color: 'green' },
    { icon: Percent, label: 'Margen mínimo', desc: `${state.settings.minMargin}%`, action: () => {}, color: 'amber' },
    { icon: Bell, label: 'Notificaciones', desc: state.settings.notifications ? 'Activadas' : 'Desactivadas', action: () => dispatch({ type: 'UPDATE_SETTINGS', payload: { notifications: !state.settings.notifications } }), color: 'purple' },
  ];

  return (
    <motion.div variants={pageVariants} initial="initial" animate="in" exit="out" transition={pageTransition}
      className="min-h-full pb-24 px-4 pt-4">
      {/* Profile Header */}
      <div className="card-base p-5 mb-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black"
            style={{ background: 'linear-gradient(135deg, #2563EB, #7C3AED)' }}>
            {state.user.name[0]}
          </div>
          <div>
            <h2 className="text-white font-bold text-xl">{state.user.name}</h2>
            <p className="text-slate-400 text-sm">Inversor Automotriz</p>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex items-center gap-1 px-2.5 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full">
                <Award size={10} className="text-blue-400" />
                <span className="text-blue-400 text-[10px] font-bold">Pro</span>
              </div>
              <div className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                <CheckCircle2 size={10} className="text-emerald-400" />
                <span className="text-emerald-400 text-[10px] font-bold">Verificado</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {statItems.map(({ icon: Icon, label, val }) => (
          <div key={label} className="card-base p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-white/8 flex items-center justify-center">
              <Icon size={14} className="text-slate-300" />
            </div>
            <div>
              <p className="text-white font-bold text-base">{val}</p>
              <p className="text-slate-500 text-[10px]">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Settings */}
      <div className="mb-4">
        <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">Configuración</p>
        <div className="card-base overflow-hidden divide-y divide-white/5">
          {settingItems.map(({ icon: Icon, label, desc, action, color }) => {
            const iconBg = { blue:'bg-blue-500/10', green:'bg-green-500/10', amber:'bg-amber-500/10', purple:'bg-purple-500/10' };
            const iconTxt = { blue:'text-blue-400', green:'text-green-400', amber:'text-amber-400', purple:'text-purple-400' };
            return (
            <button key={label} onClick={action}
              className="w-full flex items-center gap-3 p-4 hover:bg-white/5 transition-colors">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${iconBg[color] || 'bg-blue-500/10'}`}>
                <Icon size={15} className={iconTxt[color] || 'text-blue-400'} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-white text-sm font-medium">{label}</p>
                <p className="text-slate-500 text-xs">{desc}</p>
              </div>
              <ChevronRight size={15} className="text-slate-600" />
            </button>
          );})}
        </div>
      </div>

      {/* MercadoLibre Settings */}
      <div className="mb-4">
        <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">Ajustes MercadoLibre</p>
        <div className="card-base overflow-hidden">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center text-xs font-black text-yellow-400">ML</div>
              <div>
                <p className="text-white text-sm font-medium">MercadoLibre Argentina</p>
                <p className={`text-xs mt-0.5 ${mlStatus?.configured ? (mlStatus.tokenValid ? 'text-emerald-400' : 'text-amber-400') : 'text-slate-500'}`}>
                  {mlStatus === null
                    ? 'Verificando...'
                    : mlStatus.configured
                      ? mlStatus.tokenValid
                        ? `✓ Conectado · Token válido ${mlStatus.tokenExpiresIn}min`
                        : '⚠ Token vencido — reconectá'
                      : 'No configurado'}
                </p>
              </div>
            </div>
            <button onClick={() => { setShowMLInput(!showMLInput); setMlConnectResult(null); }}
              className="flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors">
              {showMLInput ? 'Cerrar' : mlStatus?.configured ? 'Editar' : 'Configurar'}
              <ChevronRight size={12} className={`transition-transform ${showMLInput ? 'rotate-90' : ''}`} />
            </button>
          </div>

          <AnimatePresence>
            {showMLInput && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
                <div className="px-4 pb-4 border-t border-white/5 pt-4 space-y-3">
                  <div className="p-3 bg-blue-500/8 border border-blue-500/20 rounded-xl space-y-2">
                    <p className="text-blue-300 text-xs font-semibold">¿Cómo obtener las credenciales? (gratis)</p>
                    <div className="space-y-1.5">
                      {[
                        'Ingresá a developers.mercadolibre.com.ar',
                        'Creá una nueva aplicación',
                        'Copiá el App ID y el Secret Key',
                      ].map((s, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span className="w-4 h-4 rounded-full bg-blue-600/80 text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i+1}</span>
                          <p className="text-slate-400 text-xs">{s}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-slate-400 text-xs font-semibold mb-1.5">App ID (Client ID)</p>
                    <input type="text" placeholder="Ej: 1234567890"
                      value={mlClientId}
                      onChange={e => setMlClientId(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-500 outline-none focus:border-yellow-500/50 transition-colors"
                    />
                  </div>

                  <div>
                    <p className="text-slate-400 text-xs font-semibold mb-1.5">Secret Key (Client Secret)</p>
                    <input type="password" placeholder="●●●●●●●●●●●●●●●●"
                      value={mlClientSecret}
                      onChange={e => setMlClientSecret(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-500 outline-none focus:border-yellow-500/50 transition-colors"
                    />
                  </div>

                  <AnimatePresence>
                    {mlConnectResult && (
                      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${mlConnectResult.ok ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                        {mlConnectResult.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                        {mlConnectResult.message}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <GlowBtn onClick={connectML} className="w-full" size="md">
                    {mlConnecting
                      ? <span className="flex items-center gap-2 justify-center">
                          <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
                            <RefreshCw size={14} />
                          </motion.span>
                          Conectando...
                        </span>
                      : <span className="flex items-center gap-2 justify-center"><Zap size={14} /> Conectar MercadoLibre</span>
                    }
                  </GlowBtn>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* API Key Input */}
      <AnimatePresence>
        {showApiInput && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }} className="mb-4">
            <div className="card-base p-4 border border-blue-500/20">
              <p className="text-white font-semibold text-sm mb-1">Clave API de OpenAI</p>
              <p className="text-slate-400 text-xs mb-3">Necesaria para activar el análisis real con IA. Tu clave se guarda localmente.</p>
              <input
                type="password"
                placeholder="sk-..."
                value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-500 outline-none focus:border-blue-500/50 transition-colors mb-3"
              />
              <GlowBtn onClick={saveApiKey} className="w-full">
                {saved ? <span className="flex items-center gap-2 justify-center"><Check size={14} /> Guardado</span> : 'Guardar clave'}
              </GlowBtn>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Financial config */}
      <div className="mb-4">
        <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">Perfil Financiero</p>
        <div className="card-base p-4 space-y-4">
          <div>
            <p className="text-slate-400 text-xs font-semibold mb-1.5">Capital disponible (USD)</p>
            <input
              type="number"
              placeholder="Ej: 30000"
              value={state.settings.capital}
              onChange={e => dispatch({ type: 'UPDATE_SETTINGS', payload: { capital: e.target.value } })}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-500 outline-none focus:border-blue-500/50 transition-colors"
            />
          </div>
          <div>
            <p className="text-slate-400 text-xs font-semibold mb-1.5">Margen mínimo esperado (%)</p>
            <div className="flex gap-2">
              {['5','10','15','20','25'].map(v => (
                <button key={v}
                  onClick={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { minMargin: v } })}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${
                    state.settings.minMargin === v
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                  }`}>
                  {v}%
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-slate-400 text-xs font-semibold mb-1.5">Nivel de riesgo</p>
            <div className="flex gap-2">
              {[{ id:'low', label:'Bajo' }, { id:'medium', label:'Medio' }, { id:'high', label:'Alto' }].map(r => (
                <button key={r.id}
                  onClick={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { riskLevel: r.id } })}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${
                    state.settings.riskLevel === r.id
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                  }`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* About */}
      <div className="card-base p-4 text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-2xl flex items-center justify-center font-black text-xl"
          style={{ background: 'linear-gradient(135deg, #1D4ED8, #3B82F6)' }}>
          C
        </div>
        <p className="text-white font-bold text-base">ChulaCars</p>
        <p className="text-slate-400 text-xs mt-1">Plataforma inteligente de análisis automotriz</p>
        <p className="text-slate-600 text-[10px] mt-2">v1.0.0 · Powered by GPT-4o Vision</p>
      </div>
    </motion.div>
  );
};

// ─────────────────────────────────────────────
// BOTTOM NAV
// ─────────────────────────────────────────────
const TABS = [
  { id: 'inicio', icon: Home, label: 'Inicio' },
  { id: 'buscar', icon: Search, label: 'Buscar' },
  { id: 'oportunidades', icon: Zap, label: 'Oprtnd.' },
  { id: 'favoritos', icon: Heart, label: 'Favoritos' },
  { id: 'perfil', icon: User, label: 'Perfil' },
];

const BottomTabBar = ({ activeTab, onTabChange, favCount }) => (
  <div className="fixed bottom-0 left-0 right-0 z-40 glass-dark border-t border-white/8 safe-area-pb">
    <div className="flex items-center justify-around px-2 pt-2 pb-4 max-w-lg mx-auto">
      {TABS.map(({ id, icon: Icon, label }) => {
        const active = activeTab === id;
        return (
          <button key={id} onClick={() => onTabChange(id)}
            className="relative flex flex-col items-center gap-1 px-3 py-1 rounded-2xl transition-all active:scale-90"
            style={{ minWidth: 52 }}>
            {active && (
              <motion.div layoutId="activeTabBg"
                className="absolute inset-0 bg-blue-500/10 rounded-2xl border border-blue-500/20"
                transition={{ type: 'spring', damping: 22, stiffness: 300 }} />
            )}
            <div className="relative">
              <Icon size={20} className={active ? 'text-blue-400' : 'text-slate-500'} />
              {id === 'favoritos' && favCount > 0 && (
                <div className="absolute -top-1 -right-1.5 w-3.5 h-3.5 bg-red-500 rounded-full flex items-center justify-center">
                  <span className="text-[8px] font-bold text-white">{favCount}</span>
                </div>
              )}
            </div>
            <span className={`text-[10px] font-semibold ${active ? 'text-blue-400' : 'text-slate-500'}`}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  </div>
);

// ─────────────────────────────────────────────
// HEADER
// ─────────────────────────────────────────────
const Header = ({ activeTab }) => {
  const titles = {
    inicio: null,
    buscar: 'Buscar Vehículos',
    oportunidades: 'Oportunidades',
    favoritos: 'Mis Favoritos',
    perfil: 'Mi Perfil',
  };
  const title = titles[activeTab];
  return (
    <div className="sticky top-0 z-30 glass-dark border-b border-white/6 px-4 pt-safe">
      <div className="flex items-center justify-between py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-sm"
            style={{ background: 'linear-gradient(135deg, #1D4ED8, #3B82F6)' }}>
            C
          </div>
          {title
            ? <h1 className="text-white font-bold text-base">{title}</h1>
            : <span className="text-white font-black text-lg tracking-tight">Chula<span className="text-blue-400">Cars</span></span>
          }
        </div>
        <div className="flex items-center gap-2">
          <button className="relative p-2 rounded-xl hover:bg-white/10 transition-colors">
            <Bell size={18} className="text-slate-400" />
            <div className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-500 rounded-full" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    (async () => {
      await Storage.init();
      const [favs, savedSettings, user] = await Promise.all([
        Storage.get(STORAGE_KEYS.favorites),
        Storage.get(STORAGE_KEYS.settings),
        Storage.get(STORAGE_KEYS.user),
      ]);
      const settings = { ...initialState.settings, ...(savedSettings || {}), apiKey: OPENAI_KEY };
      await Storage.set(STORAGE_KEYS.settings, settings);
      dispatch({
        type: 'LOAD_STORAGE',
        payload: {
          favorites: favs || [],
          settings,
          user: user || initialState.user,
        }
      });
    })();
  }, []);

  // Cargar autos reales de concesionarias al iniciar
  useEffect(() => {
    fetch('/api/catalog')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        if (data?.cars?.length) {
          const transformed = CATALOG_API.transform(data.cars);
          dispatch({ type: 'SET_CARS', payload: transformed });
          console.log(`[App] ${transformed.length} autos reales cargados`);
        }
      })
      .catch(err => console.warn('[App] No se pudo cargar el catálogo:', err));
  }, []);

  // Persist favorites
  useEffect(() => {
    Storage.set(STORAGE_KEYS.favorites, state.favorites);
  }, [state.favorites]);

  // Persist settings
  useEffect(() => {
    Storage.set(STORAGE_KEYS.settings, state.settings);
  }, [state.settings]);

  const handleTabChange = useCallback(tab => dispatch({ type: 'SET_TAB', payload: tab }), []);

  const screenProps = { state, dispatch };

  return (
    <div className="min-h-screen bg-[#060C1A] bg-mesh max-w-lg mx-auto relative overflow-hidden">
      <Header activeTab={state.activeTab} />

      <main className="overflow-y-auto" style={{ height: 'calc(100vh - 57px)' }}>
        <AnimatePresence mode="wait">
          {state.activeTab === 'inicio' && <DashboardScreen key="inicio" {...screenProps} />}
          {state.activeTab === 'buscar' && <SearchScreen key="buscar" {...screenProps} />}
          {state.activeTab === 'oportunidades' && <OpportunitiesScreen key="oportunidades" {...screenProps} />}
          {state.activeTab === 'favoritos' && <FavoritesScreen key="favoritos" {...screenProps} />}
          {state.activeTab === 'perfil' && <ProfileScreen key="perfil" {...screenProps} />}
        </AnimatePresence>
      </main>

      <BottomTabBar activeTab={state.activeTab} onTabChange={handleTabChange} favCount={state.favorites.length} />

      {/* AI Analysis Modal */}
      <AnimatePresence>
        {state.ui.showAiPanel && state.selectedCar && (
          <AiAnalysisPanel
            key="ai-panel"
            car={state.selectedCar}
            loading={state.ui.analysisLoading}
            onClose={() => dispatch({ type: 'SET_UI', payload: { showAiPanel: false } })}
          />
        )}
      </AnimatePresence>

      {/* Filter Panel */}
      <AnimatePresence>
        {state.ui.showFilters && (
          <FilterPanel
            key="filters"
            filters={state.filters}
            dispatch={dispatch}
            onClose={() => dispatch({ type: 'SET_UI', payload: { showFilters: false } })}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
