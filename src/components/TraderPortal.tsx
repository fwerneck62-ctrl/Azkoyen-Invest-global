import React, { useState, useEffect, useCallback } from 'react';
import {
  Briefcase,
  Activity,
  Award,
  Layers,
  Send,
  FileCheck,
  LogOut,
  Plus,
  GitPullRequest,
  User as UserIcon,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { CountryLanguageSelector } from './CountryLanguageSelector';
import { useLocale } from '../i18n/LocaleContext';
import { apiFetch, connectRealtime, getAuthToken } from '../lib/api';
import { formatPctFromBps } from '../lib/format';
import type { User, Product, Pool, ManualOperation } from '../types';

type TraderTab = 'dashboard' | 'central_operacoes' | 'pools' | 'comissoes' | 'perfil';

export const TraderPortal: React.FC<{
  user: User;
  onLogout: () => void;
  onUserRefresh?: (u: User) => void;
}> = ({ user, onLogout, onUserRefresh }) => {
  const { countryCode, t, statusLabel, formatUsdLocale, formatDateTimeLocale } = useLocale();
  const [tab, setTab] = useState<TraderTab>('dashboard');
  const [profile, setProfile] = useState<any>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [operations, setOperations] = useState<ManualOperation[]>([]);
  const [commissionsCents, setCommissionsCents] = useState(0);

  // Central de Operações Form
  const [poolId, setPoolId] = useState('');
  const [asset, setAsset] = useState('BTC-PERP / USDT');
  const [opType, setOpType] = useState<'LONG' | 'SHORT' | 'HEDGE' | 'ARBITRAGE' | 'OPTIONS'>('ARBITRAGE');
  const [exchangeVenue, setExchangeVenue] = useState('Binance Institutional');
  const [entryUsd, setEntryUsd] = useState('10000');
  const [exitUsd, setExitUsd] = useState('10650');
  const [feesUsd, setFeesUsd] = useState('24');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [notes, setNotes] = useState('');

  // Adjustment Modal
  const [adjTarget, setAdjTarget] = useState<ManualOperation | null>(null);
  const [adjDeltaUsd, setAdjDeltaUsd] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjEvidence, setAdjEvidence] = useState('');

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await apiFetch('/api/trader/overview');
      setProfile(res.profile);
      setProducts(res.products || []);
      setPools(res.pools || []);
      setOperations(res.operations || []);
      setCommissionsCents(res.accumulatedCommissionsCents || 0);
      if (res.pools?.[0] && !poolId) {
        setPoolId(res.pools[0].id);
      }
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  }, [poolId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;
    return connectRealtime(token, (evt) => {
      if (['operation:updated', 'pool:updated', 'trader:compensation_updated'].includes(evt)) loadData();
    });
  }, [loadData]);

  const selectedPool = pools.find((p) => p.id === poolId);
  const previewNetUsd = Number(exitUsd || 0) - Number(entryUsd || 0) - Number(feesUsd || 0);
  const totalOperationalCapital = pools.reduce((acc, p) => acc + p.operational_capital_cents, 0);
  const totalRealizedPnl = pools.reduce((acc, p) => acc + p.realized_pnl_cents, 0);

  const handleSubmitOperation = async (submitImmediately: boolean) => {
    setFeedback(null);
    try {
      const res = await apiFetch('/api/trader/operations', {
        method: 'POST',
        body: JSON.stringify({
          poolId,
          asset,
          opType,
          exchangeVenue,
          entryValueUsd: Number(entryUsd),
          exitValueUsd: Number(exitUsd),
          feesUsd: Number(feesUsd),
          evidenceRef,
          notes,
          submitImmediately,
        }),
      });
      setEvidenceRef('');
      setNotes('');
      setFeedback({
        type: 'ok',
        text: submitImmediately
          ? `Operação ${res.operation.op_code} enviada para análise administrativa.`
          : `Rascunho ${res.operation.op_code} salvo.`,
      });
      loadData();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleSubmitDraft = async (opId: string) => {
    try {
      await apiFetch(`/api/trader/operations/${opId}`, {
        method: 'PATCH',
        body: JSON.stringify({ submit: true }),
      });
      setFeedback({ type: 'ok', text: 'Operação enviada para aprovação administrativa.' });
      loadData();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleSendAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjTarget) return;
    try {
      await apiFetch(`/api/trader/operations/${adjTarget.id}/adjustment`, {
        method: 'POST',
        body: JSON.stringify({
          deltaUsd: Number(adjDeltaUsd),
          reason: adjReason,
          evidenceRef: adjEvidence,
        }),
      });
      setAdjTarget(null);
      setAdjDeltaUsd('');
      setAdjReason('');
      setAdjEvidence('');
      setFeedback({ type: 'ok', text: 'Lançamento de ajuste auditável enviado para revisão.' });
      loadData();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

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

  const nav: Array<{ id: TraderTab; label: string; icon: React.ReactNode }> = [
    { id: 'dashboard', label: t('trdDesk'), icon: <Activity className="w-4 h-4" /> },
    { id: 'central_operacoes', label: t('trdOpsCenter'), icon: <Send className="w-4 h-4" /> },
    { id: 'pools', label: t('trdPools'), icon: <Layers className="w-4 h-4" /> },
    { id: 'comissoes', label: t('trdCommissions'), icon: <Award className="w-4 h-4" /> },
    { id: 'perfil', label: t('trdProfile'), icon: <UserIcon className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-[#060609] text-[#F1F3F5] flex">
      <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-[#090A0F] border-r border-white/[0.08]">
        <div className="p-5 border-b border-white/[0.08]">
          <BrandLogo size="sm" subtitle={t('trdDesk')} />
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                tab === n.id ? 'bg-[#E11D2E] text-white' : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              {n.icon}
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-white/[0.08]">
          <div className="text-xs font-medium text-white truncate">{user.full_name}</div>
          <div className="text-[11px] text-zinc-500 truncate mb-3">{countryCode} · {profile?.credentials_summary}</div>
          <button
            onClick={onLogout}
            className="w-full py-2 text-xs font-medium bg-[#141722] hover:bg-[#1C202E] rounded-lg flex items-center justify-center gap-2 text-zinc-200"
          >
            <LogOut className="w-3.5 h-3.5 text-[#E11D2E]" />
            <span>{t('logout')}</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 px-4 sm:px-8 border-b border-white/[0.08] bg-[#08090E]/90 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 text-sm text-zinc-400 truncate">
            <span className="font-semibold text-white">AZKOYEN INVEST</span>
            <span>/</span>
            <span className="truncate">{nav.find((n) => n.id === tab)?.label}</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <CountryLanguageSelector onCountryOrLangChange={persistLocalePreference} />
            <button
              onClick={() => setTab('central_operacoes')}
              className="px-4 py-2 text-xs font-semibold bg-[#E11D2E] hover:bg-[#FF2438] text-white rounded-lg whitespace-nowrap"
            >
              {t('trdNewOpBtn')}
            </button>
            <button onClick={onLogout} className="lg:hidden px-3 py-2 text-xs bg-[#161925] rounded-lg text-zinc-200">
              {t('logout')}
            </button>
          </div>
        </header>

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

          {/* Mobile Tab Bar */}
          <div className="flex lg:hidden gap-1 overflow-x-auto pb-2">
            {nav.map((n) => (
              <button
                key={n.id}
                onClick={() => setTab(n.id)}
                className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                  tab === n.id ? 'bg-[#E11D2E] text-white' : 'bg-[#11131B] text-zinc-400'
                }`}
              >
                {n.label}
              </button>
            ))}
          </div>

          {tab === 'dashboard' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-xs text-zinc-400">{t('trdAuthorizedCap')}</div>
                  <div className="text-2xl font-mono tabular-nums font-bold text-white mt-1.5">
                    {formatUsdLocale(totalOperationalCapital)}
                  </div>
                </div>
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-xs text-zinc-400">{t('trdApprovedPnl')}</div>
                  <div className={`text-2xl font-mono tabular-nums font-bold mt-1.5 ${totalRealizedPnl >= 0 ? 'text-emerald-400' : 'text-[#E11D2E]'}`}>
                    {formatUsdLocale(totalRealizedPnl)}
                  </div>
                </div>
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-xs text-zinc-400">{t('trdRealizedComm')}</div>
                  <div className="text-2xl font-mono tabular-nums font-bold text-emerald-400 mt-1.5">
                    {formatUsdLocale(commissionsCents)}
                  </div>
                </div>
                <div className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08]">
                  <div className="text-xs text-zinc-400">{t('trdLinkedPools')}</div>
                  <div className="text-2xl font-mono tabular-nums font-bold text-white mt-1.5">{pools.length}</div>
                </div>
              </div>

              <div className="rounded-xl bg-[#0D0F16] border border-white/[0.08] overflow-hidden">
                <div className="p-5 border-b border-white/[0.08] flex items-center justify-between">
                  <h3 className="text-base font-display font-semibold text-white">Operações Recentes</h3>
                  <button
                    onClick={() => setTab('central_operacoes')}
                    className="text-xs text-[#E11D2E] hover:underline font-medium"
                  >
                    Abrir Central de Operações →
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-white/[0.06] text-zinc-400">
                      <tr>
                        <th className="py-3 px-4">Código</th>
                        <th className="py-3 px-4">Pool</th>
                        <th className="py-3 px-4">Ativo / Tipo</th>
                        <th className="py-3 px-4 text-right">Resultado Líquido</th>
                        <th className="py-3 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {operations.slice(0, 8).map((op) => (
                        <tr key={op.id}>
                          <td className="py-3 px-4 font-mono text-white">{op.op_code}</td>
                          <td className="py-3 px-4 text-zinc-300">{op.pool_name}</td>
                          <td className="py-3 px-4 font-mono text-zinc-300">{op.asset} · {op.op_type}</td>
                          <td className={`py-3 px-4 text-right font-mono tabular-nums ${op.net_pnl_cents >= 0 ? 'text-emerald-400' : 'text-[#E11D2E]'}`}>
                            {formatUsdLocale(op.net_pnl_cents)}
                          </td>
                          <td className="py-3 px-4 text-zinc-300">{statusLabel(op.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* CENTRAL DE OPERAÇÕES MANUAIS */}
          {tab === 'central_operacoes' && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-2 p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-4">
                <div className="flex items-center gap-2">
                  <Plus className="w-4 h-4 text-[#E11D2E]" />
                  <h2 className="text-lg font-display font-semibold text-white">CENTRAL DE OPERAÇÕES</h2>
                </div>
                <p className="text-xs text-zinc-400">
                  Registre operações executadas em corretoras externas com comprovação documental obrigatória.
                </p>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Pool Autorizado</label>
                  <select
                    value={poolId}
                    onChange={(e) => setPoolId(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                  >
                    {pools.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatUsdLocale(p.operational_capital_cents)})
                      </option>
                    ))}
                  </select>
                  {selectedPool && (
                    <div className="text-[11px] text-zinc-400 mt-1 font-mono">
                      {t('trdAuthorizedCap')}: <span className="text-white">{formatUsdLocale(selectedPool.operational_capital_cents)}</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Ativo Negociado</label>
                    <input
                      type="text"
                      value={asset}
                      onChange={(e) => setAsset(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Tipo de Operação</label>
                    <select
                      value={opType}
                      onChange={(e) => setOpType(e.target.value as any)}
                      className="w-full px-3 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                    >
                      <option value="LONG">LONG</option>
                      <option value="SHORT">SHORT</option>
                      <option value="ARBITRAGE">ARBITRAGE</option>
                      <option value="HEDGE">HEDGE</option>
                      <option value="OPTIONS">OPTIONS</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Corretora / Exchange Externa</label>
                  <input
                    type="text"
                    value={exchangeVenue}
                    onChange={(e) => setExchangeVenue(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Entrada (USD)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={entryUsd}
                      onChange={(e) => setEntryUsd(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Saída (USD)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={exitUsd}
                      onChange={(e) => setExitUsd(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Taxas (USD)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={feesUsd}
                      onChange={(e) => setFeesUsd(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                    />
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-[#08090D] border border-white/[0.06] flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Resultado Líquido Calculado:</span>
                  <span className={`font-mono font-bold ${previewNetUsd >= 0 ? 'text-emerald-400' : 'text-[#E11D2E]'}`}>
                    ${previewNetUsd.toFixed(2)}
                  </span>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Comprovante / Hash / ID de Ordem da Corretora</label>
                  <input
                    type="text"
                    required
                    value={evidenceRef}
                    onChange={(e) => setEvidenceRef(e.target.value)}
                    placeholder="Ex: EXEC-ID-991827 · Link/Hash do Extrato"
                    className="w-full px-3 py-2 text-xs font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Observações Técnicas</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                  />
                </div>

                <div className="flex gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => handleSubmitOperation(false)}
                    className="flex-1 py-2.5 text-xs font-semibold bg-[#181B26] hover:bg-[#232736] text-white rounded-lg"
                  >
                    Salvar Rascunho
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSubmitOperation(true)}
                    className="flex-1 py-2.5 text-xs font-semibold bg-[#E11D2E] hover:bg-[#FF2438] text-white rounded-lg"
                  >
                    Enviar p/ Aprovação
                  </button>
                </div>
              </div>

              <div className="lg:col-span-3 rounded-xl bg-[#0D0F16] border border-white/[0.08] overflow-hidden">
                <div className="p-5 border-b border-white/[0.08]">
                  <h3 className="text-base font-display font-semibold text-white">Registro & Auditoria de Operações</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Operações aprovadas são imutáveis; retificações geram lançamento de ajuste auditável.
                  </p>
                </div>
                <div className="divide-y divide-white/[0.06] max-h-[680px] overflow-y-auto">
                  {operations.map((op) => (
                    <div key={op.id} className="p-4 space-y-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-mono font-semibold text-white">{op.op_code}</span>
                          <span className="mx-2 text-zinc-600">·</span>
                          <span className="text-zinc-300">{op.asset} ({op.op_type})</span>
                          <span className="mx-2 text-zinc-600">·</span>
                          <span className="text-zinc-500">{op.exchange_venue}</span>
                        </div>
                        <span className={`font-mono font-bold ${op.net_pnl_cents >= 0 ? 'text-emerald-400' : 'text-[#E11D2E]'}`}>
                          {formatUsdLocale(op.net_pnl_cents)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-zinc-400">
                        <div>
                          Pool: {op.pool_name} · Ref: <span className="font-mono text-zinc-300">{op.evidence_ref}</span> · {formatDateTimeLocale(op.created_at)}
                        </div>
                        <span className="font-semibold text-white">{statusLabel(op.status)}</span>
                      </div>

                      {op.review_notes && (
                        <div className="p-2 rounded bg-[#08090D] text-zinc-300 border border-white/[0.05]">
                          Parecer Admin: {op.review_notes}
                        </div>
                      )}

                      <div className="flex gap-2 pt-1">
                        {op.status === 'draft' && (
                          <button
                            onClick={() => handleSubmitDraft(op.id)}
                            className="px-3 py-1 bg-[#E11D2E] text-white rounded text-[11px] font-semibold"
                          >
                            Enviar para Análise
                          </button>
                        )}
                        {op.status === 'approved' && !op.parent_op_id && (
                          <button
                            onClick={() => setAdjTarget(op)}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-[#181B26] hover:bg-[#23283A] text-zinc-200 rounded text-[11px]"
                          >
                            <GitPullRequest className="w-3 h-3 text-[#E11D2E]" />
                            <span>Lançar Ajuste Auditável</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {operations.length === 0 && (
                    <div className="p-8 text-center text-xs text-zinc-500">Nenhuma operação registrada ainda.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'pools' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {pools.map((p) => (
                <div key={p.id} className="p-5 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-3 text-xs">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm font-display font-semibold text-white">{p.name}</div>
                      <div className="text-zinc-500 font-mono">{p.id}</div>
                    </div>
                      <span className="text-zinc-300">{statusLabel(p.status)}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 pt-2 border-t border-white/[0.06] font-mono tabular-nums">
                      <div>
                        <div className="text-zinc-500 font-sans">Raised</div>
                        <div className="text-white font-semibold">{formatUsdLocale(p.raised_cents)}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500 font-sans">Op. Cap.</div>
                        <div className="text-white font-semibold">{formatUsdLocale(p.operational_capital_cents)}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500 font-sans">PnL</div>
                        <div className="text-emerald-400 font-semibold">{formatUsdLocale(p.realized_pnl_cents)}</div>
                      </div>
                    </div>
                    <div className="text-zinc-400">
                      {formatPctFromBps(p.investor_share_bps)} / {formatPctFromBps(p.trader_share_bps)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'comissoes' && (
              <div className="p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08] space-y-4">
                <div className="flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-base font-display font-semibold text-white">{t('trdRealizedComm')}</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div className="p-3.5 rounded-lg bg-[#08090D] border border-white/[0.06]">
                    <div className="text-zinc-400">Sua Participação nos Lucros</div>
                    <div className="text-lg font-mono font-bold text-white mt-1">
                      {((Number(profile?.profit_share_bps ?? 500)) / 100).toFixed(2)}%
                    </div>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[#08090D] border border-white/[0.06]">
                    <div className="text-zinc-400">Taxa de Comissão da Mesa</div>
                    <div className="text-lg font-mono font-bold text-amber-300 mt-1">
                      {((Number(profile?.commission_fee_bps ?? 0)) / 100).toFixed(2)}%
                    </div>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[#08090D] border border-white/[0.06]">
                    <div className="text-zinc-400">Comissões Líquidas Acumuladas</div>
                    <div className="text-lg font-mono font-bold text-emerald-400 mt-1">
                      {formatUsdLocale(commissionsCents)}
                    </div>
                  </div>
                </div>
              </div>
            )}

          {tab === 'perfil' && profile && (
            <div className="p-6 rounded-xl bg-[#0D0F16] border border-white/[0.08] flex flex-col sm:flex-row gap-6 items-start">
              <img
                src={profile.photo_url || '/src/assets/images/trader_portrait_one_1795271716411.jpg'}
                alt={user.full_name}
                className="w-24 h-24 rounded-full object-cover ring-2 ring-[#E11D2E]/40"
              />
              <div className="space-y-2 text-xs">
                <h3 className="text-lg font-display font-bold text-white">{user.full_name}</h3>
                <div className="text-zinc-400">{profile.credentials_summary} · {profile.experience_years} anos de experiência</div>
                <p className="text-zinc-300 max-w-2xl leading-relaxed">{profile.bio}</p>
                <div className="pt-2 text-zinc-400">
                  <strong className="text-white">Estratégia:</strong> {profile.strategies}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Adjustment Modal */}
      {adjTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form onSubmit={handleSendAdjustment} className="w-full max-w-md rounded-xl bg-[#0D0F16] border border-white/[0.12] p-6 space-y-4">
            <h3 className="text-base font-display font-semibold text-white">
              Lançamento de Ajuste Auditável ({adjTarget.op_code})
            </h3>
            <p className="text-xs text-zinc-400">
              Operações aprovadas não podem ser modificadas. Informe a diferença líquida (positiva ou negativa) e o comprovante da corretora.
            </p>
            <input
              type="number"
              step="0.01"
              required
              value={adjDeltaUsd}
              onChange={(e) => setAdjDeltaUsd(e.target.value)}
              placeholder="Diferença em USD (ex: -120.50 ou +45.00)"
              className="w-full px-3 py-2 text-xs font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
            />
            <input
              type="text"
              required
              value={adjEvidence}
              onChange={(e) => setAdjEvidence(e.target.value)}
              placeholder="Comprovante do ajuste"
              className="w-full px-3 py-2 text-xs font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
            />
            <textarea
              rows={2}
              required
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              placeholder="Justificativa contábil"
              className="w-full px-3 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setAdjTarget(null)} className="flex-1 py-2 text-xs bg-[#181B26] rounded-lg text-zinc-300">
                Cancelar
              </button>
              <button type="submit" className="flex-1 py-2 text-xs font-semibold bg-[#E11D2E] text-white rounded-lg">
                Enviar Ajuste
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
