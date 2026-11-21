import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  TrendingUp,
  Briefcase,
  Wallet as WalletIcon,
  ArrowDownLeft,
  ArrowUpRight,
  History,
  UserCheck,
  Bell,
  HelpCircle,
  LogOut,
  CandlestickChart,
  FileText,
  Shield,
  Copy,
  Check,
  Menu,
  X,
} from 'lucide-react';
import { BrandLogo, OFFICIAL_LOGO_PATH } from './BrandLogo';
import { EquityCurveChart } from './FinancialCharts';
import { LiveTradingChart } from './LiveTradingChart';
import { CountryLanguageSelector } from './CountryLanguageSelector';
import { GlobalIdentityFields, type IdentityFormState } from './GlobalIdentityFields';
import { useLocale } from '../i18n/LocaleContext';
import { apiFetch, connectRealtime, getAuthToken } from '../lib/api';
import { formatPctFromBps } from '../lib/format';
import type {
  User,
  Wallet,
  Product,
  Pool,
  Investment,
  Deposit,
  Withdrawal,
  LedgerTransaction,
  AppNotification,
  SupportTicket,
  MarketAssetQuote,
  MarketTickPoint,
  TimedTrade,
} from '../types';

type InvestorTab =
  | 'inicio'
  | 'investir'
  | 'meus_investimentos'
  | 'carteira'
  | 'depositar'
  | 'sacar'
  | 'operacoes_proprias'
  | 'historico'
  | 'perfil'
  | 'notificacoes'
  | 'suporte';

