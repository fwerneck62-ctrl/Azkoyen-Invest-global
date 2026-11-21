import React, { useState } from 'react';

interface EquityPoint {
  label: string;
  value: number;
}

export const EquityCurveChart: React.FC<{
  points: EquityPoint[];
  accentColor?: string;
  height?: number;
}> = ({ points, accentColor = '#E11D2E', height = 220 }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!points.length) {
    return (
      <div className="flex items-center justify-center h-48 text-xs text-zinc-500">
        Sem série histórica disponível.
      </div>
    );
  }

  const width = 680;
  const padX = 18;
  const padY = 20;
  const vals = points.map((p) => p.value);
  const minVal = Math.min(...vals) * 0.985;
  const maxVal = Math.max(...vals) * 1.015 || 1;
  const range = maxVal - minVal || 1;

  const coords = points.map((p, idx) => {
    const x = padX + (idx / Math.max(1, points.length - 1)) * (width - padX * 2);
    const y = padY + (1 - (p.value - minVal) / range) * (height - padY * 2);
    return { x, y, ...p };
  });

  const linePath = coords
    .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${height - padY} L ${coords[0].x.toFixed(1)} ${height - padY} Z`;

  const activePoint = hoverIdx !== null ? coords[hoverIdx] : coords[coords.length - 1];

  return (
    <div className="relative w-full">
      <div className="flex items-center justify-between mb-2 text-xs text-zinc-400">
        <span>{activePoint.label}</span>
        <span className="font-mono tabular-nums text-white font-semibold">
          ${activePoint.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full overflow-visible select-none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="azkoyeCurveGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accentColor} stopOpacity="0.34" />
            <stop offset="100%" stopColor={accentColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => {
          const y = padY + ratio * (height - padY * 2);
          return (
            <line
              key={ratio}
              x1={padX}
              x2={width - padX}
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeDasharray="3 4"
            />
          );
        })}
        <path d={areaPath} fill="url(#azkoyeCurveGrad)" />
        <path d={linePath} fill="none" stroke={accentColor} strokeWidth="2.2" strokeLinecap="round" />

        {hoverIdx !== null && (
          <line
            x1={activePoint.x}
            x2={activePoint.x}
            y1={padY}
            y2={height - padY}
            stroke="rgba(255,255,255,0.22)"
            strokeDasharray="2 2"
          />
        )}

        <circle
          cx={activePoint.x}
          cy={activePoint.y}
          r="4.5"
          fill={accentColor}
          stroke="#060609"
          strokeWidth="2"
        />

        {coords.map((c, i) => (
          <rect
            key={c.label + i}
            x={c.x - (width / points.length) / 2}
            y={0}
            width={width / points.length}
            height={height}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
          />
        ))}
      </svg>
    </div>
  );
};

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const CandlestickMarketChart: React.FC<{ candles: Candle[] }> = ({ candles }) => {
  const [selected, setSelected] = useState<number | null>(null);
  if (!candles.length) {
    return (
      <div className="h-64 flex flex-col items-center justify-center border border-white/[0.07] rounded-lg bg-[#090A0F] text-zinc-400 text-sm px-6 text-center">
        <p className="font-medium text-zinc-200">Feed de mercado externo indisponível</p>
        <p className="text-xs text-zinc-500 mt-1 max-w-md">
          Conecte-se à internet ou configure uma corretora compatível. A AZKOYEN INVEST não exibe cotações nem execuções simuladas.
        </p>
      </div>
    );
  }

  const width = 760;
  const height = 250;
  const pad = 20;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const maxP = Math.max(...highs);
  const minP = Math.min(...lows);
  const range = maxP - minP || 1;
  const step = (width - pad * 2) / candles.length;

  const yPos = (p: number) => pad + (1 - (p - minP) / range) * (height - pad * 2);

  // Compute EMA-9
  const k = 2 / (9 + 1);
  let ema = candles[0].close;
  const emaCoords = candles.map((c, idx) => {
    ema = idx === 0 ? c.close : c.close * k + ema * (1 - k);
    const x = pad + idx * step + step / 2;
    return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${yPos(ema).toFixed(1)}`;
  }).join(' ');

  const active = selected !== null ? candles[selected] : candles[candles.length - 1];

  return (
    <div className="bg-[#090A0F] border border-white/[0.08] rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-4 text-xs mb-3 font-mono tabular-nums">
        <div className="flex items-center gap-4">
          <span className="text-zinc-400">O: <span className="text-white">{active.open.toFixed(2)}</span></span>
          <span className="text-zinc-400">H: <span className="text-emerald-400">{active.high.toFixed(2)}</span></span>
          <span className="text-zinc-400">L: <span className="text-[#E11D2E]">{active.low.toFixed(2)}</span></span>
          <span className="text-zinc-400">C: <span className="text-white font-semibold">{active.close.toFixed(2)}</span></span>
        </div>
        <span className="text-zinc-500">EMA(9) · {new Date(active.time).toLocaleString('pt-BR')}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" onMouseLeave={() => setSelected(null)}>
        {[0.25, 0.5, 0.75].map((r) => (
          <line
            key={r}
            x1={pad}
            x2={width - pad}
            y1={pad + r * (height - pad * 2)}
            y2={pad + r * (height - pad * 2)}
            stroke="rgba(255,255,255,0.05)"
          />
        ))}
        {candles.map((c, idx) => {
          const xCenter = pad + idx * step + step / 2;
          const isUp = c.close >= c.open;
          const color = isUp ? '#10B981' : '#E11D2E';
          const bodyTop = yPos(Math.max(c.open, c.close));
          const bodyBot = yPos(Math.min(c.open, c.close));
          const bodyH = Math.max(2, bodyBot - bodyTop);
          return (
            <g key={c.time + idx} onMouseEnter={() => setSelected(idx)}>
              <line x1={xCenter} x2={xCenter} y1={yPos(c.high)} y2={yPos(c.low)} stroke={color} strokeWidth="1.2" />
              <rect
                x={xCenter - Math.max(2, step * 0.3)}
                y={bodyTop}
                width={Math.max(4, step * 0.6)}
                height={bodyH}
                fill={color}
                rx="1"
              />
            </g>
          );
        })}
        <path d={emaCoords} fill="none" stroke="#F59E0B" strokeWidth="1.4" strokeDasharray="3 2" />
      </svg>
    </div>
  );
};
