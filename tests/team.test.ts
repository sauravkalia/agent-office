import { expect, mock, test } from 'claude-code/testing'

import { namesFor, orgLine, roleOf } from '../hooks/office-core'

test('agent types map to office roles', () => {
  expect(roleOf('agent-office:researcher')).toBe('research')
  expect(roleOf('Explore')).toBe('research')
  expect(roleOf('agent-office:engineer')).toBe('engineering')
  expect(roleOf('agent-office:docs-writer')).toBe('docs')
  expect(roleOf('code-reviewer')).toBe('review')
  expect(roleOf('Plan')).toBe('planning')
  expect(roleOf('general-purpose')).toBe('staff')
})

test('the org line drops from the supervisor to every column', () => {
  expect(orgLine(30, 3)).toBe('     ┌─────────┼─────────┐')
  expect(orgLine(20, 2)).toBe('     ┌────┴────┐')
  expect(orgLine(20, 1)).toBe('          │')
  expect(orgLine(0, 3)).toBe('')
})

const pane = {
  plugin: 'agent-office',
  component: 'Pane' as const,
  requestId: 'agent-office',
  props: { title: 'Agent Office', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 70 }, view: {} },
}
let n = 0
const spawn = (subagentType: string, description: string) => ({
  prompt: description,
  description,
  subagentType,
  tool_use_id: `team${++n}`,
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
})

test('the supervisor hands research to the engineer, and the org chart shows the team', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ids = ['res1', 'eng1', 'doc1']
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: ids.shift() ?? 'x' }))
  await $.turn.start({ text: '/assign add CSV export', turnId: 'T1' })
  await $.agent.spawn(spawn('agent-office:researcher', 'find how reports export'))
  await clock.advance(5_000)
  await $.turn.complete({ answer: '## Findings', durationMs: 5_000, isAborted: false, turnId: 'T1', agentId: 'res1', reason: 'answer' } as never)
  await $.agent.spawn(spawn('agent-office:engineer', 'build CSV export'))
  await $.agent.spawn(spawn('agent-office:docs-writer', 'document CSV export'))
  const names = namesFor(['res1', 'eng1', 'doc1'])
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' })
  expect(await ui.find({ text: /☻ Claude · supervisor/ })).toBeDefined()
  expect(await ui.find({ text: new RegExp(`☺ ${names.get('res1')}`) })).toBeDefined()
  expect(await ui.find({ text: /^research$/ })).toBeDefined()
  expect(await ui.find({ text: /^engineering$/ })).toBeDefined()
  expect(await ui.find({ text: /^docs$/ })).toBeDefined()
  expect(await ui.find({ text: /✓ done/ })).toBeDefined()
  expect(await ui.find({ text: new RegExp(`handed ${names.get('res1')}'s research to ${names.get('eng1')} \\(engineering\\)`) })).toBeDefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- departments

import { answerDispatch, crossMessageOf, deptOfSession, desksOf, parseDepartments, asksUser, handoffAlerts, rosterText, settleIdle } from '../hooks/departments-core'

const DEPTS = 'PR Review=pr-reviews: reviewing pull requests | Sphere Dev=sphere-web,sphere-v3-web: Sphere coding | Social=social-expert'
const live = [
  { sessionId: 'p1', name: 'pr-reviews-1f', cwd: '/u/pr-reviews', status: 'idle', kind: 'interactive', updatedAt: 10 },
  { sessionId: 'p2', name: 'pr-reviews-35', cwd: '/u/pr-reviews', status: 'idle', kind: 'interactive', updatedAt: 50 },
  { sessionId: 'v3', name: 'sphere-v3-web-9f', cwd: '/u/sphere-v3-web', status: 'busy', kind: 'interactive', updatedAt: 20 },
  { sessionId: 'hq', name: 'hq', cwd: '/u/social-expert', status: 'busy', kind: 'interactive', updatedAt: 99 },
]

test('departments parse from the option, folders and what each handles', () => {
  expect(parseDepartments(DEPTS)).toEqual([
    { label: 'PR Review', folders: ['pr-reviews'], handles: 'reviewing pull requests' },
    { label: 'Sphere Dev', folders: ['sphere-web', 'sphere-v3-web'], handles: 'Sphere coding' },
    { label: 'Social', folders: ['social-expert'], handles: '' },
  ])
  expect(parseDepartments('nonsense | =x | A=')).toEqual([])
})

