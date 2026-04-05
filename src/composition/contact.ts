/**
 * Composition root for ContactUseCase
 */

import { ContactService } from '@/core/services/contact.service'
import type { ContactUseCase } from '@/core/ports/driving/contact.usecase'
import type { ContactRepository } from '@/core/ports/driven/contact.repository.port'

export function createContactService(
  contactRepo: ContactRepository,
): ContactUseCase {
  return new ContactService(contactRepo)
}
