import type { Transaction } from '@/core/domain/transaction'
import { getTypeLabel } from '@/ui/components/wallet/transactionHelpers'
import { getTxMeta } from '@/core/domain/transaction'
import { toNumber } from '@/core/domain/amount'
import { formatSats } from '@/utils/format'
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
  const amount = toNumber(tx.amount)
  const signedAmount = tx.direction === 'send' ? -amount : amount
  const mintName = ctx.getMintName ? ctx.getMintName(tx.accountId) : tx.accountId
  const meta = getTxMeta(tx)
  const snap = tx.displaySnapshot

  return [
    ctx.dateFmt.format(date),
    ctx.timeFmt.format(date),
    direction,
    getTypeLabel(tx, ctx.t),
    String(signedAmount),
    `${tx.direction === 'send' ? '-' : '+'}${formatSats(amount)}`,
    tx.memo || '',
    mintName,
    ctx.statusMap[tx.status] || tx.status,
    meta.source || '',
    snap
      ? (tx.direction === 'send' ? -snap.amount : snap.amount).toFixed(2)
      : '',
    snap?.currency || '',
  ]
}

export function exportTransactionsCsv({ transactions, getMintName }: ExportOptions): void {
  const t = i18n.t.bind(i18n)
  const ctx: RowContext = {
    dateFmt: new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    timeFmt: new Intl.DateTimeFormat('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    statusMap: {
      settled: t('history.completed'),
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
