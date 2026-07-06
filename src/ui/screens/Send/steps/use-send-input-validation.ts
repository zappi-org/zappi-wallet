/**
 * useSendInputValidation — SendInputStep의 검증 로직 훅 (R2-C 선분리, 순수 이동)
 *
 * 소유: destination/validatedData/badge/오류/로딩 상태, 디바운스 형태 판정,
 * processExternalInput(붙여넣기·스캔·연락처·제출 공용), handleNext, 자동 진행.
 *
 * §8.5 계약 (테스트 20케이스가 가드): 타이핑 중 원격 검증 0 — validateAsync는
 * 제출·붙여넣기·스캔 시점에만. 디바운스 판정은 형태(배지) 표시까지만이고
 * validatedData는 비워 두어 제출이 검증·리다이렉트를 수행한다.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { hapticTap } from '@/ui/utils/haptic'
import { useInputParser } from '@/ui/hooks/use-input-parser'
import { useContacts } from '@/ui/hooks/use-contacts'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import type { InputType, ValidatedData } from '@/core/domain/input-types'
import { resolveFlowTarget } from '@/core/domain/resolve-flow-target'
import { isNostrDirectAddress } from '@/core/domain/nostr-address'
import type { NostrDirectPaymentResolution } from '@/core/ports/driving/nostr-direct-payment.usecase'
import type { SendableValidatedData } from '../SendFlow'

const LIGHTNING_ADDRESS_RE = /^[a-z0-9_.+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i

function looksLikeLightningAddress(raw: string): boolean {
  return LIGHTNING_ADDRESS_RE.test(raw.trim())
}

function looksLikeLnurl(raw: string): boolean {
  return raw.trim().toLowerCase().startsWith('lnurl1')
}

function uniqueNonEmpty(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

function getContactLookupCandidates(input: string, data?: SendableValidatedData): string[] {
  if (!data) return uniqueNonEmpty([input])

  switch (data.type) {
    case 'lightning-address':
      return uniqueNonEmpty([input, data.address])
    case 'lnurl-pay':
      return uniqueNonEmpty([input, data.lnurl, data.params?.domain])
    case 'cashu-request':
      return uniqueNonEmpty([input, data.request, data.parsed.nostrTarget])
    case 'bolt11':
      return uniqueNonEmpty([input, data.invoice])
    case 'my-wallet':
      return uniqueNonEmpty([input, data.targetMintName])
  }
}

/** Build badge labels from detected input */
function toBadgeTypes(detected: InputType): string[] {
  if (detected.type === 'unknown' || detected.type === 'amount') return []
  const badges: string[] = [detected.type]
  if (detected.type === 'cashu-request' && detected.lightningInvoice) {
    badges.push('lightning')
  }
  return badges
}

export interface UseSendInputValidationOptions {
  onNext: (data: {
    destination: string
    validatedData?: SendableValidatedData
    amountFromInvoice?: number
    mintUrl?: string
  }) => void
  onRedirect?: (validatedData: ValidatedData) => void
  initialDestination?: string
  initialAddress?: string
  initialValidatedData?: SendableValidatedData | null
  mintUrl: string
  /** Delegate non-sendable input (cashu-token, amount-only) to universal router. */
  onRouteValidated?: (data: ValidatedData) => void
  /** Open the lifted MintSelectBottomSheet (owned by SendFlow). */
  onRequestMintSelection?: (req: {
    destination: string
    validatedData: SendableValidatedData
    commonMintUrls: string[]
    infoText?: string
  }) => void
  /** 민트 표시명 (mint-selection 안내문용) — 화면의 useMintMetadata에서 주입 */
  getDisplayName: (url: string) => string
}

