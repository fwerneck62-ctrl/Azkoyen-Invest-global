import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './security.ts';

const resolvedDbPath = process.env.DATABASE_PATH
  ? path.isAbsolute(process.env.DATABASE_PATH)
    ? process.env.DATABASE_PATH
    : path.resolve(process.cwd(), process.env.DATABASE_PATH)
  : path.resolve(process.cwd(), 'data', 'azkoye.db');

const DB_DIR = path.dirname(resolvedDbPath);
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = resolvedDbPath;
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('investor', 'trader', 'admin')),
      admin_tier TEXT CHECK(admin_tier IN ('super_admin', 'finance_admin', 'ops_admin', 'compliance_admin')),
      email_verified INTEGER NOT NULL DEFAULT 0,
      email_verification_code TEXT,
      kyc_status TEXT NOT NULL DEFAULT 'pending' CHECK(kyc_status IN ('pending', 'submitted', 'approved', 'rejected')),
      tax_id TEXT,
      document_type TEXT,
      phone TEXT,
      country TEXT DEFAULT 'BR',
      preferred_language TEXT DEFAULT 'pt',
      postal_code TEXT,
      city TEXT,
      state_region TEXT,
      verification_source TEXT,
      mfa_enabled INTEGER NOT NULL DEFAULT 0,
      mfa_secret TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending_approval', 'suspended')),
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      ip_address TEXT,
      user_agent TEXT,
      mfa_verified INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reset_code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trader_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      photo_url TEXT,
      bio TEXT NOT NULL,
      experience_years INTEGER NOT NULL DEFAULT 1,
      specialties_json TEXT NOT NULL DEFAULT '[]',
      strategies TEXT NOT NULL,
      documents_json TEXT NOT NULL DEFAULT '[]',
      credentials_summary TEXT,
      profit_share_bps INTEGER NOT NULL DEFAULT 500,
      commission_fee_bps INTEGER NOT NULL DEFAULT 0,
      approval_status TEXT NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending', 'approved', 'rejected')),
      approved_by TEXT,
      approved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      available_cents INTEGER NOT NULL DEFAULT 0 CHECK(available_cents >= 0),
      reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK(reserved_cents >= 0),
      invested_cents INTEGER NOT NULL DEFAULT 0 CHECK(invested_cents >= 0),
      realized_yield_cents INTEGER NOT NULL DEFAULT 0,
      pending_yield_cents INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ledger_accounts (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      account_type TEXT NOT NULL CHECK(account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
      currency TEXT NOT NULL DEFAULT 'USD',
      balance_cents INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ledger_transactions (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE,
      user_id TEXT,
      tx_type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      currency TEXT NOT NULL DEFAULT 'USD',
      origin_account TEXT NOT NULL,
      destination_account TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted', 'reversed')),
      external_ref TEXT,
      description TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id),
      account_code TEXT NOT NULL REFERENCES ledger_accounts(code),
      debit_cents INTEGER NOT NULL DEFAULT 0 CHECK(debit_cents >= 0),
      credit_cents INTEGER NOT NULL DEFAULT 0 CHECK(credit_cents >= 0),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      image_url TEXT,
      description TEXT NOT NULL,
      trader_id TEXT NOT NULL REFERENCES users(id),
      strategy TEXT NOT NULL,
      market TEXT NOT NULL,
      risk_level TEXT NOT NULL CHECK(risk_level IN ('Conservador', 'Moderado', 'Arrojado', 'Institucional')),
      min_capital_cents INTEGER NOT NULL,
      max_capital_cents INTEGER NOT NULL,
      contractual_yield_bps INTEGER NOT NULL,
      term_days INTEGER NOT NULL,
      maturity_date TEXT NOT NULL,
      redemption_policy TEXT NOT NULL,
      loss_policy TEXT NOT NULL,
      early_redemption_allowed INTEGER NOT NULL DEFAULT 0,
      early_redemption_penalty_bps INTEGER NOT NULL DEFAULT 500,
      contract_terms TEXT NOT NULL,
      trader_share_bps INTEGER NOT NULL DEFAULT 500,
      commission_fee_bps INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'closed')),
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pools (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      name TEXT NOT NULL,
      trader_id TEXT NOT NULL REFERENCES users(id),
      min_pool_cents INTEGER NOT NULL,
      max_pool_cents INTEGER NOT NULL,
      raised_cents INTEGER NOT NULL DEFAULT 0,
      operational_capital_cents INTEGER NOT NULL DEFAULT 0,
      reserve_cents INTEGER NOT NULL DEFAULT 0,
      realized_pnl_cents INTEGER NOT NULL DEFAULT 0,
      contractual_obligation_cents INTEGER NOT NULL DEFAULT 0,
      investor_share_bps INTEGER NOT NULL DEFAULT 9500,
      trader_share_bps INTEGER NOT NULL DEFAULT 500,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'active_trading', 'settling', 'settled', 'halted')),
      opened_at TEXT NOT NULL,
      closes_at TEXT NOT NULL,
      settled_at TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS investments (
      id TEXT PRIMARY KEY,
      contract_code TEXT NOT NULL UNIQUE,
      investor_id TEXT NOT NULL REFERENCES users(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      pool_id TEXT NOT NULL REFERENCES pools(id),
      principal_cents INTEGER NOT NULL CHECK(principal_cents > 0),
      pool_share_ppm INTEGER NOT NULL DEFAULT 0,
      contractual_yield_cents INTEGER NOT NULL DEFAULT 0,
      realized_yield_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'matured', 'settled', 'early_redeemed')),
      contract_snapshot_json TEXT NOT NULL,
      invested_at TEXT NOT NULL,
      maturity_date TEXT NOT NULL,
      settled_at TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS manual_operations (
      id TEXT PRIMARY KEY,
      op_code TEXT NOT NULL UNIQUE,
      pool_id TEXT NOT NULL REFERENCES pools(id),
      trader_id TEXT NOT NULL REFERENCES users(id),
      asset TEXT NOT NULL,
      op_type TEXT NOT NULL CHECK(op_type IN ('LONG', 'SHORT', 'HEDGE', 'ARBITRAGE', 'OPTIONS')),
      exchange_venue TEXT NOT NULL,
      entry_value_cents INTEGER NOT NULL,
      exit_value_cents INTEGER NOT NULL,
      fees_cents INTEGER NOT NULL DEFAULT 0,
      net_pnl_cents INTEGER NOT NULL,
      evidence_ref TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'submitted', 'in_review', 'approved', 'rejected', 'adjustment_requested')),
      reviewed_by TEXT REFERENCES users(id),
      review_notes TEXT,
      parent_op_id TEXT,
      executed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deposits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      method TEXT NOT NULL CHECK(method IN ('PIX', 'USDC')),
      network TEXT NOT NULL,
      gross_brl_cents INTEGER,
      fx_rate_brl_per_usd REAL,
      fee_cents INTEGER NOT NULL DEFAULT 0,
      net_usd_cents INTEGER NOT NULL CHECK(net_usd_cents > 0),
      pix_txid TEXT,
      pix_copy_paste TEXT,
      qr_data_url TEXT,
      usdc_address TEXT,
      tx_hash TEXT,
      confirmations INTEGER NOT NULL DEFAULT 0,
      required_confirmations INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirming', 'confirmed', 'rejected')),
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      method TEXT NOT NULL CHECK(method IN ('PIX', 'USDC')),
      destination_key TEXT NOT NULL,
      network TEXT NOT NULL,
      requested_usd_cents INTEGER NOT NULL CHECK(requested_usd_cents > 0),
      fee_cents INTEGER NOT NULL DEFAULT 0,
      net_payout_cents INTEGER NOT NULL CHECK(net_payout_cents > 0),
      status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested', 'in_review', 'approved', 'processing', 'completed', 'rejected')),
      reviewed_by TEXT REFERENCES users(id),
      review_notes TEXT,
      tx_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exchange_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      exchange_name TEXT NOT NULL CHECK(exchange_name IN ('Binance', 'Bybit', 'Coinbase Advanced', 'Kraken')),
      label TEXT NOT NULL,
      api_key_masked TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      api_secret_encrypted TEXT NOT NULL,
      permissions TEXT NOT NULL DEFAULT 'SPOT_READ_TRADE',
      max_risk_per_trade_bps INTEGER NOT NULL DEFAULT 200,
      status TEXT NOT NULL DEFAULT 'verified' CHECK(status IN ('verified', 'disconnected', 'error')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS self_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      connection_id TEXT NOT NULL REFERENCES exchange_connections(id),
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
      order_type TEXT NOT NULL CHECK(order_type IN ('MARKET', 'LIMIT')),
      quantity REAL NOT NULL,
      price_usd REAL NOT NULL,
      stop_loss_usd REAL,
      take_profit_usd REAL,
      status TEXT NOT NULL,
      exchange_order_id TEXT,
      exchange_response_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'system',
      read_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      subject TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'resolved')),
      admin_reply TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      actor_email TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      metadata_json TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS timed_trades (
      id TEXT PRIMARY KEY,
      trade_code TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      asset TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('BUY', 'SELL')),
      stake_cents INTEGER NOT NULL CHECK(stake_cents > 0),
      payout_bps INTEGER NOT NULL DEFAULT 7000,
      duration_sec INTEGER NOT NULL CHECK(duration_sec >= 10 AND duration_sec <= 300),
      entry_price REAL NOT NULL,
      settlement_price REAL,
      opened_at TEXT NOT NULL,
      opened_at_ms INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      settled_at TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'won', 'lost', 'tie')),
      payout_cents INTEGER NOT NULL DEFAULT 0,
      pnl_cents INTEGER NOT NULL DEFAULT 0,
      feed_source TEXT NOT NULL,
      open_tx_id TEXT,
      settle_tx_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_timed_trades_user_status ON timed_trades(user_id, status, opened_at_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_timed_trades_open_exp ON timed_trades(status, expires_at_ms);
  `);

  // Safe idempotent column migrations for existing databases
  const userCols = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
  const existingColNames = new Set(userCols.map((c) => c.name));
  const extraCols: Array<[string, string]> = [
    ['document_type', 'TEXT'],
    ['preferred_language', "TEXT DEFAULT 'pt'"],
    ['postal_code', 'TEXT'],
    ['city', 'TEXT'],
    ['state_region', 'TEXT'],
    ['verification_source', 'TEXT'],
  ];
  for (const [col, def] of extraCols) {
    if (!existingColNames.has(col)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def};`);
    }
  }

  const traderCols = db.prepare(`PRAGMA table_info(trader_profiles)`).all() as Array<{ name: string }>;
  const existingTraderColNames = new Set(traderCols.map((c) => c.name));
  const traderExtraCols: Array<[string, string]> = [
    ['profit_share_bps', 'INTEGER NOT NULL DEFAULT 500'],
    ['commission_fee_bps', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [col, def] of traderExtraCols) {
    if (!existingTraderColNames.has(col)) {
      db.exec(`ALTER TABLE trader_profiles ADD COLUMN ${col} ${def};`);
    }
  }

  const productCols = db.prepare(`PRAGMA table_info(products)`).all() as Array<{ name: string }>;
  const existingProductColNames = new Set(productCols.map((c) => c.name));
  const productExtraCols: Array<[string, string]> = [
    ['trader_share_bps', 'INTEGER NOT NULL DEFAULT 500'],
    ['commission_fee_bps', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [col, def] of productExtraCols) {
    if (!existingProductColNames.has(col)) {
      db.exec(`ALTER TABLE products ADD COLUMN ${col} ${def};`);
    }
  }
}

export function ensureLedgerAccount(
  code: string,
  name: string,
  accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
) {
  db.prepare(
    `INSERT OR IGNORE INTO ledger_accounts (code, name, account_type, currency, balance_cents)
     VALUES (?, ?, ?, 'USD', 0)`
  ).run(code, name, accountType);
}

export interface LedgerLeg {
  accountCode: string;
  accountName: string;
  accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  debitCents: number;
  creditCents: number;
}

export interface DoubleEntryInput {
  idempotencyKey?: string;
  userId?: string;
  txType: string;
  amountCents: number;
  originAccount: string;
  destinationAccount: string;
  externalRef?: string;
  description: string;
  createdBy?: string;
  legs: LedgerLeg[];
  afterCommit?: () => void;
}

export function postDoubleEntryTransaction(input: DoubleEntryInput): string {
  if (input.amountCents <= 0 || !Number.isInteger(input.amountCents)) {
    throw new Error('Valor financeiro inválido (deve ser inteiro positivo em centavos USD).');
  }

  let totalDebit = 0;
  let totalCredit = 0;
  for (const leg of input.legs) {
    if (leg.debitCents < 0 || leg.creditCents < 0) {
      throw new Error('Débitos e créditos não podem ser negativos.');
    }
    totalDebit += leg.debitCents;
    totalCredit += leg.creditCents;
  }
  if (totalDebit !== totalCredit || totalDebit === 0) {
    throw new Error(`Partida dobrada desequilibrada: D=${totalDebit} vs C=${totalCredit}`);
  }

  if (input.idempotencyKey) {
    const existing = db
      .prepare(`SELECT id FROM ledger_transactions WHERE idempotency_key = ?`)
      .get(input.idempotencyKey) as { id: string } | undefined;
    if (existing) {
      return existing.id;
    }
  }

  const txId = `TX-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO ledger_transactions
       (id, idempotency_key, user_id, tx_type, amount_cents, currency, origin_account, destination_account, status, external_ref, description, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, 'posted', ?, ?, ?, ?)`
    ).run(
      txId,
      input.idempotencyKey || null,
      input.userId || null,
      input.txType,
      input.amountCents,
      input.originAccount,
      input.destinationAccount,
      input.externalRef || null,
      input.description,
      input.createdBy || null,
      now
    );

    for (const leg of input.legs) {
      ensureLedgerAccount(leg.accountCode, leg.accountName, leg.accountType);
      const entryId = `LE-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_code, debit_cents, credit_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(entryId, txId, leg.accountCode, leg.debitCents, leg.creditCents, now);

      // Asset & Expense accounts increase with Debit; Liability, Equity & Revenue increase with Credit
      const delta =
        leg.accountType === 'asset' || leg.accountType === 'expense'
          ? leg.debitCents - leg.creditCents
          : leg.creditCents - leg.debitCents;

      db.prepare(
        `UPDATE ledger_accounts SET balance_cents = balance_cents + ? WHERE code = ?`
      ).run(delta, leg.accountCode);
    }

    if (input.afterCommit) {
      input.afterCommit();
    }

    db.exec('COMMIT');
    return txId;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function ensureWalletForUser(userId: string) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO wallets (id, user_id, available_cents, reserved_cents, invested_cents, realized_yield_cents, pending_yield_cents, updated_at)
     VALUES (?, ?, 0, 0, 0, 0, 0, ?)`
  ).run(`WAL-${userId.slice(0, 8)}`, userId, now);
  ensureLedgerAccount(`LIABILITY_USER_AVAILABLE:${userId}`, `Disponível Investidor ${userId}`, 'liability');
  ensureLedgerAccount(`LIABILITY_USER_RESERVED:${userId}`, `Reservado Investidor ${userId}`, 'liability');
  ensureLedgerAccount(`LIABILITY_USER_INVESTED:${userId}`, `Investido Investidor ${userId}`, 'liability');
}

