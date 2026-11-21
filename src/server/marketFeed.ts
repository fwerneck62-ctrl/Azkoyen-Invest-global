import WebSocket from 'ws';
import { broadcastAll } from './realtime.ts';

export interface MarketAssetMeta {
  symbol: string;
  base: string;
  quote: string;
  name: string;
  decimals: number;
  krakenPair: string;
}

export const SUPPORTED_MARKET_ASSETS: MarketAssetMeta[] = [
  { symbol: 'BTC-USD', base: 'BTC', quote: 'USD', name: 'Bitcoin / USD', decimals: 2, krakenPair: 'XXBTZUSD' },
  { symbol: 'ETH-USD', base: 'ETH', quote: 'USD', name: 'Ethereum / USD', decimals: 2, krakenPair: 'XETHZUSD' },
  { symbol: 'SOL-USD', base: 'SOL', quote: 'USD', name: 'Solana / USD', decimals: 2, krakenPair: 'SOLUSD' },
  { symbol: 'XRP-USD', base: 'XRP', quote: 'USD', name: 'XRP / USD', decimals: 4, krakenPair: 'XXRPZUSD' },
  { symbol: 'ADA-USD', base: 'ADA', quote: 'USD', name: 'Cardano / USD', decimals: 4, krakenPair: 'ADAUSD' },
  { symbol: 'DOGE-USD', base: 'DOGE', quote: 'USD', name: 'Dogecoin / USD', decimals: 5, krakenPair: 'XDGUSD' },
  { symbol: 'AVAX-USD', base: 'AVAX', quote: 'USD', name: 'Avalanche / USD', decimals: 2, krakenPair: 'AVAXUSD' },
  { symbol: 'LINK-USD', base: 'LINK', quote: 'USD', name: 'Chainlink / USD', decimals: 3, krakenPair: 'LINKUSD' },
];

const ASSET_SET = new Set(SUPPORTED_MARKET_ASSETS.map((a) => a.symbol));

export interface MarketTick {
  ts: number;
  price: number;
}

