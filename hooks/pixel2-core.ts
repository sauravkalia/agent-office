// The department office, as pure data: one person per department at their own desk, HQ in the
// middle, four shared rooms on top (Archives, Warehouse, Server Rm, Workshop). People walk to HQ
// to collect a brief, to the rooms while their session works, and back to HQ with a result.
// All art is original and drawn here; nothing touches `$`, so frames and motion are testable.

export const AW = 168
export const AH = 153
const ROOM_H = 33
const COR1 = 33
const ROW1 = 49
const ROW2 = 105
const CUB = 56

type RGB = readonly [number, number, number]
const hex = (n: number): RGB => [(n >> 16) & 255, (n >> 8) & 255, n & 255]
export const mix = (a: RGB, b: RGB, k: number): RGB => [0, 1, 2].map(i => Math.round(a[i]! + (b[i]! - a[i]!) * Math.max(0, Math.min(1, k)))) as unknown as RGB
const ease = (k: number) => k * k * (3 - 2 * k)

export const C = {
  bg: hex(0x1b1a20), wall: hex(0x3d2f28), floor: hex(0x4a4f5c), floorB: hex(0x444955), hall: hex(0x2e2b33), tile: hex(0x36323c),
  windowF: hex(0x8b5a3c), wood: hex(0x8b5a3c), woodD: hex(0x5e3b26), woodL: hex(0xa8714d), metal: hex(0x7a7f8a), metalD: hex(0x464a53),
  screen: hex(0x5fb3d9), screenOff: hex(0x2a2d33), skin: hex(0xe8b58f), skin2: hex(0xc68b62), white: hex(0xf4f1ea), tie: hex(0xc0392b),
  amber: hex(0xf9c74f), green: hex(0x90be6d), red: hex(0xe5484d), pink: hex(0xf28482), plant: hex(0x5b9a4b), black: hex(0x23222a),
  grey: hex(0x8a8a8a), paper: hex(0xede0d4), coffee: hex(0x6f4e37), purple: hex(0x9b7ede), teal: hex(0x43aa8b), orange: hex(0xf4a261),
  navy: hex(0x2f3a55), check: hex(0x3f8f3f), lamp: hex(0xffe29a),
} as const

// ---------------------------------------------------------------- canvas

export type Canvas = { w: number; h: number; d: Uint8Array }

export const newCanvas = (w = AW, h = AH, c: RGB = C.bg): Canvas => {
  const d = new Uint8Array(w * h * 3)
  for (let i = 0; i < w * h; i += 1) d.set(c, i * 3)
  return { w, h, d }
}
const P = (f: Canvas, x: number, y: number, c: RGB) => {
  x = Math.round(x)
  y = Math.round(y)
  if (x >= 0 && y >= 0 && x < f.w && y < f.h) f.d.set(c, (y * f.w + x) * 3)
}
const R = (f: Canvas, x: number, y: number, w: number, h: number, c: RGB) => {
  for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) P(f, x + i, y + j, c)
}
const SPR = (f: Canvas, x: number, y: number, rows: readonly string[], keys: Record<string, RGB>, flip = false) => {
  rows.forEach((row, j) => {
    const r = flip ? [...row].reverse().join('') : row
    for (let i = 0; i < r.length; i += 1) {
      const c = keys[r[i] ?? '.']
      if (c) P(f, x + i, y + j, c)
    }
  })
}
export const colorAt = (f: Canvas, x: number, y: number): RGB => {
  const i = (y * f.w + x) * 3
  return [f.d[i] ?? 0, f.d[i + 1] ?? 0, f.d[i + 2] ?? 0]
}

const GLYPHS: Record<string, readonly string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], C: ['###', '#..', '#..', '#..', '###'], E: ['###', '#..', '###', '#..', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'], K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  M: ['#.#', '###', '###', '#.#', '#.#'], O: ['###', '#.#', '#.#', '#.#', '###'], P: ['###', '#.#', '###', '#..', '#..'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'], S: ['###', '#..', '###', '..#', '###'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#.#', '#.#', '###', '###', '#.#'], ' ': ['...', '...', '...', '...', '...'],
}
const SIGN = (f: Canvas, cx: number, y: number, text: string, c: RGB) => {
  let x = cx - Math.floor((text.length * 4 - 1) / 2)
  for (const ch of text.toUpperCase()) {
    SPR(f, x, y, GLYPHS[ch] ?? GLYPHS[' ']!, { '#': c })
    x += 4
  }
}

// ---------------------------------------------------------------- people (original art)

export type Look = 'hq' | 'pr' | 'sphere' | 'social' | 'daily' | 'quilt'

