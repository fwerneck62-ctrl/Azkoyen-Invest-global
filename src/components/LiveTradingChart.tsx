import React, { useEffect, useRef, useState } from 'react';
import type { MarketTickPoint, TimedTrade } from '../types';

interface LiveTradingChartProps {
  symbol: string;
  decimals: number;
  ticks: MarketTickPoint[];
  livePrice: number | null;
  change24hPct: number | null;
  source: string;
  live: boolean;
  openTrades: TimedTrade[];
  windowSec: number;
  onWindowSecChange: (sec: number) => void;
  labels: {
    lockedLine: string;
    livePrice: string;
    winningNow: string;
    losingNow: string;
    windowLabel: string;
    feedOffline: string;
  };
}

export const LiveTradingChart: React.FC<LiveTradingChartProps> = ({
  symbol,
  decimals,
  ticks,
  livePrice,
  change24hPct,
  source,
  live,
  openTrades,
  windowSec,
  onWindowSecChange,
  labels,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Smooth clock ticker for countdown & X-axis advancement even between ticks
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  const symbolOpenTrades = openTrades.filter((tr) => tr.asset === symbol && tr.status === 'open');
  const primaryTrade = symbolOpenTrades[0] || null;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = rect.width;
      const H = rect.height;

      const padLeft = 14;
      const padRight = 88;
      const padTop = 18;
      const padBottom = 28;
      const plotW = Math.max(80, W - padLeft - padRight);
      const plotH = Math.max(80, H - padTop - padBottom);

      // Clear obsidian surface
      ctx.fillStyle = '#07080D';
      ctx.fillRect(0, 0, W, H);

      const activeTicks = ticks.filter((p) => Number.isFinite(p.price) && p.price > 0);
      const currentPrice = livePrice ?? activeTicks[activeTicks.length - 1]?.price ?? null;

      if (!currentPrice || activeTicks.length === 0) {
        ctx.fillStyle = '#71717A';
        ctx.font = '500 13px "DM Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(labels.feedOffline, padLeft + plotW / 2, padTop + plotH / 2);
        return;
      }

      // Compute visible X-axis window: 72% past/present, 28% future horizon for expiration line visibility
      const futureReserveRatio = primaryTrade ? 0.28 : 0.16;
      const maxRemainingMs = primaryTrade ? Math.max(15_000, primaryTrade.expires_at_ms - nowMs + 6000) : 0;
      const pastWindowMs = windowSec * 1000;
      const futureWindowMs = Math.max(Math.round(pastWindowMs * futureReserveRatio), maxRemainingMs);
      const tEnd = nowMs + futureWindowMs;
      const tStart = nowMs - pastWindowMs;
      const totalSpanMs = Math.max(10_000, tEnd - tStart);

      const xForTime = (ts: number) => padLeft + ((ts - tStart) / totalSpanMs) * plotW;

      // Filter points within window (keeping one anchor just before tStart for seamless left edge)
      let firstIdx = activeTicks.findIndex((p) => p.ts >= tStart);
      if (firstIdx === -1) firstIdx = Math.max(0, activeTicks.length - 1);
      else if (firstIdx > 0) firstIdx -= 1;

      const visibleTicks = activeTicks.slice(firstIdx);
      const pricesForScale = visibleTicks.map((p) => p.price);
      pricesForScale.push(currentPrice);
      for (const tr of symbolOpenTrades) {
        pricesForScale.push(tr.entry_price);
      }

      const rawMin = Math.min(...pricesForScale);
      const rawMax = Math.max(...pricesForScale);
      const spread = Math.max(rawMax - rawMin, currentPrice * 0.00045);
      const yMin = rawMin - spread * 0.24;
      const yMax = rawMax + spread * 0.24;
      const ySpan = Math.max(1e-9, yMax - yMin);

      const yForPrice = (price: number) => padTop + (1 - (price - yMin) / ySpan) * plotH;

      // Subtle gridlines
      ctx.strokeStyle = 'rgba(255,255,255,0.045)';
      ctx.lineWidth = 1;
      const hRows = 5;
      for (let i = 0; i <= hRows; i++) {
        const y = padTop + (plotH / hRows) * i;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
        ctx.stroke();

        const priceLabel = yMax - (ySpan * i) / hRows;
        ctx.fillStyle = '#71717A';
        ctx.font = '500 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(priceLabel.toFixed(decimals), padLeft + plotW + 8, y + 3);
      }

      // Vertical time gridlines
      const vCols = 5;
      for (let i = 0; i <= vCols; i++) {
        const x = padLeft + (plotW / vCols) * i;
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + plotH);
        ctx.stroke();

        const ts = tStart + (totalSpanMs * i) / vCols;
        const d = new Date(ts);
        const label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        ctx.fillStyle = '#52525B';
        ctx.font = '500 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(label, x, H - 8);
      }

      // Clip plotting area
      ctx.save();
      ctx.beginPath();
      ctx.rect(padLeft, padTop, plotW, plotH);
      ctx.clip();

      // Directional Profit / Loss Zone Shading for Primary Locked Trade
      if (primaryTrade) {
        const entryY = yForPrice(primaryTrade.entry_price);
        if (primaryTrade.direction === 'BUY') {
          ctx.fillStyle = 'rgba(16, 185, 129, 0.085)';
          ctx.fillRect(padLeft, padTop, plotW, Math.max(0, entryY - padTop));
          ctx.fillStyle = 'rgba(225, 29, 46, 0.065)';
          ctx.fillRect(padLeft, entryY, plotW, Math.max(0, padTop + plotH - entryY));
        } else {
          ctx.fillStyle = 'rgba(225, 29, 46, 0.065)';
          ctx.fillRect(padLeft, padTop, plotW, Math.max(0, entryY - padTop));
          ctx.fillStyle = 'rgba(16, 185, 129, 0.085)';
          ctx.fillRect(padLeft, entryY, plotW, Math.max(0, padTop + plotH - entryY));
        }
      }

      // Build price curve path up to current live timestamp
      const pts: Array<{ x: number; y: number; price: number; ts: number }> = visibleTicks.map((p) => ({
        x: xForTime(p.ts),
        y: yForPrice(p.price),
        price: p.price,
        ts: p.ts,
      }));
      const nowX = xForTime(nowMs);
      const liveY = yForPrice(currentPrice);
      const lastPt = pts[pts.length - 1];
      if (!lastPt || nowX > lastPt.x) {
        pts.push({ x: nowX, y: liveY, price: currentPrice, ts: nowMs });
      }

      // Determine stroke color based on primary open trade state
      let lineColor = '#F59E0B';
      let gradTop = 'rgba(245, 158, 11, 0.24)';
      if (primaryTrade) {
        const isWinning =
          primaryTrade.direction === 'BUY'
            ? currentPrice > primaryTrade.entry_price
            : currentPrice < primaryTrade.entry_price;
        lineColor = isWinning ? '#10B981' : '#E11D2E';
        gradTop = isWinning ? 'rgba(16, 185, 129, 0.25)' : 'rgba(225, 29, 46, 0.24)';
      }

      if (pts.length >= 2) {
        const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
        grad.addColorStop(0, gradTop);
        grad.addColorStop(1, 'rgba(7, 8, 13, 0)');

        ctx.beginPath();
        ctx.moveTo(pts[0].x, padTop + plotH);
        for (const p of pts) {
          ctx.lineTo(p.x, p.y);
        }
        ctx.lineTo(pts[pts.length - 1].x, padTop + plotH);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2.2;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      // Moving Horizontal Tracking Line (follows current price across the chart!)
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, liveY);
      ctx.lineTo(padLeft + plotW, liveY);
      ctx.stroke();
      ctx.restore();

      // Active Trade(s): Locked Horizontal Entry Line + Expiration Vertical Line
      for (const tr of symbolOpenTrades) {
        const entryY = yForPrice(tr.entry_price);
        const openX = Math.max(padLeft, xForTime(tr.opened_at_ms));
        const expX = xForTime(tr.expires_at_ms);
        const isBuy = tr.direction === 'BUY';
        const winning = isBuy ? currentPrice > tr.entry_price : currentPrice < tr.entry_price;
        const tradeAccent = winning ? '#10B981' : '#E11D2E';

        // Locked horizontal entry line spanning plot width
        ctx.save();
        ctx.strokeStyle = tradeAccent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padLeft, entryY);
        ctx.lineTo(padLeft + plotW, entryY);
        ctx.stroke();
        ctx.restore();

        // Vertical Expiration Line
        if (expX >= padLeft && expX <= padLeft + plotW) {
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.7)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(expX, padTop);
          ctx.lineTo(expX, padTop + plotH);
          ctx.stroke();
          ctx.restore();

          const remSec = Math.max(0, Math.ceil((tr.expires_at_ms - nowMs) / 1000));
          const expLabel = `${remSec}s`;
          ctx.fillStyle = '#F59E0B';
          ctx.fillRect(expX - 20, padTop + 4, 40, 18);
          ctx.fillStyle = '#060609';
          ctx.font = '700 10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(expLabel, expX, padTop + 16);
        }

        // Entry anchor point
        ctx.beginPath();
        ctx.arc(openX, entryY, 5, 0, Math.PI * 2);
        ctx.fillStyle = tradeAccent;
        ctx.fill();
        ctx.strokeStyle = '#060609';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Locked Line Badge inside chart left
        const badgeText = `${tr.direction === 'BUY' ? '▲ BUY' : '▼ SELL'} · ${labels.lockedLine}: ${tr.entry_price.toFixed(decimals)}`;
        ctx.font = '700 10px "JetBrains Mono", monospace';
        const tw = ctx.measureText(badgeText).width + 14;
        const bx = padLeft + 8;
        const by = Math.min(Math.max(padTop + 6, entryY - 22), padTop + plotH - 22);
        ctx.fillStyle = winning ? 'rgba(16, 185, 129, 0.92)' : 'rgba(225, 29, 46, 0.92)';
        ctx.fillRect(bx, by, tw, 18);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.fillText(badgeText, bx + 7, by + 12.5);
      }

      // Live Tip Marker
      ctx.beginPath();
      ctx.arc(nowX, liveY, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(nowX, liveY, 9, 0, Math.PI * 2);
      ctx.fillStyle = primaryTrade
        ? lineColor === '#10B981'
          ? 'rgba(16, 185, 129, 0.25)'
          : 'rgba(225, 29, 46, 0.25)'
        : 'rgba(245, 158, 11, 0.25)';
      ctx.fill();

      // Crosshair on hover
      if (hoverPos && hoverPos.x >= padLeft && hoverPos.x <= padLeft + plotW) {
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hoverPos.x, padTop);
        ctx.lineTo(hoverPos.x, padTop + plotH);
        ctx.moveTo(padLeft, hoverPos.y);
        ctx.lineTo(padLeft + plotW, hoverPos.y);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();

      // Right Axis Flags (Locked Entry Price + Live Price)
      for (const tr of symbolOpenTrades.slice(0, 2)) {
        const entryY = Math.min(Math.max(padTop + 10, yForPrice(tr.entry_price)), padTop + plotH - 10);
        const isWin = tr.direction === 'BUY' ? currentPrice > tr.entry_price : currentPrice < tr.entry_price;
        ctx.fillStyle = isWin ? '#059669' : '#BE123C';
        ctx.fillRect(padLeft + plotW + 2, entryY - 9, padRight - 4, 18);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(tr.entry_price.toFixed(decimals), padLeft + plotW + 7, entryY + 3.5);
      }

      const clampedLiveY = Math.min(Math.max(padTop + 10, liveY), padTop + plotH - 10);
      ctx.fillStyle = '#F59E0B';
      ctx.fillRect(padLeft + plotW + 2, clampedLiveY - 10, padRight - 4, 20);
      ctx.fillStyle = '#060609';
      ctx.font = '700 10.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(currentPrice.toFixed(decimals), padLeft + plotW + 7, clampedLiveY + 4);
    };

    draw();

    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [ticks, livePrice, symbolOpenTrades, windowSec, nowMs, hoverPos, decimals, primaryTrade, labels]);

  const primaryIsWinning =
    primaryTrade && livePrice !== null
      ? primaryTrade.direction === 'BUY'
        ? livePrice > primaryTrade.entry_price
        : livePrice < primaryTrade.entry_price
      : null;

  const primaryRemainingSec = primaryTrade ? Math.max(0, Math.ceil((primaryTrade.expires_at_ms - nowMs) / 1000)) : 0;

  return (
    <div className="rounded-xl bg-[#0D0F16] border border-white/[0.08] overflow-hidden flex flex-col">
      {/* Chart Header Bar */}
      <div className="px-4 py-3 border-b border-white/[0.07] bg-[#090B11] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-display font-bold text-white tracking-tight">{symbol}</span>
              <span className="text-[11px] font-mono text-zinc-400">· {source}</span>
            </div>
          </div>

          <div className="flex items-baseline gap-2.5">
            <span className="text-xl font-mono tabular-nums font-bold text-white">
              {livePrice !== null ? `$${livePrice.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}` : '—'}
            </span>
            {change24hPct !== null && (
              <span
                className={`text-xs font-mono tabular-nums font-semibold ${
                  change24hPct >= 0 ? 'text-emerald-400' : 'text-[#E11D2E]'
                }`}
              >
                {change24hPct >= 0 ? '+' : ''}
                {change24hPct.toFixed(2)}%
              </span>
            )}
          </div>

          {!live && (
            <span className="text-[11px] font-mono text-amber-400">{labels.feedOffline}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-zinc-500 mr-1">{labels.windowLabel}:</span>
          {[
            { label: '1m', sec: 60 },
            { label: '2m', sec: 120 },
            { label: '5m', sec: 300 },
          ].map((w) => (
            <button
              key={w.sec}
              type="button"
              onClick={() => onWindowSecChange(w.sec)}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                windowSec === w.sec
                  ? 'bg-[#E11D2E] text-white font-semibold'
                  : 'bg-[#151822] text-zinc-400 hover:text-white'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active Locked Entry Status Strip */}
      {primaryTrade && (
        <div
          className={`px-4 py-2 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-3 text-xs ${
            primaryIsWinning ? 'bg-emerald-500/10' : 'bg-[#E11D2E]/10'
          }`}
        >
          <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
            <span className={primaryTrade.direction === 'BUY' ? 'text-emerald-400 font-bold' : 'text-[#E11D2E] font-bold'}>
              {primaryTrade.direction === 'BUY' ? '▲ BUY' : '▼ SELL'} · {primaryTrade.trade_code}
            </span>
            <span className="text-zinc-300">
              {labels.lockedLine}: <strong className="text-white">{primaryTrade.entry_price.toFixed(decimals)}</strong>
            </span>
            <span className="text-zinc-300">
              {labels.livePrice}:{' '}
              <strong className={primaryIsWinning ? 'text-emerald-400' : 'text-[#E11D2E]'}>
                {livePrice !== null ? livePrice.toFixed(decimals) : '—'}
              </strong>
            </span>
          </div>
          <div className="flex items-center gap-3 font-mono tabular-nums">
            <span className={`font-bold ${primaryIsWinning ? 'text-emerald-400' : 'text-[#E11D2E]'}`}>
              {primaryIsWinning ? labels.winningNow : labels.losingNow}
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">
              {String(Math.floor(primaryRemainingSec / 60)).padStart(2, '0')}:
              {String(primaryRemainingSec % 60).padStart(2, '0')}
            </span>
          </div>
        </div>
      )}

      {/* Real-Time Canvas Plot */}
      <div
        ref={containerRef}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHoverPos({ x: e.clientX - r.left, y: e.clientY - r.top });
        }}
        onMouseLeave={() => setHoverPos(null)}
        className="relative w-full h-[360px] sm:h-[420px] select-none cursor-crosshair"
      >
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>
    </div>
  );
};
