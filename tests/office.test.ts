import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  DEFAULT_ARCHITECT,
  DEFAULT_GATE,
  DEFAULT_TURN,
  afterCall,
  applyStep,
  consultTimeline,
  describeInput,
  endConsult,
  fitLegend,
  fmtResetIn,
  fmtSpeed,
  gateSummary,
  lanes,
  limitLabel,
  limitOf,
  logRows,
  momentOf,
  normalizeCard,
  normalizeGate,
  normalizeLog,
  titleLines,
  parseConfig,
  prettyModel,
  promptLine,
  handbackOf,
  adviceLine,
  receiptOf,
  recordCheck,
  redact,
  settleCheck,
  trimRecent,
  startConsult,
  stepSpeed,
} from '../hooks/core'
import { alertText, crossedAlerts, percentList } from '../hooks/core'
import { namesFor } from '../hooks/office-core'
import { lastDays, recordTurn, staleKeys, totalOf, usageReport } from '../hooks/usage-core'
import type { Check } from '../types'

// ---------------------------------------------------------------- pure behaviour

test('redaction masks credentials before anything is stored', () => {
  expect(redact('curl -H "Authorization: Bearer abc.def.ghi123" x')).not.toContain('abc.def')
  expect(redact('export OPENAI_API_KEY=sk-proj-1234567890abcdef')).not.toContain('1234567890')
  expect(redact('gh auth --token ghp_abcdefghijklmnop')).not.toContain('abcdefghijklmnop')
  expect(redact('psql postgres://bob:hunter2@db/x')).not.toContain('hunter2')
  expect(redact('password=hunter2 ls')).not.toContain('hunter2')
  expect(redact('ls -la src/')).toBe('ls -la src/')
  expect(describeInput('Read', { file_path: 'C:\\Users\\me\\proj\\src\\main.ts' })).toBe('Read → src/main.ts')
})

const check = (id: string, verdict: Check['verdict'], bucket: Check['bucket'] = 'shell'): Check => ({
  id,
  tool: 'Bash',
  bucket,
  verdict,
  inSubagent: false,
  detail: 'Bash → ls',
  at: 1,
})

test('an ask is settled by the call that follows: cleared if it ran, deny if refused', () => {
  let g = recordCheck(DEFAULT_GATE, check('a', 'ask'))
  g = recordCheck(g, check('b', 'ask'))
  g = recordCheck(g, check('c', 'rule', 'file'))
  g = settleCheck(g, 'a', true)
  g = settleCheck(g, 'b', false)
  g = settleCheck(g, 'zzz', true) // not an ask: unchanged
  const s = gateSummary(g)
  expect([s.rule, s.ask, s.cleared, s.deny, s.total]).toEqual([1, 0, 1, 1, 3])
  expect(g.recent.map(c => c.verdict)).toEqual(['cleared', 'deny', 'rule'])
})

test('the gate tallies a mixed run of verdicts per family', () => {
  let g = DEFAULT_GATE
  g = recordCheck(g, check('r1', 'rule', 'file'))
  g = recordCheck(g, check('a1', 'ask', 'shell'))
  g = recordCheck(g, check('a2', 'ask', 'shell'))
  g = recordCheck(g, check('d1', 'deny', 'other'))
  g = settleCheck(g, 'a1', true)
  g = settleCheck(g, 'a2', false)
  expect(g.totals.file).toEqual({ rule: 1, ask: 0, cleared: 0, deny: 0 })
  expect(g.totals.shell).toEqual({ rule: 0, ask: 0, cleared: 1, deny: 1 })
  expect(g.totals.other.deny).toBe(1)
  expect(gateSummary(g)).toEqual({ rule: 1, ask: 0, cleared: 1, deny: 2, total: 4 })
  expect(gateSummary(DEFAULT_GATE).total).toBe(0)
})

