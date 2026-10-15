// Departments, as pure data: long-running Claude Code sessions that each own an area (PR reviews,
// a set of repos, social media…). The supervisor in an HQ session hands a task to the right one
// with SendMessage instead of spawning a fresh subagent, so each department keeps its own history.
import type { Dispatch, LiveSession } from '../types'
import { shorten } from './core'

export type Department = { label: string; folders: string[]; handles: string }

/**
 * `Label=folder,folder: what it handles | …`, as the `departments` option spells it. A folder is a
 * project folder's name (its last path part), matched against each running session's folder.
 */
export const parseDepartments = (s: string): Department[] =>
  s
    .split('|')
    .map(part => {
      const m = /^\s*([^=\s][^=]*?)\s*=\s*([^:]+?)\s*(?::\s*(.*?))?\s*$/.exec(part)
      if (!m?.[1] || !m[2]) return null
      const folders = m[2].split(',').map(f => f.trim()).filter(Boolean)
      return folders.length > 0 ? { label: m[1], folders, handles: m[3] ?? '' } : null
    })
    .filter((d): d is Department => d !== null)

const folderOf = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''

export type Desk = { folder: string; session: LiveSession | null; others: LiveSession[] }

/** Each department's desks: per folder, the most recently active running session there (the HQ session never). */
export const desksOf = (d: Department, live: readonly LiveSession[], selfId: string): Desk[] =>
  d.folders.map(folder => {
    const here = live
      .filter(s => s.sessionId !== selfId && folderOf(s.cwd).toLowerCase() === folder.toLowerCase())
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return { folder, session: here[0] ?? null, others: here.slice(1) }
  })

/** What the supervisor reads when handed a task: who to message for what, and who's not in. */
export const rosterText = (depts: readonly Department[], live: readonly LiveSession[], selfId: string, hqName: string) => {
  const lines = [
    'Agent Office departments (running Claude Code sessions on this machine). To delegate, use SendMessage with `to` set to the session name in quotes.',
    `You are HQ${hqName ? ` ("${hqName}")` : ''}.`,
  ]
  for (const d of depts) {
    lines.push(`- ${d.label}${d.handles ? `: ${d.handles}` : ''}`)
    for (const desk of desksOf(d, live, selfId)) {
      lines.push(
        desk.session
          ? `  - ${desk.folder}: "${desk.session.name || desk.session.sessionId}" (${desk.session.status})${desk.others.length > 0 ? `; also open there: ${desk.others.map(o => `"${o.name}"`).join(', ')}` : ''}`
          : `  - ${desk.folder}: not running (the user opens a Claude Code session in the ${desk.folder} folder to staff it)`,
      )
    }
  }
  return lines.join('\n')
}

/** Which department and folder a session name belongs to, for labelling a dispatch. */
export const deptOfSession = (depts: readonly Department[], live: readonly LiveSession[], name: string) => {
  const s = live.find(x => x.name === name)
  if (!s) return null
  const folder = folderOf(s.cwd).toLowerCase()
  const d = depts.find(x => x.folders.some(f => f.toLowerCase() === folder))
  return d ? { label: d.label, folder: folderOf(s.cwd) } : null
}

/** A cross-session message's sender and first line, from the text a turn opens with. */
export const crossMessageOf = (text: string): { fromName: string; body: string } | null => {
  const m = /<cross-session-message\b[^>]*?\bfrom-name="([^"]*)"[^>]*>([\s\S]*?)(?:<\/cross-session-message>|$)/.exec(text)
  if (!m) return null
  const body = (m[2] ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
  return { fromName: m[1] ?? '', body: shorten(body, 80) }
}

/** Dispatches after a reply from `fromName`: its newest open one is answered. */
export const answerDispatch = (list: readonly Dispatch[], fromName: string, body: string, at: number): Dispatch[] => {
  const open = [...list].reverse().find(x => x.to === fromName && x.status === 'sent')
  return open ? list.map(x => (x === open ? { ...x, status: 'replied', reply: body, endedAt: at } : x)) : [...list]
}
