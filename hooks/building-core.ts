// The building, as pure data: every Claude Code session on this machine. Running ones come from
// Claude Code's session registry (~/.claude/sessions/<pid>.json, one per live process); closed ones
// from the prompt history (~/.claude/history.jsonl: every prompt with its project and session).
// Both formats are Claude Code's own and undocumented, so every field is read leniently.
import type { LiveSession, PastSession } from '../types'
import { shorten } from './core'

export const HISTORY_DAYS = 3
const DAY = 86_400_000

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** One registry file, or null when it doesn't read as a session. */
export const parseLive = (text: string): LiveSession | null => {
  try {
    const d = JSON.parse(text) as Record<string, unknown>
    const sessionId = str(d.sessionId)
    if (!sessionId) return null
    return {
      sessionId,
      name: str(d.name),
      cwd: str(d.cwd),
      status: str(d.status) || 'idle',
      kind: str(d.kind),
      updatedAt: num(d.statusUpdatedAt) || num(d.updatedAt) || num(d.startedAt),
    }
  } catch {
    return null
  }
}

/** Prompts that say nothing about the work: slash commands and the engine's own tagged text. */
const isChatter = (s: string) => /^\s*[/<!]/.test(s)

/** Sessions with a prompt since `since`, newest first, from the history file's lines. */
export const parseHistory = (text: string, since: number): PastSession[] => {
  const by = new Map<string, PastSession>()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let d: Record<string, unknown>
    try {
      d = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const at = num(d.timestamp)
    const sessionId = str(d.sessionId)
    if (!sessionId || at < since) continue
    const prompt = shorten(str(d.display), 80)
    const was = by.get(sessionId)
    const isWork = prompt !== '' && !isChatter(prompt)
    by.set(sessionId, {
      sessionId,
      cwd: str(d.project) || was?.cwd || '',
      firstPrompt: was?.firstPrompt || (isWork ? prompt : ''),
      lastPrompt: isWork ? prompt : was?.lastPrompt || '',
      firstAt: was ? Math.min(was.firstAt, at) : at,
      lastAt: was ? Math.max(was.lastAt, at) : at,
      prompts: (was?.prompts ?? 0) + 1,
    })
  }
  return [...by.values()].sort((a, b) => b.lastAt - a.lastAt)
}

export const historySince = (now: number) => now - HISTORY_DAYS * DAY

export const projectOf = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? (cwd || '?')

/** `just now`, `12m`, `3h`, `2d`. */
export const agoOf = (ms: number, now: number) => {
  const m = Math.floor(Math.max(0, now - ms) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`
}

export type Occupant = { sessionId: string; title: string; isBusy: boolean; isSelf: boolean; since: number; kind: string }
export type Floor = { project: string; cwd: string; people: Occupant[] }

/** Running sessions on a floor per project (busiest floors first), and the closed ones gone home. */
export const buildingScene = (o: { live: readonly LiveSession[]; past: readonly PastSession[]; selfId: string; maxGone?: number }) => {
  const pastById = new Map(o.past.map(p => [p.sessionId, p]))
  const floors = new Map<string, Floor>()
  for (const s of o.live) {
    const project = projectOf(s.cwd)
    const f = floors.get(s.cwd) ?? { project, cwd: s.cwd, people: [] }
    const p = pastById.get(s.sessionId)
    f.people.push({
      sessionId: s.sessionId,
      title: shorten(s.name || p?.lastPrompt || p?.firstPrompt || 'new session', 40),
      isBusy: s.status === 'busy',
      isSelf: s.sessionId === o.selfId,
      since: s.updatedAt,
      kind: s.kind,
    })
    floors.set(s.cwd, f)
  }
  const liveIds = new Set(o.live.map(s => s.sessionId))
  const gone = o.past.filter(p => !liveIds.has(p.sessionId)).slice(0, o.maxGone ?? 8)
  const sorted = [...floors.values()].sort(
    (a, b) => b.people.filter(p => p.isBusy).length - a.people.filter(p => p.isBusy).length || a.project.localeCompare(b.project),
  )
  return { floors: sorted, gone, busy: o.live.filter(s => s.status === 'busy').length }
}
