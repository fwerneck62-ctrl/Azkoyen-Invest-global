export type UserRole = 'investor' | 'trader' | 'admin';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  admin_tier: 'super_admin' | 'finance_admin' | 'ops_admin' | 'compliance_admin' | null;
  email_verified: number;
  kyc_status: 'pending' | 'submitted' | 'approved' | 'rejected';
  tax_id?: string | null;
  document_type?: string | null;
  phone?: string | null;
  country?: string | null;
  preferred_language?: string | null;
  postal_code?: string | null;
  city?: string | null;
  state_region?: string | null;
  verification_source?: string | null;
  mfa_enabled: number;
  status: 'active' | 'pending_approval' | 'suspended';
  is_demo: number;
  created_at?: string;
}

export interface Wallet {
  id: string;
  user_id: string;
  available_cents: number;
  reserved_cents: number;
  invested_cents: number;
  realized_yield_cents: number;
  pending_yield_cents: number;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  image_url: string;
  description: string;
  trader_id: string;
  trader_name?: string;
  trader_photo?: string;
  trader_bio?: string;
  experience_years?: number;
  credentials_summary?: string;
  strategy: string;
  market: string;
  risk_level: 'Conservador' | 'Moderado' | 'Arrojado' | 'Institucional';
  min_capital_cents: number;
  max_capital_cents: number;
  contractual_yield_bps: number;
  term_days: number;
  maturity_date: string;
  redemption_policy: string;
  loss_policy: string;
  early_redemption_allowed: number;
  early_redemption_penalty_bps: number;
  contract_terms: string;
  trader_share_bps?: number;
  commission_fee_bps?: number;
  status: 'active' | 'paused' | 'closed';
  is_demo: number;
}

export interface Pool {
  id: string;
  product_id: string;
  product_name?: string;
  trader_name?: string;
  name: string;
  trader_id: string;
  min_pool_cents: number;
  max_pool_cents: number;
  raised_cents: number;
  operational_capital_cents: number;
  reserve_cents: number;
  realized_pnl_cents: number;
  contractual_obligation_cents: number;
  investor_share_bps: number;
  trader_share_bps: number;
  status: 'open' | 'active_trading' | 'settling' | 'settled' | 'halted';
  opened_at: string;
  closes_at: string;
  settled_at?: string | null;
  participant_count?: number;
  verified_ops_count?: number;
  is_demo: number;
}

export interface Investment {
  id: string;
  contract_code: string;
  investor_id: string;
  investor_name?: string;
  investor_email?: string;
  product_id: string;
  product_name?: string;
  pool_id: string;
  pool_name?: string;
  pool_status?: string;
  trader_name?: string;
  market?: string;
  risk_level?: string;
  contractual_yield_bps?: number;
  principal_cents: number;
  pool_share_ppm: number;
  contractual_yield_cents: number;
  realized_yield_cents: number;
  status: 'active' | 'matured' | 'settled' | 'early_redeemed';
  contract_snapshot_json: string;
  invested_at: string;
  maturity_date: string;
  settled_at?: string | null;
  is_demo: number;
}

export interface ManualOperation {
  id: string;
  op_code: string;
  pool_id: string;
  pool_name?: string;
  trader_id: string;
  trader_name?: string;
  asset: string;
  op_type: 'LONG' | 'SHORT' | 'HEDGE' | 'ARBITRAGE' | 'OPTIONS';
  exchange_venue: string;
  entry_value_cents: number;
  exit_value_cents: number;
  fees_cents: number;
  net_pnl_cents: number;
  evidence_ref: string;
  notes?: string | null;
  status: 'draft' | 'submitted' | 'in_review' | 'approved' | 'rejected' | 'adjustment_requested';
  reviewed_by?: string | null;
  review_notes?: string | null;
  parent_op_id?: string | null;
  executed_at: string;
  created_at: string;
}

export interface Deposit {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  method: 'PIX' | 'USDC';
  network: string;
  gross_brl_cents?: number | null;
  fx_rate_brl_per_usd?: number | null;
  fee_cents: number;
  net_usd_cents: number;
  pix_txid?: string | null;
  pix_copy_paste?: string | null;
  qr_data_url?: string | null;
  usdc_address?: string | null;
  tx_hash?: string | null;
  confirmations: number;
  required_confirmations: number;
  status: 'pending' | 'confirming' | 'confirmed' | 'rejected';
  created_at: string;
  confirmed_at?: string | null;
}

export interface Withdrawal {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  method: 'PIX' | 'USDC';
  destination_key: string;
  network: string;
  requested_usd_cents: number;
  fee_cents: number;
  net_payout_cents: number;
  status: 'requested' | 'in_review' | 'approved' | 'processing' | 'completed' | 'rejected';
  review_notes?: string | null;
  tx_hash?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LedgerTransaction {
  id: string;
  user_id?: string;
  tx_type: string;
  amount_cents: number;
  currency: string;
  origin_account: string;
  destination_account: string;
  status: string;
  external_ref?: string;
  description: string;
  created_at: string;
  entries_json?: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  category: string;
  read_at?: string | null;
  created_at: string;
}

export interface SupportTicket {
  id: string;
  user_id: string;
  full_name?: string;
  email?: string;
  subject: string;
  category: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved';
  admin_reply?: string | null;
  created_at: string;
}

export interface MarketAssetQuote {
  symbol: string;
  base: string;
  quote: string;
  name: string;
  decimals: number;
  price: number | null;
  bid: number | null;
  ask: number | null;
  change24hPct: number | null;
  updatedAtMs: number | null;
  source: string;
}

export interface MarketTickPoint {
  ts: number;
  price: number;
}

export interface TimedTrade {
  id: string;
  trade_code: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  asset: string;
  direction: 'BUY' | 'SELL';
  stake_cents: number;
  payout_bps: number;
  duration_sec: number;
  entry_price: number;
  settlement_price?: number | null;
  opened_at: string;
  opened_at_ms: number;
  expires_at: string;
  expires_at_ms: number;
  settled_at?: string | null;
  status: 'open' | 'won' | 'lost' | 'tie';
  payout_cents: number;
  pnl_cents: number;
  feed_source: string;
}

