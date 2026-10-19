import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { PX_H, PX_W, base64, crc32, drawOffice, encodePng, pixelAt, roomOrigin, rowsFor, shirtOf, termShowsImages } from '../hooks/pixel-core'
import type { Person } from '../types'

const person = (id: string, name: string, zone: Person['zone'], mood: Person['mood'] = 'ok', isBoss = false): Person => ({ id, name, zone, mood, isBoss, quip: '' })

// ---------------------------------------------------------------- the frame

test('a frame is the office: 160×88, each room with its own accent strip', () => {
  const f = drawOffice([], new Map(), 0)
  expect([f.width, f.height, f.data.length]).toEqual([PX_W, PX_H, PX_W * PX_H * 4])
  expect(pixelAt(f, roomOrigin('desk').x + 2, 1)).toEqual([0x8e, 0xca, 0xe6])
  expect(pixelAt(f, roomOrigin('hr').x + 2, roomOrigin('hr').y + 1)).toEqual([0xf9, 0xc7, 0x4f])
})

test('people stand in their room; someone waiting has a ? above them; a walker is in the hallway', () => {
  const empty = drawOffice([], new Map(), 0)
  const f = drawOffice([person('a', 'Olu', 'hr', 'waiting'), person('b', 'Raj', 'desk')], new Map([['b', { from: 'desk' as const, to: 'workshop' as const, t: 0.5 }]]), 0)
  const hr = roomOrigin('hr')
  // The shirt of the person standing in HR.
  expect(pixelAt(f, hr.x + 4 + 2, hr.y + 38 - 13 + 5)).toEqual([...shirtOf('Olu')])
  // The amber question mark above their head.
  expect(pixelAt(f, hr.x + 4 + 3, hr.y + 38 - 13 - 6)).toEqual([0xf9, 0xc7, 0x4f])
  // Raj is halfway along the hallway, not at his desk.
  const hallChanged = Array.from({ length: PX_W }, (_, x) => x).some(x => pixelAt(f, x, 44).join() !== pixelAt(empty, x, 44).join())
  expect(hallChanged).toBe(true)
  expect(shirtOf('Olu')).toEqual(shirtOf('Olu'))
})

test('the picture keeps its shape in terminal cells', () => {
  expect(rowsFor(64)).toBe(17)
  expect(rowsFor(120)).toBe(31)
})

// ---------------------------------------------------------------- PNG and base64

test('frames encode as valid PNG: signature, IHDR size, chunk CRCs', () => {
  const png = encodePng(drawOffice([], new Map(), 0))
  expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(png.buffer, png.byteOffset)
  expect(view.getUint32(8)).toBe(13)
  expect(String.fromCharCode(...png.slice(12, 16))).toBe('IHDR')
  expect([view.getUint32(16), view.getUint32(20)]).toEqual([PX_W, PX_H])
  expect(view.getUint32(29)).toBe(crc32(png.slice(12, 29)))
  expect(String.fromCharCode(...png.slice(png.length - 8, png.length - 4))).toBe('IEND')
  expect(png.length).toBeLessThan(2 * 1024 * 1024)
})

test('base64 is standard and padded', () => {
  const enc = (s: string) => base64(Uint8Array.from(s, c => c.charCodeAt(0)))
  expect([enc('Man'), enc('Ma'), enc('M'), enc('')]).toEqual(['TWFu', 'TWE=', 'TQ==', ''])
})

test('which terminals show pictures', () => {
  expect(termShowsImages({ TERM_PROGRAM: 'ghostty' })).toBe(true)
  expect(termShowsImages({ TERM: 'xterm-kitty' })).toBe(true)
  expect(termShowsImages({ TERM_PROGRAM: 'WezTerm' })).toBe(true)
  expect(termShowsImages({ KITTY_WINDOW_ID: '1' })).toBe(true)
  expect(termShowsImages({ TERM_PROGRAM: 'ghostty', TMUX: '/tmp/tmux-1' })).toBe(false)
  expect(termShowsImages({ TERM_PROGRAM: 'Apple_Terminal' })).toBe(false)
  expect(termShowsImages({})).toBe(false)
})

// ---------------------------------------------------------------- in the pane

const pane = (surface: 'terminal' | 'desktop') => ({
  plugin: 'agent-office',
  component: 'Pane' as const,
  requestId: 'agent-office',
  surface,
  props: { title: 'Agent Office', isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 70 }, view: {} },
})

const setup = (on: On, env: Record<string, string>) => {
  const clock = mock.clock(on, { now: 1_000 })
  mock.env(on, env)
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: {} }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  return clock
}

