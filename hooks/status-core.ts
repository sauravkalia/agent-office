// A session's status file for the department office, read leniently: another version of the mod,
// or a half-written file, reads as nothing rather than breaking the office.
import type { SessionStatus } from '../types'

export const parseStatus = (text: string): SessionStatus | null => {
  try {
    const d = JSON.parse(text) as Record<string, unknown>
    if (typeof d.zone !== 'string') return null
    return { zone: d.zone, text: typeof d.text === 'string' ? d.text : '', isError: d.isError === true, at: typeof d.at === 'number' ? d.at : 0 }
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
