import { DIGIT, SPACE, WORD, complement, type Node, type Range } from './ast'

export class ParseError extends Error {
  readonly pos: number
  constructor(message: string, pos: number) {
    super(message)
    this.name = 'ParseError'
    this.pos = pos
  }
}

/** Upper bound on {m,n} counts so a typo can't allocate a 10k-state NFA. */
export const MAX_REPEAT = 200

/**
 * Recursive-descent parser:
 *
 *   alt    := concat ('|' concat)*
 *   concat := repeat*
 *   repeat := atom ('*' | '+' | '?' | '{' m (',' n?)? '}')?
 *   atom   := '(' alt ')' | '[' class ']' | '.' | '^' | '$' | '\' esc | literal
 */
export function parse(src: string): Node {
  return new Parser(src).parse()
}

class Parser {
  private readonly src: string
  private i = 0
  private groups = 0

  constructor(src: string) {
    this.src = src
  }

  parse(): Node {
    const node = this.parseAlt()
    if (this.i < this.src.length) {
      // Only ')' can stop parseAlt early.
      throw new ParseError("Unmatched ')'", this.i)
    }
    return node
  }

  private peek(): string {
    return this.src[this.i] ?? ''
  }

  private eof(): boolean {
    return this.i >= this.src.length
  }

  private parseAlt(): Node {
    const alts: Node[] = [this.parseConcat()]
    while (this.peek() === '|') {
      this.i++
      alts.push(this.parseConcat())
    }
    return alts.length === 1 ? alts[0] : { type: 'Alt', alts }
  }

  private parseConcat(): Node {
    const items: Node[] = []
    while (!this.eof() && this.peek() !== '|' && this.peek() !== ')') {
      items.push(this.parseRepeat())
    }
    if (items.length === 0) return { type: 'Empty' }
    return items.length === 1 ? items[0] : { type: 'Concat', items }
  }

  private parseRepeat(): Node {
    const atomPos = this.i
    const atom = this.parseAtom()
    const c = this.peek()
    let node: Node

    if (c === '*') {
      this.i++
      node = { type: 'Star', body: atom }
    } else if (c === '+') {
      this.i++
      node = { type: 'Plus', body: atom }
    } else if (c === '?') {
      this.i++
      node = { type: 'Opt', body: atom }
    } else if (c === '{' && this.tryBraces(true)) {
      const q = this.tryBraces()!
      node = { type: 'Repeat', body: atom, min: q.min, max: q.max }
    } else {
      return atom
    }

    if (atom.type === 'Anchor') throw new ParseError('Anchors cannot be quantified', atomPos)
    const n = this.peek()
    if (n === '?') {
      throw new ParseError('Lazy quantifiers are not supported: matching is leftmost-longest', this.i)
    }
    if (n === '*' || n === '+' || (n === '{' && this.tryBraces(true))) {
      throw new ParseError('Nothing to repeat', this.i)
    }
    return node
  }

  /** Parses `{m}`, `{m,}` or `{m,n}` at the cursor. Returns null (and consumes nothing) if it isn't one. */
  private tryBraces(dryRun = false): { min: number; max: number | null } | null {
    const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(this.src.slice(this.i))
    if (!m) return null
    const min = Number(m[1])
    const max = m[2] === undefined ? min : m[3] === '' ? null : Number(m[3])
    if (dryRun) return { min, max }
    if (max !== null && max < min) {
      throw new ParseError(`Repeat range out of order: {${min},${max}}`, this.i)
    }
    if (min > MAX_REPEAT || (max ?? 0) > MAX_REPEAT) {
      throw new ParseError(`Repeat count too large (max ${MAX_REPEAT})`, this.i)
    }
    this.i += m[0].length
    return { min, max }
  }

  private parseAtom(): Node {
    const c = this.peek()
    const pos = this.i
    switch (c) {
      case '(': {
        this.i++
        let index: number | null = null
        if (this.src.startsWith('?:', this.i)) {
          this.i += 2
        } else {
          index = ++this.groups
        }
        const body = this.parseAlt()
        if (this.peek() !== ')') throw new ParseError("Missing ')'", pos)
        this.i++
        return { type: 'Group', body, index }
      }
      case '[':
        return this.parseClass()
      case '.':
        this.i++
        return { type: 'Any' }
      case '^':
        this.i++
        return { type: 'Anchor', at: 'start' }
      case '$':
        this.i++
        return { type: 'Anchor', at: 'end' }
      case '\\':
        return this.parseEscape()
      case '*':
      case '+':
      case '?':
        throw new ParseError('Nothing to repeat', pos)
      case '{':
        if (this.tryBraces(true)) throw new ParseError('Nothing to repeat', pos)
        this.i++
        return { type: 'Char', ch: c.charCodeAt(0) }
      default:
        this.i++
        return { type: 'Char', ch: c.charCodeAt(0) }
    }
  }

  private parseEscape(): Node {
    const pos = this.i
    this.i++ // backslash
    if (this.eof()) throw new ParseError('Trailing backslash', pos)
    const c = this.src[this.i++]
    const shorthand = shorthandClass(c)
    if (shorthand) {
      return { type: 'Class', ranges: shorthand, negated: false, label: '\\' + c }
    }
    return { type: 'Char', ch: escapedChar(c) }
  }

  private parseClass(): Node {
    const start = this.i
    this.i++ // '['
    let negated = false
    if (this.peek() === '^') {
      negated = true
      this.i++
    }
    const ranges: Range[] = []
    let first = true
    while (true) {
      if (this.eof()) throw new ParseError("Missing ']'", start)
      const c = this.src[this.i]
      if (c === ']' && !first) {
        this.i++
        break
      }
      first = false
      let lo: number
      if (c === '\\') {
        this.i++
        if (this.eof()) throw new ParseError('Trailing backslash', this.i - 1)
        const e = this.src[this.i++]
        const shorthand = shorthandClass(e)
        if (shorthand) {
          ranges.push(...shorthand)
          continue
        }
        lo = escapedChar(e)
      } else {
        this.i++
        lo = c.charCodeAt(0)
      }
      // range a-z ?  ("-" right before "]" is a literal dash)
      if (this.peek() === '-' && this.src[this.i + 1] !== undefined && this.src[this.i + 1] !== ']') {
        this.i++
        let hi: number
        const h = this.src[this.i++]
        if (h === '\\') {
          if (this.eof()) throw new ParseError('Trailing backslash', this.i - 1)
          const e = this.src[this.i++]
          if (shorthandClass(e)) throw new ParseError('Invalid range end', this.i - 2)
          hi = escapedChar(e)
        } else {
          hi = h.charCodeAt(0)
        }
        if (hi < lo) throw new ParseError('Range out of order in character class', start)
        ranges.push([lo, hi])
      } else {
        ranges.push([lo, lo])
      }
    }
    return { type: 'Class', ranges, negated, label: this.src.slice(start, this.i) }
  }
}

function shorthandClass(c: string): Range[] | null {
  switch (c) {
    case 'd':
      return DIGIT
    case 'D':
      return complement(DIGIT)
    case 'w':
      return WORD
    case 'W':
      return complement(WORD)
    case 's':
      return SPACE
    case 'S':
      return complement(SPACE)
    default:
      return null
  }
}

function escapedChar(c: string): number {
  switch (c) {
    case 'n':
      return 10
    case 't':
      return 9
    case 'r':
      return 13
    case 'f':
      return 12
    case 'v':
      return 11
    case '0':
      return 0
    default:
      return c.charCodeAt(0)
  }
}
