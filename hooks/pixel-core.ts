// The pixel office, as pure data: the same eight rooms, hallway and staff as the text office, drawn
// into an RGBA framebuffer and encoded as a PNG. All art is original and drawn here in code; no
// sprite files. Nothing touches `$`, so every frame is testable directly.
import type { Person, Zone } from '../types'

export const PX_W = 160
export const PX_H = 88
const ROOM_W = 40
const ROOM_H = 38
const HALL_Y = 38
const HALL_H = 12
const BOTTOM_Y = 50

type RGB = readonly [number, number, number]
const hex = (n: number): RGB => [(n >> 16) & 255, (n >> 8) & 255, n & 255]

export const PAL = {
  bg: hex(0x1b1a20),
  wall: hex(0x3d2f28),
  wallLight: hex(0x5a4436),
  hall: hex(0x2e2b33),
  hallTile: hex(0x36323c),
  wood: hex(0x8b5a3c),
  woodDark: hex(0x5e3b26),
  metal: hex(0x7a7f8a),
  metalDark: hex(0x464a53),
  screen: hex(0x5fb3d9),
  paper: hex(0xede0d4),
  plant: hex(0x5b9a4b),
  skin: hex(0xe8b58f),
  hair: hex(0x3a2a22),
  pants: hex(0x2f3a55),
  tie: hex(0xc0392b),
  amber: hex(0xf9c74f),
  red: hex(0xf9844a),
  green: hex(0x90be6d),
  coffee: hex(0x6f4e37),
  white: hex(0xf4f1ea),
} as const

/** Floor colour and accent per room, warm and readable on a dark terminal. */
const ROOM_STYLE: Record<Zone, { floor: RGB; accent: RGB }> = {
  desk: { floor: hex(0x4a4f5c), accent: hex(0x8ecae6) },
  archives: { floor: hex(0x5a4a3a), accent: hex(0xcdb4db) },
  warehouse: { floor: hex(0x4d4a40), accent: hex(0xf4a261) },
  workshop: { floor: hex(0x4f4642), accent: hex(0xf9844a) },
  server: { floor: hex(0x2f3640), accent: hex(0x90be6d) },
  meeting: { floor: hex(0x4b4458), accent: hex(0xcdb4db) },
  hr: { floor: hex(0x55493f), accent: hex(0xf9c74f) },
  coffee: { floor: hex(0x4f5546), accent: hex(0x90be6d) },
}

const SHIRTS: readonly RGB[] = [0x8ecae6, 0x90be6d, 0xcdb4db, 0xf4a261, 0x43aa8b, 0xf28482, 0x84a59d, 0xe9c46a].map(hex)

// ---------------------------------------------------------------- framebuffer

export type Frame = { width: number; height: number; data: Uint8Array }

export const newFrame = (width = PX_W, height = PX_H, fill: RGB = PAL.bg): Frame => {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i += 1) data.set([fill[0], fill[1], fill[2], 255], i * 4)
  return { width, height, data }
}

export const px = (f: Frame, x: number, y: number, c: RGB) => {
  if (x < 0 || y < 0 || x >= f.width || y >= f.height) return
  f.data.set([c[0], c[1], c[2], 255], (y * f.width + x) * 4)
}

export const rect = (f: Frame, x: number, y: number, w: number, h: number, c: RGB) => {
  for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) px(f, x + i, y + j, c)
}

export const pixelAt = (f: Frame, x: number, y: number): RGB => {
  const i = (y * f.width + x) * 4
  return [f.data[i] ?? 0, f.data[i + 1] ?? 0, f.data[i + 2] ?? 0]
}

/** A sprite from rows of palette keys; `.` is transparent. */
const sprite = (f: Frame, x: number, y: number, rows: readonly string[], keys: Record<string, RGB>) => {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i += 1) {
      const c = keys[row[i] ?? '.']
      if (c) px(f, x + i, y + j, c)
    }
  })
}

