import { useState, useEffect } from 'react'
import zappiImg from '@/assets/zappi.png'

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
    <div className="h-dvh bg-background flex flex-col pt-safe pb-safe max-w-md mx-auto">
      {/* Center content */}
      <div className="flex-1 flex flex-col items-center justify-center px-5">
        {/* Mascot */}
        <img
          src={zappiImg}
          alt="Zappi"
          className="w-40 h-40 object-contain mb-4"
        />

        {/* Title */}
        <h1 className="text-title font-bold text-brand mb-1">ZAPPI</h1>
        <p className="text-caption text-foreground-muted mb-8">Bitcoin eCash Wallet</p>

        {/* Install card */}
        <div className="w-full bg-background-card rounded-2xl p-5">
          <p className="text-body font-semibold text-foreground text-center mb-1">
            Install to Home Screen
          </p>
          <p className="text-label font-medium text-foreground-muted text-center mb-5">
            App installation is required for secure payments
          </p>

          {/* Native install button */}
          {deferredPrompt && (
            <button
              onClick={handleInstall}
              className="w-full py-3.5 mb-4 bg-brand text-white font-semibold rounded-[14px] shadow-lg shadow-brand/25 active:scale-[0.98] transition-all"
            >
              Install App
            </button>
          )}

          {/* Platform-specific steps */}
          {steps && (
            <div>
              <p className="text-label font-medium text-foreground-muted mb-3">{steps.title}</p>
              <ol className="space-y-3">
                {steps.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-brand text-white text-label font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-caption text-foreground leading-relaxed">{item}</span>
                  </li>
                ))}
              </ol>
              {steps.footnote && (
                <p className="text-overline font-medium text-foreground-muted mt-3">{steps.footnote}</p>
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
            className="w-full text-label font-medium text-foreground-muted hover:text-foreground underline underline-offset-2 transition-colors"
          >
            Skip install (dev only)
          </button>
        </div>
      )}
    </div>
  )
}

/* --- Install Steps by Platform --- */

interface InstallSteps {
  title: string
  items: string[]
  footnote?: string
}

function getInstallSteps(platform: 'ios' | 'android' | 'desktop', hasNativePrompt: boolean): InstallSteps | null {
  if (hasNativePrompt) return null

  if (platform === 'ios') {
    return {
      title: 'In Safari',
      items: [
        'Tap the Share button at the bottom',
        'Select "Add to Home Screen"',
        'Tap "Add" in the top right',
      ],
    }
  }

  if (platform === 'android') {
    return {
      title: 'In Chrome',
      items: [
        'Tap the menu icon in the top right',
        'Select "Install app" or "Add to Home screen"',
      ],
    }
  }

  const browser = getDesktopBrowser()

  if (browser === 'safari') {
    return {
      title: 'In Safari',
      items: [
        'Go to Menu Bar > "File"',
        'Select "Add to Dock..."',
      ],
      footnote: 'Or Share > Add to Dock (Sonoma+)',
    }
  }

  if (browser === 'edge') {
    return {
      title: 'In Edge',
      items: [
        'Click the ... menu in the top right',
        '"Apps" > "Install this site as an app"',
      ],
    }
  }

  return {
    title: 'In Chrome',
    items: [
      'Click the menu icon in the top right',
      '"Save and share" > "Install page as app"',
    ],
    footnote: 'Or click the install icon in the address bar',
  }
}