export function writeAuditLog(params: {
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: unknown;
  ipAddress?: string | null;
}) {
  db.prepare(
    `INSERT INTO audit_logs (id, actor_id, actor_email, actor_role, action, entity_type, entity_id, metadata_json, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `AUD-${crypto.randomUUID().slice(0, 12).toUpperCase()}`,
    params.actorId || null,
    params.actorEmail || null,
    params.actorRole || null,
    params.action,
    params.entityType,
    params.entityId || null,
    params.metadata ? JSON.stringify(params.metadata) : null,
    params.ipAddress || null,
    new Date().toISOString()
  );
}

export function createNotification(userId: string, title: string, message: string, category = 'system') {
  const id = `NOTIF-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
  db.prepare(
    `INSERT INTO notifications (id, user_id, title, message, category, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, userId, title, message, category, new Date().toISOString());
  return { id, userId, title, message, category, createdAt: new Date().toISOString() };
}

export function runReconciliation() {
  const sums = db
    .prepare(
      `SELECT COALESCE(SUM(debit_cents), 0) AS total_debits,
              COALESCE(SUM(credit_cents), 0) AS total_credits
       FROM ledger_entries`
    )
    .get() as { total_debits: number; total_credits: number };

  const walletTotals = db
    .prepare(
      `SELECT COALESCE(SUM(available_cents), 0) AS available_cents,
              COALESCE(SUM(reserved_cents), 0) AS reserved_cents,
              COALESCE(SUM(invested_cents), 0) AS invested_cents
       FROM wallets`
    )
    .get() as { available_cents: number; reserved_cents: number; invested_cents: number };

  const ledgerAvail = db
    .prepare(
      `SELECT COALESCE(SUM(balance_cents), 0) AS bal FROM ledger_accounts WHERE code LIKE 'LIABILITY_USER_AVAILABLE:%'`
    )
    .get() as { bal: number };

  const ledgerRes = db
    .prepare(
      `SELECT COALESCE(SUM(balance_cents), 0) AS bal FROM ledger_accounts WHERE code LIKE 'LIABILITY_USER_RESERVED:%'`
    )
    .get() as { bal: number };

  const ledgerInv = db
    .prepare(
      `SELECT COALESCE(SUM(balance_cents), 0) AS bal FROM ledger_accounts WHERE code LIKE 'LIABILITY_USER_INVESTED:%'`
    )
    .get() as { bal: number };

  const poolChecks = db
    .prepare(`SELECT id, name, raised_cents, operational_capital_cents, reserve_cents, realized_pnl_cents FROM pools`)
    .all() as Array<{
      id: string;
      name: string;
      raised_cents: number;
      operational_capital_cents: number;
      reserve_cents: number;
      realized_pnl_cents: number;
    }>;

  const poolDiscrepancies = poolChecks.filter((p) => {
    const capAcc = db
      .prepare(`SELECT balance_cents FROM ledger_accounts WHERE code = ?`)
      .get(`POOL_CAPITAL:${p.id}`) as { balance_cents: number } | undefined;
    return capAcc && capAcc.balance_cents !== p.raised_cents;
  });

  const doubleEntryBalanced = sums.total_debits === sums.total_credits;
  const availableMatched = walletTotals.available_cents === ledgerAvail.bal;
  const reservedMatched = walletTotals.reserved_cents === ledgerRes.bal;
  const investedMatched = walletTotals.invested_cents === ledgerInv.bal;

  return {
    checkedAt: new Date().toISOString(),
    doubleEntryBalanced,
    totalDebitsCents: sums.total_debits,
    totalCreditsCents: sums.total_credits,
    availableMatched,
    reservedMatched,
    investedMatched,
    walletTotals,
    ledgerTotals: {
      availableCents: ledgerAvail.bal,
      reservedCents: ledgerRes.bal,
      investedCents: ledgerInv.bal,
    },
    poolDiscrepancyCount: poolDiscrepancies.length,
    overallHealthy:
      doubleEntryBalanced &&
      availableMatched &&
      reservedMatched &&
      investedMatched &&
      poolDiscrepancies.length === 0,
  };
}

export function getSetting(key: string, fallback: string): string {
  const row = db.prepare(`SELECT value FROM platform_settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : fallback;
}

export function setSetting(key: string, value: string) {
  db.prepare(
    `INSERT INTO platform_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, new Date().toISOString());
}

export function seedInstitutionalDefaults() {
  initSchema();

  const defaults: Record<string, string> = {
    public_fundraising_enabled: 'false', // Blocked until legal, regulatory, financial & custody validation (Section 18)
    legal_validation_completed: 'false',
    custody_validation_completed: 'false',
    pix_fee_bps: '45', // 0.45%
    usdc_fee_bps: '25', // 0.25%
    withdrawal_pix_fee_bps: '60',
    withdrawal_usdc_fee_cents: '250', // $2.50 network fee
    brl_per_usd_rate: '5.78',
    default_investor_share_bps: '9500', // 95%
    default_trader_share_bps: '500', // 5%
    platform_commission_fee_bps: '0', // 0% platform commission fee on trader payout
    mfa_required_for_withdrawals: 'true',
    self_trading_enabled: 'true',
    self_trading_payout_bps: String(Number(process.env.SELF_TRADING_PAYOUT_BPS) || 7000), // 70%
    self_trading_min_usd: '5',
    self_trading_max_usd: '10000',
  };

  for (const [k, v] of Object.entries(defaults)) {
    db.prepare(
      `INSERT OR IGNORE INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?)`
    ).run(k, v, new Date().toISOString());
  }

  ensureLedgerAccount('ASSET_PIX_CLEARING', 'Conta de Liquidação PIX (BRL -> USD)', 'asset');
  ensureLedgerAccount('ASSET_USDC_CUSTODY', 'Custódia Institucional USDC On-Chain', 'asset');
  ensureLedgerAccount('PLATFORM_FEE_REVENUE', 'Receita Operacional AZKOYEN INVEST', 'revenue');
  ensureLedgerAccount('PLATFORM_TRADING_POOL', 'Tesouraria de Liquidação Direct Trading AZKOYEN', 'revenue');
  ensureLedgerAccount('PLATFORM_RESERVE_FUND', 'Reserva de Contingência Institucional', 'equity');

  // Ensure catalog products, pools, ledger accounts & trader display names on disk have clean AZKOYEN INVEST names
  db.prepare(
    `UPDATE ledger_accounts SET name = 'Receita Operacional AZKOYEN INVEST' WHERE code = 'PLATFORM_FEE_REVENUE'`
  ).run();
  db.prepare(
    `UPDATE ledger_accounts SET name = 'Tesouraria de Liquidação Direct Trading AZKOYEN' WHERE code = 'PLATFORM_TRADING_POOL'`
  ).run();
  db.prepare(
    `UPDATE users SET full_name = 'Diretoria Executiva' WHERE id = 'DEMO-ADMIN-001'`
  ).run();
  db.prepare(
    `UPDATE users SET full_name = 'Diretoria Executiva AZKOYEN' WHERE id = 'ADM-REAL-SUPER-01'`
  ).run();
  db.prepare(
    `UPDATE users SET full_name = 'Henrique Vasconcelos' WHERE id = 'DEMO-TRADER-001'`
  ).run();
  db.prepare(
    `UPDATE users SET full_name = 'Helena Alencar' WHERE id = 'DEMO-TRADER-002'`
  ).run();
  db.prepare(
    `UPDATE users SET full_name = 'Conta Institucional' WHERE id = 'DEMO-INVESTOR-001'`
  ).run();
  db.prepare(
    `UPDATE products SET name = 'AZKOYEN Quant Alpha Prime', is_demo = 0 WHERE id = 'PROD-DEMO-QUANT-01'`
  ).run();
  db.prepare(
    `UPDATE products SET name = 'AZKOYEN Sovereign Liquidity Pool', is_demo = 0 WHERE id = 'PROD-DEMO-TREASURY-02'`
  ).run();
  db.prepare(
    `UPDATE products SET name = 'AZKOYEN Prime Institutional Alpha' WHERE id = 'PROD-AZK-PRIME-01'`
  ).run();
  db.prepare(
    `UPDATE products SET contract_terms = REPLACE(contract_terms, 'AZKOYE INVEST', 'AZKOYEN INVEST'), description = REPLACE(description, 'AZKOYE INVEST', 'AZKOYEN INVEST') WHERE contract_terms LIKE '%AZKOYE INVEST%' OR description LIKE '%AZKOYE INVEST%'`
  ).run();
  db.prepare(
    `UPDATE pools SET name = 'Pool Q4 · Quant Alpha #01', is_demo = 0 WHERE id = 'POOL-DEMO-Q1'`
  ).run();
  db.prepare(
    `UPDATE pools SET name = 'Pool Q4 · Liquidez Soberana #02', is_demo = 0 WHERE id = 'POOL-DEMO-L1'`
  ).run();

  // Seed institutional catalog & baseline balanced double-entry accounts only if no products exist
  const existingProducts = db.prepare(`SELECT COUNT(*) AS cnt FROM products`).get() as { cnt: number };
  if (existingProducts.cnt === 0) {
    const now = new Date().toISOString();
    const demoAdminId = 'DEMO-ADMIN-001';
    const demoTrader1Id = 'DEMO-TRADER-001';
    const demoTrader2Id = 'DEMO-TRADER-002';
    const demoInvestorId = 'DEMO-INVESTOR-001';

    // Sandbox/catalog accounts use non-login random hashes; real accounts register or claim Super Admin via private route
    const sandboxDisabledHash = hashPassword(crypto.randomBytes(32).toString('hex'));

    db.prepare(
      `INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role, admin_tier, email_verified, kyc_status, tax_id, phone, country, status, is_demo, created_at)
       VALUES (?, ?, ?, ?, 'admin', 'super_admin', 1, 'approved', '00.000.000/0001-00', '+55 11 99000-0000', 'BR', 'active', 1, ?)`
    ).run(demoAdminId, 'diretoria@azkoyeinvest.com', sandboxDisabledHash, 'Diretoria Executiva', now);

    db.prepare(
      `INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role, email_verified, kyc_status, tax_id, phone, country, status, is_demo, created_at)
       VALUES (?, ?, ?, ?, 'trader', 1, 'approved', '111.222.333-44', '+55 11 98100-1000', 'BR', 'active', 1, ?)`
    ).run(demoTrader1Id, 'henrique.vasconcelos@azkoyeinvest.com', sandboxDisabledHash, 'Henrique Vasconcelos', now);

    db.prepare(
      `INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role, email_verified, kyc_status, tax_id, phone, country, status, is_demo, created_at)
       VALUES (?, ?, ?, ?, 'trader', 1, 'approved', '555.666.777-88', '+55 21 98200-2000', 'BR', 'active', 1, ?)`
    ).run(demoTrader2Id, 'helena.alencar@azkoyeinvest.com', sandboxDisabledHash, 'Helena Alencar', now);

    db.prepare(
      `INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role, email_verified, kyc_status, tax_id, phone, country, status, is_demo, created_at)
       VALUES (?, ?, ?, ?, 'investor', 1, 'approved', '999.888.777-66', '+55 11 97300-3000', 'BR', 'active', 1, ?)`
    ).run(demoInvestorId, 'institucional@azkoyeinvest.com', sandboxDisabledHash, 'Conta Institucional', now);

    db.prepare(
      `INSERT OR IGNORE INTO trader_profiles (user_id, photo_url, bio, experience_years, specialties_json, strategies, documents_json, credentials_summary, approval_status, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)`
    ).run(
      demoTrader1Id,
      '/src/assets/images/trader_portrait_one_1795271716411.jpg',
      'Gestor quantitativo sênior com 14 anos em mesas proprietárias institucionais em São Paulo e Londres. Especialista em arbitragem estatística e futuros perpétuos de alta liquidez.',
      14,
      JSON.stringify(['Arbitragem Quantitativa', 'Futuros CME/Binance', 'Delta Neutral']),
      'Execução sistemática com hedge dinâmico e controle rígido de drawdown máximo de 2.5% por ciclo.',
      JSON.stringify([{ name: 'Certificação CQF & Ancord', verified: true }]),
      'CQF · Ex-Mesa Proprietária Institucional',
      demoAdminId,
      now
    );

    db.prepare(
      `INSERT OR IGNORE INTO trader_profiles (user_id, photo_url, bio, experience_years, specialties_json, strategies, documents_json, credentials_summary, approval_status, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)`
    ).run(
      demoTrader2Id,
      '/src/assets/images/trader_portrait_two_1795271716425.jpg',
      'Estrategista macro e derivativos cambiais com atuação em tesourarias corporativas e gestão de liquidez multi-chain em USDC.',
      11,
      JSON.stringify(['Macro FX', 'Tesouraria USDC', 'Opções Estruturadas']),
      'Operações de spread cambial G10 e provisão de liquidez institucional com proteção de capital.',
      JSON.stringify([{ name: 'CFA Charterholder', verified: true }]),
      'CFA · Especialista em Derivativos & Liquidez',
      demoAdminId,
      now
    );

    ensureWalletForUser(demoInvestorId);
    ensureWalletForUser(demoTrader1Id);
    ensureWalletForUser(demoTrader2Id);

    const mat1 = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
    const mat2 = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);

    const prod1Id = 'PROD-DEMO-QUANT-01';
    const prod2Id = 'PROD-DEMO-TREASURY-02';

    db.prepare(
      `INSERT INTO products (id, name, image_url, description, trader_id, strategy, market, risk_level, min_capital_cents, max_capital_cents, contractual_yield_bps, term_days, maturity_date, redemption_policy, loss_policy, early_redemption_allowed, early_redemption_penalty_bps, contract_terms, status, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?)`
    ).run(
      prod1Id,
      'AZKOYEN Quant Alpha Prime',
      '/src/assets/images/product_quant_alpha_1795271716510.jpg',
      'Pool quantitativo multi-estratégia com foco em arbitragem de taxa de financiamento e futuros líquidos em USD. Rentabilidade contratual sujeita à apuração real e lastro líquido do pool.',
      demoTrader1Id,
      'Arbitragem Delta-Neutral & Spreads de Futuros',
      'Futuros BTC/ETH & Índices Globais',
      'Moderado',
      100000, // $1,000.00
      10000000, // $100,000.00
      450, // 4.50% contractual target per 90d cycle
      90,
      mat1,
      'Resgate integral no vencimento mediante liquidação auditada. Resgate antecipado sujeito à janela D+5 e penalidade contratual de 5%.',
      'Reserva de contingência de 10% no pool. Rentabilidade contratual não configura garantia absoluta de lucro operacional; perdas acima da reserva seguem rateio proporcional.',
      1,
      500,
      'Instrumento Particular de Participação em Pool Segregado AZKOYEN INVEST. Excedente líquido apurado distribuído conforme política contratual vigente após obrigações e reservas.',
      now
    );

    db.prepare(
      `INSERT INTO products (id, name, image_url, description, trader_id, strategy, market, risk_level, min_capital_cents, max_capital_cents, contractual_yield_bps, term_days, maturity_date, redemption_policy, loss_policy, early_redemption_allowed, early_redemption_penalty_bps, contract_terms, status, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?)`
    ).run(
      prod2Id,
      'AZKOYEN Sovereign Liquidity Pool',
      '/src/assets/images/product_usdc_treasury_1795271717871.jpg',
      'Estratégia conservadora de tesouraria digital em dólar (USDC) com operações de câmbio G10 e arbitragem institucional de liquidez.',
      demoTrader2Id,
      'Câmbio Institucional & Liquidez Estruturada',
      'FX G10 & Mercados Monetários Digitais',
      'Conservador',
      50000, // $500.00
      25000000, // $250,000.00
      280, // 2.80% contractual per 60d cycle
      60,
      mat2,
      'Liquidação automática programada no vencimento após conciliação contábil do pool.',
      'Política de preservação de capital com stop institucional diário e segregação contábil total por pool.',
      0,
      0,
      'Contrato de Adesão ao Pool Segregado de Liquidez em USD AZKOYEN INVEST.',
      now
    );

    const pool1Id = 'POOL-DEMO-Q1';
    const pool2Id = 'POOL-DEMO-L1';

    db.prepare(
      `INSERT INTO pools (id, product_id, name, trader_id, min_pool_cents, max_pool_cents, raised_cents, operational_capital_cents, reserve_cents, realized_pnl_cents, contractual_obligation_cents, investor_share_bps, trader_share_bps, status, opened_at, closes_at, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 9500, 500, 'active_trading', ?, ?, 0)`
    ).run(
      pool1Id,
      prod1Id,
      'Pool Q4 · Quant Alpha #01',
      demoTrader1Id,
      2500000, // $25,000 min
      15000000, // $150,000 max
      0,
      0,
      0,
      0,
      0,
      now,
      mat1
    );

    db.prepare(
      `INSERT INTO pools (id, product_id, name, trader_id, min_pool_cents, max_pool_cents, raised_cents, operational_capital_cents, reserve_cents, realized_pnl_cents, contractual_obligation_cents, investor_share_bps, trader_share_bps, status, opened_at, closes_at, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 9500, 500, 'open', ?, ?, 0)`
    ).run(
      pool2Id,
      prod2Id,
      'Pool Q4 · Liquidez Soberana #02',
      demoTrader2Id,
      1000000, // $10,000 min
      20000000, // $200,000 max
      0,
      0,
      0,
      0,
      0,
      now,
      mat2
    );

    ensureLedgerAccount(`POOL_CAPITAL:${pool1Id}`, `Capital Pool ${pool1Id}`, 'liability');
    ensureLedgerAccount(`POOL_RESERVE:${pool1Id}`, `Reserva Pool ${pool1Id}`, 'equity');
    ensureLedgerAccount(`POOL_PNL:${pool1Id}`, `Resultado Realizado Pool ${pool1Id}`, 'revenue');

    ensureLedgerAccount(`POOL_CAPITAL:${pool2Id}`, `Capital Pool ${pool2Id}`, 'liability');
    ensureLedgerAccount(`POOL_RESERVE:${pool2Id}`, `Reserva Pool ${pool2Id}`, 'equity');
    ensureLedgerAccount(`POOL_PNL:${pool2Id}`, `Resultado Realizado Pool ${pool2Id}`, 'revenue');

    // Seed an authentic double-entry demonstration deposit + investment + approved manual operation so charts & ledger reconcile 100%
    postDoubleEntryTransaction({
      idempotencyKey: 'SEED-DEMO-DEP-01',
      userId: demoInvestorId,
      txType: 'deposit_usdc',
      amountCents: 5000000, // $50,000.00
      originAccount: 'ASSET_USDC_CUSTODY',
      destinationAccount: `LIABILITY_USER_AVAILABLE:${demoInvestorId}`,
      externalRef: 'DEMO-USDC-ONCHAIN-0x9f3a',
      description: '[DEMONSTRAÇÃO] Depósito USDC Arbitrum confirmado on-chain',
      createdBy: demoAdminId,
      legs: [
        {
          accountCode: 'ASSET_USDC_CUSTODY',
          accountName: 'Custódia Institucional USDC On-Chain',
          accountType: 'asset',
          debitCents: 5000000,
          creditCents: 0,
        },
        {
          accountCode: `LIABILITY_USER_AVAILABLE:${demoInvestorId}`,
          accountName: `Disponível Investidor ${demoInvestorId}`,
          accountType: 'liability',
          debitCents: 0,
          creditCents: 5000000,
        },
      ],
      afterCommit: () => {
        db.prepare(
          `UPDATE wallets SET available_cents = available_cents + 5000000, updated_at = ? WHERE user_id = ?`
        ).run(now, demoInvestorId);
        db.prepare(
          `INSERT OR IGNORE INTO deposits (id, user_id, method, network, fee_cents, net_usd_cents, usdc_address, tx_hash, confirmations, required_confirmations, status, idempotency_key, created_at, confirmed_at)
           VALUES ('DEP-DEMO-01', ?, 'USDC', 'ARBITRUM', 0, 5000000, '0x71C9A8E4B2F904D12C8E4A9B003F4E11A9C28D04', '0x9f3a8c12d4b0e91a77e1c4b2d8a190c3f112ab44', 12, 12, 'confirmed', 'SEED-DEMO-DEP-01', ?, ?)`
        ).run(demoInvestorId, now, now);
      },
    });

    // Allocate $25,000 from Demo Investor into Pool 1 via Double Entry
    postDoubleEntryTransaction({
      idempotencyKey: 'SEED-DEMO-INV-01',
      userId: demoInvestorId,
      txType: 'investment_allocate',
      amountCents: 2500000, // $25,000.00
      originAccount: `LIABILITY_USER_AVAILABLE:${demoInvestorId}`,
      destinationAccount: `POOL_CAPITAL:${pool1Id}`,
      externalRef: 'AZK-CTR-DEMO-001',
      description: '[DEMONSTRAÇÃO] Alocação em Pool Q4 · Quant Alpha #01',
      createdBy: demoInvestorId,
      legs: [
        {
          accountCode: `LIABILITY_USER_AVAILABLE:${demoInvestorId}`,
          accountName: `Disponível Investidor ${demoInvestorId}`,
          accountType: 'liability',
          debitCents: 2500000,
          creditCents: 0,
        },
        {
          accountCode: `LIABILITY_USER_INVESTED:${demoInvestorId}`,
          accountName: `Investido Investidor ${demoInvestorId}`,
          accountType: 'liability',
          debitCents: 0,
          creditCents: 2500000,
        },
        {
          accountCode: `POOL_CAPITAL:${pool1Id}`,
          accountName: `Capital Pool ${pool1Id}`,
          accountType: 'liability',
          debitCents: 0,
          creditCents: 2500000,
        },
        {
          accountCode: `POOL_OPERATING_ASSET:${pool1Id}`,
          accountName: `Capital Operacional Alocado ${pool1Id}`,
          accountType: 'asset',
          debitCents: 2500000,
          creditCents: 0,
        },
      ],
      afterCommit: () => {
        db.prepare(
          `UPDATE wallets SET available_cents = available_cents - 2500000, invested_cents = invested_cents + 2500000, pending_yield_cents = 112500, updated_at = ? WHERE user_id = ?`
        ).run(now, demoInvestorId);
        db.prepare(
          `UPDATE pools SET raised_cents = 2500000, operational_capital_cents = 2250000, reserve_cents = 250000, contractual_obligation_cents = 112500 WHERE id = ?`
        ).run(pool1Id);
        db.prepare(
          `INSERT OR IGNORE INTO investments (id, contract_code, investor_id, product_id, pool_id, principal_cents, pool_share_ppm, contractual_yield_cents, realized_yield_cents, status, contract_snapshot_json, invested_at, maturity_date, is_demo)
           VALUES ('INV-DEMO-01', 'AZK-CTR-DEMO-001', ?, ?, ?, 2500000, 1000000, 112500, 0, 'active', ?, ?, ?, 1)`
        ).run(
          demoInvestorId,
          prod1Id,
          pool1Id,
          JSON.stringify({
            contractCode: 'AZK-CTR-DEMO-001',
            investorName: 'Investidor Institucional [DEMONSTRAÇÃO]',
            productName: 'AZKOYEN Quant Alpha Prime [DEMONSTRAÇÃO]',
            poolName: 'Pool Q4 · Quant Alpha #01 [DEMONSTRAÇÃO]',
            principalUsd: 25000,
            contractualRatePct: 4.5,
            maturityDate: mat1,
            disclaimer: 'Registro demonstrativo. Rentabilidade contratual não representa garantia de lucro operacional.',
          }),
          now,
          mat1
        );
      },
    });

    // Seed one approved manual operation in Demo Pool 1
    postDoubleEntryTransaction({
      idempotencyKey: 'SEED-DEMO-OP-01',
      userId: demoTrader1Id,
      txType: 'operation_pnl',
      amountCents: 185000, // +$1,850.00 net PnL
      originAccount: `POOL_OPERATING_ASSET:${pool1Id}`,
      destinationAccount: `POOL_PNL:${pool1Id}`,
      externalRef: 'OP-DEMO-001',
      description: '[DEMONSTRAÇÃO] Lucro apurado em operação manual aprovada OP-DEMO-001',
      createdBy: demoAdminId,
      legs: [
        {
          accountCode: `POOL_OPERATING_ASSET:${pool1Id}`,
          accountName: `Capital Operacional Alocado ${pool1Id}`,
          accountType: 'asset',
          debitCents: 185000,
          creditCents: 0,
        },
        {
          accountCode: `POOL_PNL:${pool1Id}`,
          accountName: `Resultado Realizado Pool ${pool1Id}`,
          accountType: 'revenue',
          debitCents: 0,
          creditCents: 185000,
        },
      ],
      afterCommit: () => {
        db.prepare(
          `UPDATE pools SET realized_pnl_cents = realized_pnl_cents + 185000, operational_capital_cents = operational_capital_cents + 185000 WHERE id = ?`
        ).run(pool1Id);
        db.prepare(
          `INSERT OR IGNORE INTO manual_operations (id, op_code, pool_id, trader_id, asset, op_type, exchange_venue, entry_value_cents, exit_value_cents, fees_cents, net_pnl_cents, evidence_ref, notes, status, reviewed_by, review_notes, executed_at, created_at, updated_at)
           VALUES ('OP-DEMO-01', 'OP-DEMO-001', ?, ?, 'BTC-PERP / USDT', 'ARBITRAGE', 'Binance Institutional', 1200000, 1388500, 3500, 185000, 'DEMO-HASH-EXEC-88412A · Comprovante Verificado', '[DEMONSTRAÇÃO] Arbitragem funding spread executada e conciliada.', 'approved', ?, 'Evidências e extrato da corretora conferidos.', ?, ?, ?)`
        ).run(pool1Id, demoTrader1Id, demoAdminId, now, now, now);
      },
    });
  }
}
