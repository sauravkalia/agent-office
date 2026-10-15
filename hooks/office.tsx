// The office floor, drawn on the surface's own frame clock: rooms in two rows with a hallway
// between them. When a worker's room changes they walk the hallway to the new one; while they work
// their dots tick. Only this region redraws; the pane does not.
import type { ClientModule } from 'claude-code'

import type { Person, Zone } from '../types'

type Colors = {
  wall: string
  label: string
  boss: string
  staff: string
  waiting: string
  oops: string
  done: string
  floor: string
  text: string
  dim: string
}

type Props = {
  width: number
  motion: boolean
  rooms: { zone: Zone; label: string }[]
  people: Person[]
  colors: Colors
}

type Walk = { from: Zone; to: Zone; start: number }
type Ref = { phase: number; at: Record<string, Zone>; walks: Record<string, Walk>; motion: boolean }
type State = { ref: Ref }

const STEP_MS = 110
const WALK_FRAMES = 14
const PER_ROOM = 3
const COLS = 4
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

const Office: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref: Ref = surface.state?.ref ?? { phase: 0, at: {}, walks: {}, motion: props.motion }
  ref.motion = props.motion

  // Who moved since the last props: they set off down the hallway.
  for (const p of props.people) {
    const was = ref.at[p.id]
    if (was !== undefined && was !== p.zone && ref.motion) ref.walks[p.id] = { from: was, to: p.zone, start: ref.phase }
    ref.at[p.id] = p.zone
  }
  const isWalking = (id: string) => {
    const w = ref.walks[id]
    return w !== undefined && ref.phase - w.start < WALK_FRAMES
  }

  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(STEP_MS, () => {
      ref.phase += 1
      const anyWalk = Object.keys(ref.walks).some(isWalking)
      for (const id of Object.keys(ref.walks)) if (!isWalking(id)) delete ref.walks[id]
      // Walks draw every frame; the working dots only every third, and nothing at all when still.
      if (anyWalk || (ref.motion && ref.phase % 3 === 0)) surface.setState({ ref })
    })
  }

  const W = Math.max(40, surface.columns || props.width)
  const roomW = Math.max(9, Math.floor((W - (COLS - 1)) / COLS))
  const C = props.colors
  const colorOf = (p: Person) =>
    p.mood === 'waiting' ? C.waiting : p.mood === 'oops' ? C.oops : p.mood === 'done' ? C.done : p.isBoss ? C.boss : C.staff
  const glyphOf = (p: Person) => (p.isBoss ? '☻' : '☺')
  // One cell, so it survives the narrowest room: a braille spinner while someone works.
  const spin = SPINNER[Math.floor(ref.phase / 3) % SPINNER.length] ?? '⠿'
  const suffixOf = (p: Person) =>
    p.mood === 'waiting'
      ? ' ?'
      : p.mood === 'oops'
        ? ' !'
        : p.mood === 'done'
          ? ' ✓'
          : p.mood === 'idle'
            ? Math.floor(ref.phase / 9) % 2 === 0 ? ' z' : ' Z'
            : p.zone === 'desk' || !ref.motion
              ? ''
              : ` ${spin}`

  const seated = (z: Zone) => props.people.filter(p => p.zone === z && !isWalking(p.id))

  const roomRow = (rooms: { zone: Zone; label: string }[]) => {
    const most = Math.min(PER_ROOM + 1, Math.max(1, ...rooms.map(r => seated(r.zone).length)))
    return (
      <Box columnGap={1}>
        {rooms.map(r => {
          const here = seated(r.zone)
          const shown = here.length > PER_ROOM + 1 ? here.slice(0, PER_ROOM) : here
          return (
            <Box key={`room-${r.zone}`} flexDirection="column" borderStyle="round" borderColor={C.wall} paddingX={1} width={roomW} height={3 + most}>
              <Text color={C.label} bold wrap="truncate">
                {r.label}
              </Text>
              {shown.map(p => (
                <Text color={colorOf(p)} wrap="truncate">
                  {`${glyphOf(p)} ${p.name}${suffixOf(p)}`}
                </Text>
              ))}
              {here.length > shown.length ? <Text color={C.dim}>{`+${here.length - shown.length} more`}</Text> : null}
            </Box>
          )
        })}
      </Box>
    )
  }

  // The hallway: a dotted floor with the walkers on it, each between the room they left and the one ahead.
  const centerOf = (z: Zone) => {
    const i = Math.max(0, props.rooms.findIndex(r => r.zone === z))
    return (i % COLS) * (roomW + 1) + Math.floor(roomW / 2)
  }
  const cells: { ch: string; color: string }[] = Array.from({ length: W }, (_, i) => ({ ch: i % 2 === 0 ? '·' : ' ', color: C.floor }))
  for (const p of props.people) {
    const w = ref.walks[p.id]
    if (!w || !isWalking(p.id)) continue
    const t = Math.min(1, (ref.phase - w.start) / (WALK_FRAMES - 1))
    const from = centerOf(w.from)
    const to = centerOf(w.to)
    const x = Math.max(1, Math.min(W - 3, Math.round(from + (to - from) * t)))
    const goesRight = to >= from
    const c = colorOf(p)
    const put = (at: number, ch: string) => {
      if (at >= 0 && at < W) cells[at] = { ch, color: c }
    }
    put(x, glyphOf(p))
    put(x + 1, p.name.charAt(0))
    put(goesRight ? x - 1 : x + 2, ref.phase % 2 === 0 ? (goesRight ? '›' : '‹') : ' ')
  }
  const runs: { text: string; color: string }[] = []
  for (const cell of cells) {
    const last = runs[runs.length - 1]
    if (last && last.color === cell.color) last.text += cell.ch
    else runs.push({ text: cell.ch, color: cell.color })
  }

  // What everyone is saying: whoever needs you first, then trouble, then the busy ones.
  const rank = (p: Person) => (p.mood === 'waiting' ? 0 : p.mood === 'oops' ? 1 : p.mood === 'ok' ? 2 : 3)
  const chatter = [...props.people].sort((a, b) => rank(a) - rank(b)).slice(0, 5)
  const labelOf = (z: Zone) => props.rooms.find(r => r.zone === z)?.label ?? z

  return (
    <Box flexDirection="column" width={W}>
      {roomRow(props.rooms.slice(0, COLS))}
      <Box>
        {runs.map(r => (
          <Text color={r.color}>{r.text}</Text>
        ))}
      </Box>
      {roomRow(props.rooms.slice(COLS, COLS * 2))}
      {chatter.map(p => (
        <Text wrap="truncate">
          <Text color={colorOf(p)} bold>{`${p.name}${p.role && p.role !== 'staff' ? ` (${p.role})` : ''}: `}</Text>
          <Text color={C.text}>{isWalking(p.id) ? `heading to the ${labelOf(p.zone)}…` : p.quip}</Text>
        </Text>
      ))}
    </Box>
  )
}

export default Office