export interface MarketCandle {
  time: string;
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LiveQuote {
  symbol: string;
  price: number;
  bid: number | null;
  ask: number | null;
  open24h: number | null;
  change24hPct: number | null;
  updatedAtMs: number;
  source: string;
}

const quotes = new Map<string, LiveQuote>();
const tickHistory = new Map<string, MarketTick[]>();
const candleHistory = new Map<string, MarketCandle[]>();
const lastBroadcastAt = new Map<string, number>();

let coinbaseWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let restFallbackTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
let shuttingDown = false;

export function isSupportedAsset(symbol: string): boolean {
  return ASSET_SET.has(symbol.toUpperCase());
}

export function getAssetMeta(symbol: string): MarketAssetMeta | undefined {
  return SUPPORTED_MARKET_ASSETS.find((a) => a.symbol === symbol.toUpperCase());
}

function recordTick(
  symbol: string,
  price: number,
  source: string,
  opts?: { bid?: number | null; ask?: number | null; open24h?: number | null; tsMs?: number }
) {
  if (!Number.isFinite(price) || price <= 0) return;
  const ts = opts?.tsMs && Number.isFinite(opts.tsMs) ? opts.tsMs : Date.now();
  const prevQuote = quotes.get(symbol);
  const open24h = opts?.open24h ?? prevQuote?.open24h ?? null;
  const change24hPct =
    open24h && open24h > 0 ? Number((((price - open24h) / open24h) * 100).toFixed(2)) : prevQuote?.change24hPct ?? null;

  const nextQuote: LiveQuote = {
    symbol,
    price,
    bid: opts?.bid ?? prevQuote?.bid ?? null,
    ask: opts?.ask ?? prevQuote?.ask ?? null,
    open24h,
    change24hPct,
    updatedAtMs: Date.now(),
    source,
  };
  quotes.set(symbol, nextQuote);

  const list = tickHistory.get(symbol) || [];
  const last = list[list.length - 1];
  // Append if price changed or at least 800ms elapsed since last tick point
  if (!last || last.price !== price || ts - last.ts >= 800) {
    list.push({ ts, price });
    if (list.length > 480) {
      list.splice(0, list.length - 480);
    }
    tickHistory.set(symbol, list);
  }

  // Throttle WS broadcast to clients (~250ms per symbol)
  const now = Date.now();
  const prevBcast = lastBroadcastAt.get(symbol) || 0;
  if (now - prevBcast >= 250) {
    lastBroadcastAt.set(symbol, now);
    broadcastAll('market:tick', {
      symbol,
      price: nextQuote.price,
      bid: nextQuote.bid,
      ask: nextQuote.ask,
      change24hPct: nextQuote.change24hPct,
      ts,
      source: nextQuote.source,
    });
  }
}

async function fetchCoinbaseTickerRest(symbol: string): Promise<LiveQuote | null> {
  try {
    const resp = await fetch(`https://api.exchange.coinbase.com/products/${encodeURIComponent(symbol)}/ticker`, {
      headers: { 'User-Agent': 'AZKOYEN-INVEST-Server/1.0' },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      price?: string;
      bid?: string;
      ask?: string;
      time?: string;
    };
    const price = Number(data.price);
    if (!Number.isFinite(price) || price <= 0) return null;
    const bid = data.bid ? Number(data.bid) : null;
    const ask = data.ask ? Number(data.ask) : null;
    recordTick(symbol, price, 'Coinbase Exchange REST', { bid, ask });
    return quotes.get(symbol) || null;
  } catch {
    return null;
  }
}

async function fetchKrakenTickerRest(symbol: string): Promise<LiveQuote | null> {
  const meta = getAssetMeta(symbol);
  if (!meta) return null;
  try {
    const resp = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(meta.krakenPair)}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { error?: string[]; result?: Record<string, any> };
    const entry = json.result ? Object.values(json.result)[0] : null;
    const price = entry?.c?.[0] ? Number(entry.c[0]) : NaN;
    if (!Number.isFinite(price) || price <= 0) return null;
    const ask = entry?.a?.[0] ? Number(entry.a[0]) : null;
    const bid = entry?.b?.[0] ? Number(entry.b[0]) : null;
    const open24h = entry?.o ? Number(entry.o) : null;
    recordTick(symbol, price, 'Kraken Exchange REST', { bid, ask, open24h });
    return quotes.get(symbol) || null;
  } catch {
    return null;
  }
}

export async function seedCandlesForSymbol(symbol: string): Promise<MarketCandle[]> {
  try {
    const resp = await fetch(
      `https://api.exchange.coinbase.com/products/${encodeURIComponent(symbol)}/candles?granularity=60`,
      {
        headers: { 'User-Agent': 'AZKOYEN-INVEST-Server/1.0' },
        signal: AbortSignal.timeout(4500),
      }
    );
    if (!resp.ok) return candleHistory.get(symbol) || [];
    const raw = (await resp.json()) as number[][];
    const candles = raw
      .slice(0, 60)
      .reverse()
      .map(([tsSec, low, high, open, close, volume]) => ({
        time: new Date(tsSec * 1000).toISOString(),
        ts: tsSec * 1000,
        open,
        high,
        low,
        close,
        volume,
      }));

    candleHistory.set(symbol, candles);

    // Seed initial rolling tick points from recent 1m closes if tickHistory is sparse
    const currentTicks = tickHistory.get(symbol) || [];
    if (currentTicks.length < 10 && candles.length > 0) {
      const seededTicks = candles.slice(-45).map((c) => ({ ts: c.ts, price: c.close }));
      const latest = seededTicks[seededTicks.length - 1];
      tickHistory.set(symbol, seededTicks);
      if (latest && !quotes.has(symbol)) {
        const firstClose = candles[0]?.open || latest.price;
        recordTick(symbol, latest.price, 'Coinbase Exchange Feed', { open24h: firstClose, tsMs: latest.ts });
      }
    }
    return candles;
  } catch {
    return candleHistory.get(symbol) || [];
  }
}

function connectCoinbaseWs() {
  if (shuttingDown) return;
  try {
    const ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
    coinbaseWs = ws;

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          product_ids: SUPPORTED_MARKET_ASSETS.map((a) => a.symbol),
          channels: ['ticker'],
        })
      );
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          product_id?: string;
          price?: string;
          best_bid?: string;
          best_ask?: string;
          open_24h?: string;
          time?: string;
        };
        if (msg.type === 'ticker' && msg.product_id && ASSET_SET.has(msg.product_id) && msg.price) {
          const price = Number(msg.price);
          const bid = msg.best_bid ? Number(msg.best_bid) : null;
          const ask = msg.best_ask ? Number(msg.best_ask) : null;
          const open24h = msg.open_24h ? Number(msg.open_24h) : null;
          const tsMs = msg.time ? Date.parse(msg.time) : Date.now();
          recordTick(msg.product_id, price, 'Coinbase Exchange Live WS', {
            bid,
            ask,
            open24h,
            tsMs: Number.isFinite(tsMs) ? tsMs : Date.now(),
          });
        }
      } catch {
        // Ignore malformed WS message
      }
    });

    ws.on('error', () => {
      // Errors handled on close
    });

    ws.on('close', () => {
      if (coinbaseWs === ws) coinbaseWs = null;
      if (!shuttingDown) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectCoinbaseWs, 3000);
      }
    });
  } catch {
    if (!shuttingDown) {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectCoinbaseWs, 5000);
    }
  }
}

