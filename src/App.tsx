import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { useAppStore } from '@/store'

// Lightweight imports only — no heavy services, hooks, or screens
import { getP2PKPubkey } from '@/services/crypto'
import { SecurityService } from '@/services/security/security.service'
import { SettingsRepository } from '@/data/repositories/settings.repository'
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
  const [services] = useState(() => ({
    security: new SecurityService(),
    settingsRepo: new SettingsRepository(),
  }))

  // Check if wallet exists (determines onboarding vs main app)
  useEffect(() => {
    const check = async () => {
      try {
        // Load settings early so they're available in Zustand for all paths
        const savedSettings = await services.settingsRepo.getSettings()
        setSettings(savedSettings)

        const hasWallet = await services.security.hasEncryptedWallet()
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
    isRecovery: boolean
  }): Promise<boolean> => {
    try {
      console.log('[Onboarding] Starting wallet creation...')

      // Phase 1: Lightweight crypto (already loaded)
      const result = await services.security.createWallet(
        data.mnemonic,
        data.password
      )

      if (result.isErr()) {
        console.error('[Onboarding] Wallet creation failed:', result.error)
        return false
      }

      console.log('[Onboarding] Wallet created successfully')

      // Set nostr key pair in store (needed by dynamically imported ProfileService)
      setNostrKeyPair(result.value.publicKey, result.value.privateKey)
      setP2pkPubkey(getP2PKPubkey(result.value.privateKey))

      // Get current settings for mints/relays
      const currentSettings = await services.settingsRepo.getSettings()

      // Phase 2: Dynamic import heavy services (user sees "recovering" spinner)
      const { ProfileService } = await import('@/services/profile/profile.service')
      const profile = new ProfileService()

      if (data.isRecovery) {
        // RECOVERY MODE: Fetch settings from Nostr, then restore tokens
        console.log('[Onboarding] Recovery mode - fetching profile from Nostr')

        const recoveredProfile = await profile.recoverProfileFromNostr(
          result.value.publicKey
        )

        let mintsToRestore: string[] = []

        if (recoveredProfile && recoveredProfile.mints.length > 0) {
          console.log('[Onboarding] Found profile on Nostr:', recoveredProfile)

          await services.settingsRepo.saveSettings({
            ...currentSettings,
            mints: recoveredProfile.mints,
            relays: recoveredProfile.relays.length > 0 ? recoveredProfile.relays : currentSettings.relays,
          })

          setSettings({
            ...currentSettings,
            mints: recoveredProfile.mints,
            relays: recoveredProfile.relays.length > 0 ? recoveredProfile.relays : currentSettings.relays,
          })

          mintsToRestore = recoveredProfile.mints
        } else {
          console.log('[Onboarding] No profile found on Nostr, using default mints')
          mintsToRestore = currentSettings.mints || []
        }

        // Dynamic import Coco for token restoration
        const cocoService = await import('@/coco/cashuService')

        console.log('[Onboarding] Restoring tokens from mints:', mintsToRestore)
        for (const mintUrl of mintsToRestore) {
          try {
            await cocoService.addMint(mintUrl)
            console.log(`[Onboarding] Restoring tokens from ${mintUrl}`)
            await cocoService.restoreWallet(mintUrl)
          } catch (e) {
            console.error(`[Onboarding] Failed to restore from ${mintUrl}:`, e)
          }
        }

        // Recover any pending Lightning quotes
        try {
          const recovery = await cocoService.recoverPendingQuotes()
          if (recovery.recovered > 0) {
            console.log(`[Onboarding] Recovered ${recovery.recovered} pending Lightning quotes`)
          }
        } catch (e) {
          console.error('[Onboarding] Failed to recover pending quotes:', e)
        }
      } else {
        // NEW WALLET MODE: Fetch ZS config, save settings, publish profile
        console.log('[Onboarding] New wallet mode - fetching ZS configuration...')

        let mints = currentSettings.mints || []
        let relays = currentSettings.relays || []
        let zsRelays: string[] | undefined

        try {
          const zsConfig = await profile.fetchZSConfiguration()
          if (zsConfig) {
            console.log('[Onboarding] ZS config fetched - mints:', zsConfig.mints, 'relays:', zsConfig.relays)
            mints = zsConfig.mints
            relays = zsConfig.relays
            zsRelays = zsConfig.relays

            await services.settingsRepo.saveSettings({
              ...currentSettings,
              mints,
              relays,
            })
            setSettings({ ...currentSettings, mints, relays })
          } else {
            console.log('[Onboarding] ZS config not available, using defaults')
          }
        } catch (e) {
          console.warn('[Onboarding] Failed to fetch ZS configuration, using defaults:', e)
        }

        console.log('[Onboarding] Mints:', mints, 'Relays:', relays)

        // Publish wallet's kind:10019, 10002, 10050 to ZS relays
        if (mints.length > 0) {
          try {
            const p2pkPubkey = getP2PKPubkey(result.value.privateKey)
            const publishResult = await profile.publishProfile(
              result.value.privateKey,
              mints,
              p2pkPubkey,
              relays,
              zsRelays
            )

            if (publishResult.isOk()) {
              console.log('[Onboarding] Profile published successfully')
            } else {
              console.warn('[Onboarding] Failed to publish profile:', publishResult.error)
            }
          } catch (e) {
            console.warn('[Onboarding] Failed to publish profile:', e)
          }
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
      <div className="flex items-center justify-center h-dvh bg-background">
        <div className="text-center">
          <h1 className="text-title text-brand mb-4">ZAPPI</h1>
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
        onValidateMnemonic={(m) => services.security.validateMnemonic(m)}
      />
    )
  }

  // Authenticated user → lazy-load the full app
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-dvh bg-background">
        <div className="text-center">
          <h1 className="text-title text-brand mb-4">ZAPPI</h1>
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    }>
      <MainApp />
    </Suspense>
  )
}

export default App