/** A department's person, from its name: PR Review wears glasses, Social has a ring light… */
export const lookOf = (label: string): Look => {
  const l = label.toLowerCase()
  return /review|\bpr\b/.test(l)
    ? 'pr'
    : /social|insta|youtube|content/.test(l)
      ? 'social'
      : /daily|dose|news/.test(l)
        ? 'daily'
        : /discuss|quilt|design|chat/.test(l)
          ? 'quilt'
          : 'sphere'
}

type Spec = { hair: RGB; shirt: RGB; style: 'short' | 'hood' | 'long' | 'cap' | 'bun'; tie?: boolean; glasses?: boolean }
const SPEC: Record<Look, Spec> = {
  hq: { hair: C.grey, shirt: C.white, style: 'short', tie: true },
  pr: { hair: C.coffee, shirt: C.teal, style: 'short', glasses: true },
  sphere: { hair: C.black, shirt: C.purple, style: 'hood' },
  social: { hair: hex(0x7a4a2a), shirt: C.pink, style: 'long' },
  daily: { hair: C.coffee, shirt: C.green, style: 'cap' },
  quilt: { hair: C.woodD, shirt: C.orange, style: 'bun' },
}

const headFront = (s: Spec, blink: boolean) => {
  const e = blink ? 's' : 'e'
  switch (s.style) {
    case 'hood':
      return ['..oooooooo..', '.oohhhhhhoo.', '.ohsssssssho', `kos${e}sss${e}sok`, 'k.ssssssss.k', '...ssssss...']
    case 'long':
      return ['..hhhhhhhh..', '.hhhhhhhhhh.', '.hhsssssshh.', `.hs${e}sss${e}sh.`, '.hssssssssh.', '.h.ssrsss.h.']
    case 'cap':
      return ['..cccccccc..', '.cccccccccc.', '....cccc....', `..s${e}sss${e}ss.`, '..ssssssss..', '...ssssss...']
    case 'bun':
      return ['....hhhh....', '...hhhhhh...', '..hhhhhhhh..', '..hssssssh..', `..s${e}sss${e}s..`, '...ssssss...']
    default:
      return ['...hhhhhh...', '..hhhhhhhh..', '..hssssssh..', s.glasses ? `..gg${e}gg${e}gs.` : `..s${e}sss${e}ss.`, '..ssssssss..', s.tie ? '...ssmmss...' : '...ssssss...']
  }
}
const headBack = (s: Spec) => {
  const k = s.style === 'hood' ? 'o' : s.style === 'cap' ? 'c' : 'h'
  return ['..' + k.repeat(8) + '..', '.' + k.repeat(10) + '.', '.' + k.repeat(10) + '.', '.' + k.repeat(10) + '.', '.' + k.repeat(10) + '.', '...ssssss...']
}
const headSide = (s: Spec, blink: boolean) => {
  const k = s.style === 'hood' ? 'o' : s.style === 'cap' ? 'c' : 'h'
  const e = blink ? 's' : 'e'
  return ['...' + k.repeat(6) + '...', '..' + k.repeat(8) + '..', '..' + k.repeat(3) + 'sssss..', `..${k}${k}sss${e}s...`, '..' + k + 'sssssss..', '...ssssss...']
}
const torso = (s: Spec, side = false, arm = 0) => {
  if (side) {
    const a = 5 + arm
    const rows = ['...cccccc...', '..cccccccc..', '..cccccccc..', '..cccccccc..', '...cccccc...', '...cccccc...']
    rows[2] = rows[2]!.slice(0, a) + 's' + rows[2]!.slice(a + 1)
    rows[3] = rows[3]!.slice(0, a) + 's' + rows[3]!.slice(a + 1)
    return rows
  }
  const rows = ['..cccccccc..', '.cccccccccc.', 'scccccccccs.', 'scccccccccs.', '.cccccccccc.', '..cccccccc..']
  return s.tie ? rows.map(r => r.slice(0, 6) + 't' + r.slice(7)) : rows
}
const LEGS_FRONT = [
  ['...nn..nn...', '...nn..nn...', '...nn..nn...', '...kk..kk...'],
  ['...nn..nn...', '...nn..nn...', '...kk..nn...', '.......kk...'],
  ['...nn..nn...', '...nn..nn...', '...nn..nn...', '...kk..kk...'],
  ['...nn..nn...', '...nn..nn...', '...nn..kk...', '...kk.......'],
]
const LEGS_SIDE = [
  ['....nnn.....', '....nnn.....', '....nnn.....', '....kkkk....'],
  ['...nn.nn....', '..nn...nn...', '..nn...nn...', '.kk.....kk..'],
  ['....nnn.....', '....nnn.....', '....nnn.....', '....kkkk....'],
  ['....nnnn....', '...nn.nn....', '...nn..nn...', '..kk...kk...'],
]
const keysOf = (s: Spec): Record<string, RGB> => ({
  h: s.hair, o: s.shirt, c: s.shirt, s: C.skin, e: C.black, k: C.black, g: C.metal, r: C.tie, m: C.skin2, t: C.tie, n: C.navy,
})

