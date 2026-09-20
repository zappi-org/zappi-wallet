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
  it('shows an unpaid request as awaiting payment rather than an instruction', () => {
    render(
      <ChatPaymentCard
        kind="request"
        outgoing={false}
        status="unknown"
        onPay={vi.fn()}
      />
    )
    expect(
      screen.getByText('chat.paymentCard.awaitingPayment')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('chat.paymentCard.processing')
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'chat.sendMoney' })).toBeEnabled()
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
  it('keeps a submitted payment awaiting receipt after request expiry without offering another send', () => {
    render(
      <ChatPaymentCard
        kind="request"
        outgoing={false}
        status="unclaimed"
        expiresAt={Date.now() - 1}
        onPay={vi.fn()}
      />
    )
    expect(
      screen.getByText('chat.paymentCard.awaitingReceipt')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('chat.paymentCard.expired')
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
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
    const button = screen.getByRole('button', { name: 'chat.sendMoney' })
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
  it.each(['settled', 'failed', 'expired', 'cancelled', 'unclaimed'] as const)(
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
  it('shows details when locally linked and does not offer payment for own request', () => {
    const details = vi.fn()
    render(
      <ChatPaymentCard
        kind="request"
        outgoing
        status="settled"
        onPay={vi.fn()}
        onDetails={details}
      />
    )
    expect(screen.getByText('chat.paymentCard.received')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'chat.paymentCard.details' })
    )
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
      screen.getByRole('button', { name: 'chat.sendMoney' })
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
    const button = screen.getByRole('button', { name: 'chat.sendMoney' })
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
    screen.getByText('chat.paymentCard.awaitingIncoming')
  ).toBeInTheDocument()
  expect(
    screen.queryByText('chat.paymentCard.processing')
  ).not.toBeInTheDocument()
})

it.each([
  ['settled', 'paid'],
  ['failed', 'failed'],
  ['cancelled', 'cancelled'],
  ['unclaimed', 'awaitingReceipt'],
] as const)('preserves %s after the request deadline', (status, label) => {
  render(
    <ChatPaymentCard
      kind="request"
      outgoing={false}
      status={status}
      expiresAt={Date.now() - 1000}
      onPay={vi.fn()}
      onDetails={vi.fn()}
    />
  )
  expect(screen.getByText(`chat.paymentCard.${label}`)).toBeInTheDocument()
  expect(screen.queryByText('chat.paymentCard.expired')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'chat.sendMoney' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'chat.paymentCard.details' })
  ).toBeEnabled()
  expect(screen.queryByText('chat.paymentCard.expires')).not.toBeInTheDocument()
})

it.each([false, true])(
  'preserves a processing transaction after expiry, outgoing=%s',
  (outgoing) => {
    render(
      <ChatPaymentCard
        kind="request"
        outgoing={outgoing}
        status="pending"
        expiresAt={Date.now() - 1000}
        onPay={vi.fn()}
        onDetails={vi.fn()}
      />
    )
    expect(screen.getByText('chat.paymentCard.processing')).toBeInTheDocument()
    expect(
      screen.queryByText('chat.paymentCard.expired')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'chat.sendMoney' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'chat.paymentCard.details' })
    ).toBeEnabled()
  }
)
