// A session's status file for the department office, read leniently: another version of the mod,
// or a half-written file, reads as nothing rather than breaking the office.
import type { SessionStatus } from '../types'

export const parseStatus = (text: string): SessionStatus | null => {
  try {
    const d = JSON.parse(text) as Record<string, unknown>
    if (typeof d.zone !== 'string') return null
    const repo = typeof d.repo === 'string' && d.repo ? { repo: d.repo } : {}
    const num = (k: string) => (typeof d[k] === 'number' && Number.isFinite(d[k]) ? { [k]: d[k] as number } : {})
    return { zone: d.zone, text: typeof d.text === 'string' ? d.text : '', isError: d.isError === true, at: typeof d.at === 'number' ? d.at : 0, ...repo, ...num('ctxPct'), ...num('ctxTokens'), ...num('window'), ...(d.waiting === 'permission' || d.waiting === 'question' || d.waiting === 'answer' ? { waiting: d.waiting } : {}) }
  } catch {
    return null
  }
}

/** `"40 150 2400 1280"` (rows, cols, x pixels, y pixels) → the cell, `{ w: 16, h: 32 }`; null when the terminal reports no pixels. */
export const cellFromWinsize = (out: string): { w: number; h: number } | null => {
  const [r, c, x, y] = out.trim().split(/\s+/).map(Number)
  if (!r || !c || !x || !y) return null
  const w = Math.round(x / c)
  const h = Math.round(y / r)
  return w >= 3 && h >= 6 && w <= 80 && h <= 160 ? { w, h } : null
}

// ---------------------------------------------------------------- which repo

// macOS reaches /tmp and /var through /private: the same folder by either name.
const parts = (p: string) => p.replace(/^\/private(?=\/(?:tmp|var)\/)/, '').split(/[\\/]/).filter(Boolean)

/**
 * The repo a path is in, for a session whose folder holds several (`~/Documents/GitHub` with
 * sphere-web, sphere-v3-web…): the first folder under the session's own. A file sitting directly in
 * the session folder, or a path outside it, says nothing.
 */
export const repoOfPath = (cwd: string, path: string, isDir = false): string | null => {
  const base = parts(cwd)
  const abs = path.startsWith('/') || path.startsWith('~') ? parts(path.replace(/^~(?=\/)/, '')) : [...base, ...parts(path)]
  // `~/x` can't be resolved without HOME; compare from the end of the session folder instead.
  const start = path.startsWith('~') ? abs.indexOf(base[base.length - 1] ?? '') + 1 : base.length
  if (start <= 0 || (!path.startsWith('~') && base.some((b, i) => abs[i] !== b))) return null
  const rest = abs.slice(start).filter(x => x !== '.')
  return rest.length >= (isDir ? 1 : 2) && rest[0] !== '..' && !rest[0]!.startsWith('.') ? rest[0]! : null
}

/**
 * The repo a tool call works in: its file or path, the folder a shell command moves into, or else
 * the first path in the command that starts with one of `dirs` (the session folder's own folders).
 */
export const repoOfCall = (cwd: string, input: unknown, dirs: ReadonlySet<string> = new Set()): string | null => {
  const i = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  for (const k of ['file_path', 'notebook_path', 'path'] as const) {
    const v = i[k]
    if (typeof v === 'string' && v) {
      const r = repoOfPath(cwd, v, k === 'path')
      if (r) return r
    }
  }
  if (typeof i.command === 'string') {
    const m = /(?:^|[;&|]\s*)cd\s+("[^"]+"|'[^']+'|\S+)|\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/.exec(i.command)
    const dir = (m?.[1] ?? m?.[2])?.replace(/^["']|["']$/g, '')
    if (dir) return repoOfPath(cwd, dir, true)
    for (const tok of i.command.split(/[\s;&|<>()"'=]+/)) {
      const first = /^(?:\.\/)?([\w.-]+)\//.exec(tok)?.[1]
      if (first && dirs.has(first)) return first
      const abs = tok.startsWith('/') ? repoOfPath(cwd, tok, true) : null
      if (abs && dirs.has(abs)) return abs
    }
  }
  return null
}

/** The repos a department names in what it handles: `coding in … (sphere-web, sphere-v3-web)`. */
export const reposIn = (handles: string): string[] => {
  const out: string[] = []
  for (const m of handles.matchAll(/\(([^)]*)\)/g)) for (const r of (m[1] ?? '').split(',')) if (/^[\w.-]+$/.test(r.trim())) out.push(r.trim())
  return out
}

/** The repo a brief names, longest match first (`sphere-v3-web` before `sphere-web`). */
export const repoInText = (text: string, repos: readonly string[]): string | null => {
  const t = text.toLowerCase()
  return [...repos].sort((a, b) => b.length - a.length).find(r => new RegExp(`(^|[^\\w-])${r.toLowerCase().replace(/[.]/g, '\\.')}($|[^\\w-])`).test(t)) ?? null
}

/** A repo's name for a small tag: `sphere-v3-web` → `v3-web`, `sphere-web` → `web`. */
export const shortRepo = (repo: string) => (/^[a-z0-9]+-./i.test(repo) ? repo.replace(/^[a-z0-9]+-/i, '') : repo)