export type Facing = 'up' | 'down' | 'left' | 'right'
export type Carry = 'paper' | 'done'

export const drawWalker = (f: Canvas, look: Look, x: number, y: number, facing: Facing, frame: number, carry?: Carry, blink = false) => {
  const s = SPEC[look]
  const keys = keysOf(s)
  const step = ((frame % 4) + 4) % 4
  const bob = step % 2 === 0 ? -1 : 0
  const paper = (px: number, py: number) => {
    R(f, px, py, 4, 4, C.paper)
    if (carry === 'done') SPR(f, px, py + 1, ['...g', '..g.', 'gg..'], { g: C.check })
  }
  if (facing === 'left' || facing === 'right') {
    const flip = facing === 'left'
    SPR(f, x, y + bob, [...headSide(s, blink), ...torso(s, true, step === 1 ? 1 : step === 3 ? -1 : 0)], keys, flip)
    SPR(f, x, y + 12, LEGS_SIDE[step]!, keys, flip)
    if (carry) paper(x + (flip ? 1 : 7), y + 7 + bob)
  } else {
    SPR(f, x, y + bob, [...(facing === 'up' ? headBack(s) : headFront(s, blink)), ...torso(s)], keys)
    SPR(f, x, y + 12, LEGS_FRONT[step]!, keys)
    if (carry && facing === 'down') paper(x + 9, y + 7 + bob)
  }
}

const drawSeated = (f: Canvas, look: Look, x: number, y: number, tick: number, busy: boolean, seed: number, lift: number) => {
  const s = SPEC[look]
  const breathe = (tick + seed * 7) % 29 < 6 ? 1 : 0
  const blink = (tick + seed * 11) % 42 < 2
  const up = Math.round(lift * 3)
  SPR(f, x, y + breathe - up, [...headFront(s, blink), ...torso(s)], keysOf(s))
  if (busy && !up) {
    const hand = Math.floor(tick / 2) % 2
    P(f, x + 3 + hand, y + 12, C.skin)
    P(f, x + 8 - hand, y + 12, C.skin)
  }
}

// ---------------------------------------------------------------- places and paths

/** The four shared rooms along the top, left to right; a person walks to one while their session works there. */
export const ROOM_ZONES = ['archives', 'warehouse', 'server', 'workshop'] as const
export type RoomZone = (typeof ROOM_ZONES)[number]
const ROOM_NAMES: Record<RoomZone, string> = { archives: 'Archives', warehouse: 'Warehouse', server: 'Server Rm', workshop: 'Workshop' }
const ROOM_ACCENT: Record<RoomZone, RGB> = { archives: hex(0xcdb4db), warehouse: hex(0xf4a261), server: hex(0x90be6d), workshop: hex(0xf9844a) }

/** Desk slots: 0 1 2 on the first row (1 is HQ), 3 4 5 on the second. */
export const HQ_SLOT = 1
export const slotOrigin = (slot: number) => ({ x: (slot % 3) * CUB, y: slot < 3 ? ROW1 : ROW2 })

export type Place = { kind: 'desk'; slot: number } | { kind: 'hq' } | { kind: 'room'; zone: RoomZone }
type Pt = readonly [number, number]

const corridorOf = (slot: number) => (slot < 3 ? COR1 : 89)
const seat = (slot: number): Pt => {
  const o = slotOrigin(slot)
  return [o.x + 22, o.y + 6]
}
const doorOf = (slot: number): Pt => [slotOrigin(slot).x + 22, corridorOf(slot)]
const hqStand = (): Pt => {
  const o = slotOrigin(HQ_SLOT)
  return [o.x + 40, o.y + 6]
}
const roomDoor = (z: RoomZone): Pt => [ROOM_ZONES.indexOf(z) * 42 + 15, COR1]
const roomSpot = (z: RoomZone): Pt => [ROOM_ZONES.indexOf(z) * 42 + 15, 14]