// ---------------------------------------------------------------- people (8×10, original)

const BODY_STAND = ['..hhhh..', '.hhhhhh.', '.hssssh.', '..ssss..', '.cccccc.', 'scctcccs', 'scctcccs', '.cccccc.', '.pp..pp.', '.pp..pp.']
const BODY_STEP = ['..hhhh..', '.hhhhhh.', '.hssssh.', '..ssss..', '.cccccc.', 'scctcccs', 'scctcccs', '.cccccc.', '.pp..pp.', 'pp....pp']
const BODY_WORK = ['..hhhh..', '.hhhhhh.', '.hssssh.', 's.ssss..', 'scccccc.', '.cctcccs', '.cctcccs', '.cccccc.', '.pp..pp.', '.pp..pp.']
const MARK_Q = ['.aa.', 'a..a', '..a.', '....', '..a.']
const MARK_X = ['.r.', '.r.', '.r.', '...', '.r.']
const MARK_CUP = ['wwww', 'wkkw', 'wkkw', '.ww.']
const MARK_Z = ['www', '..w', '.w.', 'www']

/** A person's shirt: fixed per name, so Olu is always green. */
export const shirtOf = (name: string): RGB => {
  let h = 0
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return SHIRTS[h % SHIRTS.length] ?? SHIRTS[0]!
}

export const drawPerson = (f: Frame, x: number, y: number, p: Pick<Person, 'name' | 'isBoss' | 'mood'>, pose: 'stand' | 'step' | 'work') => {
  const keys: Record<string, RGB> = {
    h: PAL.hair,
    s: PAL.skin,
    c: p.isBoss ? PAL.white : shirtOf(p.name),
    t: p.isBoss ? PAL.tie : shirtOf(p.name),
    p: PAL.pants,
  }
  sprite(f, x, y, pose === 'step' ? BODY_STEP : pose === 'work' ? BODY_WORK : BODY_STAND, keys)
  const mark = p.mood === 'waiting' ? MARK_Q : p.mood === 'oops' ? MARK_X : p.mood === 'done' ? MARK_CUP : p.mood === 'idle' ? MARK_Z : null
  if (mark) sprite(f, x + 2, y - 6, mark, { a: PAL.amber, r: PAL.red, w: PAL.white, k: PAL.coffee })
}

// ---------------------------------------------------------------- rooms and furniture (original)

const ORDER: readonly Zone[] = ['desk', 'archives', 'warehouse', 'workshop', 'server', 'meeting', 'hr', 'coffee']

export const roomOrigin = (z: Zone) => {
  const i = Math.max(0, ORDER.indexOf(z))
  return { x: (i % 4) * ROOM_W, y: i < 4 ? 0 : BOTTOM_Y }
}

