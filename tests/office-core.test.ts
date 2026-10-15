import { expect, test } from 'claude-code/testing'

import { DEFAULT_GATE, normalizeCard, recordCheck } from '../hooks/core'
import { finishErrand, namesFor, officeLine, officeScene, quipOf, startErrand, whatOf, zoneOf } from '../hooks/office-core'
import type { AgentCard, Errands } from '../types'

test('each kind of tool sends its worker to its own room', () => {
  expect(zoneOf('WebSearch')).toBe('warehouse')
  expect(zoneOf('WebFetch')).toBe('warehouse')
  expect(zoneOf('mcp__claude_ai_Slack__search')).toBe('warehouse')
  expect(zoneOf('Read')).toBe('archives')
  expect(zoneOf('Grep')).toBe('archives')
  expect(zoneOf('Edit')).toBe('workshop')
  expect(zoneOf('Write')).toBe('workshop')
  expect(zoneOf('Bash')).toBe('server')
  expect(zoneOf('Agent')).toBe('meeting')
  expect(zoneOf('AskUserQuestion')).toBe('hr')
  expect(zoneOf('TodoWrite')).toBe('desk')
})

test('names are stable per id and never repeat in one office', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `agent-${i}`)
  const a = namesFor(ids)
  const b = namesFor(ids)
  expect([...a.values()]).toEqual([...b.values()])
  expect(new Set(a.values()).size).toBe(12)
  // A thirteenth worker still gets a distinct name.
  expect(new Set(namesFor([...ids, 'agent-12']).values()).size).toBe(13)
})

test('a quip names what the worker is doing, and is the same for the same seed', () => {
  expect(whatOf({ tool: 'WebSearch', text: 'WebSearch → claude code mods' })).toBe('claude code mods')
  expect(whatOf({ tool: 'TodoWrite', text: 'TodoWrite' })).toBe('TodoWrite')
  const q = quipOf('warehouse', 'ok', 3, 'claude code mods')
  expect(q).toContain('claude code mods')
  expect(quipOf('warehouse', 'ok', 3, 'claude code mods')).toBe(q)
  expect(quipOf('coffee', 'oops', 0, '', 'failed')).toContain('failed')
})

const card = (id: string, status = 'running'): AgentCard => ({ ...normalizeCard({}), id, status, description: `task ${id}` })

test('the manager sits at the desk when idle and walks to the room of the current errand', () => {
  const idle = officeScene({ cards: [], errands: {}, gate: DEFAULT_GATE, isRunning: false, isAdvising: false, architectLabel: 'ARCHITECT' })
  expect(idle).toHaveLength(1)
  expect(idle[0]).toMatchObject({ name: 'Claude', zone: 'desk', mood: 'idle', isBoss: true })

  const errands = startErrand({}, 'main', { tool: 'Edit', text: 'Edit → src/app.ts', toolUseId: 't1', at: 5 })
  const busy = officeScene({ cards: [], errands, gate: DEFAULT_GATE, isRunning: true, isAdvising: false, architectLabel: 'ARCHITECT' })
  expect(busy[0]).toMatchObject({ zone: 'workshop', mood: 'ok' })
  expect(busy[0]?.quip).toContain('src/app.ts')
})

test('a pending permission sends the worker to HR; a failure is an oops; finished staff take a break', () => {
  let errands: Errands = startErrand({}, 'a1', { tool: 'Bash', text: 'Bash → rm -rf build', toolUseId: 'x1', at: 1 })
  errands = startErrand(errands, 'a2', { tool: 'WebFetch', text: 'WebFetch → https://example.com', toolUseId: 'x2', at: 2 })
  const gate = recordCheck(DEFAULT_GATE, { id: 'x1', tool: 'Bash', bucket: 'shell', verdict: 'ask', inSubagent: true, detail: 'Bash → rm -rf build', at: 1 })
  errands = finishErrand(errands, 'a2', 'x2', true)
  const cards = [card('a1'), card('a2'), card('a3', 'done'), card('a4', 'failed')]
  const people = officeScene({ cards, errands, gate, isRunning: true, isAdvising: true, architectLabel: 'ARCHITECT' })
  const byId = new Map(people.map(p => [p.id, p]))
  expect(byId.get('a1')).toMatchObject({ zone: 'hr', mood: 'waiting' })
  expect(byId.get('a2')).toMatchObject({ zone: 'warehouse', mood: 'oops' })
  expect(byId.get('a3')).toMatchObject({ zone: 'coffee', mood: 'done' })
  expect(byId.get('a4')).toMatchObject({ zone: 'coffee', mood: 'oops' })
  expect(byId.get('architect')).toMatchObject({ zone: 'meeting', name: 'Architect' })
  expect(officeLine(people, 400)).toContain('HR Desk (needs you)')
})

test('a finish for an older call does not touch the newer errand', () => {
  let errands = startErrand({}, 'main', { tool: 'Read', text: 'Read → a.ts', toolUseId: 'old', at: 1 })
  errands = startErrand(errands, 'main', { tool: 'Edit', text: 'Edit → a.ts', toolUseId: 'new', at: 2 })
  expect(finishErrand(errands, 'main', 'old', true)).toBe(errands)
})

test('only the newest staff get seats, running ones first', () => {
  const cards = Array.from({ length: 10 }, (_, i) => card(`c${i}`, i < 7 ? 'done' : 'running'))
  const people = officeScene({ cards, errands: {}, gate: DEFAULT_GATE, isRunning: true, isAdvising: false, architectLabel: 'ARCHITECT', maxStaff: 5 })
  const ids = people.map(p => p.id)
  expect(ids).toHaveLength(6)
  expect(ids).toEqual(expect.arrayContaining(['main', 'c7', 'c8', 'c9', 'c5', 'c6']))
})