test('a v1-shaped gate reads as empty, then records normally', () => {
  const g = normalizeGate({ file: { allow: 3, ask: 1, deny: 0, cleared: 2 }, shell: null })
  expect(gateSummary(g).total).toBe(0)
  const next = recordCheck(g, check('n1', 'rule', 'file'))
  expect(next.totals.file.rule).toBe(1)
  expect(next.recent.length).toBe(1)
})

test('a pending ask is never trimmed out before it settles', () => {
  let g = recordCheck(DEFAULT_GATE, check('old-ask', 'ask'))
  for (let i = 0; i < 120; i += 1) g = recordCheck(g, check(`r${i}`, 'rule', 'file'))
  expect(g.recent.length).toBe(80)
  expect(g.recent.some(c => c.id === 'old-ask')).toBe(true)
  g = settleCheck(g, 'old-ask', true)
  expect(gateSummary(g).ask).toBe(0)
  expect(trimRecent([check('a', 'rule'), check('b', 'rule')], 5).length).toBe(2)
})

test('edits count from every loop; errors only from the main loop', () => {
  const t = { ...DEFAULT_TURN, errorStreak: 1 }
  expect(afterCall(t, { inSubagent: true, hasFailed: false, isEdit: true }).edits).toBe(1)
  expect(afterCall(t, { inSubagent: true, hasFailed: true, isEdit: false }).errorStreak).toBe(1)
  expect(afterCall(t, { inSubagent: false, hasFailed: true, isEdit: false })).toEqual({ ...t, errorStreak: 2, errors: 1 })
  expect(momentOf(afterCall(DEFAULT_TURN, { inSubagent: true, hasFailed: false, isEdit: true }))).toBe('before done')
  expect(momentOf({ edits: 0, errorStreak: 2 })).toBe('error repeats')
})