/** The way from one place to another along the corridors, as corner points. */
export const pathBetween = (a: Place, b: Place): Pt[] => {
  const out = (p: Place): Pt[] =>
    p.kind === 'desk'
      ? [seat(p.slot), doorOf(p.slot)]
      : p.kind === 'hq'
        ? [hqStand(), [slotOrigin(HQ_SLOT).x + 34, ROW1 + 4], [slotOrigin(HQ_SLOT).x + 34, COR1]]
        : [roomSpot(p.zone), roomDoor(p.zone)]
  const from = out(a)
  const to = out(b).reverse()
  const fromDoor = from[from.length - 1]!
  const toDoor = to[0]!
  // Both on the same corridor: walk along it. Otherwise go via the top corridor and the left wall.
  const middle: Pt[] = fromDoor[1] === toDoor[1] ? [] : [[fromDoor[0], fromDoor[1]], [2, fromDoor[1]], [2, toDoor[1]]]
  return [...from, ...middle, ...to].filter((p, i, all) => i === 0 || p[0] !== all[i - 1]![0] || p[1] !== all[i - 1]![1])
}

const lengthOf = (pts: readonly Pt[]) => pts.slice(1).reduce((s, p, i) => s + Math.abs(p[0] - pts[i]![0]) + Math.abs(p[1] - pts[i]![1]), 0)

/** Where along a path someone is at progress `k` (eased), and which way they face. */
export const along = (pts: readonly Pt[], k: number): { x: number; y: number; facing: Facing } => {
  const total = lengthOf(pts) || 1
  let d = ease(Math.max(0, Math.min(1, k))) * total
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const L = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1])
    if (d <= L || i === pts.length - 1) {
      const q = L === 0 ? 1 : Math.min(1, d / L)
      const facing: Facing = b[0] > a[0] ? 'right' : b[0] < a[0] ? 'left' : b[1] > a[1] ? 'down' : 'up'
      return { x: Math.round(a[0] + (b[0] - a[0]) * q), y: Math.round(a[1] + (b[1] - a[1]) * q), facing }
    }
    d -= L
  }
  const last = pts[pts.length - 1] ?? [0, 0]
  return { x: last[0], y: last[1], facing: 'down' }
}

// ---------------------------------------------------------------- actors: who's walking where

/** A step of someone's errands: go somewhere (carrying something), then stay a while. */
export type Goal = { to: Place; carry?: Carry; stayMs: number; tag?: 'brief' | 'drop' | 'work' }
export type Trip = { from: Place; to: Place; start: number; dur: number; carry?: Carry }
export type Actor = { slot: number; look: Look; at: Place; trip: Trip | null; stay: { until: number; tag?: Goal['tag']; carry?: Carry } | null; queue: Goal[] }

const SPEED = 36 / 1000 // art pixels per ms

export const newActor = (slot: number, look: Look): Actor => ({ slot, look, at: { kind: 'desk', slot }, trip: null, stay: null, queue: [] })

const samePlace = (a: Place, b: Place) =>
  a.kind === b.kind && (a.kind !== 'desk' || (b.kind === 'desk' && a.slot === b.slot)) && (a.kind !== 'room' || (b.kind === 'room' && a.zone === b.zone))

/** The actor at time `now`: finishes a trip or a stay that's over, and starts the next errand. */
export const advance = (a: Actor, now: number): Actor => {
  let x = a
  for (let guard = 0; guard < 8; guard += 1) {
    if (x.trip && now >= x.trip.start + x.trip.dur) {
      const t = x.trip
      const goal = x.queue[0]
      x = { ...x, at: t.to, trip: null, stay: goal ? { until: t.start + t.dur + goal.stayMs, tag: goal.tag, carry: t.carry } : null, queue: x.queue.slice(1) }
      continue
    }
    if (x.stay && now >= x.stay.until) {
      x = { ...x, stay: null }
      continue
    }
    if (!x.trip && !x.stay && x.queue.length > 0) {
      const g = x.queue[0]!
      if (samePlace(g.to, x.at)) {
        x = { ...x, stay: { until: now + g.stayMs, tag: g.tag, carry: g.carry }, queue: x.queue.slice(1) }
        continue
      }
      const dur = Math.max(600, lengthOf(pathBetween(x.at, g.to)) / SPEED)
      x = { ...x, trip: { from: x.at, to: g.to, start: now, dur, carry: g.carry } }
      continue
    }
    break
  }
  return x
}

/** Queue the errands for a task handed out by HQ: collect the brief, carry it back to the desk. */
export const briefErrands = (): Goal[] => [
  { to: { kind: 'hq' }, stayMs: 1600, tag: 'brief' },
  { to: { kind: 'desk', slot: -1 }, carry: 'paper', stayMs: 0 },
]
/** …and for a reply: carry the result to HQ, drop it in the tray, walk home. */
export const replyErrands = (): Goal[] => [
  { to: { kind: 'hq' }, carry: 'done', stayMs: 1800, tag: 'drop' },
  { to: { kind: 'desk', slot: -1 }, stayMs: 0 },
]
/** Errands with `slot: -1` mean "my own desk". */
export const forSlot = (goals: readonly Goal[], slot: number): Goal[] =>
  goals.map(g => (g.to.kind === 'desk' && g.to.slot === -1 ? { ...g, to: { kind: 'desk', slot } } : g))

