import crypto from 'node:crypto';
import {
  db,
  ensureWalletForUser,
  postDoubleEntryTransaction,
  writeAuditLog,
  createNotification,
  getSetting,
} from './db.ts';
import { getAuthoritativeQuote, isSupportedAsset } from './marketFeed.ts';
import { broadcastToUser, broadcastToRole } from './realtime.ts';

export interface TimedTradeRow {
  id: string;
  trade_code: string;
  user_id: string;
  asset: string;
  direction: 'BUY' | 'SELL';
  stake_cents: number;
  payout_bps: number;
  duration_sec: number;
  entry_price: number;
  settlement_price: number | null;
  opened_at: string;
  opened_at_ms: number;
  expires_at: string;
  expires_at_ms: number;
  settled_at: string | null;
  status: 'open' | 'won' | 'lost' | 'tie';
  payout_cents: number;
  pnl_cents: number;
  feed_source: string;
  open_tx_id: string | null;
  settle_tx_id: string | null;
  created_at: string;
}

const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const settlingInFlight = new Set<string>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function getSelfTradingConfig() {
  const enabled = getSetting('self_trading_enabled', 'true') === 'true';
  const payoutBps = Math.max(1000, Math.min(9500, Number(getSetting('self_trading_payout_bps', '7000')) || 7000));
  const minUsd = Math.max(1, Number(getSetting('self_trading_min_usd', '5')) || 5);
  const maxUsd = Math.max(minUsd, Number(getSetting('self_trading_max_usd', '10000')) || 10000);
  return {
    enabled,
    payoutBps,
    payoutPct: Number((payoutBps / 100).toFixed(2)),
    minUsd,
    maxUsd,
  };
}

