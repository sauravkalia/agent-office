import { expect, mock, test } from 'claude-code/testing'

import { SESSION, classify, decide, targetOf } from '../hooks/supervisor-core'
import type { SupervisorConfig } from '../hooks/supervisor-core'

const cfg: SupervisorConfig = { lightModel: 'claude-haiku-4-5', standardModel: 'session', heavyModel: 'claude-opus-5-5', lightEffort: 'low', heavyEffort: 'high' }
const tiers: SupervisorConfig = { ...cfg, lightModel: 'claude-haiku-5-5', standardModel: 'claude-sonnet-5-5' }
const opus = { model: 'claude-opus-5-5[1m]', effort: 'medium' as const }
const sonnet = { model: 'claude-sonnet-5-5', effort: 'high' as const }

// ---------------------------------------------------------------- classify

test('prompts sort into light, standard and heavy by their words alone', () => {
  expect(classify('what does parseConfig return?').tier).toBe('light')
  expect(classify('list the files in hooks').tier).toBe('light')
  expect(classify('add a --json flag to the export command').tier).toBe('standard')
  expect(classify('refactor the auth module to use the new session store').tier).toBe('heavy')
  expect(classify('why does the build fail on CI but not locally?').tier).toBe('heavy')
  expect(classify('what is this?\n```\nTypeError: x is undefined\n```').tier).toBe('heavy')
  expect(classify('x'.repeat(900)).tier).toBe('heavy')
  expect(classify('what does this do', { isPlanMode: true }).tier).toBe('heavy')
  // A go-ahead after a plan must not drop the task to Haiku.
  expect(classify('yes, do it').tier).toBe('continue')
  expect(classify('ok').tier).toBe('continue')
})

// ---------------------------------------------------------------- decide

test('the session family keeps its own id, so its cache and [1m] survive', () => {
  expect(targetOf('heavy', opus, cfg)).toEqual({ model: null, effort: 'high' })
  expect(targetOf('light', opus, cfg)).toEqual({ model: 'claude-haiku-4-5', effort: 'low' })
  expect(targetOf('standard', opus, cfg)).toEqual(SESSION)
})

test('early in a session a quick question moves to Haiku: the re-cache is cheap', () => {
  const d = decide({ tier: 'light', current: SESSION, base: opus, ctxTokens: 4_000, isCacheWarm: true, isPinned: false, cfg })
  expect(d.isSwitch).toBe(true)
  expect(d.next).toEqual({ model: 'claude-haiku-4-5', effort: 'low' })
  expect(d.note).toMatch(/→ Haiku 4\.5 · saves ~\$/)
  expect(d.savingUsd).toBeGreaterThan(0)
})

test('deep into a session the supervisor keeps the warm cache rather than re-cache it', () => {
  const d = decide({ tier: 'light', current: SESSION, base: opus, ctxTokens: 150_000, isCacheWarm: true, isPinned: false, cfg })
  expect(d.isSwitch).toBe(false)
  expect(d.next).toEqual(SESSION)
  expect(d.note).toMatch(/^kept Opus 5\.5 1M: switching re-caches 150k/)
})

