// The daily usage log, as pure data: one entry per session, filed under the day it started (so a
// session that runs past midnight is counted once), and the tables `/office usage` prints.
import { fmtUsd, plural, prettyModel } from './core'

export type SessionUsage = {
  cwd: string
  model: string
  costUsd: number | null
  turns: number
  agents: number
  firstAt: number
  lastAt: number
}

/** One day's log, keyed by session id. */
export type DayLog = Record<string, SessionUsage>

export const STORE_PREFIX = 'usage:'
/** Days the store keeps; the files on disk are left alone. */
export const KEEP_DAYS = 90

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD` in local time. */
export const dayOf = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The `n` days ending today, oldest first. */
export const lastDays = (now: number, n: number) => Array.from({ length: n }, (_, i) => dayOf(now - (n - 1 - i) * 86_400_000))

export const normalizeDay = (stored: unknown): DayLog =>
  typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? (stored as DayLog) : {}

/** The day log after one finished turn of `sessionId`: cost and model as they stand now, counts added. */
export const recordTurn = (
  log: DayLog,
  sessionId: string,
  t: { cwd: string; model: string; costUsd: number | null; agents: number; at: number },
): DayLog => {
  const was = log[sessionId]
  return {
    ...log,
    [sessionId]: {
      cwd: t.cwd,
      model: t.model || was?.model || '',
      costUsd: t.costUsd ?? was?.costUsd ?? null,
      turns: (was?.turns ?? 0) + 1,
      agents: (was?.agents ?? 0) + t.agents,
      firstAt: was?.firstAt ?? t.at,
      lastAt: t.at,
    },
  }
}

export type DayTotal = { day: string; sessions: number; turns: number; agents: number; costUsd: number }

export const totalOf = (day: string, log: DayLog): DayTotal =>
  Object.values(log).reduce(
    (s, e) => ({ ...s, sessions: s.sessions + 1, turns: s.turns + e.turns, agents: s.agents + e.agents, costUsd: s.costUsd + (e.costUsd ?? 0) }),
    { day, sessions: 0, turns: 0, agents: 0, costUsd: 0 },
  )

/** Store keys older than the window, to drop. */
export const staleKeys = (keys: readonly string[], now: number) => {
  const oldest = dayOf(now - (KEEP_DAYS - 1) * 86_400_000)
  return keys.filter(k => k.startsWith(STORE_PREFIX) && k.slice(STORE_PREFIX.length) < oldest)
}

const project = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd

/** Today: a row per session. A week: a row per day. Markdown, as a command's answer is shown. */
export const usageReport = (span: 'today' | 'week', days: readonly { day: string; log: DayLog }[]) => {
  if (span === 'today') {
    const today = days[days.length - 1]
    const rows = Object.values(today?.log ?? {}).sort((a, b) => a.firstAt - b.firstAt)
    if (!today || rows.length === 0) return 'No sessions logged today yet.'
    const t = totalOf(today.day, today.log)
    return [
      `**Agent Office usage · ${today.day}**`,
      '',
      '| Project | Model | Turns | Agents | Cost |',
      '|---|---|---:|---:|---:|',
      ...rows.map(r => `| ${project(r.cwd)} | ${prettyModel(r.model)} | ${r.turns} | ${r.agents} | ${r.costUsd === null ? '—' : fmtUsd(r.costUsd)} |`),
      `| **Total** | ${plural(t.sessions, 'session')} | ${t.turns} | ${t.agents} | **${fmtUsd(t.costUsd)}** |`,
    ].join('\n')
  }
  const totals = days.map(d => totalOf(d.day, d.log))
  const all = totals.reduce((s, t) => ({ ...s, sessions: s.sessions + t.sessions, turns: s.turns + t.turns, agents: s.agents + t.agents, costUsd: s.costUsd + t.costUsd }), {
    day: 'week',
    sessions: 0,
    turns: 0,
    agents: 0,
    costUsd: 0,
  })
  if (all.sessions === 0) return 'No sessions logged in the last 7 days.'
  return [
    '**Agent Office usage · last 7 days**',
    '',
    '| Day | Sessions | Turns | Agents | Cost |',
    '|---|---:|---:|---:|---:|',
    ...totals.map(t => `| ${t.day} | ${t.sessions} | ${t.turns} | ${t.agents} | ${fmtUsd(t.costUsd)} |`),
    `| **Total** | ${all.sessions} | ${all.turns} | ${all.agents} | **${fmtUsd(all.costUsd)}** |`,
  ].join('\n')
}
