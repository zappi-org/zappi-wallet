import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerPasskey } from '@/ui/services/passkey'

const createCredential = vi.fn()
const getCredential = vi.fn()

function prfBytes(seed: number): ArrayBuffer {
  return new Uint8Array(32).fill(seed).buffer
}

function registrationCredential(
  extensionResults: AuthenticationExtensionsClientOutputs,
  transports: AuthenticatorTransport[] = ['internal'],
): PublicKeyCredential {
  return {
    rawId: new Uint8Array([1, 2, 3, 4]).buffer,
    response: { getTransports: () => transports } as AuthenticatorAttestationResponse,
    getClientExtensionResults: () => extensionResults,
  } as unknown as PublicKeyCredential
}

function assertionCredential(
  extensionResults: AuthenticationExtensionsClientOutputs,
): PublicKeyCredential {
  return {
    getClientExtensionResults: () => extensionResults,
  } as unknown as PublicKeyCredential
}

describe('registerPasskey PRF compatibility', () => {
  beforeEach(() => {
    createCredential.mockReset()
    getCredential.mockReset()
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      value: class PublicKeyCredential {},
    })
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: { create: createCredential, get: getCredential },
    })
  })

  it('uses a PRF result returned during credential creation', async () => {
    createCredential.mockResolvedValue(
      registrationCredential({
        prf: { enabled: true, results: { first: prfBytes(1) } },
      } as AuthenticationExtensionsClientOutputs),
    )

    await expect(registerPasskey('123456')).resolves.toBe(true)
    expect(getCredential).not.toHaveBeenCalled()

    const stored = JSON.parse(localStorage.getItem('passkey_credential') ?? '{}')
    expect(stored).toMatchObject({ version: 3, transports: ['internal'] })
    expect(localStorage.getItem('passkey_encrypted_pin_v3')).not.toBeNull()
  })

  it('evaluates PRF with a follow-up assertion when creation only reports support', async () => {
    createCredential.mockResolvedValue(
      registrationCredential(
        { prf: { enabled: true } } as AuthenticationExtensionsClientOutputs,
        ['hybrid'],
      ),
    )
    getCredential.mockResolvedValue(
      assertionCredential({
        prf: { results: { first: prfBytes(2) } },
      } as AuthenticationExtensionsClientOutputs),
    )

    await expect(registerPasskey('123456')).resolves.toBe(true)
    expect(getCredential).toHaveBeenCalledTimes(1)

    const request = getCredential.mock.calls[0][0] as CredentialRequestOptions
    expect(request.publicKey?.allowCredentials?.[0].transports).toEqual(['hybrid'])
  })

  it('rejects a provider that explicitly does not support PRF', async () => {
    createCredential.mockResolvedValue(
      registrationCredential({ prf: { enabled: false } } as AuthenticationExtensionsClientOutputs),
    )

    await expect(registerPasskey('123456')).rejects.toThrow('PRF_NOT_SUPPORTED')
    expect(getCredential).not.toHaveBeenCalled()
    expect(localStorage.getItem('passkey_credential')).toBeNull()
  })

  it('rejects a provider that ignores the PRF extension', async () => {
    createCredential.mockResolvedValue(registrationCredential({}))

    await expect(registerPasskey('123456')).rejects.toThrow('PRF_NOT_SUPPORTED')
    expect(getCredential).not.toHaveBeenCalled()
  })
})
