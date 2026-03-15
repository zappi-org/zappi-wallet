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

    // Filter by search query
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.symbol.toLowerCase().includes(q),
      )
    }

    // Pin selected currency to top
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
      <div className="px-3 pt-1 pb-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('common.search')}
          className="w-full px-3 py-2 rounded-xl bg-background border border-white/50 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <div className="px-3 pb-3 h-[50vh] overflow-y-auto space-y-1">
        {sorted.map((currency) => (
          <button
            key={currency.code}
            onClick={() => onSelect(currency.code)}
            className={cn(
              'w-full p-3 rounded-xl border flex items-center justify-between transition-all',
              currentCurrency === currency.code
                ? 'bg-primary border-primary text-white'
                : 'bg-white/60 border-white/50 text-foreground hover:bg-white/80',
            )}
          >
            <div className="flex items-center gap-3">
              <span className="text-lg w-6 text-center">{currency.flag}</span>
              <span className="font-bold text-sm">{currency.code}</span>
              <span className="text-[10px] opacity-70">{currency.name}</span>
            </div>
            {currentCurrency === currency.code && <Check className="w-4 h-4" />}
          </button>
        ))}
      </div>
    </BottomSheet>
  )
}