export type Walker = { look: Look; x: number; y: number; facing: Facing; frame: number; carry?: Carry }

/** Where an actor shows: walking, standing in a room or at HQ, or null when seated at their desk. */
export const walkerOf = (a: Actor, now: number): Walker | null => {
  if (a.trip) {
    const pts = pathBetween(a.trip.from, a.trip.to)
    const pos = along(pts, (now - a.trip.start) / a.trip.dur)
    return { look: a.look, ...pos, frame: Math.floor(now / 140), carry: a.trip.carry }
  }
  if (a.at.kind === 'hq') return { look: a.look, x: hqStand()[0], y: hqStand()[1], facing: 'left', frame: 0, carry: a.stay?.tag === 'brief' ? 'paper' : a.stay?.carry }
  if (a.at.kind === 'room') return { look: a.look, x: roomSpot(a.at.zone)[0], y: roomSpot(a.at.zone)[1], facing: 'up', frame: 0 }
  return null
}

// ---------------------------------------------------------------- the scene

export type DeskState = 'closed' | 'idle' | 'busy'
export type BubbleKind = 'busy' | 'idle' | 'reply' | 'sent' | 'alert'
export type Desk = { slot: number; look: Look; state: DeskState; bubble: BubbleKind | null; bubbleSince: number; paper: boolean }
export type RoomFx = { zone: RoomZone; since: number; flash?: 'fail' | 'pass' }
export type Scene = {
  desks: Desk[]
  walkers: Walker[]
  /** Away from their desk: walking, or at HQ or in a room. */
  away: Set<number>
  hqStanding: boolean
  briefSlide: number | null
  tray: boolean
  confettiSince: number | null
  rooms: RoomFx[]
  /** 0 is full daylight, 1 is evening with the lamps on. */
  evening: number
  clock: { h: number; m: number }
}

/** The evening level from the hour: daylight until 3 pm, dimming to 7 pm, lamps on through the night. */
export const eveningOf = (hour: number) => (hour < 7 ? 1 : hour < 15 ? 0 : Math.min(1, (hour - 15) / 4))

const bubble = (f: Canvas, x: number, y: number, kind: BubbleKind, ageFrames: number, tick: number) => {
  if (ageFrames < 1) return R(f, x + 3, y + 3, 3, 2, C.white)
  if (ageFrames < 2) return R(f, x + 1, y + 1, 7, 5, C.white)
  if ((kind === 'reply' || kind === 'alert') && ageFrames < 6) y -= 1
  R(f, x, y, 9, 7, C.white)
  P(f, x + 1, y + 7, C.white)
  P(f, x, y + 8, C.white)
  if (kind === 'busy') [2, 4, 6].forEach((dx, k) => Math.floor(tick / 3) % 4 > k && P(f, x + dx, y + 3, C.black))
  if (kind === 'idle') SPR(f, x + 2, y + 1, ['zzzz', '...z', '..z.', '.z..', 'zzzz'], { z: C.navy })
  if (kind === 'reply') SPR(f, x + 1, y + 1, ['......g', '.....gg', 'g...gg.', 'gg.gg..', '.ggg...'], { g: C.check })
  if (kind === 'sent') {
    R(f, x + 1, y + 1, 7, 5, C.amber)
    SPR(f, x + 1, y + 1, ['a.....a', '.a...a.', '..aaa..'], { a: C.woodD })
  }
  if (kind === 'alert') {
    R(f, x + 4, y + 1, 1, 3, C.red)
    P(f, x + 4, y + 5, C.red)
  }
}

const CONFETTI: readonly (readonly [number, number, RGB])[] = Array.from({ length: 26 }, (_, i) => {
  const a = Math.sin(i * 12.9898) * 43758.5453
  const b = Math.sin(i * 78.233) * 12345.678
  const fx = a - Math.floor(a)
  const fy = b - Math.floor(b)
  return [fx * 3.2 - 1.6, -1.2 - fy * 1.4, [C.amber, C.pink, C.teal, C.purple, C.green, C.red][i % 6]!] as const
})

