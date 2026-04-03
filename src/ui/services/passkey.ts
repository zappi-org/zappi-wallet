/**
 * Passkey (WebAuthn) service for biometric authentication
 *
 * Security: Uses WebAuthn PRF extension for key material
 * - PIN is encrypted with AES-256-GCM (authenticated encryption)
 * - Key is derived using PBKDF2 with 100,000 iterations
 * - Key material comes from WebAuthn PRF output (biometric-bound secret)
 * - PRF output is NEVER stored — only obtainable via biometric authentication
 * - Random salt and IV for each encryption
 */

const STORAGE_KEY = 'passkey_credential'
const ENCRYPTED_PIN_KEY = 'passkey_encrypted_pin_v3' // v3 for PRF-based format

// Old storage keys for migration cleanup
const OLD_ENCRYPTED_PIN_KEYS = ['passkey_encrypted_pin', 'passkey_encrypted_pin_v2']

interface StoredCredential {
  credentialId: string
  version: 3 // Track format version for future migrations
}

interface EncryptedPinData {
  ciphertext: string // Base64
  salt: string // Hex
  iv: string // Hex
}

// PRF extension types (not yet in standard TypeScript lib)
interface PRFValues {
  first: ArrayBuffer
  second?: ArrayBuffer
}

interface PRFExtensionInput {
  eval?: { first: BufferSource; second?: BufferSource }
}

interface PRFExtensionOutput {
  enabled?: boolean
  results?: PRFValues
}

// PBKDF2 iterations - balance between security and UX
const PBKDF2_ITERATIONS = 100000

// Fixed application-specific salt for PRF evaluation
// This ensures the same PRF output for the same credential across sessions
const PRF_SALT = new TextEncoder().encode('zappi-pin-encryption-v1')

// Check if WebAuthn is supported
export function isPasskeySupported(): boolean {
  return !!(
    window.PublicKeyCredential &&
    typeof window.PublicKeyCredential === 'function'
  )
}

// Check if passkey is registered (with valid v3 format)
export function isPasskeyRegistered(): boolean {
  const storedData = localStorage.getItem(STORAGE_KEY)
  if (!storedData) return false

  try {
    const stored = JSON.parse(storedData)
    // Only v3 (PRF-based) is considered valid
    if (stored.version !== 3) {
      // Old format detected — clean up
      cleanupOldData()
      return false
    }
    // Also verify encrypted PIN exists in v3 format
    return localStorage.getItem(ENCRYPTED_PIN_KEY) !== null
  } catch {
    return false
  }
}

// Clean up old format data
function cleanupOldData(): void {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(ENCRYPTED_PIN_KEY)
  for (const key of OLD_ENCRYPTED_PIN_KEYS) {
    localStorage.removeItem(key)
  }
}

// Generate a random challenge
function generateChallenge(): ArrayBuffer {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return array.buffer
}

// Convert ArrayBuffer to base64
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// Convert base64 to ArrayBuffer
function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

// Convert bytes to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Convert hex string to bytes
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/**
 * Derive AES key from PRF output using PBKDF2
 */
async function deriveKey(prfOutput: ArrayBuffer, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    prfOutput,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Encrypt PIN using AES-256-GCM with PRF-derived key
 */
async function encryptPin(pin: string, prfOutput: ArrayBuffer): Promise<EncryptedPinData> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const key = await deriveKey(prfOutput, salt)

  const encoder = new TextEncoder()
  const plaintext = encoder.encode(pin)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    plaintext
  )

  return {
    ciphertext: bufferToBase64(ciphertext),
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
  }
}

/**
 * Decrypt PIN using AES-256-GCM with PRF-derived key
 */
async function decryptPin(data: EncryptedPinData, prfOutput: ArrayBuffer): Promise<string> {
  const salt = hexToBytes(data.salt)
  const iv = hexToBytes(data.iv)
  const ciphertext = base64ToBuffer(data.ciphertext)

  const key = await deriveKey(prfOutput, salt)

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext
  )

  const decoder = new TextDecoder()
  return decoder.decode(plaintext)
}

/**
 * Extract PRF result from WebAuthn extension outputs.
 *
 * WebAuthn PRF spec differences:
 * - create() response: { enabled: boolean, results?: {...} }
 * - get() response:    { results?: {...} }  (NO enabled field)
 *
 * We check results.first directly, which works for both cases:
 * - create() with PRF unsupported: results is undefined → returns null
 * - create() with PRF supported: results.first is present → returns it
 * - get() with PRF working: results.first is present → returns it
 * - get() with PRF failed: results is undefined → returns null
 */
function extractPRFResult(
  extensionResults: AuthenticationExtensionsClientOutputs
): ArrayBuffer | null {
  const prf = (extensionResults as AuthenticationExtensionsClientOutputs & { prf?: PRFExtensionOutput }).prf
  if (!prf?.results?.first) return null
  return prf.results.first
}

/**
 * Register a new passkey with PRF extension.
 * Returns true on success. Throws PasskeyPRFNotSupportedError if PRF is unavailable.
 */
