import { ConsoleLogger } from '@cashu/coco-core'

export const cocoLogger = new ConsoleLogger('coco', {
  level: import.meta.env.DEV ? 'info' : 'error',
})
