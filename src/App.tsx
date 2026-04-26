import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { useAppStore } from '@/store'
import i18n from '@/i18n'
import { generateMintAliases } from '@/utils/mint-name'

// Lightweight imports only — no heavy services, hooks, or screens
import { CocoP2PKKeyManager } from '@/adapters/crypto/p2pk-key-manager.adapter'
import { getCocoManager } from '@/modules/cashu'
import { createSecurityService } from '@/composition/security'
import { DexieSettingsRepository as SettingsRepository } from '@/adapters/storage/dexie/dexie-settings.repository'
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
  const [services] = useState(() => {
    const security = createSecurityService()
    return {
      security,
      settingsRepo: new SettingsRepository(),
      p2pkKeyManager: new CocoP2PKKeyManager(async () => (await getCocoManager()).keyring),
    }
  })

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
      setNostrKeyPair(result.value.keys.publicKey, result.value.keys.privateKey)
      const { pubkey: p2pkPub } = await services.p2pkKeyManager.getCurrentKey()
      setP2pkPubkey(p2pkPub)

      // Get current settings for mints/relays
      const currentSettings = await services.settingsRepo.getSettings()

      // Phase 2: Create profile service with NostrGateway
      const { NostrGatewayAdapter } = await import('@/adapters/nostr/nostr-gateway')
      const { createProfileService } = await import('@/composition/profile')
      const nostrGateway = new NostrGatewayAdapter({ privateKeyHex: result.value.keys.privateKey })
      await nostrGateway.connect(currentSettings.relays)
      const profile = createProfileService(nostrGateway, services.settingsRepo)

      if (data.isRecovery) {
        // RECOVERY MODE: Fetch settings from Nostr, then restore tokens
        console.log('[Onboarding] Recovery mode - fetching profile from Nostr')

        const recoveredProfile = await profile.recoverProfile(
          result.value.keys.publicKey
        )

        let mintsToRestore: string[] = []

        if (recoveredProfile && recoveredProfile.mints.length > 0) {
          console.log('[Onboarding] Found profile on Nostr:', recoveredProfile)

          const recoveredAliases = generateMintAliases(
            recoveredProfile.mints,
            undefined,
            (number) => i18n.t('mintDetail.defaultName', { number }),
          )
          const recoveredRelays = recoveredProfile.relays.length > 0 ? recoveredProfile.relays : currentSettings.relays

          await services.settingsRepo.saveSettings({
            ...currentSettings,
            mints: recoveredProfile.mints,
            relays: recoveredRelays,
            mintAliases: recoveredAliases,
          })

          setSettings({
            ...currentSettings,
            mints: recoveredProfile.mints,
            relays: recoveredRelays,
            mintAliases: recoveredAliases,
          })

          mintsToRestore = recoveredProfile.mints
        } else {
          console.log('[Onboarding] No profile found on Nostr, using default mints')
          mintsToRestore = currentSettings.mints || []
        }

        // Dynamic import Coco for token restoration
        const cocoService = await import('@/modules/cashu')

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
          const { recoverPendingQuotes } = await import('@/composition/recover-pending-quotes')
          const recovery = await recoverPendingQuotes(mintsToRestore)
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
        onValidateMnemonic={(m) => services.security.validateMnemonic(m)}
      />
    )
  }

  // Authenticated user → lazy-load the full app
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-dvh bg-background">
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
