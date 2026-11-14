// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'

const key = 'xiumi:auto-input-suggestions'
const load = () => import('../../src/editor/suggestionPreference')
beforeEach(() => { vi.resetModules(); localStorage.clear() })
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

it.each([null, 'off', '', 'true', 'unexpected'])('defaults off without an explicit on preference (%s)', async (stored) => {
  if (stored !== null) localStorage.setItem(key, stored)
  expect((await load()).readSuggestionPreference()).toBe(false)
})
it('restores an explicit opt-in from storage', async () => {
  localStorage.setItem(key, 'on')
  expect((await load()).readSuggestionPreference()).toBe(true)
})
it('defaults off when storage cannot be read', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage blocked') })
  expect((await load()).readSuggestionPreference()).toBe(false)
})
it('persists explicit opt-in and opt-out across panel and page remounts', async () => {
  const preference = await load()
  preference.saveSuggestionPreference(true)
  expect(preference.readSuggestionPreference()).toBe(true)
  expect(localStorage.getItem(key)).toBe('on')
  vi.resetModules()
  const remounted = await load()
  expect(remounted.readSuggestionPreference()).toBe(true)
  remounted.saveSuggestionPreference(false)
  expect(localStorage.getItem(key)).toBe('off')
  vi.resetModules()
  expect((await load()).readSuggestionPreference()).toBe(false)
})
it('keeps explicit page choices across panel remounts when persistence fails', async () => {
  localStorage.setItem(key, 'off')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage blocked') })
  const preference = await load()
  preference.saveSuggestionPreference(true)
  expect(preference.readSuggestionPreference()).toBe(true)
  preference.saveSuggestionPreference(false)
  expect(preference.readSuggestionPreference()).toBe(false)
})
it('does not restore a previously stored opt-in after an unsaved opt-out', async () => {
  localStorage.setItem(key, 'on')
  const preference = await load()
  expect(preference.readSuggestionPreference()).toBe(true)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage blocked') })
  preference.saveSuggestionPreference(false)
  expect(preference.readSuggestionPreference()).toBe(false)
})
