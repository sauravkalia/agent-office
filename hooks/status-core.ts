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
