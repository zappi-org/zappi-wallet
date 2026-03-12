import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Detect if running as installed PWA
function isPWA(): boolean {
  const urlParams = new URLSearchParams(window.location.search)
  if (urlParams.get('mode') === 'standalone') return true
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true
  if (window.matchMedia('(display-mode: minimal-ui)').matches) return true
  if ('standalone' in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true) return true
  if (document.referrer.includes('android-app://')) return true
  return false
}

function getPlatform(): 'ios' | 'android' | 'desktop' {
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad|ipod/.test(ua)) return 'ios'
  if (/android/.test(ua)) return 'android'
  return 'desktop'
}

function getDesktopBrowser(): 'safari' | 'edge' | 'chrome' {
  const ua = navigator.userAgent
  if (/^((?!chrome|android).)*safari/i.test(ua) && /mac/i.test(ua)) return 'safari'
  if (/edg/i.test(ua)) return 'edge'
  return 'chrome'
}

interface PWAInstallGuardProps {
  children: React.ReactNode
}

export function PWAInstallGuard({ children }: PWAInstallGuardProps) {
  const [isInstalled, setIsInstalled] = useState(() => isPWA())
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [platform] = useState(() => getPlatform())

  useEffect(() => {
    const mediaQuery = window.matchMedia('(display-mode: standalone)')
    const handleChange = (e: MediaQueryListEvent) => {
      if (e.matches) setIsInstalled(true)
    }
    mediaQuery.addEventListener('change', handleChange)

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    }
  }, [])

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice.outcome === 'accepted') setDeferredPrompt(null)
    }
  }

  if (isInstalled) return <>{children}</>

  const steps = getInstallSteps(platform, deferredPrompt !== null)

  return (
    <div className="h-dvh bg-[#faf9f6] flex flex-col pt-safe pb-safe max-w-md mx-auto">
      {/* Center content */}
      <div className="flex-1 flex flex-col items-center justify-center px-5">
        {/* Mascot */}
        <img
          src="/zappi.png"
          alt="Zappi"
          className="w-40 h-40 object-contain mb-4"
        />

        {/* Title */}
        <h1 className="font-['Outfit'] font-bold text-3xl text-[#3b7df5] mb-1">ZAPPI</h1>
        <p className="text-[#86868b] text-sm mb-8">Bitcoin eCash Wallet</p>

        {/* Install card */}
        <div className="w-full bg-white/80 backdrop-blur-sm rounded-2xl p-5 shadow-sm">
          <p className="text-[15px] font-semibold text-[#1d1d1f] text-center mb-1">
            홈 화면에 설치해주세요
          </p>
          <p className="text-[12px] text-[#86868b] text-center mb-5">
            안전한 결제를 위해 앱 설치가 필요합니다
          </p>

          {/* Native install button */}
          {deferredPrompt && (
            <button
              onClick={handleInstall}
              className="w-full py-3.5 mb-4 bg-[#3b7df5] text-white font-semibold rounded-[14px] shadow-lg shadow-[#3b7df5]/25 active:scale-[0.98] transition-all"
            >
              앱 설치하기
            </button>
          )}

          {/* Platform-specific steps */}
          {steps && (
            <div>
              <p className="text-[12px] font-semibold text-[#86868b] mb-3">{steps.title}</p>
              <ol className="space-y-3">
                {steps.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-[#3b7df5] text-white text-xs font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-[13px] text-[#1d1d1f] leading-relaxed">{item}</span>
                  </li>
                ))}
              </ol>
              {steps.footnote && (
                <p className="text-[11px] text-[#86868b] mt-3">{steps.footnote}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Dev bypass */}
      {(import.meta.env.DEV || window.location.search.includes('bypass=true')) && (
        <div className="shrink-0 px-5 pb-5">
          <button
            onClick={() => setIsInstalled(true)}
            className="w-full text-xs text-[#86868b] hover:text-[#1d1d1f] underline underline-offset-2 transition-colors"
          >
            설치 없이 진입 (테스트용)
          </button>
        </div>
      )}
    </div>
  )
}

/* ─── Install Steps by Platform ─── */

interface InstallSteps {
  title: string
  items: string[]
  footnote?: string
}

function getInstallSteps(platform: 'ios' | 'android' | 'desktop', hasNativePrompt: boolean): InstallSteps | null {
  if (hasNativePrompt) return null

  if (platform === 'ios') {
    return {
      title: 'Safari에서',
      items: [
        '하단 공유(↑) 버튼 탭',
        '"홈 화면에 추가" 선택',
        '우측 상단 "추가" 탭',
      ],
    }
  }

  if (platform === 'android') {
    return {
      title: 'Chrome에서',
      items: [
        '우측 상단 ⋮ 메뉴 탭',
        '"앱 설치" 또는 "홈 화면에 추가" 선택',
      ],
    }
  }

  const browser = getDesktopBrowser()

  if (browser === 'safari') {
    return {
      title: 'Safari에서',
      items: [
        '메뉴바 → "파일" 클릭',
        '"Dock에 추가..." 선택',
      ],
      footnote: '또는 공유 → Dock에 추가 (Sonoma+)',
    }
  }

  if (browser === 'edge') {
    return {
      title: 'Edge에서',
      items: [
        '우측 상단 ··· 메뉴 클릭',
        '"앱" → "이 사이트를 앱으로 설치"',
      ],
    }
  }

  return {
    title: 'Chrome에서',
    items: [
      '우측 상단 ⋮ 메뉴 클릭',
      '"저장 및 공유" → "페이지를 앱으로 설치"',
    ],
    footnote: '또는 주소창 오른쪽 설치 아이콘 클릭',
  }
}
