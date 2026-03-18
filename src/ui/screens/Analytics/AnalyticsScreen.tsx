import { useMemo, useState } from 'react'

import { ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react'
import { AreaChart, Area, Tooltip, ResponsiveContainer, XAxis, Legend } from 'recharts'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { Transaction } from '@/core/types'
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
      (tx) => tx.createdAt >= cutoff && tx.status === 'completed'
    )

    // Previous period transactions (for comparison)
    const previousPeriod = transactions.filter(
      (tx) =>
        tx.createdAt >= previousCutoff &&
        tx.createdAt < cutoff &&
        tx.status === 'completed'
    )

    // Calculate totals
    const income = currentPeriod
      .filter((tx) => tx.direction === 'receive')
      .reduce((sum, tx) => sum + tx.amount, 0)

    const spending = currentPeriod
      .filter((tx) => tx.direction === 'send')
      .reduce((sum, tx) => sum + tx.amount, 0)

    const previousIncome = previousPeriod
      .filter((tx) => tx.direction === 'receive')
      .reduce((sum, tx) => sum + tx.amount, 0)

    const previousSpending = previousPeriod
      .filter((tx) => tx.direction === 'send')
      .reduce((sum, tx) => sum + tx.amount, 0)

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

  // Generate chart data
  const chartData = useMemo(() => {
    const now = new Date()
    const days = timeRange === 'week' ? 7 : 30

    const data: { name: string; income: number; spending: number }[] = []

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const dayStart = new Date(date.setHours(0, 0, 0, 0)).getTime()
      const dayEnd = new Date(date.setHours(23, 59, 59, 999)).getTime()

      const dayTxs = transactions.filter(
        (tx) =>
          tx.createdAt >= dayStart &&
          tx.createdAt <= dayEnd &&
          tx.status === 'completed'
      )

      const income = dayTxs
        .filter((tx) => tx.direction === 'receive')
        .reduce((sum, tx) => sum + tx.amount, 0)

      const spending = dayTxs
        .filter((tx) => tx.direction === 'send')
        .reduce((sum, tx) => sum + tx.amount, 0)

      data.push({
        name:
          timeRange === 'week'
            ? date.toLocaleDateString('en-US', { weekday: 'short' })
            : date.getDate().toString(),
        income,
        spending,
      })
    }

    return data
  }, [transactions, timeRange])

  // Spending breakdown by category
  const spendingBreakdown = useMemo(() => {
    const cutoff = timeRange === 'week' ? now - 7 * 24 * 60 * 60 * 1000 : now - 30 * 24 * 60 * 60 * 1000

    const spending = transactions.filter(
      (tx) =>
        tx.createdAt >= cutoff &&
        tx.direction === 'send' &&
        tx.status === 'completed'
    )

    // Group by transaction type
    const byMethod: Record<string, number> = {}
    spending.forEach((tx) => {
      const method = tx.type || 'ecash'
      byMethod[method] = (byMethod[method] || 0) + tx.amount
    })

    const categories = [
      { name: 'Lightning', key: 'lightning', color: '#264032' },
      { name: 'Ecash', key: 'ecash', color: '#5c6b5d' },
      { name: 'Other', key: 'other', color: '#8a9a8b' },
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
    <div className="h-dvh bg-background text-foreground flex flex-col font-sans relative overflow-hidden z-[60] pt-safe">
      {/* Header */}
      <header className="flex items-center px-3 pt-4 relative z-50">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 rounded-full bg-white/60 shadow-sm hover:shadow-md transition-all hover:bg-background-card backdrop-blur-md"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-base font-bold tracking-tight ml-3">{t('analytics.title')}</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-32">
        {/* Time Range Selector */}
        <div className="flex justify-center">
          <div className="bg-primary/10 p-1 rounded-full flex">
            <button
              onClick={() => setTimeRange('week')}
              className={cn(
                'px-3 py-2 rounded-full text-xs font-bold transition-all',
                timeRange === 'week'
                  ? 'bg-white shadow-sm text-foreground'
                  : 'text-foreground-muted hover:text-foreground'
              )}
            >
              {t('analytics.thisWeek')}
            </button>
            <button
              onClick={() => setTimeRange('month')}
              className={cn(
                'px-3 py-2 rounded-full text-xs font-bold transition-all',
                timeRange === 'month'
                  ? 'bg-white shadow-sm text-foreground'
                  : 'text-foreground-muted hover:text-foreground'
              )}
            >
              {t('analytics.thisMonth')}
            </button>
          </div>
        </div>

        {/* Total Spent / Received Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/60 p-3 rounded-2xl border border-white/50 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="bg-accent-primary/20 p-2 rounded-full">
                <TrendingDown className="w-3 h-3 text-accent-primary" />
              </div>
              <span className="text-[10px] font-bold text-foreground-muted">{t('analytics.totalReceived')}</span>
            </div>
            <h3 className="text-lg font-bold text-foreground">
              +{formatAmount(analytics.income)}
            </h3>
            {(() => { const f = formatFiat(analytics.income); return f ? (
              <span className="text-[10px] text-foreground-muted">{f}</span>
            ) : null })()}
            <span
              className={cn(
                'text-[8px] font-bold',
                analytics.incomeChange >= 0 ? 'text-accent-primary' : 'text-accent-danger'
              )}
            >
              {analytics.incomeChange >= 0 ? '+' : ''}
              {analytics.incomeChange}%
            </span>
          </div>
          <div className="bg-white/60 p-3 rounded-2xl border border-white/50 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="bg-accent-danger/20 p-2 rounded-full">
                <TrendingUp className="w-3 h-3 text-accent-danger" />
              </div>
              <span className="text-[10px] font-bold text-foreground-muted">{t('analytics.totalSent')}</span>
            </div>
            <h3 className="text-lg font-bold text-foreground">
              -{formatAmount(analytics.spending)}
            </h3>
            {(() => { const f = formatFiat(analytics.spending); return f ? (
              <span className="text-[10px] text-foreground-muted">{f}</span>
            ) : null })()}
            <span
              className={cn(
                'text-[8px] font-bold',
                analytics.spendingChange <= 0 ? 'text-accent-primary' : 'text-accent-danger'
              )}
            >
              {analytics.spendingChange >= 0 ? '+' : ''}
              {analytics.spendingChange}%
            </span>
          </div>
        </div>

        {/* Chart Section */}
        <section className="bg-white/60 p-4 rounded-2xl border border-white/50 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-sm text-foreground">{t('analytics.overview')}</h3>
            <span className="text-[10px] font-bold text-foreground-muted">
              {timeRange === 'week' ? t('analytics.thisWeek') : t('analytics.thisMonth')}
            </span>
          </div>

          {chartData.some((d) => d.income > 0 || d.spending > 0) ? (
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#5c8b65" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#5c8b65" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorSpending" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#264032" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#264032" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#5c6b5d', fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#e4e0d5',
                      borderRadius: '12px',
                      border: 'none',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    }}
                    itemStyle={{ color: '#264032', fontWeight: 'bold' }}
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
                      <span style={{ color: '#5c6b5d', fontSize: '10px', fontWeight: 'bold' }}>
                        {value === 'income' ? t('analytics.totalReceived') : t('analytics.totalSent')}
                      </span>
                    )}
                  />
                  <Area
                    type="monotone"
                    dataKey="income"
                    stroke="#5c8b65"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorIncome)"
                  />
                  <Area
                    type="monotone"
                    dataKey="spending"
                    stroke="#264032"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorSpending)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-foreground-muted">
              <p className="text-xs">{t('analytics.noData')}</p>
            </div>
          )}
        </section>

        {/* Spending Breakdown */}
        {spendingBreakdown.length > 0 && (
          <section>
            <h3 className="font-bold text-sm text-foreground mb-3 px-2">{t('analytics.totalSent')}</h3>
            <div className="space-y-2">
              {spendingBreakdown.map((item) => (
                <div
                  key={item.key}
                  className="bg-white/40 p-3 rounded-xl flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="font-bold text-xs text-foreground">
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
                    <span className="font-bold text-xs text-foreground min-w-[50px] text-right">
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
            <div className="w-12 h-12 bg-white/60 rounded-full flex items-center justify-center mb-3">
              <TrendingUp className="w-6 h-6 text-foreground-muted" />
            </div>
            <h3 className="font-bold text-sm text-foreground mb-2">{t('analytics.noData')}</h3>
            <p className="text-xs text-foreground-muted">
              {t('history.noTransactions')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default AnalyticsScreen
