import { useTranslation } from 'react-i18next'
import { ArrowLeft, Send, Download, Coins, Wallet, Gift, MessageSquare } from 'lucide-react'

interface TlsTestPageProps {
  onBack: () => void
  onNavigate: (page: 'tlsBolt11Send' | 'tlsBolt11Receive' | 'tlsEcashCreate' | 'tlsEcashRedeem' | 'tlsGiftWrap' | 'tlsCreq') => void
}

const items = [
  { id: 'tlsBolt11Send' as const, label: '1. Bolt11 보내기 (melt)', desc: 'TLS bolt11 send via melt', Icon: Send },
  { id: 'tlsBolt11Receive' as const, label: '2. Bolt11 받기 (minting)', desc: 'TLS bolt11 receive via mint quote', Icon: Download },
  { id: 'tlsEcashCreate' as const, label: '3. 이캐시 생성', desc: 'Create ecash token', Icon: Coins },
  { id: 'tlsEcashRedeem' as const, label: '4. 이캐시 등록', desc: 'Redeem ecash token', Icon: Wallet },
  { id: 'tlsGiftWrap' as const, label: '5. GiftWrap 에서 받기', desc: 'Receive via npub (giftwrap)', Icon: Gift },
  { id: 'tlsCreq' as const, label: '6. creq로 받기', desc: 'Receive via creq', Icon: MessageSquare },
]

export function TlsTestPage({ onBack, onNavigate }: TlsTestPageProps) {
  const { t } = useTranslation()
  void t

  return (
    <div className="h-full bg-background text-foreground flex flex-col overflow-hidden">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0 z-50">
        <button
          onClick={onBack}
          className="w-10 h-10 flex items-center justify-center rounded-full active:bg-foreground/5"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={1.8} />
        </button>
        <h1 className="absolute left-0 right-0 text-center text-headline font-semibold pointer-events-none">
          TLS Test Menu
        </h1>
        <div className="w-10" />
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        <div className="flex flex-col gap-2.5 pt-4">
          {items.map(({ id, label, desc, Icon }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className="w-full bg-background-card rounded-card px-4 py-4 flex items-center gap-3.5 active:scale-[0.98] active:opacity-80 transition-all text-left"
            >
              <Icon className="w-[22px] h-[22px] text-foreground-muted shrink-0" strokeWidth={1.8} />
              <div className="flex-1 min-w-0">
                <p className="text-body font-semibold text-foreground">{label}</p>
                <p className="text-caption text-foreground-muted mt-0.5 truncate">{desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