test("a card's context is its latest step's whole input; output adds up", () => {
  let c = normalizeCard({ id: 'x' })
  c = applyStep(c, { model: 'claude-sonnet-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 2_000, output_tokens: 500 }, stopReason: 'tool_use' })
  c = applyStep(c, { model: 'claude-sonnet-5-5', usage: { input_tokens: 5, cache_read_input_tokens: 40_000, output_tokens: 700 }, stopReason: 'max_tokens' })
  expect([c.ctx, c.out, c.steps, c.lastStop, c.model]).toEqual([40_005, 1200, 2, 'max_tokens', 'claude-sonnet-5-5'])
})

test('consults open, close by id, and draw on a shared timeline', () => {
  let a = startConsult(DEFAULT_ARCHITECT, { id: 's1', at: 0, moment: 'before a plan', via: 'advisor tool' })
  a = startConsult(a, { id: 's1', at: 5, moment: 'before a plan', via: 'again' }) // same id: ignored
  a = endConsult(a, 10, null, 's1')
  a = startConsult(a, { id: 's2', at: 90, moment: 'before done', via: 'advisor tool' })
  expect(a.consults.length).toBe(2)
  expect(a.consults[0]?.endAt).toBe(10)
  const tl = consultTimeline(a, 100, 11)
  expect(tl.length).toBe(11)
  expect(tl.startsWith('◆━')).toBe(true)
  expect(tl.split('◆').length - 1).toBe(2)
})

test('config is read leniently: bad values fall back to defaults', () => {
  const d = parseConfig({})
  expect([d.maxCards, d.layout, d.motion, d.moments, d.panels.length]).toEqual([3, 'auto', true, true, 8])
  expect(d.architect.test('fable-advisor:fable-advisor')).toBe(true)
  const c = parseConfig({ architectPattern: '([', maxCards: 99, layout: 'diagonal', panels: 'log, gate ,nope,gate', motion: 'off' })
  expect(c.architect.test('advisor')).toBe(true) // invalid regex → default
  expect([c.maxCards, c.layout, c.motion]).toEqual([6, 'auto', false])
  expect(c.panels).toEqual(['log', 'gate'])
})

test('state saved under an older shape still reads', () => {
  expect(normalizeLog([{ at: '08:00:00', who: 'jev', text: 'x' }])[0]).toEqual({ at: 0, who: 'jev', text: 'x', agentId: null, kind: 'info' })
  const g = normalizeGate({ file: { allow: 1 } }) // v1 gate shape
  expect(g.recent).toEqual([])
  expect(g.totals.shell.rule).toBe(0)
  expect(normalizeCard({ id: 'a', status: 'done' }).tools).toEqual([])
})

test('layout math: lanes share one axis, the log gets 4-8 rows, the legend never wraps', () => {
  const cards = [
    { ...normalizeCard({}), id: 'a', spawnedAt: 1000, endedAt: 1050 },
    { ...normalizeCard({}), id: 'b', spawnedAt: 1050, endedAt: null },
  ]
  const [a, b] = lanes(cards, 1100, 20)
  expect(a).toEqual({ id: 'a', before: 0, bar: 10, after: 10 })
  expect(b?.before).toBe(10)
  expect((b?.before ?? 0) + (b?.bar ?? 0) + (b?.after ?? 0)).toBe(20)
  expect([logRows(10, 40), logRows(50, 40), logRows(200, 40)]).toEqual([4, 7, 8])
  expect(fitLegend([{ label: 'main' }, { label: 'agents' }, { label: 'architect' }], 20).map(x => x.label)).toEqual(['main', 'agents'])
  expect(limitLabel('five_hour')).toBe('5h')
  expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
  expect(prettyModel('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('Sonnet 4.5')
  expect(prettyModel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
  expect(prettyModel('claude-opus-4-20250514')).toBe('Opus 4')
  expect(prettyModel('claude-3-opus-20240229')).toBe('Opus 3')
  expect(prettyModel('z-ai/glm-5.3-flash-with-a-long-name')).toBe('z-ai/glm-5.3-flash-wi…')
  expect(prettyModel('')).toBe('—')
  expect(promptLine('fix the parser')).toEqual({ who: 'you', text: 'fix the parser' })
  const hb = '<agent-message from="a1940a83d593229d5">\n[Subagent hand-back] The text below is the final report. The report follows:\n  Add gate tests: redaction edge cases.\n  - more\n</agent-message>'
  expect(handbackOf(hb)).toEqual({ from: 'a1940a83d593229d5', body: 'Add gate tests: redaction edge cases.' })
  expect(handbackOf('<agent-message from="x">\nPlain report line\n</agent-message>')).toEqual({ from: 'x', body: 'Plain report line' })
  expect(handbackOf('fix the parser')).toBe(null)
  expect(adviceLine('## Ship it after one more gate test.\n- details')).toBe('Ship it after one more gate test.')
  expect(adviceLine('[Subagent hand-back] header\n\n**Fix card overflow first**')).toBe('Fix card overflow first')
  expect(adviceLine('')).toBe('')
  expect(promptLine('<agent-message from="a1492260715f3be7b"> [Subagent hand-back]')).toEqual({ who: 'engine', text: 'agent message from a1492260' })
  expect(receiptOf({ ...DEFAULT_TURN, costAtStart: 5 }, { durationMs: 1, agentsSince: 0, costNow: 5, reason: 'answer' }).costDelta).toBe(null)
  expect(titleLines('Write tinyqueue test suite', 13, 16)).toEqual(['Write', 'tinyqueue test…'])
  expect(titleLines('Short', 13, 16)).toEqual(['Short', ''])
  expect(receiptOf({ ...DEFAULT_TURN, costAtStart: 1, edits: 2 }, { durationMs: 1000, agentsSince: 3, costNow: 1.5, reason: 'answer' }).costDelta).toBe(0.5)
})

test('a request\'s speed: time to its first piece, then output tokens per second to the stop', () => {
  expect(stepSpeed(1000, 1800, 3800, 120)).toEqual({ ttftMs: 800, tokPerS: 60 })
  expect(stepSpeed(1000, null, 3800, 120)).toBe(null) // no response arrived
  expect(stepSpeed(1000, 1800, 1800, 120)?.tokPerS).toBe(null) // nothing to divide by
  expect(stepSpeed(1000, 1800, 3800, null)?.tokPerS).toBe(null)
  expect(fmtSpeed({ ttftMs: 800, tokPerS: 60.4 })).toBe('ttft 0.8s · 60 tok/s')
  expect(fmtSpeed({ ttftMs: 1250, tokPerS: null })).toBe('ttft 1.3s')
})

test('a window keeps its reset time, drawn as the time left', () => {
  expect(limitOf({ kind: 'five_hour', percentUsed: 19, resetsAt: '1970-01-01T03:10:00.000Z' })).toEqual({ kind: 'five_hour', pct: 19, resetsAt: 11_400_000 })
  expect(limitOf({ kind: 'seven_day', percentUsed: 3 }).resetsAt).toBe(null)
  expect(limitOf({ kind: 'spend_limit', percentUsed: 1, resetsAt: 'soon' }).resetsAt).toBe(null)
  expect([fmtResetIn(11_400_000, 0), fmtResetIn(25 * 60_000 + 5_000, 0), fmtResetIn(4 * 86_400_000 + 2 * 3_600_000, 0)]).toEqual(['3h10m', '25m', '4d2h'])
  expect([fmtResetIn(null, 0), fmtResetIn(undefined, 0), fmtResetIn(5, 10)]).toEqual(['', '', ''])
})

// ---------------------------------------------------------------- drawing

const engine = (on: On) => {
  const clock = mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return clock
}

const pane = (bodyColumns: number) => ({
  plugin: 'agent-office',
  component: 'Pane' as const,
  requestId: 'agent-office',
  props: {
    title: 'Agent Office',
    isFocused: true,
    bodyColumns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 70 },
    view: {},
  },
})

let spawnN = 0
const spawn = (subagentType: string, description: string) => ({
  prompt: description,
  description,
  subagentType,
  tool_use_id: `tu${++spawnN}`,
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
})

test('a fresh session draws on every surface and width, empty panels hidden', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const cols of [40, 60, 86, 120]) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      expect(await ui.find({ text: /· main$/ })).toBeDefined()
      expect(await ui.find({ text: /session log/ })).toBeDefined()
      expect(await ui.find({ text: /agents ·/ })).toBeUndefined() // no subagents: no agents panel
      expect(await ui.find({ text: /permissions/ })).toBeUndefined() // no checks yet: no gate panel
      await ui.unmount()
    }
  }
})