export function useSendInputValidation({
  onNext,
  onRedirect,
  initialDestination = '',
  initialAddress,
  initialValidatedData,
  mintUrl,
  onRouteValidated,
  onRequestMintSelection,
  getDisplayName,
}: UseSendInputValidationOptions) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const addToast = useAppStore((s) => s.addToast)
  const inputParser = useInputParser()
  const { nostrDirectPayment } = useServiceRegistry()

  // State
  const [destination, setDestination] = useState(initialDestination)
  const [detectedTypes, setDetectedTypes] = useState<string[]>(() => {
    if (!initialValidatedData) return []
    if (initialValidatedData.type === 'cashu-request' && isNostrDirectAddress(initialValidatedData.request)) {
      return [initialValidatedData.request.toLowerCase().startsWith('nprofile1') ? 'nprofile' : 'npub']
    }
    return [initialValidatedData.type]
  })
  const [validatedData, setValidatedData] = useState<SendableValidatedData | null>(
    initialValidatedData || null
  )
  const [isPreValidating, setIsPreValidating] = useState(false)
  const [preValidationError, setPreValidationError] = useState<string | null>(null)
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const detectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastAutoAdvancedInputRef = useRef<string>(initialDestination)
  const validatedDataRef = useRef<SendableValidatedData | null>(null)
  // Store the raw address when displayName is used (contact selection)
  const rawAddressRef = useRef<string | null>(null)

  // Restore rawAddressRef from initialValidatedData when navigating back
  useEffect(() => {
    if (initialValidatedData && !rawAddressRef.current) {
      switch (initialValidatedData.type) {
        case 'bolt11':
          rawAddressRef.current = initialValidatedData.invoice
          break
        case 'lightning-address':
          rawAddressRef.current = initialValidatedData.address
          break
        case 'lnurl-pay':
          rawAddressRef.current = initialValidatedData.lnurl
          break
        case 'cashu-request':
          rawAddressRef.current = initialValidatedData.request
          break
      }
    }
  }, [initialValidatedData])

  // Address book contacts (via ContactUseCase)
  const { contacts, findByAddress } = useContacts()
  const findContactDisplayName = useCallback(async (candidates: string[]): Promise<string | undefined> => {
    const uniqueCandidates = uniqueNonEmpty(candidates)

    for (const candidate of uniqueCandidates) {
      try {
        const contact = await findByAddress(candidate)
        if (contact?.name) return contact.name
      } catch {
        // Non-blocking: address book display is best effort and must not stop sending.
      }
    }

    const normalizedCandidates = new Set(uniqueCandidates.map((candidate) => candidate.toLowerCase()))
    const localMatch = contacts.find((contact) =>
      normalizedCandidates.has(contact.address.trim().toLowerCase())
    )
    return localMatch?.name
  }, [contacts, findByAddress])

  const cancelPendingValidation = useCallback(() => {
    clearTimeout(detectTimeoutRef.current)
    clearTimeout(autoAdvanceTimerRef.current)
    setIsPreValidating(false)
    setPreValidationError(null)
    lastAutoAdvancedInputRef.current = ''
  }, [])

  const applyDestinationState = useCallback((options: {
    destination: string
    rawAddress?: string | null
    validatedData?: SendableValidatedData | null
    detectedTypes?: string[]
    isPreValidating?: boolean
  }) => {
    cancelPendingValidation()
    rawAddressRef.current = options.rawAddress ?? null
    setDestination(options.destination)
    setValidatedData(options.validatedData ?? null)
    validatedDataRef.current = options.validatedData ?? null
    setDetectedTypes(options.detectedTypes ?? [])
    setIsPreValidating(options.isPreValidating ?? false)
  }, [cancelPendingValidation])

  /**
   * Wrapper around setDestination — clears detection state immediately
   * when destination becomes empty or changes to @ prefix.
   */
  const updateDestination = useCallback((newDest: string) => {
    applyDestinationState({
      destination: newDest,
      rawAddress: null,
      validatedData: null,
      detectedTypes: [],
      isPreValidating: !!newDest.trim() && !newDest.startsWith('@'),
    })
  }, [applyDestinationState])

  // Debounced input type detection (only for non-empty, non-@ destinations)
  useEffect(() => {
    clearTimeout(detectTimeoutRef.current)

    if (rawAddressRef.current || !destination.trim() || destination.startsWith('@')) return

    detectTimeoutRef.current = setTimeout(async () => {
      clearTimeout(autoAdvanceTimerRef.current)
      const detected = inputParser.detectAndClassify(destination)
      if (isNostrDirectAddress(destination)) {
        setDetectedTypes([destination.trim().toLowerCase().startsWith('nprofile1') ? 'nprofile' : 'npub'])
        setIsPreValidating(false)
        setPreValidationError(null)
        return
      }

      setDetectedTypes(toBadgeTypes(detected))

      const sendableDetectedTypes = ['bolt11', 'lightning-address', 'lnurl', 'cashu-request']
      if (!sendableDetectedTypes.includes(detected.type)) {
        setIsPreValidating(false)
        // Check if input looks like Cashu token but failed to parse
        if (destination.trim().startsWith('cashuA') || destination.trim().startsWith('cashuB')) {
          console.error('[SendInputStep] Invalid Cashu token format:', destination.slice(0, 50))
          addToast({ type: 'error', message: t('send.destination.invalidCashuToken'), duration: 3000 })
        } else {
          setPreValidationError(t('send.destination.unrecognized'))
        }
        return
      }

      if (detected.type === 'bolt11') {
        setIsPreValidating(false)
        return
      }

      if (detected.type === 'cashu-request') {
        try {
          const validated = await inputParser.validateAsync(detected)
          if (onRedirect && resolveFlowTarget(validated.type) !== 'send') {
            setIsPreValidating(false)
            onRedirect(validated)
            return
          }
          if (validated.type === 'cashu-request') {
            const sendable = validated as SendableValidatedData
            setValidatedData(sendable)
            validatedDataRef.current = sendable

            const amt = validated.parsed?.amount
            if (amt && amt > 0 && destination !== lastAutoAdvancedInputRef.current) {
              const contactName = await findContactDisplayName(getContactLookupCandidates(destination, sendable))
              setIsPreValidating(false)
              lastAutoAdvancedInputRef.current = destination
              autoAdvanceTimerRef.current = setTimeout(() => {
                onNext({
                  destination: contactName || destination,
                  validatedData: sendable,
                  amountFromInvoice: amt,
                })
              }, 300)
              return
            }
          }
        } catch { /* decode failed, ignore */ }
        setIsPreValidating(false)
        return
      }

      const syntaxOk =
        (detected.type === 'lightning-address' && looksLikeLightningAddress(destination)) ||
        (detected.type === 'lnurl' && looksLikeLnurl(destination))

      if (!syntaxOk) {
        setIsPreValidating(false)
        setPreValidationError(t('send.destination.validationFailed'))
        return
      }

      // 타이핑-중 네트워크 정책 (설계 §8.5): 원격 검증은 제출·붙여넣기·스캔
      // 시점에만 — 여기서 validateAsync를 부르면 부분 입력 도메인으로 실 GET이
      // 나간다(`a@gmail.co` → gmail.co). 형태 판정 통과 = 배지 표시까지만이고,
      // validatedData는 비워 두어 Next(handleNext→processExternalInput)가
      // 검증·리다이렉트(lnurl-withdraw 등 handoff 포함)를 수행한다.
      setIsPreValidating(false)
      setPreValidationError(null)
    }, 500)

    return () => clearTimeout(detectTimeoutRef.current)
  }, [destination, inputParser, t, onNext, onRedirect, addToast, findContactDisplayName])

  // Cleanup auto-advance timer on unmount
  useEffect(() => () => clearTimeout(autoAdvanceTimerRef.current), [])

  // Unified input processing: detect → validate → set state → auto-advance if amount embedded
  // Used by paste, scan, contact click, and next button
  const processExternalInput = useCallback(async (input: string, displayName?: string) => {
    const trimmed = input.trim()
    if (!trimmed) return false
    const initialContactName = displayName || await findContactDisplayName(getContactLookupCandidates(trimmed))
    const initialDestination = initialContactName || trimmed
    const hasInitialDisplayName = !!initialContactName

    if (isNostrDirectAddress(trimmed)) {
      applyDestinationState({
        destination: initialDestination,
        rawAddress: hasInitialDisplayName ? trimmed : null,
        validatedData: null,
        detectedTypes: hasInitialDisplayName ? [] : [trimmed.toLowerCase().startsWith('nprofile1') ? 'nprofile' : 'npub'],
        isPreValidating: true,
      })

      let resolution: NostrDirectPaymentResolution
      try {
        resolution = await nostrDirectPayment.resolve({
          address: trimmed,
          ownMintUrls: settings.mints,
          selectedMintUrl: mintUrl || null,
        })
      } catch {
        setPreValidationError(t('send.destination.ecashInfoNotFound'))
        setIsPreValidating(false)
        return 'handled-error'
      }

      setIsPreValidating(false)

      if (resolution.status === 'ready') {
        setValidatedData(resolution.validatedData)
        validatedDataRef.current = resolution.validatedData
        return true
      }

      if (resolution.status === 'needs-mint-selection') {
        const selectedMintName = mintUrl ? getDisplayName(mintUrl) : ''
        onRequestMintSelection?.({
          destination: initialDestination,
          validatedData: resolution.validatedData,
          commonMintUrls: resolution.commonMintUrls,
          infoText: selectedMintName
            ? t('send.destination.selectedMintUnavailable', { mint: selectedMintName })
            : undefined,
        })
        return 'needs-mint-selection'
      }

      const message = resolution.status === 'no-common-mint'
        ? t('send.destination.noCommonMint')
        : resolution.status === 'no-relay'
          ? t('send.destination.relayNotFound')
          : t('send.destination.ecashInfoNotFound')
      setPreValidationError(message)
      return 'handled-error'
    }

    const detected = inputParser.detectAndClassify(trimmed)
    applyDestinationState({
      destination: initialDestination,
      rawAddress: hasInitialDisplayName ? trimmed : null,
      validatedData: null,
      // Don't show type badge when selecting from contacts (displayName means contact)
      detectedTypes: hasInitialDisplayName ? [] : toBadgeTypes(detected),
    })

    if (detected.type === 'unknown') {
      // Check if input looks like a Cashu token but failed to parse
      if (trimmed.startsWith('cashuA') || trimmed.startsWith('cashuB')) {
        console.error('[SendInputStep] Invalid Cashu token format:', trimmed.slice(0, 50))
        addToast({ type: 'error', message: t('send.destination.invalidCashuToken'), duration: 3000 })
      }
      return false
    }

    // Full validation (async — network calls for lightning-address, lnurl, npub)
    let validated
    try {
      validated = await inputParser.validateAsync(detected)
    } catch {
      // 형식은 인식됐고 원격 검증이 실패한 것 — "인식 불가"와 구분해
      // 표면화한다 (7단계 리뷰 #6: 오프라인/서버 오류에 unrecognized 토스트는 오도)
      return 'validation-error'
    }
    if (!['bolt11', 'lightning-address', 'lnurl-pay', 'cashu-request', 'my-wallet'].includes(validated.type)) {
      // Non-sendable types (cashu-token, amount, lnurl-withdraw) — hand off to the
      // universal router so the user lands on the right flow instead of seeing an error.
      if (onRouteValidated) {
        onRouteValidated(validated)
        return 'routed'
      }
      return false
    }

    const sendable = validated as SendableValidatedData
    const resolvedContactName = initialContactName || await findContactDisplayName(getContactLookupCandidates(trimmed, sendable))
    const resolvedDestination = resolvedContactName || trimmed
    if (resolvedContactName && resolvedContactName !== initialContactName) {
      applyDestinationState({
        destination: resolvedDestination,
        rawAddress: trimmed,
        validatedData: sendable,
        detectedTypes: [],
      })
    } else {
      setValidatedData(sendable)
      validatedDataRef.current = sendable
    }

    // Extract amount if available
    let detectedAmount = 0
    if (sendable.type === 'bolt11' && sendable.amountSats > 0) {
      detectedAmount = sendable.amountSats
    } else if (sendable.type === 'cashu-request' && sendable.parsed.amount && sendable.parsed.amount > 0) {
      detectedAmount = sendable.parsed.amount
    }

    // Auto-advance when amount is embedded in the input
    if (detectedAmount > 0) {
      autoAdvanceTimerRef.current = setTimeout(() => {
        onNext({
          destination: resolvedDestination,
          validatedData: sendable,
          amountFromInvoice: detectedAmount,
        })
      }, 300)
      return 'auto-advanced'
    }

    return true
  }, [onNext, inputParser, onRouteValidated, applyDestinationState, onRequestMintSelection, addToast, settings.mints, mintUrl, nostrDirectPayment, getDisplayName, t, findContactDisplayName])

  // Validating state for loading indicator on next button
  const [isValidating, setIsValidating] = useState(false)

  /** Extract embedded amount from validated data */
  const getAmountFromData = (data: SendableValidatedData): number => {
    if (data.type === 'bolt11' && data.amountSats > 0) return data.amountSats
    if (data.type === 'cashu-request' && data.parsed?.amount && data.parsed.amount > 0) return data.parsed.amount
    return 0
  }

  /** Proceed to next step with validated data */
  const advanceWithData = useCallback((
    displayDest: string,
    data: SendableValidatedData,
    mintUrlOverride?: string,
  ) => {
    const amt = getAmountFromData(data)
    onNext({
      destination: displayDest,
      validatedData: data,
      amountFromInvoice: amt > 0 ? amt : undefined,
      mintUrl: mintUrlOverride,
    })
  }, [onNext])

  // Handle next — destination must be validated before proceeding
  const handleNext = useCallback(async () => {
    clearTimeout(autoAdvanceTimerRef.current)
    const trimmed = destination.trim()
    if (!trimmed) return
    hapticTap()

    // Already validated → proceed immediately
    if (validatedData) {
      setIsValidating(true)
      try {
        const addressToLookup = rawAddressRef.current || trimmed
        const contactName = await findContactDisplayName(getContactLookupCandidates(addressToLookup, validatedData))
        advanceWithData(contactName || trimmed, validatedData)
      } finally {
        setIsValidating(false)
      }
      return
    }

    // Not yet validated — validate now (show loading on button)
    setIsValidating(true)
    const addressToValidate = rawAddressRef.current || trimmed
    const displayName = rawAddressRef.current ? trimmed : undefined
    const ok = await processExternalInput(addressToValidate, displayName)
    setIsValidating(false)

    if (ok === true && validatedDataRef.current) {
      const contactName = await findContactDisplayName(getContactLookupCandidates(addressToValidate, validatedDataRef.current))
      advanceWithData(contactName || displayName || addressToValidate, validatedDataRef.current)
    } else if (ok === 'validation-error') {
      addToast({ type: 'error', message: t('send.destination.validationFailed'), duration: 3000 })
    } else if (!ok) {
      addToast({ type: 'error', message: t('send.destination.unrecognized'), duration: 3000 })
    }
  }, [destination, validatedData, processExternalInput, advanceWithData, addToast, t, findContactDisplayName])

  // Auto-validate when initialAddress is provided (from address book)
  // On success, auto-advance to amount step
  const autoValidatedRef = useRef(false)
  useEffect(() => {
    if (initialAddress && !initialValidatedData && !autoValidatedRef.current) {
      autoValidatedRef.current = true
      rawAddressRef.current = initialAddress
      const id = requestAnimationFrame(async () => {
        setIsValidating(true)
        const ok = await processExternalInput(initialAddress, initialDestination || undefined)
        setIsValidating(false)
        if (ok === true && validatedDataRef.current) {
          advanceWithData(initialDestination || initialAddress, validatedDataRef.current)
        }
      })
      return () => cancelAnimationFrame(id)
    }
  }, [initialAddress, initialDestination, initialValidatedData, processExternalInput, advanceWithData])

  return {
    destination,
    updateDestination,
    detectedTypes,
    validatedData,
    isPreValidating,
    preValidationError,
    isValidating,
    contacts,
    applyDestinationState,
    processExternalInput,
    handleNext,
  }
}