export async function registerPasskey(pin: string): Promise<boolean> {
  if (!isPasskeySupported()) {
    return false
  }

  try {
    const challenge = generateChallenge()
    const userId = crypto.getRandomValues(new Uint8Array(16))

    const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
      challenge,
      rp: {
        name: 'ZAPPI',
        id: window.location.hostname,
      },
      user: {
        id: userId,
        name: 'zappi-user',
        displayName: 'ZAPPI User',
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },   // ES256
        { alg: -257, type: 'public-key' }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
      extensions: {
        prf: {
          eval: {
            first: PRF_SALT,
          },
        },
      } as AuthenticationExtensionsClientInputs & { prf: PRFExtensionInput },
    }

    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions,
    }) as PublicKeyCredential | null

    if (!credential) {
      return false
    }

    // Check PRF support
    const prfOutput = extractPRFResult(credential.getClientExtensionResults())
    if (!prfOutput) {
      // PRF not supported by this authenticator — cannot securely encrypt PIN
      throw new Error('PRF_NOT_SUPPORTED')
    }

    // Clean up any old format data
    cleanupOldData()

    // Store credential ID (needed for allowCredentials in authentication)
    const storedCredential: StoredCredential = {
      credentialId: bufferToBase64(credential.rawId),
      version: 3,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedCredential))

    // Encrypt PIN with PRF-derived key
    const encryptedData = await encryptPin(pin, prfOutput)
    localStorage.setItem(ENCRYPTED_PIN_KEY, JSON.stringify(encryptedData))

    return true
  } catch (error) {
    if (error instanceof Error && error.message === 'PRF_NOT_SUPPORTED') {
      throw error // Let caller handle this specifically
    }
    console.error('Passkey registration failed:', error)
    return false
  }
}

/**
 * Authenticate with passkey and return the decrypted PIN.
 * Uses PRF extension to obtain key material via biometric auth.
 */
export async function authenticateWithPasskey(): Promise<string | null> {
  if (!isPasskeySupported() || !isPasskeyRegistered()) {
    return null
  }

  try {
    const storedData = localStorage.getItem(STORAGE_KEY)
    if (!storedData) return null

    const stored: StoredCredential = JSON.parse(storedData)
    if (stored.version !== 3) {
      cleanupOldData()
      return null
    }

    const challenge = generateChallenge()

    const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
      challenge,
      allowCredentials: [
        {
          id: base64ToBuffer(stored.credentialId),
          type: 'public-key',
          transports: ['internal'],
        },
      ],
      userVerification: 'required',
      timeout: 60000,
      extensions: {
        prf: {
          eval: {
            first: PRF_SALT,
          },
        },
      } as AuthenticationExtensionsClientInputs & { prf: PRFExtensionInput },
    }

    const assertion = await navigator.credentials.get({
      publicKey: publicKeyCredentialRequestOptions,
    }) as PublicKeyCredential | null

    if (!assertion) {
      return null
    }

    // Get PRF output from assertion
    const prfOutput = extractPRFResult(assertion.getClientExtensionResults())
    if (!prfOutput) {
      // PRF failed during authentication — this shouldn't happen if registration succeeded
      return null
    }

    // Get encrypted PIN data
    const encryptedPinStr = localStorage.getItem(ENCRYPTED_PIN_KEY)
    if (!encryptedPinStr) return null

    const encryptedData: EncryptedPinData = JSON.parse(encryptedPinStr)

    // Decrypt PIN using PRF-derived key
    const pin = await decryptPin(encryptedData, prfOutput)
    return pin
  } catch (error) {
    console.error('Passkey authentication failed:', error)
    return null
  }
}

// Remove passkey registration
export function removePasskey(): void {
  cleanupOldData()
}

/**
 * Update stored PIN (when PIN is changed).
 * Requires biometric authentication to get PRF output for re-encryption.
 */
export async function updatePasskeyPin(newPin: string): Promise<boolean> {
  if (!isPasskeyRegistered()) return false

  try {
    const storedData = localStorage.getItem(STORAGE_KEY)
    if (!storedData) return false

    const stored: StoredCredential = JSON.parse(storedData)
    if (stored.version !== 3) {
      cleanupOldData()
      return false
    }

    const challenge = generateChallenge()

    // Must authenticate (biometric) to get PRF output
    const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
      challenge,
      allowCredentials: [
        {
          id: base64ToBuffer(stored.credentialId),
          type: 'public-key',
          transports: ['internal'],
        },
      ],
      userVerification: 'required',
      timeout: 60000,
      extensions: {
        prf: {
          eval: {
            first: PRF_SALT,
          },
        },
      } as AuthenticationExtensionsClientInputs & { prf: PRFExtensionInput },
    }

    const assertion = await navigator.credentials.get({
      publicKey: publicKeyCredentialRequestOptions,
    }) as PublicKeyCredential | null

    if (!assertion) return false

    const prfOutput = extractPRFResult(assertion.getClientExtensionResults())
    if (!prfOutput) return false

    // Re-encrypt with new PIN (new salt and IV)
    const encryptedData = await encryptPin(newPin, prfOutput)
    localStorage.setItem(ENCRYPTED_PIN_KEY, JSON.stringify(encryptedData))

    return true
  } catch (error) {
    console.error('Failed to update passkey PIN:', error)
    return false
  }
}
