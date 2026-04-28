import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'

export interface SupportAttachmentBlobStore {
  upload(args: {
    ciphertext: Uint8Array
    ciphertextSha256: string
    contentType?: string
  }): Promise<UploadedSupportAttachmentBlob>
  download(args: {
    blobSha256: string
    servers: string[]
  }): Promise<Uint8Array>
  delete(args: {
    blobSha256: string
    uploaderSecretKey: Uint8Array
    servers: string[]
  }): Promise<void>
}

export interface UploadedSupportAttachmentBlob {
  servers: string[]
  uploaderSecretKey: Uint8Array
}

interface BlossomDescriptor {
  sha256: string
}

export class BlossomAttachmentStoreAdapter implements SupportAttachmentBlobStore {
  constructor(private readonly servers: string[]) {}

  async upload(args: {
    ciphertext: Uint8Array
    ciphertextSha256: string
    contentType?: string
  }): Promise<UploadedSupportAttachmentBlob> {
    if (this.servers.length === 0) {
      throw new Error('Support attachment storage is not configured')
    }

    const uploaderSecretKey = generateSecretKey()
    const auth = buildAuth({
      action: 'upload',
      sha256: args.ciphertextSha256,
      secretKey: uploaderSecretKey,
      description: 'Encrypted support attachment upload',
    })
    const primaryServer = this.servers[0]!
    const response = await fetch(`${primaryServer}/upload`, {
      method: 'PUT',
      headers: {
        Authorization: auth,
        'Content-Type': args.contentType ?? 'application/octet-stream',
      },
      body: asArrayBuffer(args.ciphertext),
    })

    if (!response.ok) {
      throw new Error(`Support attachment upload failed (${response.status})`)
    }

    const descriptor = await response.json() as BlossomDescriptor
    if (descriptor.sha256 !== args.ciphertextSha256) {
      throw new Error('Support attachment storage integrity check failed')
    }

    return {
      servers: this.servers,
      uploaderSecretKey,
    }
  }

  async download(args: {
    blobSha256: string
    servers: string[]
  }): Promise<Uint8Array> {
    const candidates = [...new Set([...args.servers, ...this.servers])]
    let lastError: unknown

    for (const server of candidates) {
      try {
        const response = await fetch(`${server}/${args.blobSha256}`)
        if (response.ok) {
          return new Uint8Array(await response.arrayBuffer())
        }
        lastError = new Error(`HTTP ${response.status}`)
      } catch (error) {
        lastError = error
      }
    }

    throw new Error(lastError instanceof Error ? lastError.message : 'Support attachment download failed')
  }

  async delete(args: {
    blobSha256: string
    uploaderSecretKey: Uint8Array
    servers: string[]
  }): Promise<void> {
    const candidates = [...new Set([...args.servers, ...this.servers])]
    const auth = buildAuth({
      action: 'delete',
      sha256: args.blobSha256,
      secretKey: args.uploaderSecretKey,
      description: 'Encrypted support attachment cleanup',
    })

    await Promise.all(candidates.map(async (server) => {
      const response = await fetch(`${server}/${args.blobSha256}`, {
        method: 'DELETE',
        headers: { Authorization: auth },
      })
      if (!response.ok && response.status !== 404) {
        throw new Error(`Support attachment cleanup failed (${response.status})`)
      }
    }))
  }
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function buildAuth(args: {
  action: 'upload' | 'delete'
  sha256: string
  secretKey: Uint8Array
  description: string
}): string {
  const event = finalizeEvent({
    kind: 24242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['t', args.action],
      ['x', args.sha256],
      ['expiration', String(Math.floor(Date.now() / 1000) + 60)],
    ],
    content: args.description,
  }, args.secretKey)

  return `Nostr ${btoa(unescape(encodeURIComponent(JSON.stringify(event))))}`
}
