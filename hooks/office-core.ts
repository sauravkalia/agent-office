// The office, as pure data: which room a tool sends a worker to, the worker's name and what they
// mutter while there. Nothing here touches `$`, so the whole floor plan is testable directly.
import type { AgentCard, Errand, Errands, Gate, Person, Zone } from '../types'
import { shorten } from './core'

// ---------------------------------------------------------------- rooms

/** The floor plan, two rows of four; the hallway runs between the rows. */
export const ROOMS: readonly { zone: Zone; label: string }[] = [
  { zone: 'desk', label: 'Open Plan' },
  { zone: 'archives', label: 'Archives' },
  { zone: 'warehouse', label: 'Warehouse' },
  { zone: 'workshop', label: 'Workshop' },
  { zone: 'server', label: 'Server Rm' },
  { zone: 'meeting', label: 'Meeting Rm' },
  { zone: 'hr', label: 'HR Desk' },
  { zone: 'coffee', label: 'Break Room' },
]

export const roomLabel = (z: Zone) => ROOMS.find(r => r.zone === z)?.label ?? 'Open Plan'

const ARCHIVES = new Set(['Read', 'Grep', 'Glob', 'LSP', 'ToolSearch', 'Skill', 'ListMcpResourcesTool', 'ReadMcpResourceTool'])
const WAREHOUSE = new Set(['WebSearch', 'WebFetch'])
const WORKSHOP = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
const SERVER = new Set(['Bash', 'PowerShell', 'Monitor', 'BashOutput', 'KillShell', 'TaskStop'])
const MEETING = new Set(['Agent', 'Task', 'SendMessage', 'Workflow'])
const HR = new Set(['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode'])

/** Where a tool call sends its worker: research goes to the warehouse, reading to the archives… */
export const zoneOf = (tool: string): Zone =>
  WAREHOUSE.has(tool) || tool.startsWith('mcp__')
    ? 'warehouse'
    : ARCHIVES.has(tool)
      ? 'archives'
      : WORKSHOP.has(tool)
        ? 'workshop'
        : SERVER.has(tool)
          ? 'server'
          : MEETING.has(tool)
            ? 'meeting'
            : HR.has(tool)
              ? 'hr'
              : 'desk'

// ---------------------------------------------------------------- staff

const NAMES = ['Priya', 'Bob', 'Mei', 'Raj', 'Olu', 'Greta', 'Kenji', 'Lola', 'Dev', 'Ines', 'Tariq', 'Zoe'] as const

/** A small stable hash: the same id always gets the same name and the same joke. */
export const hashOf = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** A name per agent id, unique among the ids given (in order), stable for each id. */
export const namesFor = (ids: readonly string[]): Map<string, string> => {
  const out = new Map<string, string>()
  const taken = new Set<string>()
  for (const id of ids) {
    const start = hashOf(id) % NAMES.length
    let name: string = NAMES[start] ?? 'Temp'
    for (let k = 0; k < NAMES.length && taken.has(name); k += 1) name = NAMES[(start + k) % NAMES.length] ?? 'Temp'
    if (taken.has(name)) name = `${name} ${out.size + 1}`
    taken.add(name)
    out.set(id, name)
  }
  return out
}

// ---------------------------------------------------------------- quips

type Mood = Person['mood']

const QUIPS: Record<Zone, readonly string[]> = {
  warehouse: [
    'rummaging through aisle 7 for {what}',
    'forklift-certified, hunting {what}',
    'dusting off boxes marked {what}',
    'asking the warehouse cat about {what}',
  ],
  archives: ['flipping through {what}', 'blowing the dust off {what}', 'squinting at {what}', 'cross-referencing {what}'],
  workshop: ['hammering on {what}', 'welding {what} together', 'sanding the edges of {what}', 'measuring twice, cutting {what}'],
  server: ['typing furiously: {what}', 'whispering to the servers: {what}', 'running {what} and hoping', 'kicking the rack over {what}'],
  meeting: ['briefing a new hire: {what}', 'drawing boxes on the whiteboard', 'booked the room for {what}'],
  hr: ['waiting for your signature on {what}', 'filled in form 27B/6 for {what}', 'pacing outside HR about {what}'],
  desk: ['thinking very hard', 'staring at the ceiling, planning', 'sipping tea, plotting the next move', 'typing up notes'],
  coffee: ['clocked out, report filed', 'celebrating with a donut', 'done, refilling the coffee'],
}
const IDLE = ['feet up on the desk', 'waiting for your next ask', 'reorganising sticky notes'] as const
const OOPS = ['spilled coffee on {what}', 'blames the intern for {what}', '{what} exploded, sweeping up'] as const
const QUIT = ['went home early ({status})', 'stormed out ({status})'] as const

const pick = <T>(list: readonly T[], seed: number): T => list[seed % list.length] as T

/** The short "what" of an errand: the part after the arrow, or the tool's own name. */
export const whatOf = (e: Pick<Errand, 'tool' | 'text'> | undefined) => {
  if (!e) return ''
  const after = e.text.split('→ ')[1]?.trim()
  return shorten(after || e.tool, 28)
}