test('inline above the prompt, the pane is a summary of at most 8 rows', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `m${++n}` }))
  on('tool.check', () => ({ decision: 'allow' }))
  await $.turn.start({ text: 'go', turnId: 'M1' })
  for (const d of ['one', 'two', 'three', 'four', 'five']) await $.agent.spawn(spawn('general-purpose', `task ${d}`))
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'm-k1' })
  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...pane(80), props: { ...pane(80).props, placement: 'inline' as const }, surface })
    const root = (await ui.drawn()) as { children?: unknown[] }
    expect((root.children ?? []).filter(Boolean).length <= 8).toBe(true)
    expect(await ui.find({ text: /\+2 more agents/ })).toBeDefined()
    expect(await ui.find({ text: /1 allowed/ })).toBeDefined()
    expect(await ui.find({ text: /session log/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('/clear starts the pane fresh', async ($, on) => {
  engine(on)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'c1' }))
  await $.turn.start({ text: 'go', turnId: 'C1' })
  await $.agent.spawn(spawn('Explore', 'look around'))
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /look around/ })).toBeUndefined()
  await ui.unmount()
})

test('the office palette is the default: warm fixed colours', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  const title = await ui.find({ text: /· main$/ })
  expect(title?.props.color).toBe('#f4a261')
  await ui.unmount()
})

