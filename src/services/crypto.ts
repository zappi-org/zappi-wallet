import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gcm } from '@noble/ciphers/aes.js';
import { nip19 } from 'nostr-tools';
import * as secp256k1 from '@noble/secp256k1';

// NIP-06 derivation path for Nostr keys
const NOSTR_DERIVATION_PATH = "m/44'/1237'/0'/0/0";

export interface KeyPair {
  privateKey: string; // hex
  publicKey: string;  // hex (without 02 prefix)
}

// Generate new 12-word mnemonic
export function generateNewMnemonic(): string {
  return bip39.generateMnemonic(wordlist, 128); // 128 bits = 12 words
}

// Generate 24-word mnemonic
export function generateNewMnemonic24(): string {
  return bip39.generateMnemonic(wordlist, 256); // 256 bits = 24 words
}

// Validate mnemonic
export function isValidMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic, wordlist);
}

// Derive Nostr keypair from mnemonic (NIP-06)
export function deriveNostrKeyPair(mnemonic: string): KeyPair {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const derived = hdKey.derive(NOSTR_DERIVATION_PATH);

  if (!derived.privateKey) {
    throw new Error('Failed to derive private key');
  }

  const privateKey = bytesToHex(derived.privateKey);

  // Get public key (x-only, 32 bytes) from the private key
  // secp256k1 public key derivation
  const publicKey = bytesToHex(derived.publicKey!.slice(1)); // Remove prefix byte

  return { privateKey, publicKey };
}

// Get P2PK pubkey format (compressed 33 bytes with 02/03 prefix) for Cashu
export function getP2PKPubkey(privateKey: string): string {
  const privKeyBytes = hexToBytes(privateKey);
  const compressedPubkey = secp256k1.getPublicKey(privKeyBytes, true);
  return bytesToHex(compressedPubkey);
}

// Encode hex public key to npub
export function encodeNpub(publicKeyHex: string): string {
  return nip19.npubEncode(publicKeyHex);
}

// Encode hex public key to nprofile with relay hints
export function encodeNprofile(publicKeyHex: string, relays: string[]): string {
  return nip19.nprofileEncode({
    pubkey: publicKeyHex,
    relays,
  });
}

// Encrypt data with password using @noble/ciphers (works in HTTP/HTTPS)
export function encryptData(data: string, password: string): string {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);

  // Generate random salt and nonce
  const salt = randomBytes(16);
  const nonce = randomBytes(12);

  // Derive 32-byte key from password using PBKDF2
  const key = pbkdf2(sha256, encoder.encode(password), salt, {
    c: 100000,
    dkLen: 32,
  });

  // Encrypt with AES-256-GCM
  const aes = gcm(key, nonce);
  const encrypted = aes.encrypt(dataBuffer);

  // Combine salt + nonce + encrypted data (includes auth tag)
  const result = new Uint8Array(salt.length + nonce.length + encrypted.length);
  result.set(salt, 0);
  result.set(nonce, salt.length);
  result.set(encrypted, salt.length + nonce.length);

  return bytesToHex(result);
}

// Decrypt data with password using @noble/ciphers
export function decryptData(encryptedHex: string, password: string): string {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const data = hexToBytes(encryptedHex);

  const salt = data.slice(0, 16);
  const nonce = data.slice(16, 28);
  const encrypted = data.slice(28);

  // Derive key from password using PBKDF2
  const key = pbkdf2(sha256, encoder.encode(password), salt, {
    c: 100000,
    dkLen: 32,
  });

  // Decrypt with AES-256-GCM
  const aes = gcm(key, nonce);
  const decrypted = aes.decrypt(encrypted);

  return decoder.decode(decrypted);
}
