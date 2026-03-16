import { useState, useMemo } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '@/ui/components/common'
import { FIAT_CURRENCIES } from '@/core/constants/fiat'
import { cn } from '@/components/ui/utils'

interface CurrencyPickerBottomSheetProps {
  isOpen: boolean
  onClose: () => void
  currentCurrency: string
  onSelect: (code: string) => void
}

export function CurrencyPickerBottomSheet({
  isOpen,
  onClose,
  currentCurrency,
  onSelect,
}: CurrencyPickerBottomSheetProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  const sorted = useMemo(() => {
    let list = FIAT_CURRENCIES

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.symbol.toLowerCase().includes(q),
      )
    }

    return [...list].sort((a, b) => {
      if (a.code === currentCurrency) return -1
      if (b.code === currentCurrency) return 1
      return a.name.localeCompare(b.name)
    })
  }, [search, currentCurrency])

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t('settings.selectCurrency')}
    >
      <div className="px-4 pt-1 pb-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('common.search')}
          className="w-full px-3 py-2.5 rounded-sm bg-background border border-border text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <div className="px-4 pb-3 h-[50vh] overflow-y-auto">
        <div className="divide-y divide-border">
          {sorted.map((currency) => (
            <button
              key={currency.code}
              onClick={() => onSelect(currency.code)}
              className={cn(
                'w-full px-3 py-3 flex items-center justify-between text-left',
                currentCurrency === currency.code
                  ? 'bg-primary/[0.04]'
                  : 'active:bg-background-hover',
              )}
            >
              <div className="flex items-center gap-3">
                <span className="text-base w-6 text-center">{currency.flag}</span>
                <div>
                  <span className="text-[13px] font-medium">{currency.code}</span>
                  <span className="text-[11px] text-foreground-muted ml-2">{currency.name}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-foreground-muted">{currency.symbol}</span>
                {currentCurrency === currency.code && (
                  <Check className="w-4 h-4 text-accent-primary" />
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </BottomSheet>
  )
}
