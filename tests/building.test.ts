import { expect, mock, test } from 'claude-code/testing'

import { agoOf, buildingScene, parseHistory, parseLive, projectOf } from '../hooks/building-core'

const H = (o: Record<string, unknown>) => JSON.stringify({ pastedContents: {}, ...o })

test('a registry file reads leniently; anything else is skipped', () => {
  expect(parseLive('{"pid":1,"sessionId":"s1","cwd":"/u/me/web","status":"busy","name":"fix auth","kind":"interactive","updatedAt":5}')).toEqual({
    sessionId: 's1',
    name: 'fix auth',
    cwd: '/u/me/web',
    status: 'busy',
    kind: 'interactive',
    updatedAt: 5,
  })
  expect(parseLive('{"pid":1}')).toBe(null)
  expect(parseLive('not json')).toBe(null)
})

test('the history groups prompts by session, skips slash commands for titles, and keeps the window', () => {
  const text = [
    H({ display: 'old work', timestamp: 10, project: '/u/me/old', sessionId: 'x' }),
    H({ display: '/clear', timestamp: 100, project: '/u/me/web', sessionId: 'a' }),
    H({ display: 'fix the login redirect', timestamp: 110, project: '/u/me/web', sessionId: 'a' }),
    H({ display: 'now add a test', timestamp: 120, project: '/u/me/web', sessionId: 'a' }),
    H({ display: 'draft a post', timestamp: 130, project: '/u/me/social', sessionId: 'b' }),
    'garbage',
  ].join('\n')
  const past = parseHistory(text, 50)
  expect(past.map(p => p.sessionId)).toEqual(['b', 'a'])
  expect(past[1]).toEqual({ sessionId: 'a', cwd: '/u/me/web', firstPrompt: 'fix the login redirect', lastPrompt: 'now add a test', firstAt: 100, lastAt: 120, prompts: 3 })
})

test('running sessions sit on their project floor; closed ones go home', () => {
  const live = [
    { sessionId: 'a', name: '', cwd: '/u/me/web', status: 'busy', kind: 'interactive', updatedAt: 0 },
    { sessionId: 'me', name: 'agent office', cwd: '/u/me/daily', status: 'busy', kind: 'bg', updatedAt: 0 },
    { sessionId: 'c', name: 'idle one', cwd: '/u/me/web', status: 'idle', kind: 'interactive', updatedAt: 0 },
  ]
  const past = parseHistory([H({ display: 'fix the login redirect', timestamp: 5, project: '/u/me/web', sessionId: 'a' }), H({ display: 'draft a post', timestamp: 6, project: '/u/me/social', sessionId: 'b' })].join('\n'), 0)
  const s = buildingScene({ live, past, selfId: 'me' })
  expect(s.busy).toBe(2)
  expect(s.floors.map(f => f.project)).toEqual(['daily', 'web'])
  expect(s.floors[1]?.people.map(p => p.title)).toEqual(['fix the login redirect', 'idle one'])
  expect(s.floors[0]?.people[0]?.isSelf).toBe(true)
  expect(s.gone.map(p => p.sessionId)).toEqual(['b'])
  expect([projectOf('/u/me/web/'), agoOf(0, 30_000), agoOf(0, 3 * 3_600_000), agoOf(0, 2 * 86_400_000)]).toEqual(['web', 'just now', '3h', '2d'])
})

test('/office building shows every session on the machine, and b flips back', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-15T12:00:00') })
  void clock
  mock.env(on, { HOME: '/h' })
  on('ui.status', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'me' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const files: Record<string, string> = {
    '/h/.claude/sessions/1.json': '{"sessionId":"me","cwd":"/u/daily-dose","status":"busy","name":"What is jev","kind":"bg"}',
    '/h/.claude/sessions/2.json': '{"sessionId":"q","cwd":"/u/Quilt-Discussion","status":"idle","name":"close error gap"}',
    '/h/.claude/sessions/2.secret.key': 'NEVER READ',
    '/h/.claude/history.jsonl': H({ display: 'review PR 412', timestamp: Date.parse('2026-10-15T10:00:00'), project: '/u/pr-reviews', sessionId: 'old' }),
  }
  const reads: string[] = []
  on('fs.list', () => ({
    value: [
      { name: '1.json', kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false },
      { name: '2.json', kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false },
      { name: '2.secret.key', kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false },
    ],
  }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 7, isLink: false } }))
  on('fs.read', (_$, e) => {
    const path = (e as { path: string }).path
    reads.push(path)
    return { value: files[path] ?? '' }
  })
  const out = await $.command.run({ command: 'office', args: 'building', origin: { kind: 'user' } } as never)
  expect(JSON.stringify(out)).toContain('every session')
  expect(reads.some(r => r.endsWith('.key'))).toBe(false)
  const ui = await $.ui.mount({
    plugin: 'agent-office',
    component: 'Pane' as const,
    requestId: 'agent-office',
    props: { title: 'Agent Office', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 70 }, view: {} },
    surface: 'terminal',
  })
  expect(await ui.find({ text: /building · 2 running · 1 busy · 1 gone home/ })).toBeDefined()
  expect(await ui.find({ text: /☻ ⠿ What is jev \(here\) · bg/ })).toBeDefined()
  expect(await ui.find({ text: /Quilt-Discussion/ })).toBeDefined()
  expect(await ui.find({ text: /review PR 412/ })).toBeDefined()
  await ui.press({ key: 'scene' })
  expect(await ui.find({ text: /office · \d+ at work/ })).toBeDefined()
  await ui.unmount()
})
