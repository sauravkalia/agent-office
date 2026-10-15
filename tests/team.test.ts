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