const furniture = (f: Frame, z: Zone, x: number, y: number, tick: number, busy: boolean) => {
  const t = y + 6
  switch (z) {
    case 'desk':
      for (const dx of [4, 22]) {
        rect(f, x + dx, t + 6, 14, 3, PAL.wood)
        rect(f, x + dx + 4, t, 6, 5, PAL.metalDark)
        rect(f, x + dx + 5, t + 1, 4, 3, PAL.screen)
      }
      break
    case 'archives':
      for (const dx of [3, 15, 27]) {
        rect(f, x + dx, t - 1, 10, 11, PAL.woodDark)
        for (let r = 0; r < 3; r += 1) for (let b = 0; b < 4; b += 1) rect(f, x + dx + 1 + b * 2, t + r * 3, 1, 2, SHIRTS[(b + r + dx) % SHIRTS.length]!)
      }
      break
    case 'warehouse':
      for (const [dx, dy] of [[3, 4], [11, 4], [7, -2], [24, 4], [32, 4]] as const) {
        rect(f, x + dx, t + dy, 7, 6, PAL.wood)
        rect(f, x + dx, t + dy, 7, 1, PAL.woodDark)
        rect(f, x + dx + 3, t + dy, 1, 6, PAL.woodDark)
      }
      break
    case 'workshop':
      rect(f, x + 4, t + 5, 32, 3, PAL.woodDark)
      rect(f, x + 8, t + 1, 3, 4, PAL.metal)
      rect(f, x + 26, t + 2, 6, 3, PAL.metalDark)
      if (busy && tick % 2 === 0) for (const [dx, dy] of [[12, 2], [14, 0], [13, 4]] as const) px(f, x + dx, t + dy, PAL.amber)
      break
    case 'server':
      for (const dx of [4, 15, 26]) {
        rect(f, x + dx, t - 1, 9, 12, PAL.metalDark)
        for (let r = 0; r < 4; r += 1) {
          const on = (tick + r + dx) % 3 !== 0
          px(f, x + dx + 2, t + 1 + r * 3, on ? PAL.green : PAL.metal)
          px(f, x + dx + 5, t + 1 + r * 3, busy && on ? PAL.amber : PAL.metal)
        }
      }
      break
    case 'meeting':
      rect(f, x + 6, t - 1, 28, 6, PAL.white)
      for (const [dx, c] of [[9, PAL.tie], [16, PAL.screen], [23, PAL.green]] as const) rect(f, x + dx, t + 1, 5, 1, c)
      rect(f, x + 10, t + 7, 20, 3, PAL.wood)
      break
    case 'hr':
      rect(f, x + 6, t + 5, 22, 4, PAL.wood)
      rect(f, x + 10, t + 1, 6, 4, PAL.paper)
      rect(f, x + 22, t + 3, 3, 2, PAL.amber)
      break
    case 'coffee':
      rect(f, x + 5, t - 1, 8, 11, PAL.metalDark)
      rect(f, x + 7, t + 1, 4, 3, PAL.red)
      rect(f, x + 7, t + 6, 3, 3, PAL.white)
      rect(f, x + 28, t + 3, 5, 7, PAL.woodDark)
      rect(f, x + 27, t - 1, 7, 5, PAL.plant)
      break
  }
}

const drawRoom = (f: Frame, z: Zone, tick: number, busy: boolean) => {
  const { x, y } = roomOrigin(z)
  const s = ROOM_STYLE[z]
  rect(f, x, y, ROOM_W, ROOM_H, PAL.wall)
  rect(f, x + 1, y + 4, ROOM_W - 2, ROOM_H - 5, s.floor)
  rect(f, x + 1, y + 1, ROOM_W - 2, 2, s.accent)
  // A doorway onto the hallway.
  rect(f, x + 16, ORDER.indexOf(z) < 4 ? y + ROOM_H - 1 : y, 8, 1, s.floor)
  furniture(f, z, x, y, tick, busy)
}

const drawHall = (f: Frame) => {
  rect(f, 0, HALL_Y, PX_W, HALL_H, PAL.hall)
  for (let i = 0; i < PX_W; i += 8) rect(f, i + (i % 16 === 0 ? 0 : 4), HALL_Y + 5, 2, 2, PAL.hallTile)
}

// ---------------------------------------------------------------- the scene

/** Someone between rooms: from, to, and how far along (0–1). */
export type Walk = { from: Zone; to: Zone; t: number }

/** The x of a room's door, where a walker leaves and arrives. */
const doorX = (z: Zone) => roomOrigin(z).x + 16

/**
 * One frame of the office: rooms, then the seated people (up to three per room), then the walkers
 * in the hallway. `tick` moves the blinking lights, the work poses and the walking legs.
 */
