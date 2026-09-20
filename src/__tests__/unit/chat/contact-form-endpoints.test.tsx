import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { nip19 } from 'nostr-tools'
import { ContactFormModal } from '@/ui/screens/Contacts/ContactFormModal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/ui/navigation/use-is-activity-top', () => ({
  useIsActivityTop: () => true,
}))
vi.mock('@/ui/hooks/use-chat-viewport', () => ({
  useChatViewport: () => undefined,
}))
vi.mock('@/ui/components/common', () => ({
  Modal: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) =>
    isOpen ? <div>{children}</div> : null,
}))
vi.mock('@/ui/components/common/QrScannerModal', () => ({
  QrScannerModal: () => null,
}))
const resolve = vi.fn().mockResolvedValue({ capabilities: {} })
vi.mock('@/ui/hooks/use-service-registry', () => ({
  useServiceRegistry: () => ({ addressResolver: { resolve } }),
}))
const chatAddress = nip19.npubEncode('b'.repeat(64))

describe('contact form endpoints', () => {
  it('saves an incoming chat identity as one shared address', async () => {
    const save = vi.fn()
    render(
      <ContactFormModal
        isOpen
        onClose={vi.fn()}
        onSave={save}
        initialAddress={chatAddress}
      />
    )
    expect(
      screen.getByRole('textbox', { name: 'contacts.address' })
    ).toHaveValue(chatAddress)
    fireEvent.change(
      screen.getByPlaceholderText('contacts.namePlaceholder'),
      {
        target: { value: 'Alice' },
      }
    )
    fireEvent.click(screen.getByRole('button', { name: 'common.add' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        name: 'Alice',
        address: chatAddress,
      })
    )
    expect(resolve).not.toHaveBeenCalled()
  })
  it('rejects an invalid Nostr address', async () => {
    const save = vi.fn()
    render(<ContactFormModal isOpen onClose={vi.fn()} onSave={save} />)
    fireEvent.change(
      screen.getByPlaceholderText('contacts.namePlaceholder'),
      {
        target: { value: 'Alice' },
      }
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'contacts.address' }),
      { target: { value: 'npub1invalid' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'common.add' }))
    expect(
      await screen.findByText('contacts.verify.invalidNpub')
    ).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
  })
})
