import { useMemo, useState } from 'react'

import { ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react'
import { AreaChart, Area, Tooltip, ResponsiveContainer, XAxis, Legend } from 'recharts'
import { useTranslation } from 'react-i18next'
import { cn } from '@/ui/lib/utils'
import type { Transaction } from '@/core/domain/transaction'
import { getTransactionType } from '@/core/domain/transaction'
import { toNumber } from '@/core/domain/amount'
import { SegmentControl } from '@/ui/components/common/SegmentControl'
import { useFormatSats, useFormatFiat } from '@/utils/format'

export interface AnalyticsScreenProps {
  onBack: () => void
  transactions: Transaction[]
}

type TimeRange = 'week' | 'month'

export function AnalyticsScreen({ onBack, transactions }: AnalyticsScreenProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const [timeRange, setTimeRange] = useState<TimeRange>('week')
  const [now] = useState(() => Date.now())

  // Compute analytics from transactions
  const analytics = useMemo(() => {
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000
    const twoMonthsAgo = now - 60 * 24 * 60 * 60 * 1000

    const cutoff = timeRange === 'week' ? weekAgo : monthAgo
    const previousCutoff = timeRange === 'week' ? twoWeeksAgo : twoMonthsAgo

    // Current period transactions
    const currentPeriod = transactions.filter(
      (tx) => tx.createdAt >= cutoff && tx.status === 'settled'
    )

    // Previous period transactions (for comparison)
    const previousPeriod = transactions.filter(
      (tx) =>
        tx.createdAt >= previousCutoff &&
        tx.createdAt < cutoff &&
        tx.status === 'settled'
    )

    // Calculate totals
    const income = currentPeriod
      .filter((tx) => tx.direction === 'receive')
      .reduce((sum, tx) => sum + toNumber(tx.amount), 0)

    const spending = currentPeriod
      .filter((tx) => tx.direction === 'send')
      .reduce((sum, tx) => sum + toNumber(tx.amount), 0)

    const previousIncome = previousPeriod
      .filter((tx) => tx.direction === 'receive')
      .reduce((sum, tx) => sum + toNumber(tx.amount), 0)

    const previousSpending = previousPeriod
      .filter((tx) => tx.direction === 'send')
      .reduce((sum, tx) => sum + toNumber(tx.amount), 0)

    // Calculate percentage changes
    const incomeChange =
      previousIncome > 0
        ? Math.round(((income - previousIncome) / previousIncome) * 100)
        : income > 0
        ? 100
        : 0

    const spendingChange =
      previousSpending > 0
        ? Math.round(((spending - previousSpending) / previousSpending) * 100)
        : spending > 0
        ? 100
        : 0

    return {
      income,
      spending,
      incomeChange,
      spendingChange,
    }
  }, [transactions, timeRange, now])

  // Generate chart data — single-pass O(n) bucketing
  const chartData = useMemo(() => {
    const today = new Date()
    const days = timeRange === 'week' ? 7 : 30

    // Build day buckets keyed by dayStart timestamp
    const buckets = new Map<number, { income: number; spending: number }>()
    const dayMeta: { dayStart: number; label: string }[] = []

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      date.setHours(0, 0, 0, 0)
      const dayStart = date.getTime()
      buckets.set(dayStart, { income: 0, spending: 0 })
      dayMeta.push({
        dayStart,
        label: timeRange === 'week'
          ? date.toLocaleDateString('en-US', { weekday: 'short' })
          : date.getDate().toString(),
      })
    }

    const cutoffStart = dayMeta[0]?.dayStart ?? 0
    const cutoffEnd = (dayMeta[dayMeta.length - 1]?.dayStart ?? 0) + 86_400_000 - 1

    // Single pass over transactions
    for (const tx of transactions) {
      if (tx.status !== 'settled') continue
      if (tx.createdAt < cutoffStart || tx.createdAt > cutoffEnd) continue

      // Floor to start-of-day to find bucket key
      const d = new Date(tx.createdAt)
      d.setHours(0, 0, 0, 0)
      const bucket = buckets.get(d.getTime())
      if (!bucket) continue

      const amount = toNumber(tx.amount)
      if (tx.direction === 'receive') bucket.income += amount
      else if (tx.direction === 'send') bucket.spending += amount
    }

    return dayMeta.map(({ dayStart, label }) => ({
      name: label,
      ...buckets.get(dayStart)!,
    }))
  }, [transactions, timeRange])

  // Spending breakdown by category
  const spendingBreakdown = useMemo(() => {
    const cutoff = timeRange === 'week' ? now - 7 * 24 * 60 * 60 * 1000 : now - 30 * 24 * 60 * 60 * 1000

    const spending = transactions.filter(
      (tx) =>
        tx.createdAt >= cutoff &&
        tx.direction === 'send' &&
        tx.status === 'settled'
    )

    // Group by transaction type
    const byMethod: Record<string, number> = {}
    spending.forEach((tx) => {
      const txType = getTransactionType(tx)
      const method = txType === 'ecash-token' ? 'ecash' : (txType || 'ecash')
      byMethod[method] = (byMethod[method] || 0) + toNumber(tx.amount)
    })

    const categories = [
      { name: 'Lightning', key: 'lightning', color: 'var(--chart-1)' },
      { name: 'Ecash', key: 'ecash', color: 'var(--chart-2)' },
      { name: 'Other', key: 'other', color: 'var(--chart-3)' },
    ]

    const total = Object.values(byMethod).reduce((sum, val) => sum + val, 0)

    return categories
      .map((cat) => ({
        ...cat,
        value: byMethod[cat.key] || 0,
        percentage: total > 0 ? ((byMethod[cat.key] || 0) / total) * 100 : 0,
      }))
      .filter((cat) => cat.value > 0)
  }, [transactions, timeRange, now])

  const formatAmount = (amount: number) => {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(0)}k`
    }
    return amount.toLocaleString()
  }

  return (
    <div className="h-full bg-background text-foreground flex flex-col font-primary relative overflow-hidden z-[60] pt-safe">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0 z-50">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h2 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold pointer-events-none">{t('analytics.title')}</h2>
        <div className="w-10" />
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-app">
        {/* Time Range Selector */}
        <SegmentControl
          value={timeRange}
          onChange={setTimeRange}
          options={[
            { value: 'week', label: t('analytics.thisWeek') },
            { value: 'month', label: t('analytics.thisMonth') },
          ]}
        />

        {/* Total Spent / Received Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-background-card p-4 rounded-2xl ">
            <div className="flex items-center gap-2 mb-2">
              <div className="bg-accent-primary/20 p-2 rounded-full">
                <TrendingDown className="w-3 h-3 text-accent-primary" />
              </div>
              <span className="text-label font-semibold text-foreground-muted">{t('analytics.totalReceived')}</span>
            </div>
            <h3 className="text-subtitle font-semibold font-display text-foreground">
              +{formatAmount(analytics.income)}
            </h3>
            {(() => { const f = formatFiat(analytics.income); return f ? (
              <span className="text-overline font-medium text-foreground-muted">{f}</span>
            ) : null })()}
            <span
              className={cn(
                'text-overline font-bold',
                analytics.incomeChange >= 0 ? 'text-accent-primary' : 'text-accent-danger'
              )}
            >
              {analytics.incomeChange >= 0 ? '+' : ''}
              {analytics.incomeChange}%
            </span>
          </div>
          <div className="bg-background-card p-4 rounded-2xl ">
            <div className="flex items-center gap-2 mb-2">
              <div className="bg-accent-danger/20 p-2 rounded-full">
                <TrendingUp className="w-3 h-3 text-accent-danger" />
              </div>
              <span className="text-label font-semibold text-foreground-muted">{t('analytics.totalSent')}</span>
            </div>
            <h3 className="text-subtitle font-semibold font-display text-foreground">
              -{formatAmount(analytics.spending)}
            </h3>
            {(() => { const f = formatFiat(analytics.spending); return f ? (
              <span className="text-overline font-medium text-foreground-muted">{f}</span>
            ) : null })()}
            <span
              className={cn(
                'text-overline font-bold',
                analytics.spendingChange <= 0 ? 'text-accent-primary' : 'text-accent-danger'
              )}
            >
              {analytics.spendingChange >= 0 ? '+' : ''}
              {analytics.spendingChange}%
            </span>
          </div>
        </div>

        {/* Chart Section */}
        <section className="bg-background-card p-4 rounded-2xl ">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-caption font-medium uppercase tracking-wide text-foreground-muted">{t('analytics.overview')}</h3>
            <span className="text-label font-semibold text-foreground-muted">
              {timeRange === 'week' ? t('analytics.thisWeek') : t('analytics.thisMonth')}
            </span>
          </div>

          {chartData.some((d) => d.income > 0 || d.spending > 0) ? (
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorSpending" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--foreground-muted)', fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--background)',
                      borderRadius: '12px',
                      border: '1px solid var(--border)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    }}
                    itemStyle={{ color: 'var(--foreground)', fontWeight: 'bold' }}
                    formatter={(value, name) => {
                      const numValue = typeof value === 'number' ? value : 0
                      return [
                        `${formatSats(numValue)}`,
                        name === 'income' ? t('analytics.totalReceived') : t('analytics.totalSent'),
                      ]
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ paddingBottom: '10px' }}
                    formatter={(value) => (
                      <span style={{ color: 'var(--foreground-muted)', fontSize: '10px', fontWeight: 'bold' }}>
                        {value === 'income' ? t('analytics.totalReceived') : t('analytics.totalSent')}
                      </span>
                    )}
                  />
                  <Area
                    type="monotone"
                    dataKey="income"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorIncome)"
                  />
                  <Area
                    type="monotone"
                    dataKey="spending"
                    stroke="var(--chart-2)"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorSpending)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-foreground-muted">
              <p className="text-label font-medium">{t('analytics.noData')}</p>
            </div>
          )}
        </section>

        {/* Spending Breakdown */}
        {spendingBreakdown.length > 0 && (
          <section>
            <h3 className="text-caption font-medium uppercase tracking-wide text-foreground-muted mb-3 px-2">{t('analytics.totalSent')}</h3>
            <div className="space-y-2">
              {spendingBreakdown.map((item) => (
                <div
                  key={item.key}
                  className="bg-background-card p-3 rounded-xl flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-label font-medium text-foreground">
                      {item.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-20 h-1.5 bg-primary/10 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${item.percentage}%`,
                          backgroundColor: item.color,
                        }}
                      />
                    </div>
                    <span className="text-caption font-display text-foreground min-w-[50px] text-right">
                      {formatAmount(item.value)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Empty State */}
        {transactions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="w-12 h-12 bg-background-card rounded-full flex items-center justify-center mb-3">
              <TrendingUp className="w-6 h-6 text-foreground-muted" />
            </div>
            <h3 className="text-caption font-medium uppercase tracking-wide text-foreground-muted mb-2">{t('analytics.noData')}</h3>
            <p className="text-label font-medium text-foreground-muted">
              {t('history.noTransactions')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default AnalyticsScreen
