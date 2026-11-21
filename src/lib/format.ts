export function formatUsd(cents: number | null | undefined): string {
  const val = (cents || 0) / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

export function formatBrl(cents: number | null | undefined): string {
  const val = (cents || 0) / 100;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

export function formatPctFromBps(bps: number | null | undefined): string {
  return `${((bps || 0) / 100).toFixed(2)}%`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  paused: 'Pausado',
  closed: 'Encerrado',
  open: 'Captação Aberta',
  active_trading: 'Em Operação',
  settling: 'Em Liquidação',
  settled: 'Liquidado',
  halted: 'Bloqueado',
  pending: 'Pendente',
  confirming: 'Confirmando',
  confirmed: 'Confirmado',
  rejected: 'Recusado',
  requested: 'Solicitado',
  in_review: 'Em Análise',
  approved: 'Aprovado',
  processing: 'Processando',
  completed: 'Concluído',
  draft: 'Rascunho',
  submitted: 'Enviada',
  adjustment_requested: 'Ajuste Solicitado',
  pending_approval: 'Aguardando Aprovação',
  suspended: 'Suspenso',
  matured: 'Vencido',
  early_redeemed: 'Resgate Antecipado',
};
