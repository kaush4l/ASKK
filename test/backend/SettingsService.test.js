import { describe, expect, test } from 'bun:test'
import { MemoryRepository } from '../../src/backend/repositories/MemoryRepository.js'
import { DEFAULT_SETTINGS, SettingsService } from '../../src/backend/services/SettingsService.js'

/**
 * The one screen a person has to get right before this app can answer anything,
 * and it had no test file at all.
 *
 * `save` corrects rather than refuses, which is the whole design: a rejected
 * save loses every other edit made in the same form, so an unusable field is
 * replaced with something that works and the correction is reported. That
 * contract is only worth anything if the corrections are the ones a person can
 * act on, and if what comes BACK is what was actually kept — the form redraws
 * from the returned record, so a value silently retained here is a form lying
 * about the configuration it is running under.
 */
const service = () => new SettingsService(new MemoryRepository('settings'))

describe('reading settings', () => {
  test('a store with nothing in it answers with every default', async () => {
    const read = await service().get()
    expect(read.ok).toBe(true)
    expect(read.value).toEqual({ ...DEFAULT_SETTINGS })
  })

  test('a record written before a field existed still answers for that field', async () => {
    // The reason `get` merges rather than replaces. Every field added since a
    // person last saved would otherwise come back undefined, and the fields
    // added most recently are the ones with no form history at all.
    const repository = new MemoryRepository('settings')
    repository.rows.set(DEFAULT_SETTINGS.id, { id: DEFAULT_SETTINGS.id, model: 'an old choice' })
    const read = await new SettingsService(repository).get()

    expect(read.value.model).toBe('an old choice')
    expect(read.value.ttsRate).toBe(DEFAULT_SETTINGS.ttsRate)
    expect(read.value.sttDevice).toBe(DEFAULT_SETTINGS.sttDevice)
  })
})

describe('saving settings', () => {
  test('what comes back is what was kept, and the corrections say so', async () => {
    const saved = await service().save({ ...DEFAULT_SETTINGS, model: '   ', temperature: 9 })

    expect(saved.ok).toBe(true)
    expect(saved.value.model).toBe(DEFAULT_SETTINGS.model)
    expect(saved.value.temperature).toBe(DEFAULT_SETTINGS.temperature)
    expect(saved.notes.join(' ')).toContain('model was empty')
    expect(saved.notes.join(' ')).toContain('temperature')
  })

  test('a speed and a pitch outside what the browser accepts are clamped, not passed on', async () => {
    // Web Speech ignores an utterance whose rate is out of range and says
    // nothing, so a value passed through here would be a reply that is simply
    // never read aloud with no error anywhere.
    const saved = await service().save({ ...DEFAULT_SETTINGS, ttsRate: 40, ttsPitch: -3 })

    expect(saved.value.ttsRate).toBe(DEFAULT_SETTINGS.ttsRate)
    expect(saved.value.ttsPitch).toBe(DEFAULT_SETTINGS.ttsPitch)
    expect(saved.notes.join(' ')).toContain('ttsRate')
    expect(saved.notes.join(' ')).toContain('ttsPitch')
  })

  test('a rate inside the range is kept as a number', async () => {
    const saved = await service().save({ ...DEFAULT_SETTINGS, ttsRate: '1.4' })
    expect(saved.value.ttsRate).toBe(1.4)
    expect(saved.notes.join(' ')).not.toContain('ttsRate')
  })

  test('a backend or a precision this build cannot run is corrected at the save', async () => {
    // Not at the download. `pipeline(...)` with an unknown device fails minutes
    // in, after the weights have arrived, and reports it as a model that could
    // not be built rather than as a setting nobody can fulfil.
    const saved = await service().save({
      ...DEFAULT_SETTINGS,
      sttDevice: 'cuda',
      sttDtype: 'bf16',
    })

    expect(saved.value.sttDevice).toBe('wasm')
    expect(saved.value.sttDtype).toBe('fp32')
    expect(saved.notes.join(' ')).toContain('cuda')
    expect(saved.notes.join(' ')).toContain('bf16')
  })

  test('an engine this build does not have is corrected and named', async () => {
    const saved = await service().save({ ...DEFAULT_SETTINGS, sttKind: 'lipreading' })
    expect(saved.value.sttKind).toBe(DEFAULT_SETTINGS.sttKind)
    expect(saved.notes.join(' ')).toContain('lipreading')
  })

  test('an empty model id is filled in with what that engine would fetch anyway', async () => {
    // A field showing nothing and a field showing the model it is about to
    // download are the same configuration, and only one of them can be checked
    // before it is slow.
    const saved = await service().save({ ...DEFAULT_SETTINGS, sttModel: '', ttsModel: '' })
    expect(saved.value.sttModel).toBe('onnx-community/whisper-base')

    // The browser's own voice stays empty and that is not the same omission:
    // it downloads nothing, so there is no model id to fill in. A form must
    // read this as "nothing to choose", never as "not filled in yet".
    expect(saved.value.ttsKind).toBe('native')
    expect(saved.value.ttsModel).toBe('')

    const local = await service().save({ ...DEFAULT_SETTINGS, ttsKind: 'vits', ttsModel: '' })
    expect(local.value.ttsModel.length).toBeGreaterThan(0)
  })

  test('a store that will not write still applies the settings to this session', async () => {
    const repository = new MemoryRepository('settings')
    repository.put = async () => ({ ok: false, failure: { message: 'the disk is full' } })
    const saved = await new SettingsService(repository).save({
      ...DEFAULT_SETTINGS,
      temperature: 0.2,
    })

    expect(saved.ok).toBe(true)
    expect(saved.value.temperature).toBe(0.2)
    expect(saved.notes.join(' ')).toContain('not saved for next time')
  })
})
