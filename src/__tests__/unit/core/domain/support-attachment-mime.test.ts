/**
 * Attachment MIME allowlist.
 *
 * The MIME on a support attachment is chosen by the remote peer and ends up as
 * the type of a blob: URL on our own origin. Pinned contract: only the
 * allowlisted types survive; everything else is downgraded to an opaque type,
 * and only allowlisted image types are treated as renderable.
 */
import { describe, it, expect } from 'vitest'
import {
  OPAQUE_ATTACHMENT_MIME,
  isRenderableAttachmentImage,
  safeAttachmentMime,
} from '@/core/domain/support'

describe('safeAttachmentMime', () => {
  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'])(
    'keeps the allowlisted type %s',
    (mime) => {
      expect(safeAttachmentMime(mime)).toBe(mime)
    },
  )

  it.each([
    'text/html',
    'image/svg+xml',
    'application/xhtml+xml',
    'text/javascript',
    'application/javascript',
    'text/plain',
    'application/xml',
  ])('downgrades the scriptable or unlisted type %s', (mime) => {
    expect(safeAttachmentMime(mime)).toBe(OPAQUE_ATTACHMENT_MIME)
  })

  it('normalizes case and strips parameters before matching', () => {
    expect(safeAttachmentMime('IMAGE/PNG')).toBe('image/png')
    expect(safeAttachmentMime('image/png; charset=utf-8')).toBe('image/png')
    expect(safeAttachmentMime('  image/jpeg  ')).toBe('image/jpeg')
  })

  it('a parameter cannot smuggle a scriptable type past the allowlist', () => {
    expect(safeAttachmentMime('text/html;x=image/png')).toBe(OPAQUE_ATTACHMENT_MIME)
  })

  it.each([undefined, '', '   '])('treats missing MIME (%s) as opaque', (mime) => {
    expect(safeAttachmentMime(mime)).toBe(OPAQUE_ATTACHMENT_MIME)
  })
})

describe('isRenderableAttachmentImage', () => {
  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])(
    'renders the allowlisted image %s',
    (mime) => {
      expect(isRenderableAttachmentImage(mime)).toBe(true)
    },
  )

  it('does not render svg — an image/ prefix alone is not enough', () => {
    expect(isRenderableAttachmentImage('image/svg+xml')).toBe(false)
  })

  it.each(['text/html', 'application/pdf', 'image/bogus', undefined])(
    'does not render %s',
    (mime) => {
      expect(isRenderableAttachmentImage(mime)).toBe(false)
    },
  )
})