test('context that will not fit the light model keeps the current one', () => {
  const d = decide({ tier: 'light', current: SESSION, base: opus, ctxTokens: 190_000, isCacheWarm: false, isPinned: true, cfg })
  expect(d.isSwitch).toBe(false)
  expect(d.note).toMatch(/won't fit Haiku/)
})

test('an upgrade is taken for quality even when it costs a re-cache; a pin always switches', () => {
  const up = decide({ tier: 'heavy', current: { model: 'claude-haiku-4-5', effort: 'low' }, base: sonnet, ctxTokens: 80_000, isCacheWarm: true, isPinned: false, cfg })
  expect(up.isSwitch).toBe(true)
  expect(up.next).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  expect(up.note).toMatch(/re-cache ~\$/)
  const pinned = decide({ tier: 'light', current: SESSION, base: opus, ctxTokens: 150_000, isCacheWarm: true, isPinned: true, cfg })
  expect(pinned.isSwitch).toBe(true)
})

test('three tiers: everyday prompts go to the standard model, heavy ones back to the session Opus', () => {
  expect(targetOf('standard', opus, tiers)).toEqual({ model: 'claude-sonnet-5-5', effort: null })
  expect(targetOf('standard', sonnet, tiers)).toEqual(SESSION)
  expect(targetOf('heavy', opus, tiers)).toEqual({ model: null, effort: 'high' })
  expect(targetOf('standard', opus, { ...tiers, standardModel: 'session' })).toEqual(SESSION)
})

test('Haiku 5.5 is cheap enough that a quick question moves even with Claude Code\'s ~57k of context warm', () => {
  const d = decide({ tier: 'light', current: SESSION, base: opus, ctxTokens: 57_000, isCacheWarm: true, isPinned: false, cfg: tiers })
  expect(d.isSwitch).toBe(true)
  expect(d.next).toEqual({ model: 'claude-haiku-5-5', effort: 'low' })
  // Haiku 4.5 at ten times the price is not worth the re-cache there.
  expect(decide({ tier: 'light', current: SESSION, base: opus, ctxTokens: 57_000, isCacheWarm: true, isPinned: false, cfg }).isSwitch).toBe(false)
})

test('going back to a model whose cache is still warm writes only what is new', () => {
  const onOpusHigh = { model: null, effort: 'high' as const }
  const cold = decide({ tier: 'standard', current: onOpusHigh, base: opus, ctxTokens: 80_000, isCacheWarm: true, isPinned: false, cfg: tiers })
  expect(cold.isSwitch).toBe(false)
  const warm = decide({ tier: 'standard', current: onOpusHigh, base: opus, ctxTokens: 80_000, isCacheWarm: true, isPinned: false, cfg: tiers, cached: { 'claude-sonnet-5-5|medium': 78_000 } })
  expect(warm.isSwitch).toBe(true)
  expect(warm.next).toEqual({ model: 'claude-sonnet-5-5', effort: null })
})

test('no change, no switch', () => {
  const d = decide({ tier: 'standard', current: SESSION, base: opus, ctxTokens: 50_000, isCacheWarm: true, isPinned: false, cfg })
  expect(d.isSwitch).toBe(false)
  expect(d.note).toMatch(/^stays on Opus/)
})

// ---------------------------------------------------------------- in a session

test('a quick question runs on Haiku; the next heavy one goes back up to Opus', async ($, on) => {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  const seen: { model: string; effort?: unknown }[] = []
  on('turn.step', async function* (_$, e) {
    seen.push({ model: e.model, effort: e.effort })
    const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: e.model }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const step = async (turnId: string) => {
    const s = $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })
    for await (const _ of s) void _
    await s.result
  }
  await $.turn.start({ text: 'what does parseConfig return?', turnId: 'R1' })
  await step('R1')
  await step('R1')
  await $.turn.start({ text: 'refactor the config parser into its own module', turnId: 'R2' })
  await step('R2')
  expect(seen).toEqual([
    { model: 'claude-haiku-5-5', effort: 'low' },
    { model: 'claude-haiku-5-5', effort: 'low' },
    { model: 'claude-opus-5-5', effort: 'high' },
  ])
  const out = await $.command.run({ command: 'office', args: 'route', origin: { kind: 'user' } } as never)
  expect(JSON.stringify(out)).toContain('Switches this session | 2')
})

test('an everyday task runs on Sonnet between a quick question and a heavy one', async ($, on) => {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  const seen: string[] = []
  on('turn.step', async function* (_$, e) {
    seen.push(e.model)
    const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: e.model }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  for (const [turnId, text] of [['T1', 'what does parseConfig return?'], ['T2', 'add a --json flag to the export command'], ['T3', 'refactor the config parser into its own module']] as const) {
    await $.turn.start({ text, turnId })
    const s = $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })
    for await (const _ of s) void _
    await s.result
  }
  expect(seen).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])
})

test('routing off leaves every step on the session model', { options: { routing: 'off' } }, async ($, on) => {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  const seen: { model: string; effort?: unknown }[] = []
  on('turn.step', async function* (_$, e) {
    seen.push({ model: e.model, effort: e.effort })
    const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: e.model }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const step = async (turnId: string) => {
    const s = $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })
    for await (const _ of s) void _
    await s.result
  }
  await $.turn.start({ text: 'what does parseConfig return?', turnId: 'R3' })
  await step('R3')
  expect(seen).toEqual([{ model: 'claude-opus-5-5', effort: 'medium' }])
})

test("the office header shows the supervisor's last call", async ($, on) => {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: e.model }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  await $.turn.start({ text: 'list the files in hooks', turnId: 'V1' })
  const s = $.turn.step({ turnId: 'V1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })
  for await (const _ of s) void _
  await s.result
  const ui = await $.ui.mount({
    plugin: 'agent-office',
    component: 'Pane' as const,
    requestId: 'agent-office',
    props: { title: 'Agent Office', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 70 }, view: {} },
    surface: 'terminal',
  })
  expect(await ui.find({ text: /light \(quick question\) → Haiku 5\.5/ })).toBeDefined()
  expect(await ui.find({ text: /Haiku 5\.5 · main/ })).toBeDefined()
  await ui.unmount()
})