test('palette theme follows the Claude Code theme colours', { options: { palette: 'theme' } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  const title = await ui.find({ text: /· main$/ })
  expect(title?.props.color).toBe('claude')
  await ui.unmount()
})

test('pastel keeps the fixed dark-terminal colours', { options: { palette: 'pastel' } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await ui.find({ text: /· main$/ }))?.props.color).toBe('#7dd3fc')
  await ui.unmount()
})

test('subagents become cards, then swimlanes past the card limit; a card expands on its hotkey', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `ag${++n}` }))
  await $.turn.start({ text: 'fan out', turnId: 'T1' })
  await $.agent.spawn(spawn('general-purpose', 'Write the parser tests'))
  await $.agent.spawn(spawn('Explore', 'Map the call sites'))

  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /Write the parser/ })).toBeDefined()
  expect(await ui.find({ text: /Sonnet 5\.5/ })).toBeDefined() // differs from main: shown
  await ui.press({ key: 'card-ag1' })
  expect(await ui.find({ text: /^Write the parser tests$/ })).toBeDefined() // the expanded panel, full title
  await ui.unmount()

  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('general-purpose', 'Review the parser'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const lanesUi = await $.ui.mount({ ...pane(64), surface })
    expect(await lanesUi.find({ text: /4 total/ })).toBeDefined()
    expect(await lanesUi.find({ text: /━/ })).toBeDefined()
    await lanesUi.unmount()
  }
})

test('the server-side advisor is read from assistant rows: consulting, then on call', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'plan it', turnId: 'T2' })
  const row = (content: unknown[]) =>
    $.session
      .append({
        message: { type: 'assistant', role: 'assistant', content: content as never },
        door: 'response',
        origin: { kind: 'model', model: 'claude-opus-5-5' } as never,
        uuid: `u${++spawnN}`,
      })
      .catch(() => undefined) // the test has no transcript to store rows in
  await row([{ type: 'server_tool_use', id: 'srv1', name: 'advisor', input: {} }])
  const mid = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await mid.find({ text: /ARCHITECT · advising/ })).toBeDefined()
  expect(await mid.find({ text: /◆ before a plan/ })).toBeDefined()
  await mid.unmount()

  await row([{ type: 'advisor_tool_result', tool_use_id: 'srv1', content: { type: 'advisor_redacted_result' } }])
  const after = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await after.find({ text: /ARCHITECT · on call/ })).toBeDefined()
  expect(await after.find({ text: /^1$/ })).toBeDefined()
  await after.unmount()
})

test('the gate strip fills from checks and a row opens its redacted drill-down', async ($, on) => {
  engine(on)
  on('tool.check', (_$, e) => ({ decision: e.tool === 'Read' ? 'allow' : 'ask' }))
  await $.tool.check({ tool: 'Read', input: { file_path: '/a/b.ts' }, tool_use_id: 'k1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'curl -H "Authorization: Bearer abcdefgh12345" api' }, tool_use_id: 'k2' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /2 checks/ })).toBeDefined()
  expect(await ui.find({ text: /1 pending/ })).toBeDefined()
  await ui.press({ key: 'gate-shell' })
  expect(await ui.find({ text: /Authorization: Bearer •••/ })).toBeDefined()
  expect(await ui.find({ text: /abcdefgh12345/ })).toBeUndefined()
  await ui.unmount()
})

test('config changes labels, hides panels and turns the moments off', { options: { architectLabel: 'REVIEWER', panels: 'main,architect,agents,log', moments: false } }, async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-fable-5-1', agentId: `r${++n}` }))
  await $.turn.start({ text: 'review it', turnId: 'T3' })
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review'))
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /REVIEWER · advising/ })).toBeDefined()
  expect(await ui.find({ text: /permissions/ })).toBeUndefined()
  expect(await ui.find({ text: /before a plan/ })).toBeUndefined()
  await ui.unmount()
})