export const quipOf = (zone: Zone, mood: Mood, seed: number, what: string, status = '') => {
  const w = what || 'something'
  const line =
    mood === 'oops' && zone === 'coffee'
      ? pick(QUIT, seed)
      : mood === 'oops'
        ? pick(OOPS, seed)
        : mood === 'idle'
          ? pick(IDLE, seed)
          : pick(QUIPS[zone], seed)
  return line.replace('{what}', w).replace('{status}', status)
}

// ---------------------------------------------------------------- errands

/** A worker sets off on a tool call: their errand is the call, until the next one replaces it. */
export const startErrand = (all: Errands, who: string, e: Omit<Errand, 'isError' | 'isDone'>): Errands => {
  const next: Errands = { ...all, [who]: { ...e, isError: false, isDone: false } }
  const keys = Object.keys(next)
  if (keys.length <= 40) return next
  // Keep the 40 freshest workers; the main loop is never dropped.
  const keep = new Set(
    keys
      .filter(k => k !== 'main')
      .sort((a, b) => (next[b]?.at ?? 0) - (next[a]?.at ?? 0))
      .slice(0, 39),
  )
  return Object.fromEntries(Object.entries(next).filter(([k]) => k === 'main' || keep.has(k)))
}

/** The call came back: the worker stays in that room (until the next errand), marked if it failed. */
export const finishErrand = (all: Errands, who: string, toolUseId: string, isError: boolean): Errands => {
  const e = all[who]
  if (!e || e.toolUseId !== toolUseId) return all
  return { ...all, [who]: { ...e, isDone: true, isError } }
}

export const normalizeErrands = (stored: unknown): Errands =>
  typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? (stored as Errands) : {}

// ---------------------------------------------------------------- the scene

const isPending = (g: Gate, toolUseId: string) => g.recent.some(c => c.id === toolUseId && c.verdict === 'ask')

/** Where one worker is and what they say, from their errand and status. */
const placeOf = (
  errand: Errand | undefined,
  g: Gate,
  o: { isWorking: boolean; status: string },
): { zone: Zone; mood: Mood } => {
  if (o.status === 'done') return { zone: 'coffee', mood: 'done' }
  if (o.status === 'failed' || o.status === 'stopped') return { zone: 'coffee', mood: 'oops' }
  if (!o.isWorking) return { zone: 'desk', mood: 'idle' }
  if (!errand) return { zone: 'desk', mood: 'ok' }
  if (!errand.isDone && isPending(g, errand.toolUseId)) return { zone: 'hr', mood: 'waiting' }
  return { zone: zoneOf(errand.tool), mood: errand.isError ? 'oops' : 'ok' }
}

export type SceneInput = {
  cards: readonly AgentCard[]
  errands: Errands
  gate: Gate
  isRunning: boolean
  isAdvising: boolean
  architectLabel: string
  /** How many subagents get a seat: the newest, running ones first. */
  maxStaff?: number
}

/** Everyone in the office right now: the main loop as the manager, subagents as staff. */
export const officeScene = (s: SceneInput): Person[] => {
  const people: Person[] = []
  const mainErrand = s.errands.main
  const mp = placeOf(mainErrand, s.gate, { isWorking: s.isRunning, status: 'running' })
  const mainSeed = hashOf(`main${mainErrand?.at ?? 0}`)
  people.push({ id: 'main', name: 'Claude', zone: mp.zone, mood: mp.mood, isBoss: true, quip: quipOf(mp.zone, mp.mood, mainSeed, whatOf(mainErrand)) })

  const max = s.maxStaff ?? 6
  const running = s.cards.filter(c => c.status === 'running')
  const finished = s.cards.filter(c => c.status !== 'running')
  const seated = [...running, ...finished.slice(-Math.max(0, max - running.length))].slice(-max)
  const names = namesFor(s.cards.map(c => c.id))
  for (const c of s.cards) {
    if (!seated.includes(c)) continue
    const errand = s.errands[c.id]
    const p = placeOf(errand, s.gate, { isWorking: true, status: c.status })
    const seed = hashOf(`${c.id}${errand?.at ?? 0}`)
    people.push({
      id: c.id,
      name: names.get(c.id) ?? 'Temp',
      zone: p.zone,
      mood: p.mood,
      isBoss: false,
      quip: quipOf(p.zone, p.mood, seed, whatOf(errand) || shorten(c.description, 28), c.status),
    })
  }
  if (s.isAdvising) {
    people.push({ id: 'architect', name: s.architectLabel.charAt(0) + s.architectLabel.slice(1).toLowerCase(), zone: 'meeting', mood: 'ok', isBoss: false, quip: 'reviewing the plan on the whiteboard' })
  }
  return people
}

/** The office on one line, for the summary above the prompt: `Claude ▸ Workshop · Priya ▸ Warehouse`. */
export const officeLine = (people: readonly Person[], width: number) =>
  shorten(people.map(p => `${p.name} ▸ ${roomLabel(p.zone)}${p.mood === 'waiting' ? ' (needs you)' : ''}`).join(' · '), width)
