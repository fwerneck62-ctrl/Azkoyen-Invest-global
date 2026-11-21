import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Users,
  Briefcase,
  Package,
  Layers,
  CheckSquare,
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  Scale,
  FileSpreadsheet,
  ClipboardList,
  Settings,
  LogOut,
  UserCog,
  LifeBuoy,
  Lock,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { CountryLanguageSelector } from './CountryLanguageSelector';
import { useLocale } from '../i18n/LocaleContext';
import { apiFetch, connectRealtime, getAuthToken } from '../lib/api';
import { formatPctFromBps } from '../lib/format';
import type { User } from '../types';

type AdminSection =
  | 'dashboard'
  | 'investidores'
  | 'traders'
  | 'aprovacao_traders'
  | 'produtos'
  | 'pools'
  | 'participantes'
  | 'investimentos'
  | 'operacoes_manuais'
  | 'operacoes_diretas'
  | 'rendimentos_comissoes'
  | 'depositos'
  | 'saques'
  | 'carteiras_reservas'
  | 'liquidacoes'
  | 'conciliacao'
  | 'relatorios'
  | 'auditoria'
  | 'seguranca'
  | 'configuracoes'
  | 'administradores'
  | 'suporte';

export const AdminPortal: React.FC<{
  user: User;
  onLogout: () => void;
  onUserRefresh?: (u: User) => void;
}> = ({ user, onLogout, onUserRefresh }) => {
  const { t, statusLabel, formatUsdLocale, formatDateTimeLocale } = useLocale();
  const [section, setSection] = useState<AdminSection>('dashboard');
  const [data, setData] = useState<any>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Create Product Form
  const [prodName, setProdName] = useState('');
  const [prodTraderId, setProdTraderId] = useState('');
  const [prodStrategy, setProdStrategy] = useState('');
  const [prodMarket, setProdMarket] = useState('Futuros & FX');
  const [prodRisk, setProdRisk] = useState('Moderado');
  const [prodYieldPct, setProdYieldPct] = useState('3.5');
  const [prodTermDays, setProdTermDays] = useState('90');
  const [prodMinUsd, setProdMinUsd] = useState('1000');
  const [prodMaxUsd, setProdMaxUsd] = useState('100000');
  const [prodTraderSharePct, setProdTraderSharePct] = useState('5');
  const [prodCommFeePct, setProdCommFeePct] = useState('0');
  const [prodEarlyAllowed, setProdEarlyAllowed] = useState(false);
  const [prodEarlyPenaltyPct, setProdEarlyPenaltyPct] = useState('5');

  // Edit Product Modal
  const [editProduct, setEditProduct] = useState<any>(null);
  const [editProdSyncPools, setEditProdSyncPools] = useState(true);

  // Per-Trader Compensation Edits
  const [traderEdits, setTraderEdits] = useState<
    Record<string, { profitPct: string; commPct: string; syncPools: boolean }>
  >({});

  // Create Pool Form
  const [poolProdId, setPoolProdId] = useState('');
  const [poolName, setPoolName] = useState('');
  const [poolMinUsd, setPoolMinUsd] = useState('10000');
  const [poolMaxUsd, setPoolMaxUsd] = useState('250000');
  const [poolInvShare, setPoolInvShare] = useState('95');

  // Per-Pool Inline Edits
  const [poolEdits, setPoolEdits] = useState<
    Record<string, { traderSharePct: string; minUsd: string; maxUsd: string; closesAt: string }>
  >({});

  // Create Admin Form
  const [admName, setAdmName] = useState('');
  const [admEmail, setAdmEmail] = useState('');
  const [admPassword, setAdmPassword] = useState('');
  const [admTier, setAdmTier] = useState('finance_admin');

  // Settings local edits
  const [fxRate, setFxRate] = useState('5.78');
  const [pixFeeBps, setPixFeeBps] = useState('45');
  const [usdcFeeBps, setUsdcFeeBps] = useState('25');
  const [wdPixFeeBps, setWdPixFeeBps] = useState('60');
  const [wdUsdcFeeUsd, setWdUsdcFeeUsd] = useState('2.50');
  const [defaultTraderSharePct, setDefaultTraderSharePct] = useState('5');
  const [platformCommFeePct, setPlatformCommFeePct] = useState('0');
  const [stEnabled, setStEnabled] = useState('true');
  const [stPayoutBps, setStPayoutBps] = useState('7000');
  const [stMinUsd, setStMinUsd] = useState('5');
  const [stMaxUsd, setStMaxUsd] = useState('10000');

  // Ticket reply
  const [replyText, setReplyText] = useState<Record<string, string>>({});

  const loadOverview = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/overview');
      setData(res);
      if (res.settings) {
        setFxRate(res.settings.brl_per_usd_rate || '5.78');
        setPixFeeBps(res.settings.pix_fee_bps || '45');
        setUsdcFeeBps(res.settings.usdc_fee_bps || '25');
        setWdPixFeeBps(res.settings.withdrawal_pix_fee_bps || '60');
        setWdUsdcFeeUsd(((Number(res.settings.withdrawal_usdc_fee_cents || 250)) / 100).toFixed(2));
        setDefaultTraderSharePct(String((Number(res.settings.default_trader_share_bps || 500)) / 100));
        setPlatformCommFeePct(String((Number(res.settings.platform_commission_fee_bps || 0)) / 100));
        setStEnabled(res.settings.self_trading_enabled || 'true');
        setStPayoutBps(res.settings.self_trading_payout_bps || '7000');
        setStMinUsd(res.settings.self_trading_min_usd || '5');
        setStMaxUsd(res.settings.self_trading_max_usd || '10000');
      }
      if (res.traderApps) {
        setTraderEdits((prev) => {
          const next = { ...prev };
          for (const tApp of res.traderApps) {
            if (!next[tApp.user_id]) {
              next[tApp.user_id] = {
                profitPct: String((Number(tApp.profit_share_bps ?? 500)) / 100),
                commPct: String((Number(tApp.commission_fee_bps ?? 0)) / 100),
                syncPools: true,
              };
            }
          }
          return next;
        });
      }
      if (res.pools) {
        setPoolEdits((prev) => {
          const next = { ...prev };
          for (const pl of res.pools) {
            if (!next[pl.id]) {
              next[pl.id] = {
                traderSharePct: String((Number(pl.trader_share_bps ?? 500)) / 100),
                minUsd: String(Math.round(Number(pl.min_pool_cents || 0) / 100)),
                maxUsd: String(Math.round(Number(pl.max_pool_cents || 0) / 100)),
                closesAt: String(pl.closes_at || '').slice(0, 10),
              };
            }
          }
          return next;
        });
      }
      if (res.products?.[0] && !poolProdId) {
        setPoolProdId(res.products[0].id);
        const defTrdPct = Number(res.products[0].trader_share_bps ?? 500) / 100;
        setPoolInvShare(String(100 - defTrdPct));
      }
      const firstTrader = (res.users || []).find((u: any) => u.role === 'trader' && u.status === 'active');
      if (firstTrader && !prodTraderId) setProdTraderId(firstTrader.id);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  }, [poolProdId, prodTraderId]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;
    return connectRealtime(token, () => {
      loadOverview();
    });
  }, [loadOverview]);

  const execAction = async (fn: () => Promise<void>, okMsg: string): Promise<boolean> => {
    setFeedback(null);
    try {
      await fn();
      setFeedback({ type: 'ok', text: okMsg });
      loadOverview();
      return true;
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
      return false;
    }
  };

  if (!data) {
    return (
      <div className="min-h-screen bg-[#060609] text-zinc-400 flex items-center justify-center text-sm">
        Carregando Console Administrativo AZKOYEN INVEST...
      </div>
    );
  }

  const investors = (data.users || []).filter((u: any) => u.role === 'investor');
  const traders = (data.users || []).filter((u: any) => u.role === 'trader');
  const admins = (data.users || []).filter((u: any) => u.role === 'admin');
  const pendingTraders = (data.traderApps || []).filter((t: any) => t.approval_status === 'pending');
  const pendingOps = (data.operations || []).filter((o: any) => ['submitted', 'in_review'].includes(o.status));
  const pendingWithdrawals = (data.withdrawals || []).filter((w: any) => !['completed', 'rejected'].includes(w.status));

  const totalAumCents = (data.pools || []).reduce((s: number, p: any) => s + p.raised_cents, 0);
  const totalReservesCents = (data.pools || []).reduce((s: number, p: any) => s + p.reserve_cents, 0);

  const persistLocalePreference = async (nextCountry: string, nextLang: string) => {
    try {
      const res = await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ country: nextCountry, preferredLanguage: nextLang }),
      });
      if (res.user) onUserRefresh?.(res.user);
    } catch {
      // ignore non-blocking preference save
    }
  };

  const menuGroups: Array<{ group: string; items: Array<{ id: AdminSection; label: string; icon: React.ReactNode }> }> = [
    {
      group: 'Executivo',
      items: [
        { id: 'dashboard', label: t('admOverview'), icon: <ShieldAlert className="w-4 h-4" /> },
        { id: 'conciliacao', label: t('admReconciliation'), icon: <Scale className="w-4 h-4" /> },
        { id: 'relatorios', label: t('admReports'), icon: <FileSpreadsheet className="w-4 h-4" /> },
      ],
    },
    {
      group: 'Compliance',
      items: [
        { id: 'investidores', label: t('admInvestors'), icon: <Users className="w-4 h-4" /> },
        { id: 'traders', label: t('admTraders'), icon: <Briefcase className="w-4 h-4" /> },
        { id: 'aprovacao_traders', label: `${t('admApproveTraders')} (${pendingTraders.length})`, icon: <CheckSquare className="w-4 h-4" /> },
        { id: 'administradores', label: t('admAdmins'), icon: <UserCog className="w-4 h-4" /> },
      ],
    },
    {
      group: 'Pools',
      items: [
        { id: 'produtos', label: t('admProducts'), icon: <Package className="w-4 h-4" /> },
        { id: 'pools', label: t('admPools'), icon: <Layers className="w-4 h-4" /> },
        { id: 'participantes', label: t('admParticipants'), icon: <Users className="w-4 h-4" /> },
        { id: 'investimentos', label: t('admInvestments'), icon: <ClipboardList className="w-4 h-4" /> },
      ],
    },
    {
      group: 'Trading & PnL',
      items: [
        { id: 'operacoes_manuais', label: `${t('admOperations')} (${pendingOps.length})`, icon: <CheckSquare className="w-4 h-4" /> },
        { id: 'operacoes_diretas', label: `${t('admTimedTrades')} (${(data.timedTrades || []).length})`, icon: <Scale className="w-4 h-4" /> },
        { id: 'rendimentos_comissoes', label: t('admYieldsComm'), icon: <Scale className="w-4 h-4" /> },
        { id: 'liquidacoes', label: t('admSettlements'), icon: <Layers className="w-4 h-4" /> },
      ],
    },
    {
      group: 'Treasury & Ledger',
      items: [
        { id: 'depositos', label: t('admDeposits'), icon: <ArrowDownLeft className="w-4 h-4" /> },
        { id: 'saques', label: `${t('admWithdrawals')} (${pendingWithdrawals.length})`, icon: <ArrowUpRight className="w-4 h-4" /> },
        { id: 'carteiras_reservas', label: t('admWallets'), icon: <Wallet className="w-4 h-4" /> },
      ],
    },
    {
      group: 'Governance',
      items: [
        { id: 'auditoria', label: t('admAudit'), icon: <ClipboardList className="w-4 h-4" /> },
        { id: 'seguranca', label: t('admSecurity'), icon: <Lock className="w-4 h-4" /> },
        { id: 'configuracoes', label: t('admSettings'), icon: <Settings className="w-4 h-4" /> },
        { id: 'suporte', label: t('admSupport'), icon: <LifeBuoy className="w-4 h-4" /> },
      ],
    },
  ];

  const exportLedgerCsv = () => {
    const rows = [
      ['ID', 'Tipo', 'ValorUSD', 'Origem', 'Destino', 'Status', 'Data', 'Descricao'],
      ...(data.ledgerTransactions || []).map((t: any) => [
        t.id,
        t.tx_type,
        (t.amount_cents / 100).toFixed(2),
        t.origin_account,
        t.destination_account,
        t.status,
        t.created_at,
        `"${String(t.description).replace(/"/g, '""')}"`,
      ]),
    ];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `azkoyen-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#060609] text-[#F1F3F5] flex">
      <aside className="hidden xl:flex w-72 shrink-0 flex-col bg-[#090A0F] border-r border-white/[0.08]">
        <div className="p-5 border-b border-white/[0.08]">
          <BrandLogo
            size="sm"
            subtitle={`Governança · ${user.admin_tier || 'super_admin'}`}
          />
        </div>
        <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
          {menuGroups.map((g) => (
            <div key={g.group}>
              <div className="px-3 mb-1.5 text-[11px] font-semibold text-zinc-500">{g.group}</div>
              <div className="space-y-0.5">
                {g.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSection(item.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                      section === item.id ? 'bg-[#E11D2E] text-white' : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="p-4 border-t border-white/[0.08]">
          <button
            onClick={onLogout}
            className="w-full py-2 text-xs font-medium bg-[#141722] hover:bg-[#1D2130] text-zinc-200 rounded-lg flex items-center justify-center gap-2"
          >
            <LogOut className="w-3.5 h-3.5 text-[#E11D2E]" />
            <span>{t('admEndSession')}</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 px-4 sm:px-8 border-b border-white/[0.08] bg-[#08090E]/90 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="text-sm text-zinc-400 truncate">
            <span className="text-white font-semibold">AZKOYEN INVEST</span> · {t('admTitle')}
          </div>
          <div className="flex items-center gap-3 shrink-0 text-xs">
            <CountryLanguageSelector onCountryOrLangChange={persistLocalePreference} />
            <span className={data.reconciliation?.overallHealthy ? 'text-emerald-400 font-semibold hidden sm:inline' : 'text-[#E11D2E] font-semibold hidden sm:inline'}>
              {data.reconciliation?.overallHealthy ? t('admLedgerBalanced') : t('admLedgerMismatch')}
            </span>
            <button onClick={onLogout} className="xl:hidden px-3 py-1.5 bg-[#161925] rounded text-zinc-200">
              {t('logout')}
            </button>
          </div>
        </header>

        {/* Compact horizontal selector on smaller screens */}
        <div className="xl:hidden p-2 bg-[#090A0F] border-b border-white/[0.08] flex gap-1.5 overflow-x-auto">
          {menuGroups.flatMap((g) => g.items).map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`px-3 py-1.5 text-xs rounded whitespace-nowrap ${
                section === item.id ? 'bg-[#E11D2E] text-white' : 'bg-[#12141E] text-zinc-400'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto space-y-6">
          {feedback && (
            <div
              className={`p-3.5 rounded-lg border text-xs flex justify-between ${
                feedback.type === 'ok'
                  ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-200'
                  : 'bg-[#E11D2E]/10 border-[#E11D2E]/40 text-red-200'
              }`}
            >
              <span>{feedback.text}</span>
              <button onClick={() => setFeedback(null)} className="text-zinc-400">{t('close')}</button>
            </div>
          )}

          {/* 1. DASHBOARD GERAL */}
          {section === 'dashboard' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-xs text-zinc-400">AUM</div>
                  <div className="text-2xl font-mono tabular-nums font-bold text-white mt-1.5">{formatUsdLocale(totalAumCents)}</div>
                </div>
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-xs text-zinc-400">Reserves</div>
                  <div className="text-2xl font-mono tabular-nums font-bold text-white mt-1.5">{formatUsdLocale(totalReservesCents)}</div>
                </div>
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-xs text-zinc-400">Queues</div>
                  <div className="text-2xl font-mono tabular-nums font-bold text-amber-400 mt-1.5">
                    {pendingTraders.length + pendingOps.length + pendingWithdrawals.length}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-1">
                    {pendingTraders.length} traders · {pendingOps.length} ops · {pendingWithdrawals.length} wd
                  </div>
                </div>
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-xs text-zinc-400">Fundraising Gate</div>
                  <div className={`text-lg font-bold mt-2 ${data.settings?.public_fundraising_enabled === 'true' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {data.settings?.public_fundraising_enabled === 'true' ? statusLabel('active') : statusLabel('halted')}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-3">
                  <h3 className="text-sm font-display font-semibold text-white">{t('admWallets')}</h3>
                  <div className="space-y-2 max-h-72 overflow-y-auto text-xs">
                    {(data.ledgerAccounts || []).map((acc: any) => (
                      <div key={acc.code} className="flex justify-between py-1.5 border-b border-white/[0.05]">
                        <div>
                          <div className="font-mono text-zinc-200">{acc.code}</div>
                          <div className="text-[11px] text-zinc-500">{acc.name} ({acc.account_type})</div>
                        </div>
                        <div className="font-mono tabular-nums text-white">{formatUsdLocale(acc.balance_cents)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-3">
                  <h3 className="text-sm font-display font-semibold text-white">{t('admAudit')}</h3>
                  <div className="space-y-2 max-h-72 overflow-y-auto text-xs">
                    {(data.auditLogs || []).slice(0, 12).map((log: any) => (
                      <div key={log.id} className="flex justify-between py-1.5 border-b border-white/[0.05]">
                        <div>
                          <span className="font-mono text-[#E11D2E]">{log.action}</span>
                          <div className="text-[11px] text-zinc-400">{log.actor_email || 'system'} · {log.entity_type}</div>
                        </div>
                        <div className="font-mono text-[11px] text-zinc-500">{formatDateTimeLocale(log.created_at)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 2. INVESTIDORES */}
          {section === 'investidores' && (
            <div className="rounded-xl bg-[#0D0F16] border border-white/[0.08] overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-zinc-400">
                  <tr>
                    <th className="py-3 px-4">{t('admInvestors')}</th>
                    <th className="py-3 px-4">{t('countryLabel')} / ID</th>
                    <th className="py-3 px-4">KYC / Registry</th>
                    <th className="py-3 px-4">MFA</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {investors.map((u: any) => (
                    <tr key={u.id}>
                      <td className="py-3 px-4">
                        <div className="text-white font-medium">{u.full_name}</div>
                        <div className="text-zinc-500">{u.email}</div>
                        {(u.city || u.state_region) && (
                          <div className="text-[11px] text-zinc-500">
                            {[u.city, u.state_region, u.postal_code].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-xs font-semibold text-white">
                          {u.country || 'BR'} · <span className="font-mono text-zinc-300">{u.document_type || 'TAX_ID'}</span>
                        </div>
                        <div className="font-mono text-zinc-400">{u.tax_id || '—'}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-white">{statusLabel(u.kyc_status)}</div>
                        {u.verification_source && (
                          <div className={`text-[11px] font-mono ${u.verification_source === 'registry_live' ? 'text-emerald-400' : 'text-zinc-400'}`}>
                            {u.verification_source === 'registry_live' ? t('docValidRegistry') : 'checksum'}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">{u.mfa_enabled ? statusLabel('active') : 'Off'}</td>
                      <td className="py-3 px-4">{statusLabel(u.status)}</td>
                      <td className="py-3 px-4 text-right space-x-2">
                        {u.kyc_status !== 'approved' && (
                          <button
                            onClick={() =>
                              execAction(
                                () => apiFetch(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ kycStatus: 'approved' }) }),
                                'KYC approved.'
                              )
                            }
                            className="px-2.5 py-1 bg-emerald-600 text-white rounded text-[11px]"
                          >
                            Approve KYC
                          </button>
                        )}
                        <button
                          onClick={() =>
                            execAction(
                              () =>
                                apiFetch(`/api/admin/users/${u.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ status: u.status === 'active' ? 'suspended' : 'active' }),
                                }),
                              'Status updated.'
                            )
                          }
                          className="px-2.5 py-1 bg-[#181B26] text-zinc-200 rounded text-[11px]"
                        >
                          {u.status === 'active' ? statusLabel('suspended') : statusLabel('active')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 3 & 4. TRADERS & APROVAÇÃO */}
          {(section === 'traders' || section === 'aprovacao_traders') && (
            <div className="space-y-4">
              {(section === 'aprovacao_traders' ? pendingTraders : data.traderApps || []).map((tApp: any) => {
                const edit = traderEdits[tApp.user_id] || {
                  profitPct: String((Number(tApp.profit_share_bps ?? 500)) / 100),
                  commPct: String((Number(tApp.commission_fee_bps ?? 0)) / 100),
                  syncPools: true,
                };
                return (
                  <div key={tApp.user_id} className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-4 text-xs">
                    <div className="flex flex-col lg:flex-row justify-between gap-4">
                      <div className="space-y-1.5">
                        <div className="text-sm font-semibold text-white">
                          {tApp.full_name} <span className="text-zinc-500 font-normal">({tApp.email})</span>
                        </div>
                        <div className="text-zinc-400">{tApp.credentials_summary} · {tApp.experience_years}y</div>
                        <p className="text-zinc-300 max-w-3xl">{tApp.bio}</p>
                        <div className="text-zinc-400">{tApp.strategies}</div>
                        <div className="flex flex-wrap gap-3 pt-1 font-mono text-[11px]">
                          <span className="text-zinc-400">
                            Status: <span className="text-white font-semibold font-sans">{statusLabel(tApp.approval_status)}</span>
                          </span>
                          <span className="text-emerald-400">
                            Lucro Trader: {((Number(tApp.profit_share_bps ?? 500)) / 100).toFixed(2)}%
                          </span>
                          <span className="text-amber-300">
                            Taxa Comissão: {((Number(tApp.commission_fee_bps ?? 0)) / 100).toFixed(2)}%
                          </span>
                        </div>
                      </div>
                      {tApp.approval_status === 'pending' && (
                        <div className="flex items-start gap-2 shrink-0">
                          <button
                            onClick={() =>
                              execAction(
                                () => apiFetch(`/api/admin/traders/${tApp.user_id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) }),
                                'Trader aprovado.'
                              )
                            }
                            className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-semibold"
                          >
                            {statusLabel('approved')}
                          </button>
                          <button
                            onClick={() =>
                              execAction(
                                () => apiFetch(`/api/admin/traders/${tApp.user_id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'rejected' }) }),
                                'Trader recusado.'
                              )
                            }
                            className="px-4 py-2 bg-[#E11D2E] text-white rounded-lg font-semibold"
                          >
                            {statusLabel('rejected')}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Configuração Individual de % Lucro & Taxa de Comissão */}
                    <div className="pt-3 border-t border-white/[0.06] grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">% Lucro do Trader (0–80%)</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="80"
                          value={edit.profitPct}
                          onChange={(e) =>
                            setTraderEdits((prev) => ({
                              ...prev,
                              [tApp.user_id]: { ...edit, profitPct: e.target.value },
                            }))
                          }
                          className="w-full px-3 py-1.5 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">Taxa de Comissão (%) (0–50%)</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="50"
                          value={edit.commPct}
                          onChange={(e) =>
                            setTraderEdits((prev) => ({
                              ...prev,
                              [tApp.user_id]: { ...edit, commPct: e.target.value },
                            }))
                          }
                          className="w-full px-3 py-1.5 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono"
                        />
                      </div>
                      <label className="flex items-center gap-2 text-[11px] text-zinc-300 py-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={edit.syncPools}
                          onChange={(e) =>
                            setTraderEdits((prev) => ({
                              ...prev,
                              [tApp.user_id]: { ...edit, syncPools: e.target.checked },
                            }))
                          }
                          className="rounded border-white/20 bg-[#06070B]"
                        />
                        <span>Aplicar em produtos e pools abertos</span>
                      </label>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await execAction(
                            () =>
                              apiFetch(`/api/admin/traders/${tApp.user_id}/compensation`, {
                                method: 'PATCH',
                                body: JSON.stringify({
                                  profitSharePct: Number(edit.profitPct),
                                  commissionFeePct: Number(edit.commPct),
                                  applyToProductsAndPools: edit.syncPools,
                                }),
                              }),
                            `Percentuais de ${tApp.full_name} atualizados.`
                          );
                          if (ok && edit.syncPools) {
                            setPoolEdits({});
                          }
                        }}
                        className="px-4 py-2 bg-[#E11D2E] hover:bg-[#FF2438] text-white font-semibold rounded-lg"
                      >
                        Salvar Taxas do Trader
                      </button>
                    </div>
                  </div>
                );
              })}
              {section === 'aprovacao_traders' && pendingTraders.length === 0 && (
                <div className="p-8 text-center text-xs text-zinc-500 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  Nenhuma candidatura de trader pendente de aprovação.
                </div>
              )}
            </div>
          )}

          {/* 5. PRODUTOS */}
          {section === 'produtos' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  execAction(
                    () =>
                      apiFetch('/api/admin/products', {
                        method: 'POST',
                        body: JSON.stringify({
                          name: prodName,
                          traderId: prodTraderId,
                          strategy: prodStrategy,
                          market: prodMarket,
                          riskLevel: prodRisk,
                          contractualYieldPct: Number(prodYieldPct),
                          termDays: Number(prodTermDays),
                          minCapitalUsd: Number(prodMinUsd),
                          maxCapitalUsd: Number(prodMaxUsd),
                          traderSharePct: Number(prodTraderSharePct),
                          commissionFeePct: Number(prodCommFeePct),
                          earlyRedemptionAllowed: prodEarlyAllowed,
                          earlyPenaltyPct: Number(prodEarlyPenaltyPct),
                        }),
                      }),
                    'Produto institucional criado.'
                  );
                  setProdName('');
                }}
                className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-3 text-xs"
              >
                <h3 className="text-sm font-display font-semibold text-white">Novo Produto de Investimento</h3>
                <input
                  type="text"
                  required
                  value={prodName}
                  onChange={(e) => setProdName(e.target.value)}
                  placeholder="Nome do produto"
                  className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                />
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Trader Responsável</label>
                  <select
                    required
                    value={prodTraderId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setProdTraderId(nextId);
                      const prof = (data.traderApps || []).find((ta: any) => ta.user_id === nextId);
                      if (prof) {
                        setProdTraderSharePct(String((Number(prof.profit_share_bps ?? 500)) / 100));
                        setProdCommFeePct(String((Number(prof.commission_fee_bps ?? 0)) / 100));
                      }
                    }}
                    className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                  >
                    {traders.map((t: any) => (
                      <option key={t.id} value={t.id}>{t.full_name}</option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  required
                  value={prodStrategy}
                  onChange={(e) => setProdStrategy(e.target.value)}
                  placeholder="Estratégia operacional"
                  className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={prodMarket}
                    onChange={(e) => setProdMarket(e.target.value)}
                    placeholder="Mercado"
                    className="px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                  />
                  <select
                    value={prodRisk}
                    onChange={(e) => setProdRisk(e.target.value)}
                    className="px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                  >
                    <option value="Conservador">Conservador</option>
                    <option value="Moderado">Moderado</option>
                    <option value="Arrojado">Arrojado</option>
                    <option value="Institucional">Institucional</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Lucro Usuário (%)</label>
                    <input type="number" step="0.1" min="0" value={prodYieldPct} onChange={(e) => setProdYieldPct(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white font-mono" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Prazo (dias)</label>
                    <input type="number" min="1" value={prodTermDays} onChange={(e) => setProdTermDays(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white font-mono" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Comissão Trader (%)</label>
                    <input type="number" step="0.1" min="0" max="80" value={prodTraderSharePct} onChange={(e) => setProdTraderSharePct(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white font-mono" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Taxa Comissão (%)</label>
                    <input type="number" step="0.1" min="0" max="50" value={prodCommFeePct} onChange={(e) => setProdCommFeePct(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white font-mono" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Mínimo USD</label>
                    <input type="number" min="1" value={prodMinUsd} onChange={(e) => setProdMinUsd(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white font-mono" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Máximo USD</label>
                    <input type="number" min="1" value={prodMaxUsd} onChange={(e) => setProdMaxUsd(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white font-mono" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 items-center pt-1">
                  <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
                    <input type="checkbox" checked={prodEarlyAllowed} onChange={(e) => setProdEarlyAllowed(e.target.checked)} />
                    <span>Resgate antecipado</span>
                  </label>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Multa Antec. (%)</label>
                    <input type="number" step="0.1" min="0" max="50" value={prodEarlyPenaltyPct} onChange={(e) => setProdEarlyPenaltyPct(e.target.value)} className="w-full px-3 py-1.5 bg-[#06070B] border border-white/[0.1] rounded-lg text-white font-mono" />
                  </div>
                </div>
                <button type="submit" className="w-full py-2.5 bg-[#E11D2E] text-white font-semibold rounded-lg">
                  Publicar Produto
                </button>
              </form>

              <div className="lg:col-span-2 space-y-3">
                {(data.products || []).map((p: any) => (
                  <div key={p.id} className="p-4 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-3 text-xs">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-white">{p.name}</div>
                        <div className="text-zinc-400 mt-0.5">
                          {p.trader_name} · {p.strategy} · {p.risk_level} · <span className="text-white">{statusLabel(p.status)}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => {
                            setEditProduct({
                              id: p.id,
                              name: p.name,
                              traderId: p.trader_id,
                              strategy: p.strategy,
                              market: p.market,
                              riskLevel: p.risk_level,
                              description: p.description,
                              contractualYieldPct: String((Number(p.contractual_yield_bps || 0)) / 100),
                              termDays: String(p.term_days || 90),
                              maturityDate: String(p.maturity_date || '').slice(0, 10),
                              minCapitalUsd: String(Math.round(Number(p.min_capital_cents || 0) / 100)),
                              maxCapitalUsd: String(Math.round(Number(p.max_capital_cents || 0) / 100)),
                              traderSharePct: String((Number(p.trader_share_bps ?? p.trader_profile_profit_bps ?? 500)) / 100),
                              commissionFeePct: String((Number(p.commission_fee_bps ?? p.trader_profile_commission_bps ?? 0)) / 100),
                              earlyRedemptionAllowed: Boolean(p.early_redemption_allowed),
                              earlyPenaltyPct: String((Number(p.early_redemption_penalty_bps || 0)) / 100),
                              redemptionPolicy: p.redemption_policy || '',
                              lossPolicy: p.loss_policy || '',
                              status: p.status,
                            });
                            setEditProdSyncPools(true);
                          }}
                          className="px-3 py-1.5 bg-[#E11D2E] hover:bg-[#FF2438] text-white font-semibold rounded"
                        >
                          Editar Parâmetros
                        </button>
                        <button
                          onClick={() =>
                            execAction(
                              () => apiFetch(`/api/admin/products/${p.id}`, { method: 'PATCH', body: JSON.stringify({ status: p.status === 'active' ? 'paused' : 'active' }) }),
                              'Status atualizado.'
                            )
                          }
                          className="px-3 py-1.5 bg-[#181B26] text-white rounded"
                        >
                          {p.status === 'active' ? statusLabel('paused') : statusLabel('active')}
                        </button>
                        <button
                          onClick={() =>
                            execAction(
                              () => apiFetch(`/api/admin/products/${p.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) }),
                              'Produto encerrado.'
                            )
                          }
                          className="px-3 py-1.5 bg-[#E11D2E]/20 text-red-300 rounded"
                        >
                          {statusLabel('closed')}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-white/[0.06] font-mono tabular-nums text-[11px]">
                      <div>
                        <div className="text-zinc-500 font-sans">Lucro Usuário</div>
                        <div className="text-emerald-400 font-semibold">{formatPctFromBps(p.contractual_yield_bps)}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500 font-sans">Prazo / Venc.</div>
                        <div className="text-white">{p.term_days}d · {p.maturity_date}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500 font-sans">Comissão Trader</div>
                        <div className="text-white">{((Number(p.trader_share_bps ?? 500)) / 100).toFixed(2)}%</div>
                      </div>
                      <div>
                        <div className="text-zinc-500 font-sans">Taxa Comissão</div>
                        <div className="text-amber-300">{((Number(p.commission_fee_bps ?? 0)) / 100).toFixed(2)}%</div>
                      </div>
                      <div>
                        <div className="text-zinc-500 font-sans">Limites USD</div>
                        <div className="text-zinc-300">{formatUsdLocale(p.min_capital_cents)} – {formatUsdLocale(p.max_capital_cents)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 6. POOLS DE CAPITAL */}
          {section === 'pools' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  execAction(
                    () =>
                      apiFetch('/api/admin/pools', {
                        method: 'POST',
                        body: JSON.stringify({
                          productId: poolProdId,
                          name: poolName,
                          minPoolUsd: Number(poolMinUsd),
                          maxPoolUsd: Number(poolMaxUsd),
                          investorSharePct: Number(poolInvShare),
                        }),
                      }),
                    'Pool criado com sucesso.'
                  );
                  setPoolName('');
                }}
                className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-3 text-xs"
              >
                <h3 className="text-sm font-display font-semibold text-white">{t('admPools')}</h3>
                <select
                  value={poolProdId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    setPoolProdId(pid);
                    const prod = (data.products || []).find((pr: any) => pr.id === pid);
                    if (prod) {
                      const trdPct = Number(prod.trader_share_bps ?? prod.trader_profile_profit_bps ?? 500) / 100;
                      setPoolInvShare(String(100 - trdPct));
                    }
                  }}
                  className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                >
                  {(data.products || []).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <input type="text" required value={poolName} onChange={(e) => setPoolName(e.target.value)} placeholder="Nome do Pool" className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white" />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Mín. Pool (USD)</label>
                    <input type="number" value={poolMinUsd} onChange={(e) => setPoolMinUsd(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white font-mono" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Máx. Pool (USD)</label>
                    <input type="number" value={poolMaxUsd} onChange={(e) => setPoolMaxUsd(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white font-mono" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">% Investidores</label>
                    <input type="number" step="0.1" min="20" max="100" value={poolInvShare} onChange={(e) => setPoolInvShare(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white font-mono" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">% Lucro Trader</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="80"
                      value={(100 - Number(poolInvShare || 95)).toFixed(1)}
                      onChange={(e) => setPoolInvShare(String(100 - Number(e.target.value || 0)))}
                      className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded-lg text-white font-mono"
                    />
                  </div>
                </div>
                <button type="submit" className="w-full py-2.5 bg-[#E11D2E] text-white font-semibold rounded-lg">
                  + Criar Pool
                </button>
              </form>

              <div className="lg:col-span-2 space-y-3">
                {(data.pools || []).map((pl: any) => {
                  const pEdit = poolEdits[pl.id] || {
                    traderSharePct: String((Number(pl.trader_share_bps ?? 500)) / 100),
                    minUsd: String(Math.round(Number(pl.min_pool_cents || 0) / 100)),
                    maxUsd: String(Math.round(Number(pl.max_pool_cents || 0) / 100)),
                    closesAt: String(pl.closes_at || '').slice(0, 10),
                  };
                  return (
                    <div key={pl.id} className="p-4 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-3 text-xs">
                      <div className="flex flex-wrap justify-between items-center gap-2">
                        <div>
                          <div className="text-sm font-semibold text-white">{pl.name}</div>
                          <div className="text-zinc-400 text-[11px]">
                            {pl.product_name} · Trader: {pl.trader_name} · Divisão: {(pl.investor_share_bps / 100).toFixed(1)}% / {(pl.trader_share_bps / 100).toFixed(1)}%
                          </div>
                        </div>
                        <span className="text-zinc-300">{statusLabel(pl.status)}</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono tabular-nums text-zinc-300">
                        <div>Captado: <span className="text-white">{formatUsdLocale(pl.raised_cents)}</span></div>
                        <div>Operacional: <span className="text-white">{formatUsdLocale(pl.operational_capital_cents)}</span></div>
                        <div>Reserva: <span className="text-white">{formatUsdLocale(pl.reserve_cents)}</span></div>
                        <div>PnL: <span className="text-emerald-400">{formatUsdLocale(pl.realized_pnl_cents)}</span></div>
                      </div>

                      {pl.status !== 'settled' && (
                        <div className="pt-2 border-t border-white/[0.06] grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                          <div>
                            <label className="block text-[10px] text-zinc-500 mb-1">% Lucro Trader</label>
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="80"
                              value={pEdit.traderSharePct}
                              onChange={(e) =>
                                setPoolEdits((prev) => ({
                                  ...prev,
                                  [pl.id]: { ...pEdit, traderSharePct: e.target.value },
                                }))
                              }
                              className="w-full px-2.5 py-1.5 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-zinc-500 mb-1">Mín. USD</label>
                            <input
                              type="number"
                              min="100"
                              value={pEdit.minUsd}
                              onChange={(e) =>
                                setPoolEdits((prev) => ({
                                  ...prev,
                                  [pl.id]: { ...pEdit, minUsd: e.target.value },
                                }))
                              }
                              className="w-full px-2.5 py-1.5 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-zinc-500 mb-1">Máx. USD</label>
                            <input
                              type="number"
                              min="100"
                              value={pEdit.maxUsd}
                              onChange={(e) =>
                                setPoolEdits((prev) => ({
                                  ...prev,
                                  [pl.id]: { ...pEdit, maxUsd: e.target.value },
                                }))
                              }
                              className="w-full px-2.5 py-1.5 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-zinc-500 mb-1">Vencimento</label>
                            <input
                              type="date"
                              value={pEdit.closesAt}
                              onChange={(e) =>
                                setPoolEdits((prev) => ({
                                  ...prev,
                                  [pl.id]: { ...pEdit, closesAt: e.target.value },
                                }))
                              }
                              className="w-full px-2.5 py-1.5 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              execAction(
                                () =>
                                  apiFetch(`/api/admin/pools/${pl.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({
                                      traderSharePct: Number(pEdit.traderSharePct),
                                      minPoolUsd: Number(pEdit.minUsd),
                                      maxPoolUsd: Number(pEdit.maxUsd),
                                      closesAt: pEdit.closesAt,
                                    }),
                                  }),
                                `Parâmetros do pool ${pl.name} salvos.`
                              )
                            }
                            className="px-3 py-1.5 bg-[#E11D2E] text-white font-semibold rounded"
                          >
                            Salvar Pool
                          </button>
                        </div>
                      )}

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => execAction(() => apiFetch(`/api/admin/pools/${pl.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'active_trading' }) }), 'Operação do pool iniciada.')}
                          className="px-3 py-1 bg-[#181B26] text-white rounded"
                        >
                          {statusLabel('active_trading')}
                        </button>
                        <button
                          onClick={() => execAction(() => apiFetch(`/api/admin/pools/${pl.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'halted' }) }), 'Pool suspenso.')}
                          className="px-3 py-1 bg-[#E11D2E]/20 text-red-300 rounded"
                        >
                          {statusLabel('halted')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 7 & 8. PARTICIPANTES & INVESTIMENTOS */}
          {(section === 'participantes' || section === 'investimentos') && (
            <div className="rounded-xl bg-[#0D0F16] border border-white/[0.08] overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-zinc-400">
                  <tr>
                    <th className="py-3 px-4">ID</th>
                    <th className="py-3 px-4">{t('admInvestors')}</th>
                    <th className="py-3 px-4">Pool</th>
                    <th className="py-3 px-4 text-right">Principal</th>
                    <th className="py-3 px-4 text-right">%</th>
                    <th className="py-3 px-4 text-right">{t('pendingYield')}</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {(data.investments || []).map((inv: any) => (
                    <tr key={inv.id}>
                      <td className="py-3 px-4 font-mono text-white">{inv.contract_code}</td>
                      <td className="py-3 px-4">{inv.investor_name}</td>
                      <td className="py-3 px-4">{inv.pool_name}</td>
                      <td className="py-3 px-4 text-right font-mono text-white">{formatUsdLocale(inv.principal_cents)}</td>
                      <td className="py-3 px-4 text-right font-mono">{(inv.pool_share_ppm / 10000).toFixed(2)}%</td>
                      <td className="py-3 px-4 text-right font-mono text-zinc-300">{formatUsdLocale(inv.contractual_yield_cents)}</td>
                      <td className="py-3 px-4">{statusLabel(inv.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 9 & 10. OPERAÇÕES MANUAIS & APROVAÇÃO DE RESULTADOS */}
          {section === 'operacoes_manuais' && (
            <div className="space-y-3">
              {(data.operations || []).map((op: any) => (
                <div key={op.id} className="p-4 rounded-xl bg-[#0D0F16] border border-white/[0.08] flex flex-col lg:flex-row justify-between gap-4 text-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-white">{op.op_code}</span>
                      <span className="text-zinc-400">· {op.trader_name} · {op.pool_name}</span>
                    </div>
                    <div className="text-zinc-300">
                      {op.asset} ({op.op_type}) @ {op.exchange_venue} · {formatUsdLocale(op.entry_value_cents)} → {formatUsdLocale(op.exit_value_cents)} (Fees: {formatUsdLocale(op.fees_cents)})
                    </div>
                    <div className="font-mono text-zinc-400">Ref: <span className="text-zinc-200">{op.evidence_ref}</span></div>
                  </div>
                  <div className="flex flex-col items-end justify-between gap-2 shrink-0">
                    <div className={`text-base font-mono font-bold ${op.net_pnl_cents >= 0 ? 'text-emerald-400' : 'text-[#E11D2E]'}`}>
                      {formatUsdLocale(op.net_pnl_cents)} · {statusLabel(op.status)}
                    </div>
                    {['submitted', 'in_review'].includes(op.status) && (
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            execAction(
                              () => apiFetch(`/api/admin/operations/${op.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'approved', reviewNotes: 'Approved.' }) }),
                              `${op.op_code} approved.`
                            )
                          }
                          className="px-3 py-1.5 bg-emerald-600 text-white rounded font-semibold"
                        >
                          {statusLabel('approved')}
                        </button>
                        <button
                          onClick={() =>
                            execAction(
                              () => apiFetch(`/api/admin/operations/${op.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'adjustment_requested', reviewNotes: 'Adjustment requested.' }) }),
                              'Adjustment requested.'
                            )
                          }
                          className="px-3 py-1.5 bg-amber-600 text-white rounded font-semibold"
                        >
                          {statusLabel('adjustment_requested')}
                        </button>
                        <button
                          onClick={() =>
                            execAction(
                              () => apiFetch(`/api/admin/operations/${op.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'rejected', reviewNotes: 'Rejected.' }) }),
                              'Rejected.'
                            )
                          }
                          className="px-3 py-1.5 bg-[#E11D2E] text-white rounded font-semibold"
                        >
                          {statusLabel('rejected')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* OPERAÇÕES DIRETAS (SELF-TRADING TIMED OPTIONS) */}
          {section === 'operacoes_diretas' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono tabular-nums">
                <div className="p-4 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-zinc-400 font-sans">{t('admTimedTrades')}</div>
                  <div className="text-xl font-bold text-white mt-1">{(data.timedTrades || []).length}</div>
                </div>
                <div className="p-4 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-zinc-400 font-sans">Open</div>
                  <div className="text-xl font-bold text-amber-400 mt-1">
                    {(data.timedTrades || []).filter((x: any) => x.status === 'open').length}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-zinc-400 font-sans">Volume USD</div>
                  <div className="text-xl font-bold text-white mt-1">
                    {formatUsdLocale((data.timedTrades || []).reduce((s: number, x: any) => s + Number(x.stake_cents || 0), 0))}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-zinc-400 font-sans">Client Net PnL</div>
                  <div className="text-xl font-bold text-emerald-400 mt-1">
                    {formatUsdLocale((data.timedTrades || []).reduce((s: number, x: any) => s + Number(x.pnl_cents || 0), 0))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-[#0D0F16] border border-white/[0.08] overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/[0.08] text-zinc-400">
                    <tr>
                      <th className="py-3 px-4">ID</th>
                      <th className="py-3 px-4">{t('admInvestors')}</th>
                      <th className="py-3 px-4">Asset / Dir</th>
                      <th className="py-3 px-4 text-right">{t('stEntryPrice')}</th>
                      <th className="py-3 px-4 text-right">{t('stClosePrice')}</th>
                      <th className="py-3 px-4 text-right">Stake USD</th>
                      <th className="py-3 px-4 text-right">PnL</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05] font-mono tabular-nums">
                    {(data.timedTrades || []).map((tr: any) => (
                      <tr key={tr.id}>
                        <td className="py-3 px-4 text-white">{tr.trade_code}</td>
                        <td className="py-3 px-4 font-sans">
                          <div className="text-white">{tr.user_name}</div>
                          <div className="text-zinc-500 text-[11px]">{tr.user_email}</div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-white">{tr.asset}</span>{' '}
                          <span className={tr.direction === 'BUY' ? 'text-emerald-400 font-bold' : 'text-[#E11D2E] font-bold'}>
                            {tr.direction}
                          </span>{' '}
                          <span className="text-zinc-500">({tr.duration_sec}s)</span>
                        </td>
                        <td className="py-3 px-4 text-right text-zinc-200">{tr.entry_price}</td>
                        <td className="py-3 px-4 text-right text-zinc-300">{tr.settlement_price ?? '—'}</td>
                        <td className="py-3 px-4 text-right text-white">{formatUsdLocale(tr.stake_cents)}</td>
                        <td
                          className={`py-3 px-4 text-right font-bold ${
                            tr.pnl_cents > 0 ? 'text-emerald-400' : tr.pnl_cents < 0 ? 'text-[#E11D2E]' : 'text-zinc-300'
                          }`}
                        >
                          {tr.pnl_cents > 0 ? '+' : ''}
                          {formatUsdLocale(tr.pnl_cents)}
                        </td>
                        <td className="py-3 px-4 font-sans">{statusLabel(tr.status)}</td>
                        <td className="py-3 px-4 text-right text-zinc-500">{formatDateTimeLocale(tr.opened_at)}</td>
                      </tr>
                    ))}
                    {(!data.timedTrades || data.timedTrades.length === 0) && (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-zinc-500 font-sans">—</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 11, 12 & 17. RENDIMENTOS, COMISSÕES & LIQUIDAÇÕES */}
          {(section === 'rendimentos_comissoes' || section === 'liquidacoes') && (
            <div className="space-y-4">
              {(data.pools || []).map((pl: any) => {
                const eligibleSurplus = Math.max(0, pl.realized_pnl_cents - pl.contractual_obligation_cents);
                const estGrossTraderComm = Math.round((eligibleSurplus * pl.trader_share_bps) / 10000);
                const commFeeBps = Number(pl.product_commission_fee_bps ?? pl.trader_commission_fee_bps ?? 0);
                const estPlatformFee = Math.round((estGrossTraderComm * commFeeBps) / 10000);
                const estNetTraderComm = estGrossTraderComm - estPlatformFee;
                return (
                  <div key={pl.id} className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-3 text-xs">
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-white">{pl.name}</h3>
                        <div className="text-zinc-500">Trader: {pl.trader_name} · {statusLabel(pl.status)}</div>
                      </div>
                      {pl.status !== 'settled' && pl.raised_cents > 0 && (
                        <button
                          onClick={() =>
                            execAction(
                              () => apiFetch(`/api/admin/pools/${pl.id}/settle`, { method: 'POST' }),
                              `${pl.name} settled.`
                            )
                          }
                          className="px-4 py-2 bg-[#E11D2E] hover:bg-[#FF2438] text-white font-semibold rounded-lg"
                        >
                          {t('admSettlements')}
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 pt-2 border-t border-white/[0.06] font-mono tabular-nums">
                      <div>
                        <div className="text-zinc-500 font-sans">Captado</div>
                        <div className="text-white">{formatUsdLocale(pl.raised_cents)}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500 font-sans">Contratual</div>
                        <div className="text-amber-300">{formatUsdLocale(pl.contractual_obligation_cents)}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500 font-sans">PnL Realizado</div>
                        <div className="text-emerald-400">{formatUsdLocale(pl.realized_pnl_cents)}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500 font-sans">Lastro</div>
                        <div className="text-white">{formatUsdLocale(pl.operational_capital_cents + pl.reserve_cents)}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500 font-sans">Trader ({(pl.trader_share_bps / 100).toFixed(1)}%)</div>
                        <div className="text-zinc-200">{formatUsdLocale(estNetTraderComm)}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500 font-sans">Taxa Mesa ({(commFeeBps / 100).toFixed(1)}%)</div>
                        <div className="text-amber-300">{formatUsdLocale(estPlatformFee)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 13. DEPÓSITOS */}
          {section === 'depositos' && (
            <div className="rounded-xl bg-[#0D0F16] border border-white/[0.08] overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-zinc-400">
                  <tr>
                    <th className="py-3 px-4">ID</th>
                    <th className="py-3 px-4">{t('admInvestors')}</th>
                    <th className="py-3 px-4">Method</th>
                    <th className="py-3 px-4 text-right">USD Net</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {(data.deposits || []).map((d: any) => (
                    <tr key={d.id}>
                      <td className="py-3 px-4 font-mono text-white">{d.id}</td>
                      <td className="py-3 px-4">{d.user_name}</td>
                      <td className="py-3 px-4">{d.method} · {d.network}</td>
                      <td className="py-3 px-4 text-right font-mono text-emerald-400">{formatUsdLocale(d.net_usd_cents)}</td>
                      <td className="py-3 px-4">{statusLabel(d.status)}</td>
                      <td className="py-3 px-4 text-right">
                        {d.status !== 'confirmed' && (
                          <button
                            onClick={() => execAction(() => apiFetch(`/api/investor/deposits/${d.id}/confirm`, { method: 'POST' }), 'Confirmed.')}
                            className="px-3 py-1 bg-emerald-600 text-white rounded text-[11px]"
                          >
                            {statusLabel('confirmed')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 14. SAQUES */}
          {section === 'saques' && (
            <div className="space-y-3">
              {(data.withdrawals || []).map((w: any) => (
                <div key={w.id} className="p-4 rounded-xl bg-[#0D0F16] border border-white/[0.08] flex flex-col lg:flex-row justify-between gap-4 text-xs">
                  <div>
                    <div className="font-mono font-bold text-white">{w.id} · {w.method} ({w.network})</div>
                    <div className="text-zinc-300 mt-0.5">{w.user_name} ({w.user_email}) · <span className="font-mono">{w.destination_key}</span></div>
                    <div className="text-zinc-400 font-mono mt-0.5">
                      {formatUsdLocale(w.requested_usd_cents)} · Fee: {formatUsdLocale(w.fee_cents)} · Net: <span className="text-white">{formatUsdLocale(w.net_payout_cents)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-zinc-300 mr-2">{statusLabel(w.status)}</span>
                    {!['completed', 'rejected'].includes(w.status) && (
                      <>
                        <button
                          onClick={() =>
                            execAction(
                              () => apiFetch(`/api/admin/withdrawals/${w.id}/review`, { method: 'POST', body: JSON.stringify({ action: 'completed', txHash: `SETTLED-${Date.now()}` }) }),
                              'Completed.'
                            )
                          }
                          className="px-3 py-1.5 bg-emerald-600 text-white rounded font-semibold"
                        >
                          {statusLabel('completed')}
                        </button>
                        <button
                          onClick={() =>
                            execAction(
                              () => apiFetch(`/api/admin/withdrawals/${w.id}/review`, { method: 'POST', body: JSON.stringify({ action: 'rejected', reviewNotes: 'Rejected.' }) }),
                              'Rejected.'
                            )
                          }
                          className="px-3 py-1.5 bg-[#E11D2E] text-white rounded font-semibold"
                        >
                          {statusLabel('rejected')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 15 & 16. CARTEIRAS USD & RESERVAS */}
          {section === 'carteiras_reservas' && (
            <div className="rounded-xl bg-[#0D0F16] border border-white/[0.08] overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-zinc-400">
                  <tr>
                    <th className="py-3 px-4">{t('admInvestors')}</th>
                    <th className="py-3 px-4 text-right">{t('availableUsd')}</th>
                    <th className="py-3 px-4 text-right">Reserved</th>
                    <th className="py-3 px-4 text-right">{t('investedCapital')}</th>
                    <th className="py-3 px-4 text-right">{t('realizedYield')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {(data.wallets || []).map((w: any) => (
                    <tr key={w.id}>
                      <td className="py-3 px-4">
                        <div className="text-white">{w.full_name}</div>
                        <div className="text-zinc-500">{w.email}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-white">{formatUsdLocale(w.available_cents)}</td>
                      <td className="py-3 px-4 text-right font-mono text-amber-400">{formatUsdLocale(w.reserved_cents)}</td>
                      <td className="py-3 px-4 text-right font-mono text-white">{formatUsdLocale(w.invested_cents)}</td>
                      <td className="py-3 px-4 text-right font-mono text-emerald-400">{formatUsdLocale(w.realized_yield_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 18. CONCILIAÇÃO FINANCEIRA */}
          {section === 'conciliacao' && data.reconciliation && (
            <div className="p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-display font-semibold text-white">{t('admReconciliation')}</h3>
                <span className={data.reconciliation.overallHealthy ? 'text-emerald-400 font-bold' : 'text-[#E11D2E] font-bold'}>
                  {data.reconciliation.overallHealthy ? t('admLedgerBalanced') : t('admLedgerMismatch')}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono tabular-nums">
                <div className="p-4 rounded-lg bg-[#08090D] border border-white/[0.06]">
                  <div className="text-zinc-400 font-sans">Debits / Credits</div>
                  <div className="text-white mt-1">{formatUsdLocale(data.reconciliation.totalDebitsCents)} / {formatUsdLocale(data.reconciliation.totalCreditsCents)}</div>
                </div>
                <div className="p-4 rounded-lg bg-[#08090D] border border-white/[0.06]">
                  <div className="text-zinc-400 font-sans">Available vs Ledger</div>
                  <div className="text-white mt-1">{formatUsdLocale(data.reconciliation.walletTotals.available_cents)} / {formatUsdLocale(data.reconciliation.ledgerTotals.availableCents)}</div>
                </div>
                <div className="p-4 rounded-lg bg-[#08090D] border border-white/[0.06]">
                  <div className="text-zinc-400 font-sans">Invested vs Ledger</div>
                  <div className="text-white mt-1">{formatUsdLocale(data.reconciliation.walletTotals.invested_cents)} / {formatUsdLocale(data.reconciliation.ledgerTotals.investedCents)}</div>
                </div>
              </div>
            </div>
          )}

          {/* 19. RELATÓRIOS */}
          {section === 'relatorios' && (
            <div className="p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-4 text-xs">
              <h3 className="text-base font-display font-semibold text-white">{t('admReports')}</h3>
              <button onClick={exportLedgerCsv} className="px-4 py-2.5 bg-[#E11D2E] text-white font-semibold rounded-lg">
                Export Ledger (.CSV)
              </button>
            </div>
          )}

          {/* 20. AUDITORIA */}
          {section === 'auditoria' && (
            <div className="rounded-xl bg-[#0D0F16] border border-white/[0.08] overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-zinc-400">
                  <tr>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Actor</th>
                    <th className="py-3 px-4">Entity</th>
                    <th className="py-3 px-4">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {(data.auditLogs || []).map((a: any) => (
                    <tr key={a.id}>
                      <td className="py-2.5 px-4 font-mono text-[#E11D2E]">{a.action}</td>
                      <td className="py-2.5 px-4">{a.actor_email || 'system'}</td>
                      <td className="py-2.5 px-4 font-mono text-zinc-400">{a.entity_type} · {a.entity_id || '—'}</td>
                      <td className="py-2.5 px-4 font-mono text-zinc-500">{formatDateTimeLocale(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 21. SEGURANÇA & SESSÕES */}
          {section === 'seguranca' && (
            <div className="rounded-xl bg-[#0D0F16] border border-white/[0.08] overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-zinc-400">
                  <tr>
                    <th className="py-3 px-4">{t('emailLabel')}</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">IP</th>
                    <th className="py-3 px-4">Created</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {(data.sessions || []).map((s: any) => (
                    <tr key={s.id}>
                      <td className="py-2.5 px-4">{s.email}</td>
                      <td className="py-2.5 px-4">{s.role}</td>
                      <td className="py-2.5 px-4 font-mono text-zinc-400">{s.ip_address}</td>
                      <td className="py-2.5 px-4 font-mono text-zinc-500">{formatDateTimeLocale(s.created_at)}</td>
                      <td className="py-2.5 px-4 text-right">
                        {s.revoked_at ? (
                          <span className="text-zinc-500">{statusLabel('closed')}</span>
                        ) : (
                          <button
                            onClick={() => execAction(() => apiFetch(`/api/admin/sessions/${s.id}`, { method: 'DELETE' }), 'Revoked.')}
                            className="text-[#E11D2E] hover:underline"
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 22. CONFIGURAÇÕES & GATE REGULATÓRIO */}
          {section === 'configuracoes' && (
            <div className="p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-5 text-xs max-w-3xl">
              <h3 className="text-base font-display font-semibold text-white">Parâmetros Financeiros, Comissões & Conformidade de Custódia</h3>
              <div className="p-4 rounded-lg bg-[#08090D] border border-amber-500/30 space-y-3">
                <div className="text-amber-200">
                  Controle Institucional: Habilite a captação pública somente após a conclusão das validações jurídicas, regulatórias e de custódia.
                </div>
                <button
                  onClick={() =>
                    execAction(
                      () =>
                        apiFetch('/api/admin/settings', {
                          method: 'PATCH',
                          body: JSON.stringify({
                            public_fundraising_enabled: data.settings?.public_fundraising_enabled === 'true' ? 'false' : 'true',
                          }),
                        }),
                      'Status do Gate Regulatório atualizado.'
                    )
                  }
                  className={`px-4 py-2 font-semibold rounded-lg ${
                    data.settings?.public_fundraising_enabled === 'true' ? 'bg-emerald-600 text-white' : 'bg-[#E11D2E] text-white'
                  }`}
                >
                  {data.settings?.public_fundraising_enabled === 'true'
                    ? 'Captação Pública Ativa (Clique p/ Bloquear)'
                    : 'Liberar Captação Pública (Após Validação)'}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-zinc-400 mb-1">Cotação BRL/USD</label>
                  <input type="text" value={fxRate} onChange={(e) => setFxRate(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">Tarifa Depósito PIX (bps)</label>
                  <input type="text" value={pixFeeBps} onChange={(e) => setPixFeeBps(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">Tarifa Depósito USDC (bps)</label>
                  <input type="text" value={usdcFeeBps} onChange={(e) => setUsdcFeeBps(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
                </div>
              </div>

              <div className="pt-3 border-t border-white/[0.08] space-y-3">
                <div className="text-sm font-display font-semibold text-white">Padrões de Comissão & Tarifas de Saque</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-zinc-400 mb-1">% Padrão Lucro Trader</label>
                    <input type="number" step="0.1" min="0" max="80" value={defaultTraderSharePct} onChange={(e) => setDefaultTraderSharePct(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
                    <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                      Investidor: {(100 - Number(defaultTraderSharePct || 0)).toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">Taxa Comissão Mesa (%)</label>
                    <input type="number" step="0.1" min="0" max="50" value={platformCommFeePct} onChange={(e) => setPlatformCommFeePct(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">Taxa Saque PIX (bps)</label>
                    <input type="text" value={wdPixFeeBps} onChange={(e) => setWdPixFeeBps(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">Taxa Saque USDC (USD)</label>
                    <input type="number" step="0.1" min="0" value={wdUsdcFeeUsd} onChange={(e) => setWdUsdcFeeUsd(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-white/[0.08] space-y-3">
                <div className="text-sm font-display font-semibold text-white">{t('admTimedTrades')} (10s – 5m)</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-zinc-400 mb-1">Status</label>
                    <select value={stEnabled} onChange={(e) => setStEnabled(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white">
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">Payout (bps · 7000 = 70%)</label>
                    <input type="text" value={stPayoutBps} onChange={(e) => setStPayoutBps(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">Min USD</label>
                    <input type="text" value={stMinUsd} onChange={(e) => setStMinUsd(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">Max USD</label>
                    <input type="text" value={stMaxUsd} onChange={(e) => setStMaxUsd(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
                  </div>
                </div>
              </div>

              <button
                onClick={() =>
                  execAction(
                    () =>
                      apiFetch('/api/admin/settings', {
                        method: 'PATCH',
                        body: JSON.stringify({
                          brl_per_usd_rate: fxRate,
                          pix_fee_bps: pixFeeBps,
                          usdc_fee_bps: usdcFeeBps,
                          withdrawal_pix_fee_bps: wdPixFeeBps,
                          withdrawal_usdc_fee_cents: String(Math.round(Number(wdUsdcFeeUsd || 0) * 100)),
                          default_trader_share_bps: String(Math.round(Number(defaultTraderSharePct || 0) * 100)),
                          platform_commission_fee_bps: String(Math.round(Number(platformCommFeePct || 0) * 100)),
                          self_trading_enabled: stEnabled,
                          self_trading_payout_bps: stPayoutBps,
                          self_trading_min_usd: stMinUsd,
                          self_trading_max_usd: stMaxUsd,
                        }),
                      }),
                    'Configurações financeiras, comissões e operacionais salvas.'
                  )
                }
                className="px-4 py-2 bg-[#E11D2E] hover:bg-[#FF2438] text-white font-semibold rounded-lg"
              >
                Salvar Taxas e Parâmetros
              </button>
            </div>
          )}

          {/* 23. GESTÃO DE ADMINISTRADORES */}
          {section === 'administradores' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  execAction(
                    () =>
                      apiFetch('/api/admin/admins', {
                        method: 'POST',
                        body: JSON.stringify({ fullName: admName, email: admEmail, password: admPassword, adminTier: admTier }),
                      }),
                    'Administrador criado com RBAC.'
                  );
                  setAdmName('');
                  setAdmEmail('');
                  setAdmPassword('');
                }}
                className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-3"
              >
                <h3 className="text-sm font-display font-semibold text-white">Novo Administrador (RBAC por Nível)</h3>
                <input type="text" required value={admName} onChange={(e) => setAdmName(e.target.value)} placeholder="Nome completo" className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white" />
                <input type="email" required value={admEmail} onChange={(e) => setAdmEmail(e.target.value)} placeholder="E-mail institucional" className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white" />
                <input type="password" required minLength={8} value={admPassword} onChange={(e) => setAdmPassword(e.target.value)} placeholder="Senha (mín. 8 caracteres)" className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white" />
                <select value={admTier} onChange={(e) => setAdmTier(e.target.value)} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white">
                  <option value="finance_admin">Finance Admin (Tesouraria, Saques, Liquidação)</option>
                  <option value="ops_admin">Ops Admin (Produtos, Pools, Operações)</option>
                  <option value="compliance_admin">Compliance Admin (KYC, Traders, Auditoria)</option>
                  <option value="super_admin">Super Admin (Acesso Integral)</option>
                </select>
                <button type="submit" className="w-full py-2.5 bg-[#E11D2E] text-white font-semibold rounded-lg">
                  Cadastrar Administrador
                </button>
              </form>

              <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-2.5">
                <h3 className="text-sm font-display font-semibold text-white">Administradores Ativos</h3>
                {admins.map((a: any) => (
                  <div key={a.id} className="flex justify-between py-2 border-b border-white/[0.06]">
                    <div>
                      <div className="text-white font-medium">{a.full_name}</div>
                      <div className="text-zinc-500">{a.email}</div>
                    </div>
                    <span className="font-mono text-[#E11D2E]">{a.admin_tier}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SUPORTE */}
          {section === 'suporte' && (
            <div className="space-y-3 text-xs">
              {(data.tickets || []).map((t: any) => (
                <div key={t.id} className="p-4 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-2">
                  <div className="flex justify-between">
                    <span className="font-semibold text-white">{t.subject} — {t.full_name} ({t.email})</span>
                    <span className="text-zinc-400">{t.status}</span>
                  </div>
                  <p className="text-zinc-300">{t.message}</p>
                  {t.status !== 'resolved' && (
                    <div className="flex gap-2 pt-2">
                      <input
                        type="text"
                        value={replyText[t.id] || ''}
                        onChange={(e) => setReplyText({ ...replyText, [t.id]: e.target.value })}
                        placeholder="Escreva a resposta oficial..."
                        className="flex-1 px-3 py-1.5 bg-[#06070B] border border-white/[0.1] rounded text-white"
                      />
                      <button
                        onClick={() =>
                          execAction(
                            () => apiFetch(`/api/admin/support/${t.id}/reply`, { method: 'POST', body: JSON.stringify({ reply: replyText[t.id] }) }),
                            'Resposta enviada ao investidor.'
                          )
                        }
                        className="px-3 py-1.5 bg-[#E11D2E] text-white rounded font-semibold"
                      >
                        Responder
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* MODAL: EDITAR PARÂMETROS DO PRODUTO (LUCRO USUÁRIO, PRAZO, LIMITES, TRADER & COMISSÃO) */}
      {editProduct && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await execAction(
                () =>
                  apiFetch(`/api/admin/products/${editProduct.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                      name: editProduct.name,
                      traderId: editProduct.traderId,
                      strategy: editProduct.strategy,
                      market: editProduct.market,
                      riskLevel: editProduct.riskLevel,
                      description: editProduct.description,
                      contractualYieldPct: Number(editProduct.contractualYieldPct),
                      termDays: Number(editProduct.termDays),
                      maturityDate: editProduct.maturityDate,
                      minCapitalUsd: Number(editProduct.minCapitalUsd),
                      maxCapitalUsd: Number(editProduct.maxCapitalUsd),
                      traderSharePct: Number(editProduct.traderSharePct),
                      commissionFeePct: Number(editProduct.commissionFeePct),
                      earlyRedemptionAllowed: editProduct.earlyRedemptionAllowed,
                      earlyPenaltyPct: Number(editProduct.earlyPenaltyPct),
                      redemptionPolicy: editProduct.redemptionPolicy,
                      lossPolicy: editProduct.lossPolicy,
                      status: editProduct.status,
                      syncPools: editProdSyncPools,
                    }),
                  }),
                `Parâmetros do produto "${editProduct.name}" atualizados.`
              );
              if (ok) {
                if (editProdSyncPools) setPoolEdits({});
                setEditProduct(null);
              }
            }}
            className="w-full max-w-2xl rounded-xl bg-[#0D0F16] border border-white/[0.12] p-6 space-y-4 text-xs max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h3 className="text-base font-display font-semibold text-white">
                Configurar Produto · {editProduct.name}
              </h3>
              <button type="button" onClick={() => setEditProduct(null)} className="text-zinc-400 hover:text-white">
                {t('close')}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-zinc-400 mb-1">Nome do Produto</label>
                <input type="text" required value={editProduct.name} onChange={(e) => setEditProduct({ ...editProduct, name: e.target.value })} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white" />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Trader Responsável</label>
                <select value={editProduct.traderId} onChange={(e) => setEditProduct({ ...editProduct, traderId: e.target.value })} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white">
                  {traders.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.full_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Estratégia</label>
                <input type="text" required value={editProduct.strategy} onChange={(e) => setEditProduct({ ...editProduct, strategy: e.target.value })} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-zinc-400 mb-1">Mercado</label>
                  <input type="text" required value={editProduct.market} onChange={(e) => setEditProduct({ ...editProduct, market: e.target.value })} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white" />
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">Risco</label>
                  <select value={editProduct.riskLevel} onChange={(e) => setEditProduct({ ...editProduct, riskLevel: e.target.value })} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white">
                    <option value="Conservador">Conservador</option>
                    <option value="Moderado">Moderado</option>
                    <option value="Arrojado">Arrojado</option>
                    <option value="Institucional">Institucional</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-white/[0.06]">
              <div>
                <label className="block text-emerald-400 mb-1 font-semibold">Lucro Usuário (%)</label>
                <input type="number" step="0.1" min="0" max="200" value={editProduct.contractualYieldPct} onChange={(e) => setEditProduct({ ...editProduct, contractualYieldPct: e.target.value })} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Prazo (dias)</label>
                <input type="number" min="1" max="3650" value={editProduct.termDays} onChange={(e) => setEditProduct({ ...editProduct, termDays: e.target.value })} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Vencimento</label>
                <input type="date" value={editProduct.maturityDate} onChange={(e) => setEditProduct({ ...editProduct, maturityDate: e.target.value })} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Comissão Trader (%)</label>
                <input type="number" step="0.1" min="0" max="80" value={editProduct.traderSharePct} onChange={(e) => setEditProduct({ ...editProduct, traderSharePct: e.target.value })} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
              </div>
              <div>
                <label className="block text-amber-300 mb-1">Taxa Comissão Mesa (%)</label>
                <input type="number" step="0.1" min="0" max="50" value={editProduct.commissionFeePct} onChange={(e) => setEditProduct({ ...editProduct, commissionFeePct: e.target.value })} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Status</label>
                <select value={editProduct.status} onChange={(e) => setEditProduct({ ...editProduct, status: e.target.value })} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white">
                  <option value="active">{statusLabel('active')}</option>
                  <option value="paused">{statusLabel('paused')}</option>
                  <option value="closed">{statusLabel('closed')}</option>
                </select>
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Capital Mínimo (USD)</label>
                <input type="number" min="1" value={editProduct.minCapitalUsd} onChange={(e) => setEditProduct({ ...editProduct, minCapitalUsd: e.target.value })} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Capital Máximo (USD)</label>
                <input type="number" min="1" value={editProduct.maxCapitalUsd} onChange={(e) => setEditProduct({ ...editProduct, maxCapitalUsd: e.target.value })} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Multa Resg. Antec. (%)</label>
                <input type="number" step="0.1" min="0" max="50" value={editProduct.earlyPenaltyPct} onChange={(e) => setEditProduct({ ...editProduct, earlyPenaltyPct: e.target.value })} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white font-mono" />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={editProduct.earlyRedemptionAllowed} onChange={(e) => setEditProduct({ ...editProduct, earlyRedemptionAllowed: e.target.checked })} />
                <span>Permitir resgate antecipado</span>
              </label>
              <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={editProdSyncPools} onChange={(e) => setEditProdSyncPools(e.target.checked)} />
                <span>Sincronizar comissão do trader e vencimento nos pools abertos</span>
              </label>
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">Descrição</label>
              <textarea rows={2} value={editProduct.description} onChange={(e) => setEditProduct({ ...editProduct, description: e.target.value })} className="w-full px-3 py-2 bg-[#06070B] border border-white/[0.1] rounded text-white" />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setEditProduct(null)} className="flex-1 py-2.5 bg-[#181B26] text-zinc-200 rounded-lg">
                {t('cancel')}
              </button>
              <button type="submit" className="flex-1 py-2.5 bg-[#E11D2E] hover:bg-[#FF2438] text-white font-semibold rounded-lg">
                Salvar Alterações do Produto
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