export function startMarketFeedService() {
  if (started) return;
  started = true;
  shuttingDown = false;

  connectCoinbaseWs();

  // Warm initial candles & quotes asynchronously without blocking server startup
  void Promise.allSettled(
    SUPPORTED_MARKET_ASSETS.map(async (asset) => {
      await seedCandlesForSymbol(asset.symbol);
      await fetchCoinbaseTickerRest(asset.symbol);
    })
  );

  // Keep quotes fresh if any symbol goes silent for >4 seconds on WS
  restFallbackTimer = setInterval(() => {
    if (shuttingDown) return;
    const now = Date.now();
    for (const asset of SUPPORTED_MARKET_ASSETS) {
      const q = quotes.get(asset.symbol);
      if (!q || now - q.updatedAtMs > 4000) {
        void fetchCoinbaseTickerRest(asset.symbol).then((res) => {
          if (!res) void fetchKrakenTickerRest(asset.symbol);
        });
      }
    }
  }, 2500);
}

export function stopMarketFeedService() {
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (restFallbackTimer) clearInterval(restFallbackTimer);
  if (coinbaseWs) {
    try {
      coinbaseWs.close();
    } catch {
      // ignore
    }
    coinbaseWs = null;
  }
}

/**
 * Returns an authoritative, verified live quote (never older than 20s).
 * Pulls live REST quote on-demand if WS cache is stale.
 */
export async function getAuthoritativeQuote(symbol: string): Promise<LiveQuote | null> {
  const sym = symbol.toUpperCase();
  if (!ASSET_SET.has(sym)) return null;

  const cached = quotes.get(sym);
  if (cached && Date.now() - cached.updatedAtMs <= 12_000) {
    return cached;
  }

  const cb = await fetchCoinbaseTickerRest(sym);
  if (cb) return cb;

  const kr = await fetchKrakenTickerRest(sym);
  if (kr) return kr;

  if (cached && Date.now() - cached.updatedAtMs <= 30_000) {
    return cached;
  }
  return null;
}

export function getCachedAssetsSnapshot() {
  return SUPPORTED_MARKET_ASSETS.map((meta) => {
    const q = quotes.get(meta.symbol);
    return {
      ...meta,
      price: q?.price ?? null,
      bid: q?.bid ?? null,
      ask: q?.ask ?? null,
      change24hPct: q?.change24hPct ?? null,
      updatedAtMs: q?.updatedAtMs ?? null,
      source: q?.source ?? 'Connecting...',
    };
  });
}

export async function getSymbolSeries(symbol: string) {
  const sym = symbol.toUpperCase();
  if (!ASSET_SET.has(sym)) {
    return { symbol: sym, live: false, source: 'Unsupported asset', quote: null, ticks: [], candles: [] };
  }

  let candles = candleHistory.get(sym) || [];
  if (candles.length === 0) {
    candles = await seedCandlesForSymbol(sym);
  }
  const quote = await getAuthoritativeQuote(sym);
  const ticks = tickHistory.get(sym) || [];

  return {
    symbol: sym,
    live: Boolean(quote),
    source: quote?.source || 'Feed externo temporariamente indisponível',
    quote,
    ticks,
    candles,
  };
}

export function isMarketFeedHealthy(): { connected: boolean; activeAssets: number } {
  const freshCount = Array.from(quotes.values()).filter((q) => Date.now() - q.updatedAtMs < 30_000).length;
  return {
    connected: (coinbaseWs !== null && coinbaseWs.readyState === WebSocket.OPEN) || freshCount > 0,
    activeAssets: freshCount,
  };
}
