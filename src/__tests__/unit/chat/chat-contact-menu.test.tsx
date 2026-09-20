import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatContactMenu } from '@/ui/screens/Chat/ChatContactMenu'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('chat contact menu', () => {
  it('shows edit only after opening the menu and supports Escape', () => {
    const onContact = vi.fn()
    render(<ChatContactMenu known onContact={onContact} />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: 'chat.actions' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(
      screen.getByRole('menuitem', { name: 'contacts.editContact' })
    ).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem'))
    expect(onContact).toHaveBeenCalledOnce()
  })
  it('offers add for an unknown sender and dismisses on outside pointer down', () => {
    render(<ChatContactMenu known={false} onContact={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'chat.actions' }))
    expect(
      screen.getByRole('menuitem', { name: 'contacts.addContact' })
    ).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

it('supports arrow navigation through conversation actions and refreshed toggle labels', () => {
  const select = vi.fn()
  const actions = [
    { key: 'pin', label: 'chat.pin', icon: <span />, onSelect: select },
  ]
  const { rerender } = render(
    <ChatContactMenu known onContact={vi.fn()} actions={actions} />
  )
  fireEvent.click(screen.getByRole('button', { name: 'chat.actions' }))
  fireEvent.keyDown(
    screen.getByRole('menuitem', { name: 'contacts.editContact' }),
    { key: 'ArrowDown' }
  )
  expect(screen.getByRole('menuitem', { name: 'chat.pin' })).toHaveFocus()
  fireEvent.click(screen.getByRole('menuitem', { name: 'chat.pin' }))
  expect(select).toHaveBeenCalledOnce()
  rerender(
    <ChatContactMenu
      known
      onContact={vi.fn()}
      actions={[{ ...actions[0], label: 'chat.unpin' }]}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'chat.actions' }))
  expect(
    screen.getByRole('menuitem', { name: 'chat.unpin' })
  ).toBeInTheDocument()
})
