import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_RELAYS } from '@/core/constants'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import type { WalletSettings } from '@/core/types'
import { useAppStore } from '@/store'
import { broadcastSync } from '@/utils/cross-tab-sync'
import { generateMintAliases } from '@/utils/mint-name'
import { normalizeMintUrl, isSameMintUrl } from '@/utils/url'

/**
 * Registry surface used by the mint hook — the ServiceRegistry port plus the
 * BootstrapResult extension. Structurally requires only trustMint, so it stays
 * independent of composition types.
 */
export type MintHandlersRegistry = ServiceRegistry & {
  trustMint(mintUrl: string): Promise<void>
}

export interface UseMintHandlersDeps {
  serviceRegistry: MintHandlersRegistry | null
  /** preUnlock.settingsRepo — settings persistence store; exists even before unlock */
  settingsRepo: { saveSettings(settings: WalletSettings): Promise<void> }
}

export interface MintHandlers {
  handleSaveSettings: (newSettings: Record<string, unknown>) => Promise<void>
  handleAddTrustedMint: (mintUrl: string) => Promise<boolean>
}

/**
 * Mint/settings handler bundle: save settings (+ profile republish, relay
 * reconnect) and add trusted mint (+ seed restore). republishProfile is
 * encapsulated in the hook since only these two handlers use it.
 */
export function useMintHandlers(deps: UseMintHandlersDeps): MintHandlers {
  const { serviceRegistry, settingsRepo } = deps
  const { t } = useTranslation()

  const settings = useAppStore((state) => state.settings)
  const setSettings = useAppStore((state) => state.setSettings)
  const nostrPubkey = useAppStore((state) => state.nostrPubkey)
  const p2pkPubkey = useAppStore((state) => state.p2pkPubkey)

  /** Profile republish via bootstrap's profileService */
  const republishProfile = useCallback(async (mints: string[], relays: string[]) => {
    if (!serviceRegistry || !nostrPubkey || !p2pkPubkey) return
    try {
      await serviceRegistry.profile.publishAll(nostrPubkey, mints, relays, p2pkPubkey)
      console.log('[Profile] Republished successfully')
    } catch (e) {
      console.warn('[Profile] Failed to republish:', e)
    }
  }, [serviceRegistry, nostrPubkey, p2pkPubkey])

  const handleSaveSettings = useCallback(async (newSettings: Record<string, unknown>): Promise<void> => {
    const mergedSettings = { ...settings, ...newSettings }
    setSettings(mergedSettings)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await settingsRepo.saveSettings(mergedSettings as any)

    const newMints = newSettings.mints as string[] | undefined
    const newRelays = newSettings.relays as string[] | undefined
    // Set-equality compare: skip republishing the 3 profile events
    // (nutzap-info/relay-list/DM-relay-list) on every relay drag commit that only
    // reorders — relay events are set-semantic, so reordering isn't a republish
    // reason. mints keep an ordered compare: the 10019 mint-list order can signal
    // receive preference, so reordering it is a republish reason.
    const sameSet = (a: string[], b: string[]) => {
      const sa = new Set(a)
      const sb = new Set(b)
      return sa.size === sb.size && [...sa].every((x) => sb.has(x))
    }
    const mintsChanged = newMints && JSON.stringify(newMints) !== JSON.stringify(settings.mints)
    const relaysChanged = newRelays && !sameSet(newRelays, settings.relays)

    if ((mintsChanged || relaysChanged) && p2pkPubkey) {
      republishProfile(newMints || settings.mints, newRelays || settings.relays)
    }
    // Re-establish the persistent set: a relay settings change must also update
    // the gateway's connection targets. The legacy path relied on the implicit
    // connect of the next fetch, but on the controller path this explicit call is
    // the only establishment point.
    if (relaysChanged && serviceRegistry) {
      const nextRelays = newRelays || settings.relays
      serviceRegistry.nostrGateway
        .connect([...new Set([...DEFAULT_RELAYS, ...nextRelays])])
        .catch((e) => console.warn('[useMintHandlers] relay reconnect failed:', e))
    }
    broadcastSync('settings_changed')
  }, [settingsRepo, settings, setSettings, p2pkPubkey, republishProfile, serviceRegistry])

  // Handle adding a trusted mint (from receive screen)
  const handleAddTrustedMint = useCallback(async (mintUrl: string): Promise<boolean> => {
    try {
      if (!serviceRegistry) {
        console.warn('[useMintHandlers] ServiceRegistry not ready — cannot add trusted mint')
        return false
      }

      const url = normalizeMintUrl(mintUrl)

      if (settings.mints.some((mint) => isSameMintUrl(mint, url))) {
        await serviceRegistry.trustMint(url)
        return true
      }

      // Fresh probe via the facade: trusting a mint is a "valid right now?" check,
      // so probe fresh — the response is back-fed into the metadata cache for
      // later screens to reuse.
      const info = await serviceRegistry.mintInfo.getInfo(url, { fresh: true })
      if (!info || (!info.name && !info.pubkey)) {
        console.error('[useMintHandlers] Invalid or unreachable mint info')
        return false
      }

      const newMints = [...settings.mints, url]
      const newAliases = generateMintAliases(
        newMints,
        settings.mintAliases,
        (number) => t('mintDetail.defaultName', { number }),
      )
      const nextSettings = { ...settings, mints: newMints, mintAliases: newAliases }

      await settingsRepo.saveSettings(nextSettings)
      setSettings(nextSettings)

      try {
        await serviceRegistry.trustMint(url)
      } catch (trustError) {
        await settingsRepo.saveSettings(settings).catch((rollbackError) => {
          console.error('[useMintHandlers] Failed to rollback settings after mint trust failure:', rollbackError)
        })
        setSettings(settings)
        throw trustError
      }

      if (p2pkPubkey) {
        republishProfile(nextSettings.mints, nextSettings.relays)
      }

      // Seed-based balance restore — ownership decision: a reinstalling/re-adding
      // user can't tell whether this mint held a balance and mistakes it for loss.
      // Fire-and-forget since we're mid receive-modal — balance:changed refreshes
      // the screen on completion.
      serviceRegistry.payment
        .recoverAccounts({ accountIds: [url] })
        .catch((e) => console.warn('[useMintHandlers] Seed restore after trust failed:', e))

      console.log('[useMintHandlers] Added trusted mint:', url)
      broadcastSync('settings_changed')
      return true
    } catch (error) {
      console.error('[useMintHandlers] Failed to add trusted mint:', error)
      return false
    }
  }, [settings, settingsRepo, setSettings, p2pkPubkey, republishProfile, t, serviceRegistry])

  return { handleSaveSettings, handleAddTrustedMint }
}