test('a consult whose start and result share one row closes, and its review flag with it', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.turn.start({ text: 'go', turnId: 'T4' })
  // An edit first, so the consult is inferred as "before done" and sets the review flag.
  await $.tool.call({ tool: 'Edit', file_path: '/x.ts', old_string: 'a', new_string: 'b' } as never)
  await $.session
    .append({
      message: {
        type: 'assistant',
        role: 'assistant',
        content: [
          { type: 'server_tool_use', id: 'srv9', name: 'advisor', input: {} },
          { type: 'advisor_tool_result', tool_use_id: 'srv9', content: { type: 'advisor_redacted_result' } },
        ] as never,
      },
      door: 'response',
      origin: { kind: 'model', model: 'claude-opus-5-5' } as never,
      uuid: 'one-row',
    })
    .catch(() => undefined)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /ARCHITECT · on call/ })).toBeDefined()
  expect(await ui.find({ text: /◆ before done/ })).toBeDefined()
  expect(await ui.find({ text: /reviewing before done/ })).toBeUndefined()
  await ui.unmount()
})

test('with no architect anywhere, the panel, legend entry and status field stay hidden', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /ARCHITECT/ })).toBeUndefined()
  expect(await ui.find({ text: /^ architect$/ })).toBeUndefined()
  await ui.unmount()
})

test('cards that cannot fit the pane fall back to lanes', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'W1' })
  for (const d of ['alpha', 'beta', 'gamma']) await $.agent.spawn(spawn('Explore', `task ${d}`))
  const narrow = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await narrow.find({ text: /━/ })).toBeDefined() // lanes
  await narrow.unmount()
  const wide = await $.ui.mount({ ...pane(70), surface: 'terminal' })
  expect(await wide.find({ text: /━/ })).toBeUndefined() // three cards fit in 70
  expect(await wide.find({ text: /task gamma/ })).toBeDefined()
  await wide.unmount()
})

test("a background architect's advice is read from its hand-back", async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-fable-5-1', agentId: 'fab1' }))
  await $.turn.start({ text: 'review it', turnId: 'H1' })
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review'))
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'H1', agentId: 'fab1', reason: 'answer' })
  await $.turn.start({
    text: '<agent-message from="fab1">\n[Subagent hand-back] The report follows:\n  Ship it after one more gate test.\n</agent-message>',
    turnId: 'H2',
  })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /» Ship it after one more gate test\./ })).toBeDefined()
  await ui.unmount()
})

test('each rate-limit window shows the time to its reset where the main panel has room', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const at = (ms: number) => new Date(ms).toISOString()
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 19, resetsAt: at(3 * 3_600_000 + 10 * 60_000) },
      { kind: 'seven_day', percentUsed: 3, resetsAt: at(4 * 86_400_000 + 2 * 3_600_000) },
    ],
    changed: ['rateLimits'],
  })
  for (const cols of [64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /19% ↻3h10m/ })).toBeDefined()
    expect(await ui.find({ text: /3% ↻4d2h/ })).toBeDefined()
    await ui.unmount()
  }
  const narrow = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await narrow.find({ text: /19%/ })).toBeDefined()
  expect(await narrow.find({ text: /↻/ })).toBeUndefined() // no room: the gauges stay whole
  await narrow.unmount()
})

test("the main box shows the last request's time to first token and decode speed", async ($, on) => {
  const clock = engine(on)
  // The model beneath: 800 ms to its first words, then 2 s more to stop after 120 tokens.
  on('turn.step', async function* () {
    await clock.sleep(800)
    yield { kind: 'text' as const, index: 0, text: 'hello' }
    await clock.sleep(2000)
    const usage = { input_tokens: 10, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: 'S1', index: 0, answer: 'hello', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const before = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await before.find({ text: /ttft/ })).toBeUndefined() // nothing measured yet: no line
  await before.unmount()
  const s = $.turn.step({ turnId: 'S1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  const first = s.next()
  await clock.advance(800)
  expect((await first).value).toEqual({ kind: 'text', index: 0, text: 'hello' })
  const stop = s.next()
  await clock.advance(2000)
  await stop
  for await (const _ of s) void _
  await s.result
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /ttft 0\.8s · 60 tok\/s/ })).toBeDefined()
    await ui.unmount()
  }
})