export async function openTimedTrade(params: {
  userId: string;
  userEmail: string;
  userRole: string;
  asset: string;
  direction: 'BUY' | 'SELL';
  stakeUsd: number;
  durationSec: number;
  ipAddress?: string;
}) {
  const cfg = getSelfTradingConfig();
  if (!cfg.enabled) {
    throw new Error('Módulo de Operações Próprias temporariamente desativado pela administração.');
  }

  const asset = params.asset.toUpperCase();
  if (!isSupportedAsset(asset)) {
    throw new Error('Ativo não suportado para operações diretas.');
  }
  if (params.direction !== 'BUY' && params.direction !== 'SELL') {
    throw new Error('Direção inválida. Escolha Compra (BUY) ou Venda (SELL).');
  }

  const durationSec = Math.round(Number(params.durationSec));
  if (!Number.isFinite(durationSec) || durationSec < 10 || durationSec > 300) {
    throw new Error('O prazo da operação deve ser entre 10 segundos e 5 minutos (300s).');
  }

  const stakeUsd = Number(params.stakeUsd);
  if (!Number.isFinite(stakeUsd) || stakeUsd < cfg.minUsd || stakeUsd > cfg.maxUsd) {
    throw new Error(`Valor por operação deve estar entre $${cfg.minUsd.toFixed(2)} e $${cfg.maxUsd.toFixed(2)} USD.`);
  }
  const stakeCents = Math.round(stakeUsd * 100);

  ensureWalletForUser(params.userId);
  const wallet = db.prepare(`SELECT available_cents FROM wallets WHERE user_id = ?`).get(params.userId) as {
    available_cents: number;
  };
  if (!wallet || wallet.available_cents < stakeCents) {
    throw new Error('Saldo disponível em USD insuficiente para abrir esta operação.');
  }

  // Pull authoritative server price (never trust client price)
  const quote = await getAuthoritativeQuote(asset);
  if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) {
    throw new Error(
      'Cotação ao vivo indisponível no provedor externo neste instante. Nenhuma operação simulada é permitida.'
    );
  }

  const id = `TRD-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
  const tradeCode = `AZK-TD-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const openedAtMs = Date.now();
  const expiresAtMs = openedAtMs + durationSec * 1000;
  const openedAt = new Date(openedAtMs).toISOString();
  const expiresAt = new Date(expiresAtMs).toISOString();

  const openTxId = postDoubleEntryTransaction({
    idempotencyKey: `TRADE-OPEN-${id}`,
    userId: params.userId,
    txType: 'self_trade_open',
    amountCents: stakeCents,
    originAccount: `LIABILITY_USER_AVAILABLE:${params.userId}`,
    destinationAccount: `LIABILITY_USER_RESERVED:${params.userId}`,
    externalRef: tradeCode,
    description: `Reserva Operação Direta ${params.direction} ${asset} (${durationSec}s · Preço ${quote.price})`,
    createdBy: params.userId,
    legs: [
      {
        accountCode: `LIABILITY_USER_AVAILABLE:${params.userId}`,
        accountName: `Disponível Investidor ${params.userId}`,
        accountType: 'liability',
        debitCents: stakeCents,
        creditCents: 0,
      },
      {
        accountCode: `LIABILITY_USER_RESERVED:${params.userId}`,
        accountName: `Reservado Investidor ${params.userId}`,
        accountType: 'liability',
        debitCents: 0,
        creditCents: stakeCents,
      },
    ],
    afterCommit: () => {
      const updateRes = db
        .prepare(
          `UPDATE wallets
           SET available_cents = available_cents - ?,
               reserved_cents = reserved_cents + ?,
               updated_at = ?
           WHERE user_id = ? AND available_cents >= ?`
        )
        .run(stakeCents, stakeCents, openedAt, params.userId, stakeCents);

      if (updateRes.changes !== 1) {
        throw new Error('Saldo disponível insuficiente no momento da execução.');
      }

      db.prepare(
        `INSERT INTO timed_trades
         (id, trade_code, user_id, asset, direction, stake_cents, payout_bps, duration_sec, entry_price, opened_at, opened_at_ms, expires_at, expires_at_ms, status, feed_source, open_tx_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
      ).run(
        id,
        tradeCode,
        params.userId,
        asset,
        params.direction,
        stakeCents,
        cfg.payoutBps,
        durationSec,
        quote.price,
        openedAt,
        openedAtMs,
        expiresAt,
        expiresAtMs,
        quote.source,
        `TRADE-OPEN-${id}`,
        openedAt
      );

      writeAuditLog({
        actorId: params.userId,
        actorEmail: params.userEmail,
        actorRole: params.userRole,
        action: 'TIMED_TRADE_OPENED',
        entityType: 'timed_trade',
        entityId: id,
        metadata: {
          tradeCode,
          asset,
          direction: params.direction,
          stakeCents,
          payoutBps: cfg.payoutBps,
          durationSec,
          entryPrice: quote.price,
          source: quote.source,
        },
        ipAddress: params.ipAddress,
      });
    },
  });

  // Update exact open_tx_id reference
  db.prepare(`UPDATE timed_trades SET open_tx_id = ? WHERE id = ?`).run(openTxId, id);

  scheduleTradeSettlement(id, expiresAtMs - Date.now());

  const trade = db.prepare(`SELECT * FROM timed_trades WHERE id = ?`).get(id) as unknown as TimedTradeRow;
  const updatedWallet = db.prepare(`SELECT * FROM wallets WHERE user_id = ?`).get(params.userId);

  broadcastToUser(params.userId, 'trade:opened', { trade });
  broadcastToUser(params.userId, 'wallet:updated', { tradeId: id });
  broadcastToRole('admin', 'trade:updated', { tradeId: id, status: 'open' });

  return { trade, wallet: updatedWallet };
}

export async function settleTimedTrade(tradeId: string): Promise<TimedTradeRow | null> {
  if (settlingInFlight.has(tradeId)) return null;
  settlingInFlight.add(tradeId);

  try {
    const existingTimer = activeTimers.get(tradeId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      activeTimers.delete(tradeId);
    }

    const trade = db.prepare(`SELECT * FROM timed_trades WHERE id = ?`).get(tradeId) as TimedTradeRow | undefined;
    if (!trade || trade.status !== 'open') return null;

    if (Date.now() < trade.expires_at_ms - 50) {
      // Reschedule if fired slightly early
      scheduleTradeSettlement(tradeId, trade.expires_at_ms - Date.now());
      return null;
    }

    const quote = await getAuthoritativeQuote(trade.asset);
    if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) {
      // Do not fabricate a closing price; sweep interval will retry in 1s
      return null;
    }

    const settlementPrice = quote.price;
    let outcome: 'won' | 'lost' | 'tie';
    if (settlementPrice === trade.entry_price) {
      outcome = 'tie';
    } else if (trade.direction === 'BUY') {
      outcome = settlementPrice > trade.entry_price ? 'won' : 'lost';
    } else {
      outcome = settlementPrice < trade.entry_price ? 'won' : 'lost';
    }

    const profitCents = outcome === 'won' ? Math.round((trade.stake_cents * trade.payout_bps) / 10000) : 0;
    const payoutCents =
      outcome === 'won' ? trade.stake_cents + profitCents : outcome === 'tie' ? trade.stake_cents : 0;
    const pnlCents = outcome === 'won' ? profitCents : outcome === 'tie' ? 0 : -trade.stake_cents;
    const settledAt = new Date().toISOString();

    const legs =
      outcome === 'won'
        ? [
            {
              accountCode: `LIABILITY_USER_RESERVED:${trade.user_id}`,
              accountName: `Reservado Investidor ${trade.user_id}`,
              accountType: 'liability' as const,
              debitCents: trade.stake_cents,
              creditCents: 0,
            },
            {
              accountCode: 'PLATFORM_TRADING_POOL',
              accountName: 'Tesouraria de Liquidação Direct Trading AZKOYEN',
              accountType: 'revenue' as const,
              debitCents: profitCents,
              creditCents: 0,
            },
            {
              accountCode: `LIABILITY_USER_AVAILABLE:${trade.user_id}`,
              accountName: `Disponível Investidor ${trade.user_id}`,
              accountType: 'liability' as const,
              debitCents: 0,
              creditCents: payoutCents,
            },
          ]
        : outcome === 'tie'
          ? [
              {
                accountCode: `LIABILITY_USER_RESERVED:${trade.user_id}`,
                accountName: `Reservado Investidor ${trade.user_id}`,
                accountType: 'liability' as const,
                debitCents: trade.stake_cents,
                creditCents: 0,
              },
              {
                accountCode: `LIABILITY_USER_AVAILABLE:${trade.user_id}`,
                accountName: `Disponível Investidor ${trade.user_id}`,
                accountType: 'liability' as const,
                debitCents: 0,
                creditCents: trade.stake_cents,
              },
            ]
          : [
              {
                accountCode: `LIABILITY_USER_RESERVED:${trade.user_id}`,
                accountName: `Reservado Investidor ${trade.user_id}`,
                accountType: 'liability' as const,
                debitCents: trade.stake_cents,
                creditCents: 0,
              },
              {
                accountCode: 'PLATFORM_TRADING_POOL',
                accountName: 'Tesouraria de Liquidação Direct Trading AZKOYEN',
                accountType: 'revenue' as const,
                debitCents: 0,
                creditCents: trade.stake_cents,
              },
            ];

    const txAmount = outcome === 'won' ? payoutCents : trade.stake_cents;

    const settleTxId = postDoubleEntryTransaction({
      idempotencyKey: `TRADE-SETTLE-${trade.id}`,
      userId: trade.user_id,
      txType: `self_trade_${outcome}`,
      amountCents: txAmount,
      originAccount:
        outcome === 'lost' ? `LIABILITY_USER_RESERVED:${trade.user_id}` : 'PLATFORM_TRADING_POOL',
      destinationAccount:
        outcome === 'lost' ? 'PLATFORM_TRADING_POOL' : `LIABILITY_USER_AVAILABLE:${trade.user_id}`,
      externalRef: trade.trade_code,
      description:
        outcome === 'won'
          ? `Liquidação Operação ${trade.trade_code} (${trade.direction} ${trade.asset}): GANHO +${(trade.payout_bps / 100).toFixed(0)}%`
          : outcome === 'tie'
            ? `Empate Operação ${trade.trade_code} (${trade.asset}): Capital devolvido`
            : `Liquidação Operação ${trade.trade_code} (${trade.direction} ${trade.asset}): Perda do capital alocado`,
      legs,
      afterCommit: () => {
        const res = db
          .prepare(
            `UPDATE timed_trades
             SET status = ?,
                 settlement_price = ?,
                 settled_at = ?,
                 payout_cents = ?,
                 pnl_cents = ?,
                 settle_tx_id = ?
             WHERE id = ? AND status = 'open'`
          )
          .run(outcome, settlementPrice, settledAt, payoutCents, pnlCents, `TRADE-SETTLE-${trade.id}`, trade.id);

        if (res.changes !== 1) {
          throw new Error('Operação já liquidada concorrentemente.');
        }

        if (outcome === 'won') {
          db.prepare(
            `UPDATE wallets
             SET reserved_cents = MAX(0, reserved_cents - ?),
                 available_cents = available_cents + ?,
                 realized_yield_cents = realized_yield_cents + ?,
                 updated_at = ?
             WHERE user_id = ?`
          ).run(trade.stake_cents, payoutCents, profitCents, settledAt, trade.user_id);
        } else if (outcome === 'tie') {
          db.prepare(
            `UPDATE wallets
             SET reserved_cents = MAX(0, reserved_cents - ?),
                 available_cents = available_cents + ?,
                 updated_at = ?
             WHERE user_id = ?`
          ).run(trade.stake_cents, trade.stake_cents, settledAt, trade.user_id);
        } else {
          db.prepare(
            `UPDATE wallets
             SET reserved_cents = MAX(0, reserved_cents - ?),
                 updated_at = ?
             WHERE user_id = ?`
          ).run(trade.stake_cents, settledAt, trade.user_id);
        }

        writeAuditLog({
          actorId: 'SYSTEM_SETTLER',
          actorRole: 'system',
          action: `TIMED_TRADE_${outcome.toUpperCase()}`,
          entityType: 'timed_trade',
          entityId: trade.id,
          metadata: {
            tradeCode: trade.trade_code,
            asset: trade.asset,
            direction: trade.direction,
            entryPrice: trade.entry_price,
            settlementPrice,
            stakeCents: trade.stake_cents,
            payoutCents,
            pnlCents,
          },
        });
      },
    });

    db.prepare(`UPDATE timed_trades SET settle_tx_id = ? WHERE id = ?`).run(settleTxId, trade.id);

    const settledTrade = db.prepare(`SELECT * FROM timed_trades WHERE id = ?`).get(trade.id) as unknown as TimedTradeRow;
    const updatedWallet = db.prepare(`SELECT * FROM wallets WHERE user_id = ?`).get(trade.user_id);

    if (outcome === 'won') {
      createNotification(
        trade.user_id,
        `Operação ${trade.trade_code} Liquidada (+${(trade.payout_bps / 100).toFixed(0)}%)`,
        `${trade.direction} ${trade.asset}: Entrada ${trade.entry_price} → Fechamento ${settlementPrice}. Lucro de $${(profitCents / 100).toFixed(2)} creditado.`,
        'trading'
      );
    }

    broadcastToUser(trade.user_id, 'trade:settled', { trade: settledTrade, wallet: updatedWallet });
    broadcastToUser(trade.user_id, 'wallet:updated', { tradeId: trade.id });
    broadcastToRole('admin', 'trade:updated', { tradeId: trade.id, status: outcome });

    return settledTrade;
  } finally {
    settlingInFlight.delete(tradeId);
  }
}

function scheduleTradeSettlement(tradeId: string, delayMs: number) {
  if (activeTimers.has(tradeId)) {
    clearTimeout(activeTimers.get(tradeId)!);
  }
  const safeDelay = Math.max(50, delayMs);
  const timer = setTimeout(() => {
    void settleTimedTrade(tradeId);
  }, safeDelay);
  activeTimers.set(tradeId, timer);
}

export function startTimedTradeSettler() {
  // Recover any open trades after startup / reboot
  const openTrades = db
    .prepare(`SELECT id, expires_at_ms FROM timed_trades WHERE status = 'open'`)
    .all() as Array<{ id: string; expires_at_ms: number }>;

  const now = Date.now();
  for (const t of openTrades) {
    if (t.expires_at_ms <= now) {
      void settleTimedTrade(t.id);
    } else {
      scheduleTradeSettlement(t.id, t.expires_at_ms - now);
    }
  }

  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = setInterval(() => {
    const expired = db
      .prepare(`SELECT id FROM timed_trades WHERE status = 'open' AND expires_at_ms <= ?`)
      .all(Date.now()) as Array<{ id: string }>;
    for (const row of expired) {
      void settleTimedTrade(row.id);
    }
  }, 1000);
}

export function stopTimedTradeSettler() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  for (const timer of activeTimers.values()) {
    clearTimeout(timer);
  }
  activeTimers.clear();
}
