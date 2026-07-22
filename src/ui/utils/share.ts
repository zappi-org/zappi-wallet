/**
 * Share text via the native sheet, falling back to the clipboard.
 * Only a user cancel (AbortError) is silent — any other share failure
 * (permissions policy, share-in-progress) still lands on the clipboard.
 */
export async function shareOrCopyText(
  text: string,
  onCopied?: () => void,
): Promise<void> {
  if (typeof navigator === 'undefined') return

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text })
      return
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      // Non-cancel share failure — fall through to the clipboard.
    }
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      onCopied?.()
    }
  } catch {
    // Clipboard blocked — silent.
  }
}