/** One frame of the office, 168×153 art pixels. `tick` counts frames (about 12 a second); `now` is ms. */
export const drawScene = (sc: Scene, tick: number, now: number): Canvas => {
  const f = newCanvas()
  const e = sc.evening
  const win = e < 0.8 ? mix(hex(0x7cc4e8), hex(0xf2a65a), e * 1.4) : mix(hex(0xf2a65a), hex(0x3a3566), (e - 0.8) / 0.2)
  const floor = mix(C.floor, hex(0x3e3a4a), e * 0.6)
  const floorB = mix(C.floorB, hex(0x38344a), e * 0.6)
  R(f, 0, 0, AW, AH, floor)
  for (const y0 of [COR1, 89]) {
    R(f, 0, y0, AW, 16, mix(C.hall, hex(0x26232e), e * 0.5))
    for (let i = 0; i < AW; i += 8) R(f, i + ((i / 8) % 2 ? 4 : 0), y0 + 7, 2, 2, C.tile)
  }
  // shared rooms
  ROOM_ZONES.forEach((z, n) => {
    const x = n * 42
    const fx = sc.rooms.find(r => r.zone === z)
    let rf = z === 'warehouse' ? hex(0x4d4a40) : hex(0x4a4f5c)
    if (fx?.flash && Math.floor(tick / 2) % 2 === 0) rf = mix(rf, fx.flash === 'fail' ? C.red : C.green, 0.45)
    R(f, x, 0, 42, ROOM_H, C.wall)
    R(f, x + 1, 8, 40, ROOM_H - 9, mix(rf, hex(0x3a3646), e * 0.5))
    R(f, x + 1, 1, 40, 7, ROOM_ACCENT[z])
    SIGN(f, x + 21, 2, ROOM_NAMES[z], C.black)
    R(f, x + 16, ROOM_H - 1, 10, 1, C.hall)
    const age = fx ? Math.max(0, (now - fx.since) / 1000) : 0
    if (z === 'archives')
      for (const dx of [3, 15, 27]) {
        R(f, x + dx, 11, 10, 12, C.woodD)
        for (let rr = 0; rr < 3; rr += 1)
          for (let b = 0; b < 4; b += 1) {
            const out = fx && dx === 15 && rr === 1 && b === 2 ? Math.min(6, Math.round(age * 8)) : 0
            R(f, x + dx + 1 + b * 2, 12 + rr * 4 + out, 1, 3, [C.purple, C.teal, C.amber, C.pink][(b + rr) % 4]!)
          }
      }
    if (z === 'warehouse') {
      const box = fx ? Math.min(1, age * 1.2) : null
      ;[[3, 15], [11, 15], [7, 9], [27, 15], [33, 15]].forEach(([dx, dy], i) => {
        if (box !== null && i === 2) return
        R(f, x + dx!, dy!, 7, 6, C.wood)
        R(f, x + dx!, dy!, 7, 1, C.woodD)
        R(f, x + dx! + 3, dy!, 1, 6, C.woodD)
      })
      if (box !== null) {
        const bx = x + 7 + Math.round(box * 12)
        const by = 9 + Math.round(box * 12)
        R(f, bx, by, 7, 6, C.wood)
        R(f, bx + 3, by, 1, 6, C.woodD)
        if (box >= 1) {
          R(f, bx - 1, by - 2, 4, 1, C.woodL)
          R(f, bx + 4, by - 2, 4, 1, C.woodL)
          if (Math.floor(tick / 3) % 2) P(f, bx + 3, by - 3, C.paper)
        }
      }
    }
    if (z === 'server')
      [4, 15, 26].forEach((dx, di) => {
        R(f, x + dx, 11, 9, 14, C.metalD)
        for (let rr = 0; rr < 4; rr += 1) {
          const ripple = Boolean(fx)
          const on = ripple ? (tick - di * 2 - rr) % 8 < 3 : (Math.floor(tick / 4) + rr + dx) % 5 !== 0
          P(f, x + dx + 2, 13 + rr * 3, on ? (fx?.flash === 'fail' ? C.red : C.green) : C.metal)
          P(f, x + dx + 5, 13 + rr * 3, ripple && (tick + rr) % 6 < 2 ? C.amber : C.metal)
        }
      })
    if (z === 'workshop') {
      R(f, x + 4, 21, 34, 3, C.woodD)
      R(f, x + 8, 16, 3, 5, C.metal)
      R(f, x + 28, 17, 6, 4, C.metalD)
      if (fx)
        for (let j = 0; j < 8; j += 1) {
          const n2 = (tick + j * 3) % 6
          P(f, x + 21 + Math.round(Math.sin(j * 2.1) * n2 * 1.5), 20 - n2 + Math.round(0.25 * n2 * n2), j % 2 ? C.amber : C.lamp)
        }
    }
  })
  // desks
  for (const d of sc.desks) {
    const { x, y } = slotOrigin(d.slot)
    const isHQ = d.slot === HQ_SLOT
    R(f, x, y, CUB, 40, floor)
    for (let yy = y + 8; yy < y + 40; yy += 8) for (let xx = x + (Math.floor(yy / 8) % 2) * 8; xx < x + CUB; xx += 16) R(f, xx, yy, 8, 8, floorB)
    R(f, x, y, 1, 40, C.wall)
    R(f, x + CUB - 1, y, 1, 40, C.wall)
    R(f, x, y, 20, 2, C.wall)
    R(f, x + 36, y, 20, 2, C.wall)
    if (!isHQ) {
      R(f, x + 4, y + 3, 12, 4, C.windowF)
      R(f, x + 5, y + 4, 10, 2, win)
    }
    const closed = d.state === 'closed'
    const away = sc.away.has(d.slot)
    const chair = closed ? C.metalD : isHQ ? C.tie : C.navy
    if (away) {
      R(f, x + 25, y + 8, 6, 10, chair)
      R(f, x + 24, y + 11, 8, 2, chair)
    } else {
      R(f, x + 23, y + 8, 10, 10, chair)
      R(f, x + 22, y + 11, 12, 2, chair)
    }
    if (!closed && !away) drawSeated(f, d.look, x + 22, y + 9, tick, d.state === 'busy', d.slot + 1, isHQ && sc.hqStanding ? 1 : 0)
    const dx = isHQ ? x + 6 : x + 10
    const dw = isHQ ? 44 : 36
    R(f, dx, y + 21, dw, 5, C.wood)
    R(f, dx, y + 21, dw, 1, C.woodL)
    R(f, dx + 1, y + 26, 2, 8, C.woodD)
    R(f, dx + dw - 3, y + 26, 2, 8, C.woodD)
    if (e > 0.65 && !closed) {
      R(f, dx + dw - 8, y + 17, 3, 4, C.metalD)
      R(f, dx + dw - 9, y + 16, 5, 2, C.lamp)
      R(f, dx + dw - 12, y + 21, 10, 1, mix(C.wood, C.lamp, (0.35 * (e - 0.65)) / 0.35))
    }
    const on = d.state === 'busy' && !away
    const monitor = (mx: number, colors: readonly RGB[]) => {
      R(f, mx, y + 12, 12, 8, C.metalD)
      R(f, mx + 1, y + 13, 10, 6, on ? C.screen : C.screenOff)
      if (on) {
        for (let i = 0; i < 3; i += 1) R(f, mx + 2, y + 14 + i * 2, 3 + ((i * 5 + Math.floor(tick / 4)) % 6), 1, colors[(i + Math.floor(tick / 4)) % colors.length]!)
        if (Math.floor(tick / 9) % 7 === 0) R(f, mx + 1, y + 13, 10, 1, C.white)
      }
      R(f, mx + 5, y + 20, 2, 1, C.metalD)
    }
    switch (d.look) {
      case 'hq': {
        R(f, x + 9, y + 17, 8, 4, C.paper)
        R(f, x + 10, y + 16, 8, 4, C.white)
        if (sc.tray) R(f, x + 11, y + 14, 6, 2, C.amber)
        SPR(f, x + 40, y + 17, ['kkkk', 'k..k', 'kkkk'], { k: C.black })
        if (sc.briefSlide !== null) R(f, x + 18 + Math.round(sc.briefSlide * 18), y + 20, 6, 2, C.paper)
        const cx = x + 9
        const cy = y + 6
        R(f, cx - 4, cy - 4, 9, 9, C.woodD)
        R(f, cx - 3, cy - 3, 7, 7, C.paper)
        const hourAng = ((sc.clock.h % 12) + sc.clock.m / 60) * (Math.PI / 6)
        const minAng = sc.clock.m * (Math.PI / 30)
        P(f, cx + Math.round(Math.sin(hourAng) * 2), cy - Math.round(Math.cos(hourAng) * 2), C.black)
        P(f, cx + Math.round(Math.sin(minAng) * 3), cy - Math.round(Math.cos(minAng) * 3), C.red)
        P(f, cx, cy, C.black)
        break
      }
      case 'pr':
        monitor(x + 36, [C.green, C.red, C.green, C.white])
        SPR(f, x + 12, y + 14, ['.mm.', 'm..m', 'm..m', '.mm.', '...w', '....w'], { m: C.metal, w: C.woodD })
        break
      case 'sphere':
        monitor(x + 36, [C.green, C.white, C.amber, C.purple])
        break
      case 'quilt':
        R(f, x + 3, y + 7, 16, 13, closed ? C.grey : C.white)
        if (!closed) {
          R(f, x + 5, y + 9, 4, 3, C.orange)
          R(f, x + 12, y + 14, 4, 3, C.teal)
          R(f, x + 8, y + 11, 5, 1, C.black)
        }
        R(f, x + 37, y + 17, 4, 4, closed ? C.metalD : C.amber)
        break
      case 'social': {
        const ring = mix(C.white, C.lamp, 0.5 + 0.5 * Math.sin(tick / 5))
        SPR(f, x + 2, y + 6, ['.aaaaa.', 'a.....a', 'a..k..a', 'a.....a', '.aaaaa.', '...m...', '...m...', '...m...', '..m.m..', '..m.m..', '.m...m.', '.m...m.', '.m...m.', '.m...m.', '.m...m.'], { a: closed ? C.grey : ring, k: C.black, m: C.metalD })
        R(f, x + 40, y + 17, 3, 4, C.black)
        break
      }
      case 'daily':
        R(f, x + 12, y + 17, 10, 4, C.paper)
        R(f, x + 13, y + 18, 6, 1, C.grey)
        R(f, x + 37, y + 16, 5, 5, C.white)
        R(f, x + 38, y + 17, 3, 2, C.coffee)
        if (!closed)
          for (let k = 0; k < 3; k += 1) {
            const ph = (tick + k * 5) % 15
            P(f, x + 38 + ((Math.floor(ph / 3) + k) % 2) + (k % 2), y + 15 - Math.floor(ph / 3), mix(C.grey, floor, ph / 15))
          }
        break
    }
    if (closed) {
      R(f, x + 44, y + 26, 5, 8, C.woodD)
      R(f, x + 43, y + 21, 7, 6, C.plant)
    }
    if (d.paper && !away) {
      R(f, x + 12, y + 17, 6, 4, C.paper)
      R(f, x + 13, y + 18, 4, 1, C.grey)
    }
    if (d.bubble && !away && !closed) bubble(f, x + 35, y + 3, d.bubble, Math.floor((now - d.bubbleSince) / 83), tick)
  }
  R(f, 0, ROW2 + 40, AW, AH - ROW2 - 40, C.wall)
  for (let px = 8; px < AW; px += 28) R(f, px, ROW2 + 42, 5, 4, C.plant)
  for (const w of sc.walkers) drawWalker(f, w.look, w.x, w.y, w.facing, w.frame, w.carry, tick % 40 < 2)
  if (sc.confettiSince !== null) {
    const n = (now - sc.confettiSince) / 83
    const o = slotOrigin(HQ_SLOT)
    for (const [vx, vy, c] of CONFETTI) {
      const yy = o.y + 12 + vy * n + 0.12 * n * n
      if (yy < o.y + 40) P(f, o.x + 28 + vx * n, yy, c)
    }
  }
  return f
}

