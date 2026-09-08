/** Inclusive code-unit range [lo, hi]. */
export type Range = [number, number]

export type Node =
  | { type: 'Char'; ch: number }
  | { type: 'Any' }
  | { type: 'Class'; ranges: Range[]; negated: boolean; label: string }
  | { type: 'Anchor'; at: 'start' | 'end' }
  | { type: 'Empty' }
  | { type: 'Concat'; items: Node[] }
  | { type: 'Alt'; alts: Node[] }
  | { type: 'Star'; body: Node }
  | { type: 'Plus'; body: Node }
  | { type: 'Opt'; body: Node }
  | { type: 'Repeat'; body: Node; min: number; max: number | null }
  | { type: 'Group'; body: Node; index: number | null }

export const DIGIT: Range[] = [[48, 57]]
export const WORD: Range[] = [[48, 57], [65, 90], [95, 95], [97, 122]]
export const SPACE: Range[] = [[9, 13], [32, 32], [160, 160]]

/** Complement of a set of ranges over the full UTF-16 code-unit space. */
export function complement(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: Range[] = []
  let next = 0
  for (const [lo, hi] of sorted) {
    if (lo > next) out.push([next, lo - 1])
    next = Math.max(next, hi + 1)
  }
  if (next <= 0xffff) out.push([next, 0xffff])
  return out
}

export function inRanges(ranges: Range[], c: number): boolean {
  for (let i = 0; i < ranges.length; i++) {
    if (c >= ranges[i][0] && c <= ranges[i][1]) return true
  }
  return false
}