test('pixel office in a terminal that shows pictures: an Image, and the caption in words', { options: { departments: '' } }, async ($, on) => {
  setup(on, { TERM_PROGRAM: 'ghostty' })
  await $.session.start({ cwd: '/u/me/proj', surface: 'terminal', isInteractive: true } as never)
  const out = await $.command.run({ command: 'office', args: 'pixel', origin: { kind: 'user' } } as never)
  expect(JSON.stringify(out)).toContain('Pixel office on')
  await $.turn.start({ text: 'go', turnId: 'P1' })
  await $.tool.call({ tool: 'WebSearch', query: 'pixel art' } as never)
  const ui = await $.ui.mount(pane('terminal'))
  const img = await ui.find({ type: 'Image', key: 'office-px' })
  expect(img).toBeDefined()
  expect(String((img?.props as { source?: { png?: string } })?.source?.png ?? '').startsWith('iVBORw0KGgo')).toBe(true)
  expect(await ui.find({ text: /Claude ▸ Warehouse: / })).toBeDefined()
  expect(await ui.find({ text: /^text ▸$/ })).toBeDefined()
  await ui.press({ key: 'style' })
  expect(await ui.find({ type: 'Image', key: 'office-px' })).toBeUndefined()
  await ui.unmount()
})

test('a terminal without pictures keeps the text office, unchanged', { options: { departments: '' } }, async ($, on) => {
  setup(on, { TERM_PROGRAM: 'Apple_Terminal' })
  await $.session.start({ cwd: '/u/me/proj', surface: 'terminal', isInteractive: true } as never)
  const out = await $.command.run({ command: 'office', args: 'pixel on', origin: { kind: 'user' } } as never)
  expect(JSON.stringify(out)).toContain("doesn't look like it shows pictures")
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ in: 'office', text: /Open Plan/ })).toBeDefined()
  await ui.unmount()
})

test('the desktop app shows the pixel office as an SVG', { options: { departments: '' } }, async ($, on) => {
  setup(on, {})
  await $.session.start({ cwd: '/u/me/proj', surface: 'terminal', isInteractive: true } as never)
  await $.command.run({ command: 'office', args: 'pixel on', origin: { kind: 'user' } } as never)
  const ui = await $.ui.mount(pane('desktop'))
  const svg = await ui.find({ type: 'Svg' })
  expect(String((svg?.props as { source?: string })?.source ?? '')).toContain('data:image/png;base64,iVBORw0KGgo')
  await ui.unmount()
})