// ---------------------------------------------------------------- sizing for sharp pixels

/**
 * The picture's size for a pane `columns` wide with cells `cellW × cellH` px: the largest whole-number
 * scale whose art fits, and a box of whole cells holding it, so the terminal never resamples.
 */
export const pixelBox = (columns: number, cellW: number, cellH: number) => {
  const scale = Math.max(1, Math.floor((columns * cellW) / AW))
  const cols = Math.ceil((AW * scale) / cellW)
  const rows = Math.ceil((AH * scale) / cellH)
  return { scale, cols, rows, width: cols * cellW, height: rows * cellH }
}

/** The art scaled up by whole pixels (no smoothing), centred on a background box `width × height`. */
export const scaleInto = (f: Canvas, scale: number, width: number, height: number): Uint8Array => {
  const out = new Uint8Array(width * height * 3)
  const bg = C.bg
  for (let i = 0; i < width * height; i += 1) out.set(bg, i * 3)
  const ox = Math.floor((width - f.w * scale) / 2)
  const oy = Math.floor((height - f.h * scale) / 2)
  const row = new Uint8Array(f.w * scale * 3)
  for (let y = 0; y < f.h; y += 1) {
    for (let x = 0; x < f.w; x += 1) for (let s = 0; s < scale; s += 1) row.set(f.d.subarray((y * f.w + x) * 3, (y * f.w + x) * 3 + 3), (x * scale + s) * 3)
    for (let s = 0; s < scale; s += 1) {
      const yy = oy + y * scale + s
      if (yy >= 0 && yy < height) out.set(row, (yy * width + ox) * 3)
    }
  }
  return out
}

/** `"7x17"` → `{ w: 7, h: 17 }`; anything else falls back to 7×17. */
export const parseCell = (s: string) => {
  const m = /^\s*(\d{1,3})\s*[x×]\s*(\d{1,3})\s*$/.exec(s)
  const w = Number(m?.[1])
  const h = Number(m?.[2])
  return w >= 3 && h >= 6 ? { w, h } : { w: 7, h: 17 }
}
