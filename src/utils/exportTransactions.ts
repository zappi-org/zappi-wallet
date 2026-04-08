import type { Transaction } from '@/core/types'
import { formatSats } from '@/utils/format'
function getTypeLabel(tx: Transaction, t: (key: string) => string): string {
  if (tx.type === 'swap') return t('history.swap')
  if (tx.type === 'lightning') return tx.direction === 'receive' ? t('history.lightningReceive') : t('history.lightningSend')
  if (tx.type === 'ecash-token') {
    if (tx.metadata?.reclaimedFrom) return t('history.ecashReclaim')
    return tx.direction === 'receive' ? t('history.ecashReceive') : t('history.ecashToken')
  }
  if (tx.type === 'nutzap') return t('history.nutzap')
  return tx.direction === 'receive' ? t('history.ecashReceive') : t('history.ecashSend')
}
import i18n from '@/i18n'

export interface ExportOptions {
  transactions: Transaction[]
  getMintName?: (url: string) => string
}

const HEADERS = [
  'Date', 'Time', 'Direction', 'Type', 'Amount (sats)', 'Amount',
  'Memo', 'Mint', 'Status', 'Source', 'Fiat Amount', 'Fiat Currency',
] as const

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

interface RowContext {
  dateFmt: Intl.DateTimeFormat
  timeFmt: Intl.DateTimeFormat
  statusMap: Record<string, string>
  t: typeof i18n.t
  getMintName?: (url: string) => string
}

function formatRow(tx: Transaction, ctx: RowContext): string[] {
  const date = new Date(tx.createdAt)
  const direction = tx.direction === 'receive' ? ctx.t('history.income') : ctx.t('history.expense')
  const signedAmount = tx.direction === 'send' ? -tx.amount : tx.amount
  const mintName = ctx.getMintName ? ctx.getMintName(tx.mintUrl) : tx.mintUrl

  return [
    ctx.dateFmt.format(date),
    ctx.timeFmt.format(date),
    direction,
    getTypeLabel(tx, ctx.t),
    String(signedAmount),
    `${tx.direction === 'send' ? '-' : '+'}${formatSats(tx.amount)}`,
    tx.memo || '',
    mintName,
    ctx.statusMap[tx.status] || tx.status,
    tx.source || '',
    tx.fiatAmount != null
      ? (tx.direction === 'send' ? -tx.fiatAmount : tx.fiatAmount).toFixed(2)
      : '',
    tx.fiatCurrency || '',
  ]
}

export function exportTransactionsCsv({ transactions, getMintName }: ExportOptions): void {
  const t = i18n.t.bind(i18n)
  const ctx: RowContext = {
    dateFmt: new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    timeFmt: new Intl.DateTimeFormat('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    statusMap: {
      completed: t('history.completed'),
      pending: t('history.pendingStatus'),
      failed: t('history.failedStatus'),
    },
    t,
    getMintName,
  }

  const rows = transactions.map((tx) =>
    formatRow(tx, ctx).map(escapeCsvField).join(',')
  )
  const csv = '\uFEFF' + [HEADERS.map(escapeCsvField).join(','), ...rows].join('\n')

  const date = ctx.dateFmt.format(new Date())
  const baseName = t('history.exportFileName')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${baseName}_${date}.csv`
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
