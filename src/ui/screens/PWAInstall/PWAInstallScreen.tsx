import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/common'

export interface PWAInstallScreenProps {
  onBypass?: () => void // For development/testing only
}

type Platform = 'ios' | 'android' | 'desktop'

function detectPlatform(): Platform {
  const userAgent = navigator.userAgent.toLowerCase()

  if (/iphone|ipad|ipod/.test(userAgent)) {
    return 'ios'
  }
  if (/android/.test(userAgent)) {
    return 'android'
  }
  return 'desktop'
}

// Icons
const ShareIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" y1="2" x2="12" y2="15" />
  </svg>
)

const PlusSquareIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="12" y1="8" x2="12" y2="16" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </svg>
)

const MenuIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="19" r="1" />
  </svg>
)

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

export function PWAInstallScreen({ onBypass }: PWAInstallScreenProps) {
  const { t } = useTranslation()
  const [platform] = useState<Platform>(() => detectPlatform())
  const [showInstructions, setShowInstructions] = useState(false)

  const renderIOSInstructions = () => (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-background-card rounded-lg">
        <div className="w-8 h-8 bg-accent-primary/20 rounded-lg flex items-center justify-center flex-shrink-0">
          <span className="text-subtitle">1</span>
        </div>
        <div>
          <p className="font-medium mb-1">{t('pwa.iosShareButton')}</p>
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShareIcon />
            <span className="text-label">{t('pwa.iosFindIcon')}</span>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 p-3 bg-background-card rounded-lg">
        <div className="w-8 h-8 bg-accent-primary/20 rounded-lg flex items-center justify-center flex-shrink-0">
          <span className="text-subtitle">2</span>
        </div>
        <div>
          <p className="font-medium mb-1">{t('pwa.iosAddToHome')}</p>
          <div className="flex items-center gap-2 text-muted-foreground">
            <PlusSquareIcon />
            <span className="text-label">{t('pwa.iosScrollFind')}</span>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 p-3 bg-background-card rounded-lg">
        <div className="w-8 h-8 bg-accent-primary/20 rounded-lg flex items-center justify-center flex-shrink-0">
          <span className="text-subtitle">3</span>
        </div>
        <div>
          <p className="font-medium">{t('pwa.iosAddComplete')}</p>
        </div>
      </div>
    </div>
  )

  const renderAndroidInstructions = () => (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-background-card rounded-lg">
        <div className="w-8 h-8 bg-accent-primary/20 rounded-lg flex items-center justify-center flex-shrink-0">
          <span className="text-subtitle">1</span>
        </div>
        <div>
          <p className="font-medium mb-1">{t('pwa.androidOpenMenu')}</p>
          <div className="flex items-center gap-2 text-muted-foreground">
            <MenuIcon />
            <span className="text-label">{t('pwa.androidMenuIcon')}</span>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 p-3 bg-background-card rounded-lg">
        <div className="w-8 h-8 bg-accent-primary/20 rounded-lg flex items-center justify-center flex-shrink-0">
          <span className="text-subtitle">2</span>
        </div>
        <div>
          <p className="font-medium mb-1">{t('pwa.androidInstallApp')}</p>
          <div className="flex items-center gap-2 text-muted-foreground">
            <DownloadIcon />
            <span className="text-label">{t('pwa.androidFindInMenu')}</span>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 p-3 bg-background-card rounded-lg">
        <div className="w-8 h-8 bg-accent-primary/20 rounded-lg flex items-center justify-center flex-shrink-0">
          <span className="text-subtitle">3</span>
        </div>
        <div>
          <p className="font-medium">{t('pwa.androidTapInstall')}</p>
        </div>
      </div>
    </div>
  )

  const renderDesktopInstructions = () => (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-background-card rounded-lg">
        <div className="w-8 h-8 bg-accent-primary/20 rounded-lg flex items-center justify-center flex-shrink-0">
          <span className="text-subtitle">1</span>
        </div>
        <div>
          <p className="font-medium mb-1">{t('pwa.desktopClickIcon')}</p>
          <div className="flex items-center gap-2 text-muted-foreground">
            <DownloadIcon />
            <span className="text-label">{t('pwa.desktopOrMenu')}</span>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 p-3 bg-background-card rounded-lg">
        <div className="w-8 h-8 bg-accent-primary/20 rounded-lg flex items-center justify-center flex-shrink-0">
          <span className="text-subtitle">2</span>
        </div>
        <div>
          <p className="font-medium">{t('pwa.desktopClickInstall')}</p>
        </div>
      </div>

      <p className="text-label text-muted-foreground text-center">
        {t('pwa.desktopBrowserSupport')}
      </p>
    </div>
  )

  return (
    <div className="flex flex-col min-h-dvh bg-background p-4 pt-safe pb-safe">
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        {/* Logo */}
        <h1 className="text-title text-brand mb-3">ZAPPI</h1>
        <p className="text-muted-foreground mb-6">{t('pwa.tagline')}</p>

        {/* Install Message */}
        <div className="w-full max-w-sm">
          <div className="p-4 bg-background-card rounded-xl mb-4">
            <div className="w-14 h-14 bg-accent-primary/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <DownloadIcon />
            </div>
            <h2 className="text-subtitle font-semibold mb-2">{t('pwa.installRequired')}</h2>
            <p className="text-muted-foreground text-label whitespace-pre-line">
              {t('pwa.installRequiredDesc')}
            </p>
          </div>

          {!showInstructions ? (
            <Button
              variant="primary"
              size="xl"
              onClick={() => setShowInstructions(true)}
              className="w-full"
            >
              {t('pwa.showInstallInstructions')}
            </Button>
          ) : (
            <div className="space-y-4">
              {/* Platform-specific instructions */}
              <div className="text-left">
                <h3 className="text-body font-semibold mb-3 text-center">
                  {platform === 'ios' && 'iOS (Safari)'}
                  {platform === 'android' && 'Android (Chrome)'}
                  {platform === 'desktop' && t('pwa.desktopBrowser')}
                </h3>

                {platform === 'ios' && renderIOSInstructions()}
                {platform === 'android' && renderAndroidInstructions()}
                {platform === 'desktop' && renderDesktopInstructions()}
              </div>

              <p className="text-label text-muted-foreground">
                {t('pwa.afterInstall')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Development bypass (only in dev mode) */}
      {import.meta.env.DEV && onBypass && (
        <div className="mt-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBypass}
            className="w-full text-muted-foreground"
          >
            {t('pwa.devBypass')}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Check if app is running as installed PWA
 */
// eslint-disable-next-line react-refresh/only-export-components
export function isPWAInstalled(): boolean {
  // Check display-mode: standalone
  if (window.matchMedia('(display-mode: standalone)').matches) {
    return true
  }

  // Check iOS standalone mode
  if ((navigator as { standalone?: boolean }).standalone === true) {
    return true
  }

  // Check if running in TWA (Trusted Web Activity) on Android
  if (document.referrer.includes('android-app://')) {
    return true
  }

  return false
}
