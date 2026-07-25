/**
 * What actually happened, so a caller can say the true thing:
 *   shared    — handed to the native share sheet
 *   copied    — landed on the clipboard (no share sheet, or it failed)
 *   cancelled — the user dismissed the share sheet
 *   failed    — neither channel worked
 */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

/**
 * Write to the clipboard, falling back to execCommand.
 * The async Clipboard API is missing or rejects in insecure contexts and in
 * some in-app browsers, and every copy site used to inline this same fallback.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return false

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Blocked or unavailable — try the legacy path below.
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/**
 * Share text via the native sheet, falling back to the clipboard.
 * Only a user cancel (AbortError) skips the clipboard — any other share
 * failure (permissions policy, share-in-progress) still lands there.
 */
export async function shareOrCopyText(text: string): Promise<ShareOutcome> {
  if (typeof navigator === 'undefined') return 'failed'

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text })
      return 'shared'
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled'
      // Non-cancel share failure — fall through to the clipboard.
    }
  }

  return (await writeClipboardText(text)) ? 'copied' : 'failed'
}