export const drawOffice = (people: readonly Person[], walks: ReadonlyMap<string, Walk>, tick: number): Frame => {
  const f = newFrame()
  drawHall(f)
  const busyZones = new Set(people.filter(p => p.mood === 'ok' && !walks.has(p.id)).map(p => p.zone))
  for (const z of ORDER) drawRoom(f, z, tick, busyZones.has(z))
  for (const z of ORDER) {
    const here = people.filter(p => p.zone === z && !walks.has(p.id)).slice(0, 3)
    const { x, y } = roomOrigin(z)
    here.forEach((p, i) => {
      const pose = p.mood === 'ok' && z !== 'desk' && tick % 2 === 0 ? 'work' : 'stand'
      drawPerson(f, x + 4 + i * 12, y + ROOM_H - 13, p, pose)
    })
    const extra = people.filter(p => p.zone === z && !walks.has(p.id)).length - here.length
    for (let k = 0; k < Math.min(extra, 3); k += 1) px(f, x + ROOM_W - 4 - k * 2, y + ROOM_H - 3, PAL.white)
  }
  for (const p of people) {
    const w = walks.get(p.id)
    if (!w) continue
    const t = Math.max(0, Math.min(1, w.t))
    const wx = Math.round(doorX(w.from) + (doorX(w.to) - doorX(w.from)) * t)
    drawPerson(f, wx, HALL_Y + 1, p, tick % 2 === 0 ? 'step' : 'stand')
  }
  return f
}

/** Cells for the picture at `columns` wide: terminal cells are about twice as tall as wide. */
export const rowsFor = (columns: number) => Math.max(4, Math.round((columns * PX_H) / PX_W / 2.1))

// ---------------------------------------------------------------- PNG (stored deflate, no compression)

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (const b of bytes) c = (CRC[(c ^ b) & 255] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const adler32 = (bytes: Uint8Array) => {
  let a = 1
  let b = 0
  for (const x of bytes) {
    a = (a + x) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

const u32 = (n: number) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)

const concat = (parts: readonly Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const chunk = (type: string, body: Uint8Array) => {
  const t = Uint8Array.from(type, ch => ch.charCodeAt(0))
  return concat([u32(body.length), t, body, u32(crc32(concat([t, body])))])
}

/** A frame as PNG bytes: RGBA, 8 bits, every row unfiltered, deflate stored (no compression). */
export const encodePng = (f: Frame): Uint8Array => {
  const stride = f.width * 4
  const raw = new Uint8Array((stride + 1) * f.height)
  for (let y = 0; y < f.height; y += 1) raw.set(f.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  const blocks: Uint8Array[] = [Uint8Array.of(0x78, 0x01)]
  for (let o = 0; o < raw.length; o += 65535) {
    const len = Math.min(65535, raw.length - o)
    const last = o + len >= raw.length ? 1 : 0
    blocks.push(Uint8Array.of(last, len & 255, len >>> 8, ~len & 255, (~len >>> 8) & 255), raw.subarray(o, o + len))
  }
  blocks.push(u32(adler32(raw)))
  const ihdr = concat([u32(f.width), u32(f.height), Uint8Array.of(8, 6, 0, 0, 0)])
  return concat([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', ihdr), chunk('IDAT', concat(blocks)), chunk('IEND', new Uint8Array(0))])
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64, without relying on the environment having one. */
export const base64 = (bytes: Uint8Array) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (b === undefined ? '=' : B64[(n >> 6) & 63]!) + (c === undefined ? '=' : B64[n & 63]!)
  }
  return out
}

/** A terminal that can show pictures inline (kitty graphics), from its environment; tmux passes none through. */
export const termShowsImages = (env: { TERM?: string; TERM_PROGRAM?: string; TMUX?: string; KITTY_WINDOW_ID?: string; GHOSTTY_RESOURCES_DIR?: string; WEZTERM_EXECUTABLE?: string }) => {
  if (env.TMUX) return false
  const prog = (env.TERM_PROGRAM ?? '').toLowerCase()
  return Boolean(
    env.KITTY_WINDOW_ID || env.GHOSTTY_RESOURCES_DIR || env.WEZTERM_EXECUTABLE || /kitty|ghostty|wezterm/.test(prog) || /kitty|ghostty/.test((env.TERM ?? '').toLowerCase()),
  )
}