test('each folder is staffed by its most recently active session, or by HQ when HQ runs there', () => {
  const [pr, sphere, social] = parseDepartments(DEPTS)
  expect(desksOf(pr!, live, 'hq')[0]?.session?.name).toBe('pr-reviews-35')
  expect(desksOf(pr!, live, 'hq')[0]?.others.map(o => o.name)).toEqual(['pr-reviews-1f'])
  expect(desksOf(sphere!, live, 'hq').map(d => d.session?.name ?? null)).toEqual([null, 'sphere-v3-web-9f'])
  expect(desksOf(social!, live, 'hq')[0]).toMatchObject({ isSelf: true, session: { name: 'hq' } })
  expect(desksOf(social!, live.slice(0, 3), 'hq')[0]?.session).toBe(null)
  const roster = rosterText(parseDepartments(DEPTS), live, 'hq', 'hq')
  expect(roster).toContain('- PR Review: reviewing pull requests')
  expect(roster).toContain('pr-reviews: "pr-reviews-35" (idle); also open there: "pr-reviews-1f"')
  expect(roster).toContain('sphere-web: not running')
  expect(roster).toContain("social-expert: that's you (HQ runs in this folder): do this department's work yourself")
  expect(deptOfSession(parseDepartments(DEPTS), live, 'sphere-v3-web-9f')).toEqual({ label: 'Sphere Dev', folder: 'sphere-v3-web' })
})

test('a reply closes the oldest open dispatch to that session: it answers in order', () => {
  const msg = '<cross-session-message from="uds:/tmp/x.sock" from-name="pr-reviews-35" from-mode="prompting">\nPR 504: 2 blockers, 1 minor.\nDetails…\n</cross-session-message>'
  expect(crossMessageOf(msg)).toEqual({ fromName: 'pr-reviews-35', body: 'PR 504: 2 blockers, 1 minor.' })
  expect(crossMessageOf('hello')).toBe(null)
  const list = [
    { to: 'pr-reviews-35', dept: 'PR Review', folder: 'pr-reviews', task: 'review PR 503', at: 1, status: 'replied' as const },
    { to: 'pr-reviews-35', dept: 'PR Review', folder: 'pr-reviews', task: 'review PR 504', at: 2, status: 'sent' as const },
  ]
  const after = answerDispatch(list, 'pr-reviews-35', 'PR 504: 2 blockers', 9)
  expect(after[1]).toMatchObject({ status: 'replied', reply: 'PR 504: 2 blockers', endedAt: 9 })
  expect(after[0]).toEqual(list[0])
  const two = [
    { to: 'github-4b', dept: 'Sphere Dev', folder: 'GitHub', task: 'fix rows', at: 1, status: 'sent' as const },
    { to: 'github-4b', dept: 'Sphere Dev', folder: 'GitHub', task: 'retitle #501', at: 2, status: 'sent' as const },
  ]
  const first = answerDispatch(two, 'github-4b', 'rows fixed', 5)
  expect(first.map(x => x.status)).toEqual(['replied', 'sent'])
  // One reply for both, then idle: the second counts as answered too. Still busy: it stays open.
  const live = (status: string) => [{ sessionId: 's', name: 'github-4b', cwd: '/u/GitHub', status, kind: 'interactive', updatedAt: 5 }]
  expect(settleIdle(first, live('idle'), 5 + 6_000).map(x => x.status)).toEqual(['replied', 'replied'])
  expect(settleIdle(first, live('busy'), 5 + 6_000).map(x => x.status)).toEqual(['replied', 'sent'])
  expect(settleIdle(first, live('idle'), 5 + 1_000).map(x => x.status)).toEqual(['replied', 'sent'])
})