// ---------------------------------------------------------------- the office

test('a researching agent walks to the warehouse, then the workshop, and says so', async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'r1' }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.turn.start({ text: 'research mods', turnId: 'O1' })
  await $.agent.spawn(spawn('general-purpose', 'research mods'))
  await $.tool.call({ tool: 'WebSearch', query: 'claude code mods', agentId: 'r1' } as never)
  const name = namesFor(['r1']).get('r1') ?? ''
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(80), surface })
    expect(await ui.find({ text: /office · 2 at work/ })).toBeDefined()
    expect(await ui.find({ in: 'office', text: /Warehouse/ })).toBeDefined()
    expect(await ui.find({ in: 'office', text: new RegExp(`aisle|forklift|boxes|cat`) })).toBeDefined()
    expect(await ui.find({ in: 'office', text: /claude code mods/ })).toBeDefined()

    // The next errand is an edit: they head down the hallway, then settle in the workshop.
    await $.tool.call({ tool: 'Edit', file_path: '/src/mod.ts', old_string: 'a', new_string: 'b', agentId: 'r1' } as never)
    expect(await ui.find({ in: 'office', text: /heading to the Workshop/ })).toBeDefined()
    await ui.advance(2000)
    expect(await ui.find({ in: 'office', text: /heading to the Workshop/ })).toBeUndefined()
    expect(await ui.find({ in: 'office', text: new RegExp(`${name}: .*mod\\.ts`) })).toBeDefined()
    await ui.unmount()
    await $.tool.call({ tool: 'WebSearch', query: 'claude code mods', agentId: 'r1' } as never)
  }
})

test('a pending permission sends the worker to HR and the header asks for you', async ($, on) => {
  engine(on)
  on('tool.check', () => ({ decision: 'ask' }))
  // The call is still waiting on you: its errand started, its check came back "ask".
  on('tool.call', async (_$, e) => {
    await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: (e as { tool_use_id: string }).tool_use_id })
    const ui = await $.ui.mount({ ...pane(80), surface: 'terminal' })
    expect(await ui.find({ text: /someone needs your signature/ })).toBeDefined()
    expect(await ui.find({ in: 'office', text: /Claude: .*rm -rf build/ })).toBeDefined()
    await ui.unmount()
    return { result: {}, text: 'ok' }
  })
  await $.turn.start({ text: 'clean up', turnId: 'O2' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as never)
})