test('officeStyle: pixel makes it the default', { options: { officeStyle: 'pixel', departments: '' } }, async ($, on) => {
  setup(on, { TERM: 'xterm-kitty' })
  await $.session.start({ cwd: '/u/me/proj', surface: 'terminal', isInteractive: true } as never)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Image', key: 'office-px' })).toBeDefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- the department office

const DEPTS = 'PR Review=pr-reviews: reviews | Sphere Dev=GitHub: Sphere code | Social=social-expert: posts'
const registry = [
  { sessionId: 'hq', name: 'hq-1', cwd: '/u/hq', status: 'busy', kind: 'interactive', updatedAt: 1 },
  { sessionId: 'pr', name: 'pr-1', cwd: '/u/pr-reviews', status: 'idle', kind: 'interactive', updatedAt: 1 },
  { sessionId: 'gh', name: 'github-1', cwd: '/u/GitHub', status: 'busy', kind: 'interactive', updatedAt: 1 },
]
const files = (statusZone: string): Record<string, string> => ({
  ...Object.fromEntries(registry.map((s, i) => [`/h/.claude/sessions/${i}.json`, JSON.stringify(s)])),
  '/h/.claude/agent-office/status/gh.json': JSON.stringify({ zone: statusZone, text: 'WebSearch → radar chart', isError: false, at: 1 }),
})
const deptSetup = (on: On, zone: string) => {
  setup(on, { TERM_PROGRAM: 'ghostty', HOME: '/h' })
  const fs = files(zone)
  on('session.id', () => ({ value: 'hq' }))
  on('fs.list', () => ({ value: registry.map((_, i) => ({ name: `${i}.json`, kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false })) }))
  on('fs.read', (_$, e) => {
    const v = fs[(e as { path: string }).path]
    return v === undefined ? { deny: 'missing' } : { value: v }
  })
  on('fs.stat', () => ({ deny: 'missing' }))
  on('fs.write', () => ({ value: undefined }))
}

test('the department office spans the whole pane; names live on the desks, not in a block below', { options: { departments: DEPTS, cellPx: '7x17' } }, async ($, on) => {
  deptSetup(on, 'warehouse')
  await $.session.start({ cwd: '/u/hq', surface: 'terminal', isInteractive: true } as never)
  await $.command.run({ command: 'office', args: 'departments', origin: { kind: 'user' } } as never)
  await $.command.run({ command: 'office', args: 'pixel on', origin: { kind: 'user' } } as never)
  for (const cols of [48, 74, 90]) {
    const ui = await $.ui.mount({ ...pane('terminal'), props: { ...pane('terminal').props, bodyColumns: cols } })
    const img = await ui.find({ type: 'Image', key: 'office-dept' })
    expect((img?.props as { columns?: number })?.columns).toBe(cols)
    expect(String((img?.props as { source?: { png?: string } })?.source?.png ?? '').startsWith('iVBORw0KGgo')).toBe(true)
    // No detached label rows: each desk carries its own plate in the picture.
    expect(await ui.find({ text: /^PR Review z idle/ })).toBeUndefined()
    // The picture is the org chart here; the text one isn't repeated above it.
    expect(await ui.find({ text: /HQ supervisor/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the work board under the office: the task, its repo, what the session is doing, and what waits', { options: { departments: 'PR Review=pr-reviews: reviews | Sphere Dev=GitHub: Sphere code (sphere-web, sphere-v3-web) | Social=social-expert: posts' } }, async ($, on) => {
  deptSetup(on, 'desk')
  await $.session.start({ cwd: '/u/hq', surface: 'terminal', isInteractive: true } as never)
  await $.command.run({ command: 'office', args: 'departments', origin: { kind: 'user' } } as never)
  await $.command.run({ command: 'office', args: 'pixel on', origin: { kind: 'user' } } as never)
  await $.turn.start({ text: 'fix it', turnId: 'D1' })
  await $.tool.call({ tool: 'SendMessage', to: 'github-1', message: 'Task from HQ: fix RadarChart in sphere-v3-web' } as never)
  await $.tool.call({ tool: 'SendMessage', to: 'github-1', message: 'Task from HQ: retitle #501 in sphere-web' } as never)
  const ui = await $.ui.mount({ ...pane('terminal'), props: { ...pane('terminal').props, bodyColumns: 72 } })
  expect(await ui.find({ text: /Sphere Dev/ })).toBeDefined()
  // The oldest task is the one being worked on; the session answers its messages in order.
  expect(await ui.find({ text: / · sphere-v3-web/ })).toBeDefined()
  expect(await ui.find({ text: /fix RadarChart in sphere-v3-web/ })).toBeDefined()
  expect(await ui.find({ text: /▸ researching radar chart/ })).toBeDefined()
  expect(await ui.find({ text: /\+1 queued/ })).toBeDefined()
  await ui.unmount()
})

test('a toast when a department starts on a task, and when it finishes', { options: { departments: 'PR Review=pr-reviews: reviews | Sphere Dev=GitHub: Sphere code (sphere-web, sphere-v3-web)' } }, async ($, on) => {
  deptSetup(on, 'desk')
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? JSON.stringify(e)))
    return { value: undefined }
  })
  await $.session.start({ cwd: '/u/hq', surface: 'terminal', isInteractive: true } as never)
  await $.command.run({ command: 'office', args: 'departments', origin: { kind: 'user' } } as never)
  await $.turn.start({ text: 'fix it', turnId: 'T1' })
  await $.tool.call({ tool: 'SendMessage', to: 'github-1', message: 'Task from HQ: fix RadarChart in sphere-v3-web' } as never)
  // The next looks around find the department's session busy: one toast, not one per look.
  await $.command.run({ command: 'office', args: 'departments', origin: { kind: 'user' } } as never)
  await $.command.run({ command: 'office', args: 'departments', origin: { kind: 'user' } } as never)
  expect(toasts.filter(t => /Sphere Dev is working on: fix RadarChart in sphere-v3-web \(sphere-v3-web\)/.test(t))).toHaveLength(1)
  await $.turn.start({ text: '<cross-session-message from="uds:/tmp/1.sock" from-name="github-1" from-mode="prompting">\nRadarChart fixed, PR #612\n</cross-session-message>', turnId: 'T2' })
  expect(toasts.some(t => /✓ Sphere Dev finished \(sphere-v3-web\): RadarChart fixed, PR #612/.test(t))).toBe(true)
})