test('HQ: a SendMessage to a department is tracked, its reply closes it, and the desks show both', { options: { departments: DEPTS } }, async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.env(on, { HOME: '/h' })
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('session.id', () => ({ value: 'hq' }))
  on('fs.list', () => ({ value: live.map((_, i) => ({ name: `${i}.json`, kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false })) }))
  on('fs.read', (_$, e) => ({ value: JSON.stringify(live[Number(/(\d+)\.json$/.exec((e as { path: string }).path)?.[1] ?? -1)] ?? {}) }))
  on('tool.call', () => ({ result: {}, text: 'sent' }))
  await $.turn.start({ text: 'review PR 504', turnId: 'H1' })
  await $.command.run({ command: 'office', args: 'departments', origin: { kind: 'user' } } as never)
  await $.tool.call({ tool: 'SendMessage', to: 'pr-reviews-35', message: 'Task from HQ: review PR 504\nhttps://github.com/x/y/pull/504' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' })
  expect(await ui.find({ text: /☻ Claude · HQ supervisor/ })).toBeDefined()
  expect(await ui.find({ text: /^PR Review$/ })).toBeDefined()
  expect(await ui.find({ text: /→ review PR 504/ })).toBeDefined()
  expect(await ui.find({ text: /→ PR Review \(pr-reviews-35\): review PR 504/ })).toBeDefined()
  await $.turn.start({ text: '<cross-session-message from="uds:/x" from-name="pr-reviews-35">\nPR 504: 2 blockers\n</cross-session-message>', turnId: 'H2' })
  expect(await ui.find({ text: /✓ PR 504: 2 blockers/ })).toBeDefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- handoff alerts

test('handoff alerts: once per level, the highest on a jump, again after the fill drops', () => {
  const st = (ctxPct: number | undefined, at = 1_000) => ({ zone: 'desk', text: '', isError: false, at, ...(ctxPct === undefined ? {} : { ctxPct }) })
  const desk = (ctxPct: number | undefined, over: Partial<{ isSelf: boolean; at: number; status: null }> = {}) => ({
    name: 'github-4b',
    label: 'Sphere Dev',
    isSelf: over.isSelf ?? false,
    status: over.status === null ? null : st(ctxPct, over.at),
  })
  const levels = [60, 80]
  const a = handoffAlerts({}, [desk(55)], levels, 2_000)
  expect(a.alerts).toEqual([])
  const b = handoffAlerts(a.fired, [desk(61.2)], levels, 2_000)
  expect(b.alerts).toEqual([{ name: 'github-4b', label: 'Sphere Dev', pct: 61, level: 60 }])
  // Still past 60: nothing new.
  expect(handoffAlerts(b.fired, [desk(70)], levels, 2_000).alerts).toEqual([])
  const c = handoffAlerts(b.fired, [desk(83)], levels, 2_000)
  expect(c.alerts.map(x => x.level)).toEqual([80])
  // A jump from nothing to 90%: one alert, at the highest level.
  expect(handoffAlerts({}, [desk(90)], levels, 2_000).alerts.map(x => x.level)).toEqual([80])
  // After /clear the fill drops: the levels reset, and crossing 60 again alerts again.
  const cleared = handoffAlerts(c.fired, [desk(5)], levels, 2_000)
  expect(cleared.fired['github-4b']).toEqual([])
  expect(handoffAlerts(cleared.fired, [desk(62)], levels, 2_000).alerts.map(x => x.level)).toEqual([60])
})

test('handoff alerts skip HQ itself, a missing status, a stale one, and one without a context fill', () => {
  const st = (at: number, ctxPct?: number) => ({ zone: 'desk', text: '', isError: false, at, ...(ctxPct === undefined ? {} : { ctxPct }) })
  const now = 10 * 60_000
  const r = handoffAlerts(
    { 'pr-1': [60] },
    [
      { name: 'hq-1', label: 'HQ', isSelf: true, status: st(now, 95) },
      { name: 'pr-1', label: 'PR Review', isSelf: false, status: null },
      { name: 'q-1', label: 'Quilt', isSelf: false, status: st(now - 6 * 60_000, 95) },
      { name: 's-1', label: 'Social', isSelf: false, status: st(now) },
    ],
    [60, 80],
    now,
  )
  expect(r.alerts).toEqual([])
  // A session left out keeps what it was told.
  expect(r.fired['pr-1']).toEqual([60])
})

// ---------------------------------------------------------------- waiting on you

test('a turn that ends by asking waits on you', () => {
  expect(asksUser('Tests pass and the build is green.\n\nShall I commit and push?')).toBe(true)
  expect(asksUser('All 104 tests pass.\n\nSay the word and I\'ll release it as 0.13.0.')).toBe(true)
  expect(asksUser('Ready on the branch. Let me know if you want the toasts too.')).toBe(true)
  expect(asksUser('Two decisions for you:\n1. **Commit and publish as 0.12.0?**\n2. Which model for everyday prompts?')).toBe(true)
  expect(asksUser('Done. Want me to open the PR? (It targets main.)')).toBe(true)
  expect(asksUser('Done. Want me to open the PR (it targets main)?')).toBe(true)
  // Handing the decision over without a "?".
  expect(asksUser('The review is ready. Say "post it" here and I\'ll submit it.')).toBe(true)
  expect(asksUser('Both fixes work. Tell me which and I\'ll proceed.')).toBe(true)
  expect(asksUser('It moves the foot down 32px, so I left it alone until you say so.')).toBe(true)
  expect(asksUser('Posting is public, so I\'ll wait for your OK.')).toBe(true)
})

test('a "?" that is not a question for you does not count', () => {
  // Earlier in the answer, then a plain closing.
  expect(asksUser('Why did it fail? The cache key changed.\n\nFixed and pushed.')).toBe(false)
  // In code, inline code, a quote, a table or a heading.
  expect(asksUser('Fixed the regex:\n\n```ts\nconst ok = /a?b/.test(x) ? 1 : 0\n```')).toBe(false)
  expect(asksUser('It now matches `colou?r`.')).toBe(false)
  expect(asksUser('HQ asked: "Can you confirm the push?"\n\n> Is it safe?')).toBe(false)
  expect(asksUser('| Check | Result |\n|---|---|\n| Pushed? | yes |')).toBe(false)
  expect(asksUser('## Why routing stayed on Opus?\n\nIt never paid for the re-cache.')).toBe(false)
  // A summary list of what was asked, not a question now.
  expect(asksUser('Answered:\n- why the build failed\n- what changed in 0.12.1')).toBe(false)
  expect(asksUser('')).toBe(false)
  // An option mentioned, not offered.
  expect(asksUser('The short names remain the option if you ever want the map calmer.')).toBe(false)
  expect(asksUser('Committed locally as 3529459. Seven commits are waiting to be pushed.')).toBe(false)
  expect(asksUser('Sphere Dev is on it. Nothing gets pushed until you say so in its tab.')).toBe(false)
})