test('above the prompt, the office is one line', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.turn.start({ text: 'go', turnId: 'O3' })
  await $.tool.call({ tool: 'Read', file_path: '/a/b.ts' } as never)
  const ui = await $.ui.mount({ ...pane(80), props: { ...pane(80).props, placement: 'inline' as const }, surface: 'terminal' })
  expect(await ui.find({ text: /Claude ▸ Archives/ })).toBeDefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- alerts

test('the highest threshold crossed raises one alert, and never again', () => {
  const cfg = { costBudgetUsd: 5, costWarnPct: [50, 80, 100], contextWarnPct: [70, 90] }
  const a = crossedAlerts([], { costUsd: 4.2, contextPct: 40 }, cfg)
  expect(a.alerts).toEqual([{ key: 'cost:80', kind: 'cost', pct: 80 }])
  expect(a.fired).toEqual(['cost:50', 'cost:80'])
  const b = crossedAlerts(a.fired, { costUsd: 4.5, contextPct: 91 }, cfg)
  expect(b.alerts).toEqual([{ key: 'context:90', kind: 'context', pct: 90 }])
  expect(crossedAlerts(b.fired, { costUsd: 4.6, contextPct: 95 }, cfg).alerts).toEqual([])
  expect(crossedAlerts([], { costUsd: 99, contextPct: null }, { ...cfg, costBudgetUsd: 0 }).alerts).toEqual([])
  expect(alertText({ key: 'cost:100', kind: 'cost', pct: 100 }, { costUsd: 5.5, budgetUsd: 5 })).toBe('Accounts: over budget, $5.50 of $5.00 spent')
  expect(percentList('80, 50,x,120,50', [1])).toEqual([50, 80])
  expect(percentList('', [70, 90])).toEqual([70, 90])
})

test('crossing the budget toasts once and logs it', { options: { costBudgetUsd: 2 } }, async ($, on) => {
  engine(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const measure = (usd: number) => $.session.measure({ context: { window: 200_000, percent: 10 }, cost: { usd } as never, rateLimits: [], changed: ['cost'] })
  await measure(0.5)
  await measure(1.7)
  await measure(1.8)
  expect(toasts).toEqual(['Accounts: 80% of the $2.00 budget spent ($1.70)'])
  const ui = await $.ui.mount({ ...pane(80), surface: 'terminal' })
  expect(await ui.find({ text: /80% of the \$2\.00 budget/ })).toBeDefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- usage log

test('a session is filed under the day it started; the report totals it', () => {
  let log = recordTurn({}, 's1', { cwd: '/u/me/agent-office', model: 'claude-opus-5-5', costUsd: 0.4, agents: 2, at: 1000 })
  log = recordTurn(log, 's1', { cwd: '/u/me/agent-office', model: '', costUsd: 0.9, agents: 1, at: 2000 })
  log = recordTurn(log, 's2', { cwd: '/u/me/daily-dose', model: 'claude-sonnet-5-5', costUsd: null, agents: 0, at: 3000 })
  expect(log.s1).toEqual({ cwd: '/u/me/agent-office', model: 'claude-opus-5-5', costUsd: 0.9, turns: 2, agents: 3, firstAt: 1000, lastAt: 2000 })
  expect(totalOf('d', log)).toEqual({ day: 'd', sessions: 2, turns: 3, agents: 3, costUsd: 0.9 })
  const today = usageReport('today', [{ day: '2026-10-15', log }])
  expect(today).toContain('| agent-office | Opus 5.5 | 2 | 3 | $0.90 |')
  expect(today).toContain('| daily-dose | Sonnet 5.5 | 1 | 0 | — |')
  expect(usageReport('week', [{ day: '2026-10-14', log: {} }, { day: '2026-10-15', log }])).toContain('| **Total** | 2 | 3 | 3 | **$0.90** |')
  expect(usageReport('today', [{ day: '2026-10-15', log: {} }])).toBe('No sessions logged today yet.')
  expect(staleKeys(['usage:2020-01-01', 'usage:2999-01-01', 'other'], Date.parse('2026-10-15T12:00:00'))).toEqual(['usage:2020-01-01'])
  expect(lastDays(Date.parse('2026-10-15T12:00:00'), 3)).toEqual(['2026-10-13', '2026-10-14', '2026-10-15'])
})

test('each finished turn is logged, and /office usage reads it back', async ($, on) => {
  const clock = engine(on)
  mock.store(on)
  mock.env(on, { HOME: '/nowhere' })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/u/me/agent-office' }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await clock.set(Date.parse('2026-10-15T09:00:00'))
  await $.session.measure({ context: { window: 200_000, percent: 5 }, cost: { usd: 0.25 } as never, rateLimits: [], changed: ['cost'] })
  for (const id of ['U1', 'U2']) {
    await $.turn.start({ text: 'go', turnId: id })
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: id, reason: 'answer' } as never)
  }
  const out = await $.command.run({ command: 'office', args: 'usage', origin: { kind: 'user' } } as never)
  expect(JSON.stringify(out)).toContain('| agent-office | — | 2 | 0 | $0.25 |')
})
