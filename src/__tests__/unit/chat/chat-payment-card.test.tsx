import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ChatPaymentCard } from '@/ui/screens/Chat/ChatPaymentCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
    i18n: { language: 'en' },
  }),
}))

describe('chat payment card', () => {
  it('presents incoming notices without claiming receipt or offering receive', () => {
    render(
      <ChatPaymentCard
        kind="send"
        amount={1200}
        outgoing={false}
        status="notice"
      />
    )
    expect(screen.getByRole('heading')).toHaveTextContent(
      'chat.paymentCard.noticeTitle'
    )
    expect(screen.getByText('1,200')).toBeInTheDocument()
    expect(screen.getByText('chat.paymentCard.notice')).toBeInTheDocument()
    expect(
      screen.queryByText('chat.paymentCard.received')
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it.each([
    ['pending', 'processing', 'receiving'],
    ['settled', 'sent', 'received'],
    ['failed', 'failed', 'receiveFailed'],
    ['notice', 'checkingPayment', 'notice'],
    ['unknown', 'checkingPayment', 'notice'],
    ['unclaimed', 'awaitingReceipt', 'notice'],
    ['cancelled', 'cancelled', 'cancelled'],
    ['expired', 'expired', 'expired'],
  ] as const)('uses viewer-relative payment text for %s', (status, sentKey, receivedKey) => {
    const view = render(<ChatPaymentCard kind="send" outgoing status={status} peerName="Alex" />)
    expect(screen.getByRole('heading')).toHaveTextContent('chat.paymentCard.paymentTo:Alex')
    expect(screen.getByText(`chat.paymentCard.${sentKey}`)).toBeInTheDocument()
    view.rerender(<ChatPaymentCard kind="send" outgoing={false} status={status} peerName="Alex" />)
    expect(screen.getByRole('heading')).toHaveTextContent('chat.paymentCard.paymentFrom:Alex')
    expect(screen.getByText(`chat.paymentCard.${receivedKey}`)).toBeInTheDocument()
  })
  it.each(['unknown', 'pending', 'settled', 'unclaimed'] as const)(
    'keeps the original request perspective for %s',
    (status) => {
      const view = render(<ChatPaymentCard kind="request" outgoing status={status} />)
      expect(screen.getByText('chat.paymentCard.requested')).toBeInTheDocument()
      view.rerender(<ChatPaymentCard kind="request" outgoing={false} status={status} />)
      expect(screen.getByText('chat.paymentCard.receivedRequest')).toBeInTheDocument()
    }
  )
  it('keeps an explicit payment memo without adding a notice explanation', () => {
    render(
      <ChatPaymentCard
        kind="send"
        amount={1200}
        outgoing={false}
        status="notice"
        description="Dinner"
      />
    )
    expect(screen.getByText('Dinner')).toBeInTheDocument()
    expect(screen.getByRole('region').querySelectorAll('p')).toHaveLength(3)
  })
  it('describes an incoming unpaid request from the recipient perspective', () => {
    render(
      <ChatPaymentCard
        kind="request"
        outgoing={false}
        status="unknown"
        onPay={vi.fn()}
      />
    )
    expect(
      screen.getByText('chat.paymentCard.receivedRequest')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('chat.paymentCard.processing')
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'chat.paymentCard.pay' })).toBeEnabled()
  })
  it.each([
    ['request', true, 'requestTo'],
    ['request', false, 'requestFrom'],
    ['send', true, 'paymentTo'],
    ['send', false, 'paymentFrom'],
  ] as const)(
    'identifies the peer for %s outgoing=%s',
    (kind, outgoing, key) => {
      render(
        <ChatPaymentCard
          kind={kind}
          outgoing={outgoing}
          peerName="Alex"
          status="notice"
        />
      )
      expect(screen.getByRole('heading')).toHaveTextContent(
        `chat.paymentCard.${key}:Alex`
      )
    }
  )
  it.each(['settled', 'unclaimed'] as const)('keeps a %s request unchanged and explains repeat sends even after expiry', (status) => {
    const onPay = vi.fn()
    render(<ChatPaymentCard kind="request" amount={1200} outgoing={false} status={status} expiresAt={Date.now() - 1} onPay={onPay} />)
    expect(screen.getByText('chat.paymentCard.receivedRequest')).toBeInTheDocument()
    expect(screen.queryByText('chat.paymentCard.expired')).not.toBeInTheDocument()
    const send = screen.getByRole('button', { name: 'chat.paymentCard.pay' })
    fireEvent.click(send)
    expect(screen.getByRole('dialog')).toHaveTextContent('1,200 sat')
    expect(screen.getByText('chat.paymentCard.alreadySent')).toBeInTheDocument()
    expect(onPay).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(send).toHaveFocus()
  })
  it('preserves request text when its payment settles and blocks another send', () => {
    const onPay = vi.fn()
    const view = render(<ChatPaymentCard kind="request" amount={1200} outgoing={false} status="unknown" onPay={onPay} />)
    const card = screen.getByRole('region')
    const initialText = card.textContent
    view.rerender(<ChatPaymentCard kind="request" amount={1200} outgoing={false} status="settled" onPay={onPay} />)
    expect(screen.getByRole('region')).toBe(card)
    expect(card.textContent).toBe(initialText)
    fireEvent.click(screen.getByRole('button', { name: 'chat.paymentCard.pay' }))
    expect(screen.getByText('chat.paymentCard.alreadySent')).toBeInTheDocument()
    expect(onPay).not.toHaveBeenCalled()
  })
  it('blocks repeat taps while opening payment and shows recoverable failure', async () => {
    let reject!: () => void
    const pay = vi.fn(
      () =>
        new Promise<void>((_resolve, rejectPromise) => {
          reject = () => rejectPromise(new Error('offline'))
        })
    )
    render(
      <ChatPaymentCard
        kind="request"
        outgoing={false}
        status="pending"
        onPay={pay}
      />
    )
    const button = screen.getByRole('button', { name: 'chat.paymentCard.pay' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(pay).toHaveBeenCalledOnce()
    expect(button).toBeDisabled()
    await act(async () => {
      reject()
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'chat.paymentCard.openFailed'
    )
    expect(button).not.toBeDisabled()
  })
  it.each(['failed', 'expired', 'cancelled'] as const)(
    'does not offer payment for %s requests',
    (status) => {
      render(
        <ChatPaymentCard
          kind="request"
          outgoing={false}
          status={status}
          onPay={vi.fn()}
        />
      )
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    }
  )
  it('keeps an own request unchanged and leaves details to the separate receipt', () => {
    const details = vi.fn()
    render(<ChatPaymentCard kind="request" outgoing status="settled" onPay={vi.fn()} onDetails={details} />)
    expect(screen.getByText('chat.paymentCard.requested')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(details).not.toHaveBeenCalled()
  })
  it.each([true, false])('shows transaction details only on a settled send card outgoing=%s', (outgoing) => {
    const details = vi.fn()
    render(<ChatPaymentCard kind="send" outgoing={outgoing} status="settled" onDetails={details} />)
    expect(screen.getByText(`chat.paymentCard.${outgoing ? 'sent' : 'received'}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'chat.paymentCard.details' }))
    expect(details).toHaveBeenCalledOnce()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
  it('hides expired request action and handles unknown amount safely', () => {
    render(
      <ChatPaymentCard
        kind="request"
        amount={NaN}
        outgoing={false}
        status="pending"
        expiresAt={Date.now() - 1}
        onPay={vi.fn()}
      />
    )
    expect(screen.getByText('chat.paymentCard.openAmount')).toBeInTheDocument()
    expect(screen.getByText('chat.paymentCard.expired')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

it('expires an open request card without another message or rerender', () => {
  vi.useFakeTimers()
  vi.setSystemTime(2_000_000_000_000)
  const onPay = vi.fn()
  const view = render(
    <ChatPaymentCard
      kind="request"
      amount={10}
      outgoing={false}
      status="unknown"
      expiresAt={Date.now() + 1000}
      onPay={onPay}
    />
  )
  try {
    expect(
      screen.getByRole('button', { name: 'chat.paymentCard.pay' })
    ).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('chat.paymentCard.expired')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(onPay).not.toHaveBeenCalled()
  } finally {
    view.unmount()
    vi.useRealTimers()
  }
})

it('rechecks expiry on click when background timers have not run', () => {
  vi.useFakeTimers()
  vi.setSystemTime(2_000_000_000_000)
  const onPay = vi.fn()
  const view = render(
    <ChatPaymentCard
      kind="request"
      amount={10}
      outgoing={false}
      status="unknown"
      expiresAt={Date.now() + 1000}
      onPay={onPay}
    />
  )
  try {
    const button = screen.getByRole('button', { name: 'chat.paymentCard.pay' })
    vi.setSystemTime(Date.now() + 2000)
    fireEvent.click(button)
    expect(onPay).not.toHaveBeenCalled()
    expect(screen.getByText('chat.paymentCard.expired')).toBeInTheDocument()
  } finally {
    view.unmount()
    vi.useRealTimers()
  }
})

it('shows the requester waiting for incoming money', () => {
  render(<ChatPaymentCard kind="request" outgoing status="pending" />)
  expect(
    screen.getByText('chat.paymentCard.requested')
  ).toBeInTheDocument()
  expect(
    screen.queryByText('chat.paymentCard.processing')
  ).not.toBeInTheDocument()
})

it.each([false, true])('keeps a submitted processing request unchanged after expiry, outgoing=%s', (outgoing) => {
  const onPay = vi.fn()
  render(<ChatPaymentCard kind="request" amount={10} outgoing={outgoing} status="pending" paymentSubmitted expiresAt={Date.now() - 1000} onPay={onPay} />)
  expect(screen.getByText(`chat.paymentCard.${outgoing ? 'requested' : 'receivedRequest'}`)).toBeInTheDocument()
  expect(screen.queryByText('chat.paymentCard.expired')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'chat.paymentCard.details' })).not.toBeInTheDocument()
  if (!outgoing) {
    fireEvent.click(screen.getByRole('button', { name: 'chat.paymentCard.pay' }))
    expect(screen.getByText('chat.paymentCard.alreadySent')).toBeInTheDocument()
    expect(onPay).not.toHaveBeenCalled()
  } else {
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  }
})
