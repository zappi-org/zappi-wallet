import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { useAppStore } from '@/store'
import i18n from '@/i18n'
import { generateMintAliases } from '@/utils/mint-name'

// Lightweight imports only — no heavy services, hooks, or screens.
// Adapter/module wiring belongs to composition/onboarding.ts
import { createOnboardingServices, createOnboardingProfileService } from '@/composition/onboarding'
import { OnboardingScreen } from '@/ui/screens/Onboarding/OnboardingScreen'

// Lazy-load the main app (heavy: all services, hooks, screens)
const MainApp = lazy(() => import('./MainApp'))

function App() {
  // Store actions (lightweight — no heavy hooks)
  const setNostrKeyPair = useAppStore((state) => state.setNostrKeyPair)
  const setP2pkPubkey = useAppStore((state) => state.setP2pkPubkey)
  const setSettings = useAppStore((state) => state.setSettings)

  // Local state
  const [isOnboarded, setIsOnboarded] = useState<boolean | null>(null)

  // Services (lightweight only)
  const [services] = useState(() => createOnboardingServices())

  // Check if wallet exists (determines onboarding vs main app)
  useEffect(() => {
    const check = async () => {
      try {
        // Load settings early so they're available in Zustand for all paths
        const savedSettings = await services.settingsRepo.getSettings()
        setSettings(savedSettings)

        const hasWallet = await services.security.hasWallet()
        setIsOnboarded(hasWallet)
      } catch (error) {
        console.error('Init error:', error)
        setIsOnboarded(false)
      }
    }
    check()
  }, [services, setSettings])

  // Handle onboarding complete — heavy services loaded dynamically
  const handleOnboardingComplete = useCallback(async (data: {
    mnemonic: string
    password: string
  }): Promise<boolean> => {
    try {
      console.log('[Onboarding] Starting wallet creation...')

      // Phase 1: Lightweight crypto (already loaded)
      const result = await services.security.createWallet(
        data.mnemonic,
        data.password
      )

      if (!result.ok) {
        console.error('[Onboarding] Wallet creation failed:', result.error)
        return false
      }

      console.log('[Onboarding] Wallet created successfully')

      // Set nostr key pair in store (needed by dynamically imported ProfileService)
      setNostrKeyPair(result.value.keys.publicKey, result.value.keys.privateKey)
      const { pubkey: p2pkPub } = await services.p2pkKeyManager.getCurrentKey()
      setP2pkPubkey(p2pkPub)

      // Get current settings for mints/relays
      const currentSettings = await services.settingsRepo.getSettings()

      // Phase 2: Create profile service with NostrGateway (dynamic import — composition-owned)
      const profile = await createOnboardingProfileService({
        privateKeyHex: result.value.keys.privateKey,
        relays: currentSettings.relays,
        settingsRepo: services.settingsRepo,
      })

      // NEW WALLET MODE: Fetch ZS config, save settings, publish profile.
      // Fresh installs intentionally cannot import an existing wallet here;
      // seed-based ecash import lives under Settings to avoid multi-device wallet state.
      console.log('[Onboarding] New wallet mode - fetching ZS configuration...')

      let mints = currentSettings.mints || []
      let relays = currentSettings.relays || []
      let zsRelays: string[] | undefined

      try {
        const { ZS_DOMAIN } = await import('@/core/constants')
        const zsConfig = await profile.fetchZSConfiguration(ZS_DOMAIN)
        if (zsConfig) {
          console.log('[Onboarding] ZS config fetched - mints:', zsConfig.mints, 'relays:', zsConfig.relays)
          mints = zsConfig.mints
          relays = zsConfig.relays
          zsRelays = zsConfig.relays

          const mintAliases = generateMintAliases(
            mints,
            undefined,
            (number) => i18n.t('mintDetail.defaultName', { number }),
          )

          await services.settingsRepo.saveSettings({
            ...currentSettings,
            mints,
            relays,
            mintAliases,
          })
          setSettings({ ...currentSettings, mints, relays, mintAliases })
        } else {
          console.log('[Onboarding] ZS config not available, using defaults')
        }
      } catch (e) {
        console.warn('[Onboarding] Failed to fetch ZS configuration, using defaults:', e)
      }

      // Ensure mint aliases exist (covers ZS config miss / default mints path)
      if (mints.length > 0) {
        const existingAliases = (await services.settingsRepo.getSettings()).mintAliases || {}
        const hasAllAliases = mints.every((url) => !!existingAliases[url])
        if (!hasAllAliases) {
          const mintAliases = generateMintAliases(
            mints,
            existingAliases,
            (number) => i18n.t('mintDetail.defaultName', { number }),
          )
          await services.settingsRepo.saveSettings({ ...currentSettings, mints, relays, mintAliases })
          setSettings({ ...currentSettings, mints, relays, mintAliases })
        }
      }

      console.log('[Onboarding] Mints:', mints, 'Relays:', relays)

      // Publish wallet's kind:10019, 10002, 10050 to ZS relays
      if (mints.length > 0) {
        try {
          const { pubkey: p2pkPubkey } = await services.p2pkKeyManager.getCurrentKey()
          await profile.publishAll(
            result.value.keys.publicKey,
            mints,
            relays,
            p2pkPubkey,
            zsRelays,
          )
          console.log('[Onboarding] Profile published successfully')
        } catch (e) {
          console.warn('[Onboarding] Failed to publish profile:', e)
        }
      }

      console.log('[Onboarding] Onboarding completed successfully')
      // DO NOT set isOnboarded or isLocked here.
      // OnboardingScreen shows "complete" step → user clicks "Get Started" → page reloads
      // → fresh hasEncryptedWallet() check → MainApp loads
      return true
    } catch (error) {
      console.error('[Onboarding] Onboarding failed with error:', error)
      return false
    }
  }, [services, setNostrKeyPair, setP2pkPubkey, setSettings])

  // Loading state (checking wallet existence)
  if (isOnboarded === null) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center">
          <h1 className="text-title font-bold text-brand mb-4">ZAPPI</h1>
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  // Onboarding (new user)
  if (!isOnboarded) {
    return (
      <OnboardingScreen
        onComplete={handleOnboardingComplete}
        onGenerateMnemonic={() => services.security.generateMnemonic()}
      />
    )
  }

  // Authenticated user → lazy-load the full app
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center">
          <h1 className="text-title font-bold text-brand mb-4">ZAPPI</h1>
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    }>
      <MainApp />
    </Suspense>
  )
}

export default App