export const InvestorPortal: React.FC<{ user: User; onLogout: () => void; onUserRefresh: (u: User) => void }> = ({
  user,
  onLogout,
  onUserRefresh,
}) => {
  const {
    countryCode,
    t,
    statusLabel,
    formatUsdLocale,
    formatDateLocale,
    formatDateTimeLocale,
  } = useLocale();
  const [tab, setTab] = useState<InvestorTab>('inicio');
  const [mobileMenu, setMobileMenu] = useState(false);

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [rates, setRates] = useState({
    brlPerUsd: 5.78,
    pixFeeBps: 45,
    usdcFeeBps: 25,
    withdrawalPixFeeBps: 60,
    withdrawalUsdcFeeCents: 250,
  });

  const [products, setProducts] = useState<Product[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [verifiedOps, setVerifiedOps] = useState<any[]>([]);

  // Modals / Interactive Forms
  const [selectedPoolModal, setSelectedPoolModal] = useState<{ product: Product; pool: Pool } | null>(null);
  const [investAmount, setInvestAmount] = useState('1000');
  const [contractModal, setContractModal] = useState<Investment | null>(null);

  // Deposit Form
  const [depMethod, setDepMethod] = useState<'PIX' | 'USDC'>((user.country || 'BR') === 'BR' ? 'PIX' : 'USDC');
  const [depAmount, setDepAmount] = useState('1000');
  const [depNetwork, setDepNetwork] = useState('ARBITRUM');
  const [depTxHash, setDepTxHash] = useState('');
  const [activeDeposit, setActiveDeposit] = useState<Deposit | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Withdrawal Form
  const [wdMethod, setWdMethod] = useState<'PIX' | 'USDC'>((user.country || 'BR') === 'BR' ? 'PIX' : 'USDC');
  const [wdAmount, setWdAmount] = useState('250');
  const [wdDest, setWdDest] = useState('');
  const [wdNetwork, setWdNetwork] = useState('ARBITRUM');
  const [wdMfaCode, setWdMfaCode] = useState('');

  // Self-Trading State (Timed Options + Optional Spot API)
  const [marketSymbol, setMarketSymbol] = useState('BTC-USD');
  const [marketAssets, setMarketAssets] = useState<MarketAssetQuote[]>([]);
  const [marketTicks, setMarketTicks] = useState<MarketTickPoint[]>([]);
  const [marketSource, setMarketSource] = useState('Coinbase Exchange Feed');
  const [marketLive, setMarketLive] = useState(true);
  const [windowSec, setWindowSec] = useState(120);
  const [openTrades, setOpenTrades] = useState<TimedTrade[]>([]);
  const [settledTrades, setSettledTrades] = useState<TimedTrade[]>([]);
  const [tradeConfig, setTradeConfig] = useState({
    enabled: true,
    payoutBps: 7000,
    payoutPct: 70,
    minUsd: 5,
    maxUsd: 10000,
  });
  const [tradeStake, setTradeStake] = useState('25');
  const [tradeDuration, setTradeDuration] = useState(30);
  const [submittingTrade, setSubmittingTrade] = useState<'BUY' | 'SELL' | null>(null);
  const [tradeSubTab, setTradeSubTab] = useState<'open' | 'history' | 'api'>('open');
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());

  const [connections, setConnections] = useState<any[]>([]);
  const [selfOrders, setSelfOrders] = useState<any[]>([]);
  const [connExchange, setConnExchange] = useState('Binance');
  const [connLabel, setConnLabel] = useState('');
  const [connKey, setConnKey] = useState('');
  const [connSecret, setConnSecret] = useState('');
  const [orderConnId, setOrderConnId] = useState('');
  const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderQty, setOrderQty] = useState('0.01');
  const [orderSl, setOrderSl] = useState('');
  const [orderTp, setOrderTp] = useState('');

  // Profile / KYC / MFA / Sessions
  const [profName, setProfName] = useState(user.full_name);
  const [profPhone, setProfPhone] = useState(user.phone || '');
  const [kycIdentity, setKycIdentity] = useState<IdentityFormState>({
    country: user.country || 'BR',
    documentType: user.document_type || ((user.country || 'BR') === 'BR' ? 'CPF' : 'TAX_ID'),
    taxId: user.tax_id || '',
    phone: user.phone || '',
    postalCode: user.postal_code || '',
    city: user.city || '',
    stateRegion: user.state_region || '',
  });
  const [kycDoc, setKycDoc] = useState('');
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [mfaVerifyInput, setMfaVerifyInput] = useState('');
  const [sessions, setSessions] = useState<any[]>([]);

  // Support
  const [supSubject, setSupSubject] = useState('');
  const [supCategory, setSupCategory] = useState('Financeiro');
  const [supMessage, setSupMessage] = useState('');

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [ov, cat] = await Promise.all([apiFetch('/api/investor/overview'), apiFetch('/api/products')]);
      setWallet(ov.wallet);
      setInvestments(ov.investments);
      setDeposits(ov.deposits);
      setWithdrawals(ov.withdrawals);
      setTransactions(ov.transactions);
      setNotifications(ov.notifications);
      setTickets(ov.tickets);
      setRates(ov.rates);
      setProducts(cat.products);
      setPools(cat.pools);
      setVerifiedOps(cat.verifiedOps || []);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  }, []);

  const loadSelfTrading = useCallback(async () => {
    try {
      const [st, con] = await Promise.all([
        apiFetch(`/api/self-trading/overview?symbol=${encodeURIComponent(marketSymbol)}`),
        apiFetch('/api/self-trading/connections'),
      ]);
      setMarketAssets(st.assets || []);
      setMarketTicks(st.series?.ticks || []);
      setMarketSource(st.series?.source || 'Coinbase Exchange Feed');
      setMarketLive(Boolean(st.series?.live));
      if (st.config) setTradeConfig(st.config);
      if (st.wallet) setWallet(st.wallet);
      setOpenTrades(st.openTrades || []);
      setSettledTrades(st.settledTrades || []);
      setConnections(con.connections || []);
      setSelfOrders(con.orders || []);
      if (con.connections?.[0] && !orderConnId) {
        setOrderConnId(con.connections[0].id);
      }
    } catch {
      // ignore non-fatal market refresh errors
    }
  }, [marketSymbol, orderConnId]);

  const loadSessions = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth/sessions');
      setSessions(res.sessions || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (tab === 'operacoes_proprias') loadSelfTrading();
    if (tab === 'perfil') loadSessions();
  }, [tab, loadSelfTrading, loadSessions]);

  useEffect(() => {
    if (tab !== 'operacoes_proprias' && openTrades.length === 0) return;
    const id = window.setInterval(() => setClockNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [tab, openTrades.length]);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;
    return connectRealtime(token, (event, data: any) => {
      if (['wallet:updated', 'deposit:updated', 'withdrawal:updated', 'pool:updated', 'settings:updated'].includes(event)) {
        loadAll();
      }
      if (event === 'market:tick' && data?.symbol && Number.isFinite(data?.price)) {
        setMarketAssets((prev) =>
          prev.map((a) =>
            a.symbol === data.symbol
              ? {
                  ...a,
                  price: data.price,
                  bid: data.bid ?? a.bid,
                  ask: data.ask ?? a.ask,
                  change24hPct: data.change24hPct ?? a.change24hPct,
                  updatedAtMs: data.ts || Date.now(),
                  source: data.source || a.source,
                }
              : a
          )
        );
        if (data.symbol === marketSymbol) {
          setMarketLive(true);
          if (data.source) setMarketSource(data.source);
          setMarketTicks((prev) => {
            const next = [...prev, { ts: data.ts || Date.now(), price: data.price }];
            return next.length > 480 ? next.slice(next.length - 480) : next;
          });
        }
      }
      if (event === 'trade:opened' && data?.trade) {
        setOpenTrades((prev) => {
          if (prev.some((tItem) => tItem.id === data.trade.id)) return prev;
          return [data.trade, ...prev];
        });
      }
      if (event === 'trade:settled' && data?.trade) {
        const settled: TimedTrade = data.trade;
        setOpenTrades((prev) => prev.filter((tItem) => tItem.id !== settled.id));
        setSettledTrades((prev) => [settled, ...prev.filter((tItem) => tItem.id !== settled.id)].slice(0, 40));
        if (data.wallet) setWallet(data.wallet);
        setFeedback({
          type: settled.status === 'lost' ? 'err' : 'ok',
          text:
            settled.status === 'won'
              ? `${settled.trade_code} (${settled.asset}) · +${formatUsdLocale(settled.pnl_cents)} (+${(settled.payout_bps / 100).toFixed(0)}%)`
              : settled.status === 'tie'
                ? `${settled.trade_code} (${settled.asset}) · ${statusLabel('tie')}`
                : `${settled.trade_code} (${settled.asset}) · -${formatUsdLocale(settled.stake_cents)}`,
        });
      }
    });
  }, [loadAll, marketSymbol, formatUsdLocale, statusLabel]);

  const persistLocalePreference = async (nextCountry: string, nextLang: string) => {
    setKycIdentity((prev) => ({ ...prev, country: nextCountry }));
    try {
      const res = await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ country: nextCountry, preferredLanguage: nextLang }),
      });
      if (res.user) onUserRefresh(res.user);
    } catch {
      // ignore non-blocking preference save
    }
  };

  const copyText = (val: string, label: string) => {
    navigator.clipboard?.writeText(val);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleInvestConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPoolModal) return;
    setFeedback(null);
    try {
      const res = await apiFetch('/api/investor/invest', {
        method: 'POST',
        body: JSON.stringify({ poolId: selectedPoolModal.pool.id, amountUsd: Number(investAmount) }),
      });
      setSelectedPoolModal(null);
      setFeedback({ type: 'ok', text: `Participação confirmada. Contrato ${res.contractCode} emitido.` });
      loadAll();
      setTab('meus_investimentos');
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleCreateDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await apiFetch('/api/investor/deposits', {
        method: 'POST',
        body: JSON.stringify({
          method: depMethod,
          amountInput: Number(depAmount),
          network: depMethod === 'PIX' ? 'PIX_BR' : depNetwork,
          txHash: depMethod === 'USDC' && depTxHash ? depTxHash : undefined,
        }),
      });
      setActiveDeposit(res.deposit);
      setFeedback({ type: 'ok', text: `Solicitação de depósito ${res.deposit.id} emitida.` });
      loadAll();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleCreateWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await apiFetch('/api/investor/withdrawals', {
        method: 'POST',
        body: JSON.stringify({
          method: wdMethod,
          destinationKey: wdDest,
          network: wdMethod === 'PIX' ? 'PIX_BR' : wdNetwork,
          amountUsd: Number(wdAmount),
          mfaCode: wdMfaCode || undefined,
        }),
      });
      setFeedback({
        type: 'ok',
        text: `Solicitação de saque ${res.withdrawal.id} registrada. Valor reservado para processamento.`,
      });
      setWdDest('');
      setWdMfaCode('');
      loadAll();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleConnectExchange = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiFetch('/api/self-trading/connections', {
        method: 'POST',
        body: JSON.stringify({
          exchangeName: connExchange,
          label: connLabel,
          apiKey: connKey,
          apiSecret: connSecret,
        }),
      });
      setConnKey('');
      setConnSecret('');
      setConnLabel('');
      setFeedback({ type: 'ok', text: 'Corretora vinculada com segurança à sua conta.' });
      loadSelfTrading();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleDispatchOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiFetch('/api/self-trading/orders', {
        method: 'POST',
        body: JSON.stringify({
          connectionId: orderConnId,
          symbol: marketSymbol,
          side: orderSide,
          orderType: 'MARKET',
          quantity: Number(orderQty),
          stopLossUsd: orderSl ? Number(orderSl) : undefined,
          takeProfitUsd: orderTp ? Number(orderTp) : undefined,
        }),
      });
      setFeedback({ type: 'ok', text: 'Ordem enviada para execução na corretora conectada.' });
      loadSelfTrading();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handlePlaceTimedTrade = async (direction: 'BUY' | 'SELL') => {
    setFeedback(null);
    setSubmittingTrade(direction);
    try {
      const res = await apiFetch('/api/self-trading/trades', {
        method: 'POST',
        body: JSON.stringify({
          asset: marketSymbol,
          direction,
          stakeUsd: Number(tradeStake),
          durationSec: tradeDuration,
        }),
      });
      if (res.trade) {
        setOpenTrades((prev) => {
          if (prev.some((x) => x.id === res.trade.id)) return prev;
          return [res.trade, ...prev];
        });
      }
      if (res.wallet) setWallet(res.wallet);
      setTradeSubTab('open');
      setFeedback({
        type: 'ok',
        text: `${res.trade.trade_code} · ${direction} ${marketSymbol} @ ${res.trade.entry_price} (${tradeDuration}s)`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    } finally {
      setSubmittingTrade(null);
    }
  };

  const totalPatrimonialCents =
    (wallet?.available_cents || 0) + (wallet?.reserved_cents || 0) + (wallet?.invested_cents || 0);
  const activeInvs = investments.filter((i) => i.status === 'active');
  const closedInvs = investments.filter((i) => i.status !== 'active');
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const equityPoints = [
    { label: 'Abertura', value: Math.max(0, (totalPatrimonialCents - (wallet?.realized_yield_cents || 0)) / 100) },
    { label: 'Alocação', value: Math.max(0, (totalPatrimonialCents - (wallet?.realized_yield_cents || 0) * 0.5) / 100) },
    { label: 'Patrimônio Atual', value: totalPatrimonialCents / 100 },
    {
      label: 'Projeção Contratual*',
      value: (totalPatrimonialCents + (wallet?.pending_yield_cents || 0)) / 100,
    },
  ];

  const navItems: Array<{ id: InvestorTab; label: string; icon: React.ReactNode }> = [
    { id: 'inicio', label: t('invOverview'), icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'investir', label: t('invProducts'), icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'meus_investimentos', label: t('invMyInvestments'), icon: <Briefcase className="w-4 h-4" /> },
    { id: 'carteira', label: t('invWallet'), icon: <WalletIcon className="w-4 h-4" /> },
    { id: 'depositar', label: t('invDeposit'), icon: <ArrowDownLeft className="w-4 h-4" /> },
    { id: 'sacar', label: t('invWithdraw'), icon: <ArrowUpRight className="w-4 h-4" /> },
    { id: 'operacoes_proprias', label: t('invSelfTrading'), icon: <CandlestickChart className="w-4 h-4" /> },
    { id: 'historico', label: t('invHistory'), icon: <History className="w-4 h-4" /> },
    { id: 'perfil', label: t('invProfile'), icon: <UserCheck className="w-4 h-4" /> },
    {
      id: 'notificacoes',
      label: `${t('invNotifications')}${unreadCount ? ` (${unreadCount})` : ''}`,
      icon: <Bell className="w-4 h-4" />,
    },
    { id: 'suporte', label: t('invSupport'), icon: <HelpCircle className="w-4 h-4" /> },
  ];

  const parsedContract = contractModal ? JSON.parse(contractModal.contract_snapshot_json || '{}') : null;

  return (
    <div className="min-h-screen bg-[#060609] text-[#F1F3F5] flex">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-[#090A0F] border-r border-white/[0.08]">
        <div className="p-5 border-b border-white/[0.08]">
          <BrandLogo size="sm" subtitle={t('investorDeskTitle')} />
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                tab === item.id
                  ? 'bg-[#E11D2E] text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-white/[0.08]">
          <div className="text-xs font-medium text-white truncate">{user.full_name}</div>
          <div className="text-[11px] text-zinc-500 truncate mb-3">{user.email} · {countryCode}</div>
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium bg-[#141722] hover:bg-[#1C202E] text-zinc-200 rounded-lg transition-colors"
          >
            <LogOut className="w-3.5 h-3.5 text-[#E11D2E]" />
            <span>{t('logout')}</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar (3-Zone Contract) */}
        <header className="h-16 px-4 sm:px-8 border-b border-white/[0.08] bg-[#08090E]/90 backdrop-blur flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenu(!mobileMenu)}
              className="lg:hidden p-2 rounded-lg bg-[#11131B] text-zinc-300"
            >
              {mobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="text-sm text-zinc-400 truncate">
              <span className="text-white font-semibold">AZKOYEN INVEST</span>
              <span className="mx-2 text-zinc-600">/</span>
              <span>{navItems.find((n) => n.id === tab)?.label}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <CountryLanguageSelector onCountryOrLangChange={persistLocalePreference} />
            <div className="hidden md:block text-right">
              <div className="text-[11px] text-zinc-500">{t('availableUsd')}</div>
              <div className="text-sm font-mono tabular-nums font-semibold text-white">
                {formatUsdLocale(wallet?.available_cents)}
              </div>
            </div>
            <button
              onClick={() => setTab('depositar')}
              className="px-4 py-2 text-xs font-semibold bg-[#E11D2E] hover:bg-[#FF2438] text-white rounded-lg whitespace-nowrap shrink-0 transition-colors"
            >
              {t('invDeposit')} USD
            </button>
          </div>
        </header>

        {/* Mobile Drawer */}
        {mobileMenu && (
          <div className="lg:hidden bg-[#090A0F] border-b border-white/[0.08] p-3 grid grid-cols-2 gap-1.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setTab(item.id);
                  setMobileMenu(false);
                }}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg ${
                  tab === item.id ? 'bg-[#E11D2E] text-white' : 'text-zinc-300 bg-[#11131B]'
                }`}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </button>
            ))}
            <button onClick={onLogout} className="col-span-2 mt-1 py-2 text-xs text-red-400 bg-[#141722] rounded-lg">
              {t('logout')}
            </button>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto space-y-6">
          {feedback && (
            <div
              className={`p-3.5 rounded-lg border text-xs flex items-center justify-between ${
                feedback.type === 'ok'
                  ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-200'
                  : 'bg-[#E11D2E]/10 border-[#E11D2E]/40 text-red-200'
              }`}
            >
              <span>{feedback.text}</span>
              <button onClick={() => setFeedback(null)} className="text-zinc-400 hover:text-white ml-4">
                {t('close')}
              </button>
            </div>
          )}

          {/* TAB: INÍCIO */}
          {tab === 'inicio' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-xs text-zinc-400">{t('totalEquity')}</div>
                  <div className="text-2xl font-mono tabular-nums font-bold text-white mt-1.5">
                    {formatUsdLocale(totalPatrimonialCents)}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">USD</div>
                </div>
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-xs text-zinc-400">{t('availableUsd')}</div>
                  <div className="text-2xl font-mono tabular-nums font-bold text-white mt-1.5">
                    {formatUsdLocale(wallet?.available_cents)}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    <span className="font-mono">{formatUsdLocale(wallet?.reserved_cents)}</span>
                  </div>
                </div>
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-xs text-zinc-400">{t('investedCapital')}</div>
                  <div className="text-2xl font-mono tabular-nums font-bold text-white mt-1.5">
                    {formatUsdLocale(wallet?.invested_cents)}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {activeInvs.length} {t('activeInvestmentsCount')} · {closedInvs.length} {t('closedInvestmentsCount')}
                  </div>
                </div>
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-xs text-zinc-400">{t('realizedYield')}</div>
                  <div className="text-2xl font-mono tabular-nums font-bold text-emerald-400 mt-1.5">
                    {formatUsdLocale(wallet?.realized_yield_cents)}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {t('pendingYield')}: <span className="font-mono text-zinc-300">{formatUsdLocale(wallet?.pending_yield_cents)}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-base font-display font-semibold text-white">{t('equityCurveTitle')}</h3>
                      <p className="text-xs text-zinc-500">{t('portfolioNote')}</p>
                    </div>
                  </div>
                  <EquityCurveChart points={equityPoints} accentColor="#E11D2E" />
                </div>

                <div className="p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08] flex flex-col justify-between">
                  <div>
                    <h3 className="text-base font-display font-semibold text-white mb-4">
                      {t('recentDeposits')} / {t('recentWithdrawals')}
                    </h3>
                    <div className="space-y-3">
                      {deposits.slice(0, 3).map((d) => (
                        <div key={d.id} className="flex items-center justify-between text-xs border-b border-white/[0.06] pb-2.5">
                          <div>
                            <div className="text-white font-medium">{t('invDeposit')} {d.method}</div>
                            <div className="text-zinc-500">{statusLabel(d.status)} · {formatDateLocale(d.created_at)}</div>
                          </div>
                          <div className="font-mono tabular-nums text-emerald-400">+{formatUsdLocale(d.net_usd_cents)}</div>
                        </div>
                      ))}
                      {withdrawals.slice(0, 2).map((w) => (
                        <div key={w.id} className="flex items-center justify-between text-xs border-b border-white/[0.06] pb-2.5">
                          <div>
                            <div className="text-white font-medium">{t('invWithdraw')} {w.method}</div>
                            <div className="text-zinc-500">{statusLabel(w.status)} · {formatDateLocale(w.created_at)}</div>
                          </div>
                          <div className="font-mono tabular-nums text-zinc-200">-{formatUsdLocale(w.requested_usd_cents)}</div>
                        </div>
                      ))}
                      {deposits.length === 0 && withdrawals.length === 0 && (
                        <div className="text-xs text-zinc-500 py-4">{t('depositTitle')}</div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setTab('historico')}
                    className="mt-4 w-full py-2 text-xs font-medium bg-[#151824] hover:bg-[#1E2233] text-zinc-200 rounded-lg transition-colors"
                  >
                    {t('financialHistory')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB: INVESTIR */}
          {tab === 'investir' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-display font-semibold text-white">{t('portfolioTitle')}</h2>
                <p className="text-xs text-zinc-400 mt-1">{t('portfolioNote')}</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {products.map((prod) => {
                  const prodPools = pools.filter((pl) => pl.product_id === prod.id);
                  const primaryPool = prodPools[0];
                  const fillPct = primaryPool
                    ? Math.min(100, Math.round((primaryPool.raised_cents / primaryPool.max_pool_cents) * 100))
                    : 0;
                  const poolOps = primaryPool ? verifiedOps.filter((o) => o.pool_id === primaryPool.id) : [];

                  return (
                    <div key={prod.id} className="rounded-xl bg-[#0D0F16] border border-white/[0.08] overflow-hidden flex flex-col">
                      <div className="h-44 relative bg-[#07080C] overflow-hidden">
                        <img
                          src={prod.image_url}
                          alt={prod.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#0D0F16] via-[#0D0F16]/40 to-transparent" />
                        <div className="absolute bottom-3 left-5 right-5 flex items-end justify-between gap-4">
                          <div>
                            <div className="text-xs text-zinc-300">
                              {prod.market} · {t('riskWord')} {prod.risk_level}
                            </div>
                            <h3 className="text-lg font-display font-bold text-white">{prod.name}</h3>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[11px] text-zinc-400">{t('targetCycle')}</div>
                            <div className="text-lg font-mono tabular-nums font-bold text-emerald-400">
                              {formatPctFromBps(prod.contractual_yield_bps)}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="p-5 space-y-4 flex-1 flex flex-col justify-between">
                        <div className="space-y-4">
                          <p className="text-xs text-zinc-300 leading-relaxed">{prod.description}</p>

                          <div className="flex items-center gap-3 py-3 border-y border-white/[0.07]">
                            <img
                              src={prod.trader_photo || '/src/assets/images/trader_portrait_one_1795271716411.jpg'}
                              alt={prod.trader_name}
                              referrerPolicy="no-referrer"
                              className="w-10 h-10 rounded-full object-cover ring-1 ring-white/15"
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-white truncate">{prod.trader_name}</div>
                              <div className="text-[11px] text-zinc-400 truncate">
                                {prod.credentials_summary} · {prod.experience_years}y
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                            <div>
                              <div className="text-zinc-500">{t('termLabel')}</div>
                              <div className="font-mono text-white font-medium">{prod.term_days}d</div>
                            </div>
                            <div>
                              <div className="text-zinc-500">{formatDateLocale(prod.maturity_date)}</div>
                              <div className="font-mono text-white font-medium">{formatDateLocale(prod.maturity_date)}</div>
                            </div>
                            <div>
                              <div className="text-zinc-500">{t('minLabel')}</div>
                              <div className="font-mono text-white font-medium">{formatUsdLocale(prod.min_capital_cents)}</div>
                            </div>
                            <div>
                              <div className="text-zinc-500">Max</div>
                              <div className="font-mono text-white font-medium">{formatUsdLocale(prod.max_capital_cents)}</div>
                            </div>
                          </div>

                          {primaryPool && (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-400">{primaryPool.name}</span>
                                <span className="font-mono tabular-nums text-white">
                                  {formatUsdLocale(primaryPool.raised_cents)} / {formatUsdLocale(primaryPool.max_pool_cents)} ({fillPct}%)
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-[#181B26] overflow-hidden">
                                <div className="h-full bg-[#E11D2E]" style={{ width: `${fillPct}%` }} />
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-zinc-500">
                                <span>{primaryPool.participant_count || 0}</span>
                                <span>
                                  PnL:{' '}
                                  <span className="text-emerald-400 font-mono">{formatUsdLocale(primaryPool.realized_pnl_cents)}</span>
                                </span>
                              </div>
                            </div>
                          )}

                          {poolOps.length > 0 && (
                            <div className="text-[11px] text-zinc-400 bg-[#08090D] border border-white/[0.06] rounded-lg p-2.5">
                              <span className="text-white font-mono">{poolOps[0].op_code}</span> · {poolOps[0].asset} ·{' '}
                              <span className={poolOps[0].net_pnl_cents >= 0 ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono'}>
                                {formatUsdLocale(poolOps[0].net_pnl_cents)}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="pt-2">
                          {primaryPool ? (
                            <button
                              onClick={() => {
                                setSelectedPoolModal({ product: prod, pool: primaryPool });
                                setInvestAmount(String(prod.min_capital_cents / 100));
                              }}
                              disabled={prod.status !== 'active' || (primaryPool.status !== 'open' && primaryPool.status !== 'active_trading')}
                              className="w-full py-2.5 px-4 bg-[#E11D2E] hover:bg-[#FF2438] disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-xs font-semibold rounded-lg transition-colors"
                            >
                              {t('investAction')}
                            </button>
                          ) : (
                            <div className="text-xs text-zinc-500 text-center py-2">—</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB: MEUS INVESTIMENTOS */}
          {tab === 'meus_investimentos' && (
            <div className="space-y-4">
              <h2 className="text-xl font-display font-semibold text-white">{t('invMyInvestments')}</h2>
              <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#0D0F16]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/[0.08] text-zinc-400">
                    <tr>
                      <th className="py-3.5 px-4">ID</th>
                      <th className="py-3.5 px-4">Pool</th>
                      <th className="py-3.5 px-4 text-right">{t('investedCapital')}</th>
                      <th className="py-3.5 px-4 text-right">%</th>
                      <th className="py-3.5 px-4 text-right">{t('pendingYield')}</th>
                      <th className="py-3.5 px-4 text-right">{t('realizedYield')}</th>
                      <th className="py-3.5 px-4">{t('termLabel')}</th>
                      <th className="py-3.5 px-4">Status</th>
                      <th className="py-3.5 px-4 text-right">PDF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {investments.map((inv) => (
                      <tr key={inv.id} className="hover:bg-white/[0.02]">
                        <td className="py-3 px-4 font-mono text-white">{inv.contract_code}</td>
                        <td className="py-3 px-4">
                          <div className="text-white font-medium">{inv.product_name}</div>
                          <div className="text-zinc-500">{inv.pool_name}</div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-white">{formatUsdLocale(inv.principal_cents)}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-zinc-300">
                          {(inv.pool_share_ppm / 10000).toFixed(2)}%
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-zinc-300">
                          {formatUsdLocale(inv.contractual_yield_cents)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-400">
                          {formatUsdLocale(inv.realized_yield_cents)}
                        </td>
                        <td className="py-3 px-4 font-mono text-zinc-400">{formatDateLocale(inv.maturity_date)}</td>
                        <td className="py-3 px-4 text-zinc-300">{statusLabel(inv.status)}</td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => setContractModal(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#161925] hover:bg-[#E11D2E] text-white rounded text-xs transition-colors"
                          >
                            <FileText className="w-3 h-3" />
                            <span>Doc</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                    {investments.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-zinc-500">
                          —
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB: MINHA CARTEIRA */}
          {tab === 'carteira' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-xs text-zinc-400">{t('availableUsd')}</div>
                  <div className="text-2xl font-mono tabular-nums font-bold text-white mt-1">
                    {formatUsdLocale(wallet?.available_cents)}
                  </div>
                </div>
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-xs text-zinc-400">Reserved (USD)</div>
                  <div className="text-2xl font-mono tabular-nums font-bold text-amber-400 mt-1">
                    {formatUsdLocale(wallet?.reserved_cents)}
                  </div>
                </div>
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-xs text-zinc-400">{t('investedCapital')}</div>
                  <div className="text-2xl font-mono tabular-nums font-bold text-white mt-1">
                    {formatUsdLocale(wallet?.invested_cents)}
                  </div>
                </div>
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-xs text-zinc-400">{t('realizedYield')}</div>
                  <div className="text-2xl font-mono tabular-nums font-bold text-emerald-400 mt-1">
                    {formatUsdLocale(wallet?.realized_yield_cents)}
                  </div>
                </div>
              </div>

              <div className="p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08] flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-display font-semibold text-white">FX & Fees · {countryCode}</h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    BRL/USD: <span className="font-mono text-white">R$ {rates.brlPerUsd.toFixed(2)}</span> · PIX:{' '}
                    <span className="font-mono text-white">{(rates.pixFeeBps / 100).toFixed(2)}%</span> · USDC:{' '}
                    <span className="font-mono text-white">{(rates.usdcFeeBps / 100).toFixed(2)}%</span>
                  </p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setTab('depositar')} className="px-4 py-2 text-xs font-semibold bg-[#E11D2E] text-white rounded-lg">
                    {t('invDeposit')}
                  </button>
                  <button onClick={() => setTab('sacar')} className="px-4 py-2 text-xs font-semibold bg-[#181B26] text-white rounded-lg">
                    {t('invWithdraw')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB: DEPOSITAR (PIX & USDC) */}
          {tab === 'depositar' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <form onSubmit={handleCreateDeposit} className="p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-4">
                <h2 className="text-lg font-display font-semibold text-white">{t('depositTitle')}</h2>

                <div className="flex gap-2 p-1 bg-[#08090D] rounded-lg border border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => setDepMethod('USDC')}
                    className={`flex-1 py-2 text-xs font-semibold rounded-md ${depMethod === 'USDC' ? 'bg-[#E11D2E] text-white' : 'text-zinc-400'}`}
                  >
                    USDC Global (On-Chain)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepMethod('PIX')}
                    className={`flex-1 py-2 text-xs font-semibold rounded-md ${depMethod === 'PIX' ? 'bg-[#E11D2E] text-white' : 'text-zinc-400'}`}
                  >
                    PIX (BRL → USD)
                  </button>
                </div>

                {depMethod === 'PIX' ? (
                  <>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5">BRL</label>
                      <input
                        type="number"
                        step="0.01"
                        min="50"
                        required
                        value={depAmount}
                        onChange={(e) => setDepAmount(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
                      />
                    </div>
                    <div className="p-3.5 rounded-lg bg-[#08090D] border border-white/[0.06] text-xs space-y-1.5 font-mono tabular-nums">
                      <div className="flex justify-between text-zinc-400">
                        <span>BRL/USD:</span>
                        <span className="text-white">R$ {rates.brlPerUsd.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-zinc-400">
                        <span>Fee ({(rates.pixFeeBps / 100).toFixed(2)}%):</span>
                        <span className="text-white">
                          {formatUsdLocale(Math.round(((Number(depAmount || 0) * 100) / rates.brlPerUsd) * (rates.pixFeeBps / 10000)))}
                        </span>
                      </div>
                      <div className="flex justify-between text-emerald-400 font-semibold pt-1 border-t border-white/[0.06]">
                        <span>USD Net:</span>
                        <span>
                          {formatUsdLocale(
                            Math.round(
                              ((Number(depAmount || 0) * 100) / rates.brlPerUsd) * (1 - rates.pixFeeBps / 10000)
                            )
                          )}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5">Network</label>
                      <select
                        value={depNetwork}
                        onChange={(e) => setDepNetwork(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
                      >
                        <option value="ARBITRUM">Arbitrum One (USDC)</option>
                        <option value="POLYGON">Polygon PoS (USDC)</option>
                        <option value="ETHEREUM">Ethereum ERC-20 (USDC)</option>
                        <option value="SOLANA">Solana SPL (USDC)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5">USDC</label>
                      <input
                        type="number"
                        step="0.01"
                        min="10"
                        required
                        value={depAmount}
                        onChange={(e) => setDepAmount(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5">Tx Hash (optional)</label>
                      <input
                        type="text"
                        value={depTxHash}
                        onChange={(e) => setDepTxHash(e.target.value)}
                        placeholder="0x..."
                        className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
                      />
                    </div>
                  </>
                )}

                <button
                  type="submit"
                  className="w-full py-2.5 bg-[#E11D2E] hover:bg-[#FF2438] text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {t('invDeposit')} ({depMethod})
                </button>
              </form>

              <div className="p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-4">
                <h3 className="text-base font-display font-semibold text-white">{t('recentDeposits')}</h3>
                {activeDeposit ? (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row items-center gap-5 p-4 rounded-lg bg-[#08090D] border border-white/[0.08]">
                      {activeDeposit.qr_data_url && (
                        <img
                          src={activeDeposit.qr_data_url}
                          alt="QR Code"
                          className="w-36 h-36 rounded-lg bg-white p-1.5 shrink-0"
                        />
                      )}
                      <div className="space-y-2 text-xs min-w-0 flex-1">
                        <div className="font-semibold text-white">
                          {activeDeposit.method} · {activeDeposit.network}
                        </div>
                        <div className="text-zinc-400">
                          USD Net: <span className="text-emerald-400 font-mono">{formatUsdLocale(activeDeposit.net_usd_cents)}</span>
                        </div>
                        <div className="text-zinc-400 break-all font-mono text-[11px] bg-[#0D0F16] p-2 rounded border border-white/[0.06]">
                          {activeDeposit.pix_copy_paste || activeDeposit.usdc_address}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            copyText(activeDeposit.pix_copy_paste || activeDeposit.usdc_address || '', activeDeposit.id)
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#181B26] hover:bg-[#232738] text-white rounded text-xs"
                        >
                          {copiedKey === activeDeposit.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedKey === activeDeposit.id ? 'OK' : 'Copy'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-zinc-400 space-y-2">
                    <div className="space-y-2">
                      {deposits.slice(0, 5).map((d) => (
                        <div key={d.id} className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
                          <div>
                            <span className="font-mono text-white">{d.id}</span> · {d.method}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-zinc-200">{formatUsdLocale(d.net_usd_cents)}</span>
                            <span className={d.status === 'confirmed' ? 'text-emerald-400' : 'text-amber-400'}>
                              {statusLabel(d.status)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: SACAR */}
          {tab === 'sacar' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <form onSubmit={handleCreateWithdrawal} className="p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-4">
                <h2 className="text-lg font-display font-semibold text-white">{t('withdrawTitle')}</h2>

                <div className="flex gap-2 p-1 bg-[#08090D] rounded-lg border border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => setWdMethod('USDC')}
                    className={`flex-1 py-2 text-xs font-semibold rounded-md ${wdMethod === 'USDC' ? 'bg-[#E11D2E] text-white' : 'text-zinc-400'}`}
                  >
                    USDC On-Chain
                  </button>
                  <button
                    type="button"
                    onClick={() => setWdMethod('PIX')}
                    className={`flex-1 py-2 text-xs font-semibold rounded-md ${wdMethod === 'PIX' ? 'bg-[#E11D2E] text-white' : 'text-zinc-400'}`}
                  >
                    PIX (BRL)
                  </button>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">
                    USD ({t('availableUsd')}: {formatUsdLocale(wallet?.available_cents)})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="10"
                    required
                    value={wdAmount}
                    onChange={(e) => setWdAmount(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
                  />
                </div>

                {wdMethod === 'USDC' && (
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">Network</label>
                    <select
                      value={wdNetwork}
                      onChange={(e) => setWdNetwork(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                    >
                      <option value="ARBITRUM">Arbitrum One</option>
                      <option value="POLYGON">Polygon</option>
                      <option value="ETHEREUM">Ethereum ERC-20</option>
                      <option value="SOLANA">Solana</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">
                    {wdMethod === 'PIX' ? 'PIX Key' : 'USDC Address'}
                  </label>
                  <input
                    type="text"
                    required
                    value={wdDest}
                    onChange={(e) => setWdDest(e.target.value)}
                    placeholder={wdMethod === 'PIX' ? 'CPF / CNPJ / Email' : '0x...'}
                    className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
                  />
                </div>

                {user.mfa_enabled === 1 && (
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">{t('mfaInputLabel')}</label>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      value={wdMfaCode}
                      onChange={(e) => setWdMfaCode(e.target.value)}
                      placeholder="000000"
                      className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#06070B] border border-[#E11D2E]/50 rounded-lg text-white"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full py-2.5 bg-[#E11D2E] hover:bg-[#FF2438] text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {t('invWithdraw')}
                </button>
              </form>

              <div className="p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-3">
                <h3 className="text-base font-display font-semibold text-white">{t('recentWithdrawals')}</h3>
                <div className="space-y-3">
                  {withdrawals.map((w) => (
                    <div key={w.id} className="p-3.5 rounded-lg bg-[#08090D] border border-white/[0.06] text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-white font-semibold">{w.id} · {w.method}</span>
                        <span className="font-mono text-white">{formatUsdLocale(w.requested_usd_cents)}</span>
                      </div>
                      <div className="flex items-center justify-between text-zinc-400">
                        <span className="truncate max-w-[220px]">{w.destination_key}</span>
                        <span
                          className={
                            w.status === 'completed'
                              ? 'text-emerald-400'
                              : w.status === 'rejected'
                                ? 'text-[#E11D2E]'
                                : 'text-amber-400'
                          }
                        >
                          {statusLabel(w.status)}
                        </span>
                      </div>
                    </div>
                  ))}
                  {withdrawals.length === 0 && <p className="text-xs text-zinc-500">—</p>}
                </div>
              </div>
            </div>
          )}

          {/* TAB: OPERAÇÕES PRÓPRIAS */}
          {tab === 'operacoes_proprias' && (() => {
            const activeAssetMeta = marketAssets.find((a) => a.symbol === marketSymbol);
            const activeDecimals = activeAssetMeta?.decimals ?? 2;
            const currentLivePrice =
              activeAssetMeta?.price ?? marketTicks[marketTicks.length - 1]?.price ?? null;
            const stakeNum = Math.max(0, Number(tradeStake) || 0);
            const profitUsd = stakeNum * (tradeConfig.payoutBps / 10000);
            const returnUsd = stakeNum + profitUsd;
            const durationPresets = [
              { label: '10s', sec: 10 },
              { label: '15s', sec: 15 },
              { label: '30s', sec: 30 },
              { label: '1m', sec: 60 },
              { label: '2m', sec: 120 },
              { label: '3m', sec: 180 },
              { label: '5m', sec: 300 },
            ];

            return (
              <div className="space-y-5">
                {/* Header & Available Balance */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-display font-semibold text-white">{t('stTitle')}</h2>
                    <p className="text-xs text-zinc-400 mt-0.5">{t('stSubtitle')}</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
                    <div className="px-3.5 py-2 rounded-lg bg-[#0D0F16] border border-white/[0.08]">
                      <span className="text-zinc-400 font-sans mr-2">{t('availableUsd')}:</span>
                      <strong className="text-white">{formatUsdLocale(wallet?.available_cents)}</strong>
                    </div>
                    <div className="px-3.5 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold">
                      +{tradeConfig.payoutPct}%
                    </div>
                  </div>
                </div>

                {/* Live Asset Selector Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                  {(marketAssets.length > 0
                    ? marketAssets
                    : [
                        { symbol: 'BTC-USD', base: 'BTC', decimals: 2, price: null, change24hPct: null },
                        { symbol: 'ETH-USD', base: 'ETH', decimals: 2, price: null, change24hPct: null },
                        { symbol: 'SOL-USD', base: 'SOL', decimals: 2, price: null, change24hPct: null },
                        { symbol: 'XRP-USD', base: 'XRP', decimals: 4, price: null, change24hPct: null },
                      ] as any[]
                  ).map((asset) => {
                    const selected = asset.symbol === marketSymbol;
                    return (
                      <button
                        key={asset.symbol}
                        type="button"
                        onClick={() => setMarketSymbol(asset.symbol)}
                        className={`p-2.5 rounded-lg border text-left transition-colors ${
                          selected
                            ? 'bg-[#141724] border-[#E11D2E] text-white'
                            : 'bg-[#0D0F16] border-white/[0.08] text-zinc-300 hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-display font-bold">{asset.base}/USD</span>
                          {asset.change24hPct !== null && (
                            <span
                              className={`font-mono tabular-nums ${
                                asset.change24hPct >= 0 ? 'text-emerald-400' : 'text-[#E11D2E]'
                              }`}
                            >
                              {asset.change24hPct >= 0 ? '+' : ''}
                              {asset.change24hPct.toFixed(1)}%
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-mono tabular-nums text-white mt-1 truncate">
                          {asset.price !== null
                            ? `$${asset.price.toLocaleString(undefined, {
                                minimumFractionDigits: asset.decimals,
                                maximumFractionDigits: asset.decimals,
                              })}`
                            : '—'}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Main Trading Desk: 8 cols Live Chart + 4 cols Execution Ticket */}
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
                  <div className="xl:col-span-8">
                    <LiveTradingChart
                      symbol={marketSymbol}
                      decimals={activeDecimals}
                      ticks={marketTicks}
                      livePrice={currentLivePrice}
                      change24hPct={activeAssetMeta?.change24hPct ?? null}
                      source={marketSource}
                      live={marketLive}
                      openTrades={openTrades}
                      windowSec={windowSec}
                      onWindowSecChange={setWindowSec}
                      labels={{
                        lockedLine: t('stLockedLine'),
                        livePrice: t('stLivePrice'),
                        winningNow: t('stWinningNow'),
                        losingNow: t('stLosingNow'),
                        windowLabel: t('stWindowLabel'),
                        feedOffline: t('stFeedOffline'),
                      }}
                    />
                  </div>

                  {/* Execution Ticket */}
                  <div className="xl:col-span-4 rounded-xl bg-[#0D0F16] border border-white/[0.08] p-5 flex flex-col justify-between space-y-4">
                    <div className="space-y-4">
                      {/* Stake Input */}
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <label className="text-zinc-300 font-medium">{t('stAmountUsd')}</label>
                          <span className="font-mono text-[11px] text-zinc-500">
                            ${tradeConfig.minUsd} – ${tradeConfig.maxUsd}
                          </span>
                        </div>
                        <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm text-zinc-400">$</span>
                          <input
                            type="number"
                            step="1"
                            min={tradeConfig.minUsd}
                            max={tradeConfig.maxUsd}
                            value={tradeStake}
                            onChange={(e) => setTradeStake(e.target.value)}
                            className="w-full pl-8 pr-4 py-2.5 bg-[#06070B] border border-white/[0.12] rounded-lg font-mono tabular-nums text-base font-bold text-white focus:outline-none focus:border-[#E11D2E]"
                          />
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mt-2">
                          {['10', '25', '50', '100', '250', '500'].map((val) => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setTradeStake(val)}
                              className={`py-1.5 text-[11px] font-mono rounded border transition-colors ${
                                tradeStake === val
                                  ? 'bg-[#E11D2E]/20 border-[#E11D2E] text-white font-semibold'
                                  : 'bg-[#08090D] border-white/[0.08] text-zinc-400 hover:text-white'
                              }`}
                            >
                              ${val}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Expiration Time (10s to 5m) */}
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <label className="text-zinc-300 font-medium">{t('stDurationLabel')}</label>
                          <span className="font-mono text-xs font-bold text-amber-400">
                            {tradeDuration >= 60
                              ? `${Math.floor(tradeDuration / 60)}m ${tradeDuration % 60 ? `${tradeDuration % 60}s` : ''}`
                              : `${tradeDuration}s`}
                          </span>
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {durationPresets.map((p) => (
                            <button
                              key={p.sec}
                              type="button"
                              onClick={() => setTradeDuration(p.sec)}
                              className={`py-1.5 text-[11px] font-mono rounded border transition-colors ${
                                tradeDuration === p.sec
                                  ? 'bg-amber-500 text-[#060609] border-amber-400 font-bold'
                                  : 'bg-[#08090D] border-white/[0.08] text-zinc-400 hover:text-white'
                              }`}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                        <input
                          type="range"
                          min={10}
                          max={300}
                          step={5}
                          value={tradeDuration}
                          onChange={(e) => setTradeDuration(Number(e.target.value))}
                          className="w-full mt-2.5 accent-[#E11D2E] cursor-pointer"
                        />
                      </div>

                      {/* Fixed +70% Profit Summary */}
                      <div className="p-3.5 rounded-lg bg-[#08090D] border border-white/[0.07] space-y-2 text-xs font-mono tabular-nums">
                        <div className="flex justify-between text-zinc-400">
                          <span className="font-sans">{t('stLockedLine')}:</span>
                          <span className="text-white">
                            {currentLivePrice !== null ? `$${currentLivePrice.toFixed(activeDecimals)}` : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between text-emerald-400">
                          <span className="font-sans">{t('stProfitLabel')}:</span>
                          <span className="font-bold">+${profitUsd.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-white font-bold pt-1.5 border-t border-white/[0.06]">
                          <span className="font-sans">{t('stTotalReturn')}:</span>
                          <span>${returnUsd.toFixed(2)} USD</span>
                        </div>
                      </div>
                    </div>

                    {/* BUY & SELL Execution Buttons */}
                    <div className="space-y-2.5 pt-1">
                      <button
                        type="button"
                        disabled={!marketLive || submittingTrade !== null || !tradeConfig.enabled}
                        onClick={() => handlePlaceTimedTrade('BUY')}
                        className="w-full py-3.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors text-left flex items-center justify-between"
                      >
                        <div>
                          <div className="text-sm font-display font-bold tracking-wide">
                            {submittingTrade === 'BUY' ? '...' : t('stBuyBtn')}
                          </div>
                          <div className="text-[11px] text-emerald-100/90 mt-0.5">{t('stBuyRule')}</div>
                        </div>
                        <ArrowUpRight className="w-5 h-5 shrink-0" />
                      </button>

                      <button
                        type="button"
                        disabled={!marketLive || submittingTrade !== null || !tradeConfig.enabled}
                        onClick={() => handlePlaceTimedTrade('SELL')}
                        className="w-full py-3.5 px-4 rounded-lg bg-[#E11D2E] hover:bg-[#FF2438] disabled:opacity-50 text-white transition-colors text-left flex items-center justify-between"
                      >
                        <div>
                          <div className="text-sm font-display font-bold tracking-wide">
                            {submittingTrade === 'SELL' ? '...' : t('stSellBtn')}
                          </div>
                          <div className="text-[11px] text-red-100/90 mt-0.5">{t('stSellRule')}</div>
                        </div>
                        <ArrowDownLeft className="w-5 h-5 shrink-0" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Bottom Sub-Tabs: Active Trades / Settled History / Spot Exchange API */}
                <div className="rounded-xl bg-[#0D0F16] border border-white/[0.08] overflow-hidden">
                  <div className="flex flex-wrap border-b border-white/[0.08] bg-[#090B11] px-4">
                    <button
                      type="button"
                      onClick={() => setTradeSubTab('open')}
                      className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
                        tradeSubTab === 'open'
                          ? 'border-[#E11D2E] text-white'
                          : 'border-transparent text-zinc-400 hover:text-white'
                      }`}
                    >
                      {t('stOpenTrades')} ({openTrades.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTradeSubTab('history')}
                      className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
                        tradeSubTab === 'history'
                          ? 'border-[#E11D2E] text-white'
                          : 'border-transparent text-zinc-400 hover:text-white'
                      }`}
                    >
                      {t('stSettledTrades')} ({settledTrades.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTradeSubTab('api')}
                      className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
                        tradeSubTab === 'api'
                          ? 'border-[#E11D2E] text-white'
                          : 'border-transparent text-zinc-400 hover:text-white'
                      }`}
                    >
                      {t('stExchangeApiToggle')} ({connections.length})
                    </button>
                  </div>

                  {tradeSubTab === 'open' && (
                    <div className="p-4">
                      {openTrades.length === 0 ? (
                        <div className="py-8 text-center text-xs text-zinc-500">{t('stNoOpenTrades')}</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="text-zinc-400 border-b border-white/[0.07]">
                              <tr>
                                <th className="py-2.5 px-3">ID</th>
                                <th className="py-2.5 px-3">Asset</th>
                                <th className="py-2.5 px-3">{t('stEntryPrice')}</th>
                                <th className="py-2.5 px-3">{t('stLivePrice')}</th>
                                <th className="py-2.5 px-3 text-right">USD</th>
                                <th className="py-2.5 px-3 text-right">{t('stProfitLabel')}</th>
                                <th className="py-2.5 px-3 text-right">{t('stExpiry')}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.05] font-mono tabular-nums">
                              {openTrades.map((tr) => {
                                const quoteObj = marketAssets.find((a) => a.symbol === tr.asset);
                                const dec = quoteObj?.decimals ?? 2;
                                const cur = quoteObj?.price ?? null;
                                const isWin =
                                  cur !== null
                                    ? tr.direction === 'BUY'
                                      ? cur > tr.entry_price
                                      : cur < tr.entry_price
                                    : null;
                                const remSec = Math.max(0, Math.ceil((tr.expires_at_ms - clockNowMs) / 1000));
                                const potProfit = Math.round((tr.stake_cents * tr.payout_bps) / 10000);
                                return (
                                  <tr key={tr.id} className="hover:bg-white/[0.02]">
                                    <td className="py-2.5 px-3 text-white">{tr.trade_code}</td>
                                    <td className="py-2.5 px-3 font-sans">
                                      <span className="text-white font-semibold mr-2">{tr.asset}</span>
                                      <span className={tr.direction === 'BUY' ? 'text-emerald-400 font-bold' : 'text-[#E11D2E] font-bold'}>
                                        {tr.direction}
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-3 text-zinc-200">{tr.entry_price.toFixed(dec)}</td>
                                    <td className={`py-2.5 px-3 font-bold ${isWin === null ? 'text-zinc-300' : isWin ? 'text-emerald-400' : 'text-[#E11D2E]'}`}>
                                      {cur !== null ? cur.toFixed(dec) : '—'}
                                    </td>
                                    <td className="py-2.5 px-3 text-right text-white">{formatUsdLocale(tr.stake_cents)}</td>
                                    <td className="py-2.5 px-3 text-right text-emerald-400">+{formatUsdLocale(potProfit)}</td>
                                    <td className="py-2.5 px-3 text-right text-amber-400 font-bold">
                                      {String(Math.floor(remSec / 60)).padStart(2, '0')}:{String(remSec % 60).padStart(2, '0')}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {tradeSubTab === 'history' && (
                    <div className="p-4 overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="text-zinc-400 border-b border-white/[0.07]">
                          <tr>
                            <th className="py-2.5 px-3">ID</th>
                            <th className="py-2.5 px-3">Asset</th>
                            <th className="py-2.5 px-3">{t('stEntryPrice')}</th>
                            <th className="py-2.5 px-3">{t('stClosePrice')}</th>
                            <th className="py-2.5 px-3 text-right">USD</th>
                            <th className="py-2.5 px-3 text-right">PnL</th>
                            <th className="py-2.5 px-3">Status</th>
                            <th className="py-2.5 px-3 text-right">Time</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.05] font-mono tabular-nums">
                          {settledTrades.map((tr) => {
                            const dec = marketAssets.find((a) => a.symbol === tr.asset)?.decimals ?? 2;
                            return (
                              <tr key={tr.id} className="hover:bg-white/[0.02]">
                                <td className="py-2.5 px-3 text-white">{tr.trade_code}</td>
                                <td className="py-2.5 px-3 font-sans">
                                  <span className="text-white font-semibold mr-2">{tr.asset}</span>
                                  <span className={tr.direction === 'BUY' ? 'text-emerald-400' : 'text-[#E11D2E]'}>{tr.direction}</span>
                                </td>
                                <td className="py-2.5 px-3 text-zinc-300">{tr.entry_price.toFixed(dec)}</td>
                                <td className="py-2.5 px-3 text-zinc-200">
                                  {tr.settlement_price !== null && tr.settlement_price !== undefined ? tr.settlement_price.toFixed(dec) : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-right text-zinc-300">{formatUsdLocale(tr.stake_cents)}</td>
                                <td
                                  className={`py-2.5 px-3 text-right font-bold ${
                                    tr.pnl_cents > 0 ? 'text-emerald-400' : tr.pnl_cents < 0 ? 'text-[#E11D2E]' : 'text-zinc-300'
                                  }`}
                                >
                                  {tr.pnl_cents > 0 ? '+' : ''}
                                  {formatUsdLocale(tr.pnl_cents)}
                                </td>
                                <td
                                  className={`py-2.5 px-3 font-sans font-semibold ${
                                    tr.status === 'won' ? 'text-emerald-400' : tr.status === 'lost' ? 'text-[#E11D2E]' : 'text-zinc-300'
                                  }`}
                                >
                                  {statusLabel(tr.status)}
                                </td>
                                <td className="py-2.5 px-3 text-right text-zinc-500">
                                  {formatDateTimeLocale(tr.settled_at || tr.opened_at)}
                                </td>
                              </tr>
                            );
                          })}
                          {settledTrades.length === 0 && (
                            <tr>
                              <td colSpan={8} className="py-8 text-center text-zinc-500 font-sans">
                                —
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {tradeSubTab === 'api' && (
                    <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <form onSubmit={handleConnectExchange} className="p-4 rounded-lg bg-[#08090D] border border-white/[0.07] space-y-3">
                        <h3 className="text-sm font-display font-semibold text-white">{t('stExchangeApiToggle')}</h3>
                        <div className="grid grid-cols-2 gap-3">
                          <select
                            value={connExchange}
                            onChange={(e) => setConnExchange(e.target.value)}
                            className="px-3 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                          >
                            <option value="Binance">Binance</option>
                            <option value="Bybit">Bybit</option>
                            <option value="Coinbase Advanced">Coinbase Advanced</option>
                            <option value="Kraken">Kraken</option>
                          </select>
                          <input
                            type="text"
                            value={connLabel}
                            onChange={(e) => setConnLabel(e.target.value)}
                            placeholder="Label"
                            className="px-3 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                          />
                        </div>
                        <input
                          type="text"
                          required
                          value={connKey}
                          onChange={(e) => setConnKey(e.target.value)}
                          placeholder="API Key"
                          className="w-full px-3 py-2 text-xs font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                        />
                        <input
                          type="password"
                          required
                          value={connSecret}
                          onChange={(e) => setConnSecret(e.target.value)}
                          placeholder="API Secret"
                          className="w-full px-3 py-2 text-xs font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                        />
                        <button type="submit" className="w-full py-2 bg-[#181B26] hover:bg-[#242838] text-white text-xs font-semibold rounded-lg">
                          Save API Key (AES-256)
                        </button>

                        {connections.length > 0 && (
                          <div className="pt-2 space-y-1.5 border-t border-white/[0.06] text-xs">
                            {connections.map((c) => (
                              <div key={c.id} className="flex items-center justify-between text-zinc-300">
                                <span>{c.exchange_name} ({c.label})</span>
                                <span className="font-mono text-zinc-500">{c.api_key_masked}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </form>

                      <form onSubmit={handleDispatchOrder} className="p-4 rounded-lg bg-[#08090D] border border-white/[0.07] space-y-3">
                        <h3 className="text-sm font-display font-semibold text-white">Spot Exchange Order</h3>
                        <select
                          value={orderConnId}
                          onChange={(e) => setOrderConnId(e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                        >
                          <option value="">Select connected exchange...</option>
                          {connections.map((c) => (
                            <option key={c.id} value={c.id}>{c.exchange_name} · {c.api_key_masked}</option>
                          ))}
                        </select>
                        <div className="grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => setOrderSide('BUY')}
                            className={`py-2 text-xs font-semibold rounded-lg ${orderSide === 'BUY' ? 'bg-emerald-600 text-white' : 'bg-[#151822] text-zinc-400'}`}
                          >
                            BUY
                          </button>
                          <button
                            type="button"
                            onClick={() => setOrderSide('SELL')}
                            className={`py-2 text-xs font-semibold rounded-lg ${orderSide === 'SELL' ? 'bg-[#E11D2E] text-white' : 'bg-[#151822] text-zinc-400'}`}
                          >
                            SELL
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <input
                            type="number"
                            step="0.0001"
                            value={orderQty}
                            onChange={(e) => setOrderQty(e.target.value)}
                            placeholder="Qty"
                            className="px-3 py-2 text-xs font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                          />
                          <input
                            type="number"
                            value={orderSl}
                            onChange={(e) => setOrderSl(e.target.value)}
                            placeholder="SL $"
                            className="px-3 py-2 text-xs font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                          />
                          <input
                            type="number"
                            value={orderTp}
                            onChange={(e) => setOrderTp(e.target.value)}
                            placeholder="TP $"
                            className="px-3 py-2 text-xs font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                          />
                        </div>
                        <button
                          type="submit"
                          className="w-full py-2.5 bg-[#E11D2E] hover:bg-[#FF2438] text-white text-xs font-semibold rounded-lg"
                        >
                          Dispatch Order
                        </button>
                        {selfOrders.length > 0 && (
                          <div className="text-[11px] text-zinc-400 pt-2 border-t border-white/[0.06]">
                            Last: {selfOrders[0].symbol} {selfOrders[0].side} · {selfOrders[0].status}
                          </div>
                        )}
                      </form>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* TAB: HISTÓRICO FINANCEIRO */}
          {tab === 'historico' && (
            <div className="space-y-4">
              <h2 className="text-xl font-display font-semibold text-white">{t('financialHistory')}</h2>
              <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#0D0F16]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/[0.08] text-zinc-400">
                    <tr>
                      <th className="py-3 px-4">ID</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4">Ref</th>
                      <th className="py-3 px-4 text-right">USD</th>
                      <th className="py-3 px-4">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-white/[0.02]">
                        <td className="py-3 px-4 font-mono text-zinc-300">{tx.id}</td>
                        <td className="py-3 px-4 text-white">{tx.description}</td>
                        <td className="py-3 px-4 font-mono text-zinc-500">{tx.external_ref || '—'}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-white">{formatUsdLocale(tx.amount_cents)}</td>
                        <td className="py-3 px-4 font-mono text-zinc-400">{formatDateTimeLocale(tx.created_at)}</td>
                      </tr>
                    ))}
                    {transactions.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-zinc-500">—</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB: PERFIL, KYC, MFA & SESSÕES */}
          {tab === 'perfil' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-4">
                <h3 className="text-base font-display font-semibold text-white">{t('profileTitle')}</h3>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={profName}
                    onChange={(e) => setProfName(e.target.value)}
                    placeholder={t('fullNamePlaceholder')}
                    className="w-full px-3.5 py-2 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                  />
                  <input
                    type="text"
                    value={profPhone}
                    onChange={(e) => setProfPhone(e.target.value)}
                    placeholder={t('phonePlaceholder')}
                    className="w-full px-3.5 py-2 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                  />
                  <button
                    onClick={async () => {
                      const res = await apiFetch('/api/auth/profile', {
                        method: 'PATCH',
                        body: JSON.stringify({ fullName: profName, phone: profPhone }),
                      });
                      onUserRefresh(res.user);
                      setFeedback({ type: 'ok', text: t('saveProfileBtn') });
                    }}
                    className="px-4 py-2 bg-[#181B26] hover:bg-[#242838] text-white text-xs font-semibold rounded-lg"
                  >
                    {t('saveProfileBtn')}
                  </button>
                </div>

                <div className="pt-4 border-t border-white/[0.08] space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">{t('kycStatusLabel')}:</span>
                    <span className="font-semibold text-white">
                      {statusLabel(user.kyc_status)}
                      {user.verification_source && (
                        <span className="ml-2 text-[11px] text-emerald-400 font-mono">
                          ({user.verification_source === 'registry_live' ? t('docValidRegistry') : t('docValidChecksum')})
                        </span>
                      )}
                    </span>
                  </div>

                  <GlobalIdentityFields
                    value={kycIdentity}
                    onChange={setKycIdentity}
                    compact
                  />

                  <input
                    type="text"
                    value={kycDoc}
                    onChange={(e) => setKycDoc(e.target.value)}
                    placeholder={t('govIdPlaceholder')}
                    className="w-full px-3.5 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                  />
                  <button
                    onClick={async () => {
                      try {
                        const res = await apiFetch('/api/auth/kyc', {
                          method: 'POST',
                          body: JSON.stringify({
                            taxId: kycIdentity.taxId,
                            documentType: kycIdentity.documentType,
                            countryCode: kycIdentity.country,
                            postalCode: kycIdentity.postalCode,
                            city: kycIdentity.city,
                            stateRegion: kycIdentity.stateRegion,
                            documentNumber: kycDoc,
                          }),
                        });
                        if (res.user) onUserRefresh(res.user);
                        setFeedback({
                          type: 'ok',
                          text:
                            res.identityCheck?.registryMessage ||
                            t('docValidChecksum'),
                        });
                      } catch (err: any) {
                        setFeedback({ type: 'err', text: err.message });
                      }
                    }}
                    className="px-4 py-2 bg-[#E11D2E] hover:bg-[#FF2438] text-white text-xs font-semibold rounded-lg"
                  >
                    {t('submitKycBtn')}
                  </button>
                </div>
              </div>

              <div className="p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-4">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#E11D2E]" />
                  <h3 className="text-base font-display font-semibold text-white">{t('mfaTitle')}</h3>
                </div>

                {user.mfa_enabled === 0 ? (
                  <div className="space-y-3">
                    {!mfaSetup ? (
                      <button
                        onClick={async () => {
                          const res = await apiFetch('/api/auth/mfa/setup', { method: 'POST' });
                          setMfaSetup(res);
                        }}
                        className="px-4 py-2 bg-[#E11D2E] text-white text-xs font-semibold rounded-lg"
                      >
                        MFA (TOTP)
                      </button>
                    ) : (
                      <div className="p-4 rounded-lg bg-[#08090D] border border-white/[0.08] space-y-3">
                        <img src={mfaSetup.qrDataUrl} alt="MFA QR Code" className="w-36 h-36 bg-white p-1.5 rounded-lg" />
                        <div className="text-xs font-mono text-zinc-300 break-all">{mfaSetup.secret}</div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            maxLength={6}
                            value={mfaVerifyInput}
                            onChange={(e) => setMfaVerifyInput(e.target.value)}
                            placeholder="000000"
                            className="flex-1 px-3 py-2 text-xs font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                          />
                          <button
                            onClick={async () => {
                              try {
                                await apiFetch('/api/auth/mfa/enable', {
                                  method: 'POST',
                                  body: JSON.stringify({ code: mfaVerifyInput }),
                                });
                                setMfaSetup(null);
                                onUserRefresh({ ...user, mfa_enabled: 1 });
                                setFeedback({ type: 'ok', text: 'MFA OK' });
                              } catch (err: any) {
                                setFeedback({ type: 'err', text: err.message });
                              }
                            }}
                            className="px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg"
                          >
                            OK
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-emerald-400 font-medium">MFA Active</div>
                )}

                <div className="pt-4 border-t border-white/[0.08] space-y-2">
                  <div className="text-xs font-semibold text-white">Sessions</div>
                  {sessions.slice(0, 5).map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-xs py-1.5 border-b border-white/[0.05]">
                      <div className="truncate max-w-[240px]">
                        <span className="font-mono text-zinc-300">{s.ip_address}</span> · {formatDateTimeLocale(s.created_at)}
                      </div>
                      {s.revoked_at ? (
                        <span className="text-zinc-500">{statusLabel('closed')}</span>
                      ) : (
                        <button
                          onClick={async () => {
                            await apiFetch(`/api/auth/sessions/${s.id}`, { method: 'DELETE' });
                            loadSessions();
                          }}
                          className="text-[#E11D2E] hover:underline"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB: NOTIFICAÇÕES */}
          {tab === 'notificacoes' && (
            <div className="space-y-4">
              <h2 className="text-xl font-display font-semibold text-white">{t('invNotifications')}</h2>
              <div className="space-y-2.5">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-4 rounded-xl border flex items-start justify-between gap-4 ${
                      n.read_at ? 'bg-[#0A0B10] border-white/[0.06]' : 'bg-[#11131B] border-[#E11D2E]/35'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <img src={OFFICIAL_LOGO_PATH} alt="AZKOYEN" className="w-7 h-7 rounded-full object-cover mt-0.5" />
                      <div>
                        <div className="text-sm font-semibold text-white">{n.title}</div>
                        <div className="text-xs text-zinc-300 mt-0.5">{n.message}</div>
                        <div className="text-[11px] text-zinc-500 mt-1 font-mono">{formatDateTimeLocale(n.created_at)}</div>
                      </div>
                    </div>
                    {!n.read_at && (
                      <button
                        onClick={async () => {
                          await apiFetch(`/api/notifications/${n.id}/read`, { method: 'POST' });
                          loadAll();
                        }}
                        className="text-xs text-zinc-400 hover:text-white shrink-0"
                      >
                        Marcar lida
                      </button>
                    )}
                  </div>
                ))}
                {notifications.length === 0 && <div className="text-xs text-zinc-500">Sem notificações no momento.</div>}
              </div>
            </div>
          )}

          {/* TAB: SUPORTE */}
          {tab === 'suporte' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await apiFetch('/api/support/tickets', {
                    method: 'POST',
                    body: JSON.stringify({ subject: supSubject, category: supCategory, message: supMessage }),
                  });
                  setSupSubject('');
                  setSupMessage('');
                  setFeedback({ type: 'ok', text: 'Solicitação registrada junto ao atendimento AZKOYEN INVEST.' });
                  loadAll();
                }}
                className="p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-3"
              >
                <h3 className="text-base font-display font-semibold text-white">Atendimento ao Investidor</h3>
                <input
                  type="text"
                  required
                  value={supSubject}
                  onChange={(e) => setSupSubject(e.target.value)}
                  placeholder="Assunto"
                  className="w-full px-3.5 py-2 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                />
                <select
                  value={supCategory}
                  onChange={(e) => setSupCategory(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                >
                  <option value="Financeiro">Financeiro / Depósitos / Saques</option>
                  <option value="Contratos">Contratos & Pools</option>
                  <option value="Segurança">Segurança & Cadastro</option>
                </select>
                <textarea
                  rows={4}
                  required
                  value={supMessage}
                  onChange={(e) => setSupMessage(e.target.value)}
                  placeholder="Descreva sua dúvida ou solicitação..."
                  className="w-full px-3.5 py-2 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                />
                <button type="submit" className="w-full py-2.5 bg-[#E11D2E] text-white text-xs font-semibold rounded-lg">
                  Enviar Mensagem
                </button>
              </form>

              <div className="p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-3">
                <h3 className="text-base font-display font-semibold text-white">Meus Atendimentos</h3>
                {tickets.map((t) => (
                  <div key={t.id} className="p-3.5 rounded-lg bg-[#08090D] border border-white/[0.06] text-xs space-y-1.5">
                    <div className="flex justify-between">
                      <span className="font-semibold text-white">{t.subject}</span>
                      <span className="text-zinc-400">{t.status}</span>
                    </div>
                    <p className="text-zinc-400">{t.message}</p>
                    {t.admin_reply && (
                      <div className="mt-2 pt-2 border-t border-white/[0.06] text-emerald-300">
                        Resposta AZKOYEN INVEST: {t.admin_reply}
                      </div>
                    )}
                  </div>
                ))}
                {tickets.length === 0 && <p className="text-xs text-zinc-500">Nenhum atendimento registrado.</p>}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* MODAL: ADESÃO AO POOL */}
      {selectedPoolModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={handleInvestConfirm}
            className="w-full max-w-lg rounded-xl bg-[#0D0F16] border border-white/[0.12] p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-display font-bold text-white">{selectedPoolModal.product.name}</h3>
              <button type="button" onClick={() => setSelectedPoolModal(null)} className="text-zinc-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-xs text-zinc-300 space-y-2 bg-[#08090D] p-3.5 rounded-lg border border-white/[0.07]">
              <div><span className="text-zinc-500">Pool:</span> {selectedPoolModal.pool.name}</div>
              <div><span className="text-zinc-500">Política de Resgate:</span> {selectedPoolModal.product.redemption_policy}</div>
              <div><span className="text-zinc-500">Política de Risco e Perdas:</span> {selectedPoolModal.product.loss_policy}</div>
              <div><span className="text-zinc-500">Instrumento Contratual:</span> {selectedPoolModal.product.contract_terms}</div>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">
                USD ({t('availableUsd')}: {formatUsdLocale(wallet?.available_cents)})
              </label>
              <input
                type="number"
                min={selectedPoolModal.product.min_capital_cents / 100}
                max={selectedPoolModal.product.max_capital_cents / 100}
                step="10"
                required
                value={investAmount}
                onChange={(e) => setInvestAmount(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
              />
            </div>
            <div className="text-[11px] text-zinc-400">
              {formatPctFromBps(selectedPoolModal.product.contractual_yield_bps)} · {t('portfolioNote')}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setSelectedPoolModal(null)} className="flex-1 py-2.5 text-xs bg-[#181B26] text-zinc-200 rounded-lg">
                {t('cancel')}
              </button>
              <button type="submit" className="flex-1 py-2.5 text-xs font-semibold bg-[#E11D2E] hover:bg-[#FF2438] text-white rounded-lg">
                {t('investAction')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: CERTIFICADO CONTRATUAL INSTITUCIONAL FORMATADO */}
      {contractModal && parsedContract && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl bg-[#0B0C11] border border-[#E11D2E]/40 p-7 space-y-5 max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-5">
              <BrandLogo size="sm" subtitle="AZKOYEN INVEST" />
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-zinc-300">{contractModal.contract_code}</span>
                <button onClick={() => setContractModal(null)} className="text-zinc-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs bg-[#07080C] p-4 rounded-lg border border-white/[0.06]">
              <div>
                <div className="text-zinc-500">{t('investorDeskTitle')}</div>
                <div className="text-white font-semibold mt-0.5">{parsedContract.investorName || user.full_name}</div>
              </div>
              <div>
                <div className="text-zinc-500">Issued</div>
                <div className="text-white font-mono mt-0.5">{formatDateTimeLocale(contractModal.invested_at)}</div>
              </div>
              <div>
                <div className="text-zinc-500">Product</div>
                <div className="text-white font-medium mt-0.5">{parsedContract.productName || contractModal.product_name}</div>
              </div>
              <div>
                <div className="text-zinc-500">Pool</div>
                <div className="text-white font-medium mt-0.5">{parsedContract.poolName || contractModal.pool_name}</div>
              </div>
              <div>
                <div className="text-zinc-500">{t('investedCapital')}</div>
                <div className="text-white font-mono font-bold mt-0.5">{formatUsdLocale(contractModal.principal_cents)}</div>
              </div>
              <div>
                <div className="text-zinc-500">{t('termLabel')}</div>
                <div className="text-white font-mono mt-0.5">{formatDateLocale(contractModal.maturity_date)}</div>
              </div>
            </div>

            <div className="space-y-2.5 text-xs text-zinc-300 leading-relaxed">
              <div>{parsedContract.terms}</div>
              <div>{parsedContract.redemptionPolicy}</div>
              <div>{parsedContract.lossPolicy}</div>
              <div className="pt-2 text-[11px] text-zinc-500 border-t border-white/[0.06]">
                {parsedContract.disclaimer}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setContractModal(null)} className="px-4 py-2 text-xs bg-[#181B26] text-zinc-200 rounded-lg">
                {t('close')}
              </button>
              <button onClick={() => window.print()} className="px-4 py-2 text-xs font-semibold bg-[#E11D2E] text-white rounded-lg">
                Print
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
