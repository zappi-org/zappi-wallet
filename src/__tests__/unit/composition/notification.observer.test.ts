import { describe, expect, it } from 'vitest'
import {
  connectServiceWorkerMessages,
  shouldNotifyWithWalletSetting,
} from '@/composition/notification.observer'
import { useAppStore } from '@/store'
import { createPushGatewayMock } from '@/__tests__/helpers/push.mock'

describe('shouldNotifyWithWalletSetting', () => {
  it('hides while visible by default and yields when the setting is off', () => {
    expect(shouldNotifyWithWalletSetting()).toBe(false)
    useAppStore.setState((state) => ({
      settings: { ...state.settings, hideNotificationInForeground: false },
    }))
    expect(shouldNotifyWithWalletSetting()).toBe(true)
    useAppStore.setState((state) => ({
      settings: { ...state.settings, hideNotificationInForeground: true },
    }))
  })
})

describe('connectServiceWorkerMessages', () => {
  it.each([
    ['shows neutral wording when allowed', true, 'hint'],
    ['skips when suppressed', false, undefined],
  ])('%s', (_name, notify, expected) => {
    const target = new EventTarget()
    const gateway = createPushGatewayMock()
    connectServiceWorkerMessages(target, gateway, {
      shouldNotify: () => notify,
      hintText: () => 'hint',
    })

    target.dispatchEvent(new MessageEvent('message', { data: { type: 'zappi-push' } }))

    if (expected) expect(gateway.notifyIncoming).toHaveBeenCalledWith(expected)
    else expect(gateway.notifyIncoming).not.toHaveBeenCalled()
  })

  it('ignores unrelated messages and stops on disconnect', () => {
    const target = new EventTarget()
    const gateway = createPushGatewayMock()
    const disconnect = connectServiceWorkerMessages(target, gateway, { hintText: () => 'hint' })

    target.dispatchEvent(new MessageEvent('message', { data: { type: 'other' } }))
    expect(gateway.notifyIncoming).not.toHaveBeenCalled()

    target.dispatchEvent(new MessageEvent('message', { data: { type: 'zappi-push' } }))
    disconnect()
    target.dispatchEvent(new MessageEvent('message', { data: { type: 'zappi-push' } }))
    expect(gateway.notifyIncoming).toHaveBeenCalledTimes(1)
  })
})
