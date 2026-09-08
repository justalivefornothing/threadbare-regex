import { describe, expect, it } from 'vitest'
import { compile, ParseError, layout } from '../src/engine'

describe('spec assertions', () => {
  it('a(b|c)*d matches abcbcd', () => {
    expect(compile('a(b|c)*d').test('abcbcd')).toBe(true)
  })
  it('anchored phone number', () => {
    expect(compile('^\\d{3}-\\d{4}$').test('555-1234')).toBe(true)
  })
  it('findAll returns leftmost-longest spans', () => {
    expect(compile('colou?r').findAll('color colour colr')).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 12 },
    ])
  })
  it('Thompson NFA stays small for nested stars', () => {
    expect(compile('(a*)*b').nfa.states.length).toBeLessThan(12)
  })
  it('negated class exec', () => {
    expect(compile('[^aeiou]+').exec('rhythm')).toEqual({ start: 0, end: 6 })
  })
})

describe('parser', () => {
  it('builds the expected AST shapes', () => {
    const ast = compile('a(b|c)*d').ast
    expect(ast.type).toBe('Concat')
    if (ast.type !== 'Concat') return
    expect(ast.items.map((n) => n.type)).toEqual(['Char', 'Star', 'Char'])
    const star = ast.items[1]
    expect(star.type === 'Star' && star.body.type === 'Group' && star.body.body.type === 'Alt').toBe(true)
  })
  it('handles escapes, classes and ranges', () => {
    expect(compile('\\w+@\\w+\\.com').test('mail me: jo_9@site.com')).toBe(true)
    expect(compile('[a-c1-3]+').exec('zzab21cz')).toEqual({ start: 2, end: 7 })
    expect(compile('[\\d.]+').exec('v3.14')).toEqual({ start: 1, end: 5 })
    expect(compile('[-a]+').exec('x-a-x')).toEqual({ start: 1, end: 4 })
    expect(compile('[]a]+').exec('b]a]b')).toEqual({ start: 1, end: 4 })
    expect(compile('^\\D\\S\\W$').test('11 ')).toBe(false)
    expect(compile('^\\D\\S\\W$').test('a1 ')).toBe(true)
    expect(compile('a\\.b').test('axb')).toBe(false)
    expect(compile('a\\.b').test('a.b')).toBe(true)
    expect(compile('\\t').test('\t')).toBe(true)
  })
  it('dot matches anything but newline', () => {
    expect(compile('a.c').test('abc')).toBe(true)
    expect(compile('a.c').test('a\nc')).toBe(false)
  })
  it('counted repeats', () => {
    const r = compile('^a{2,3}$')
    expect(r.test('a')).toBe(false)
    expect(r.test('aa')).toBe(true)
    expect(r.test('aaa')).toBe(true)
    expect(r.test('aaaa')).toBe(false)
    expect(compile('^a{2}$').test('aa')).toBe(true)
    expect(compile('^a{2,}$').test('aaaaa')).toBe(true)
    expect(compile('^a{0}b$').test('b')).toBe(true)
    // braces that aren't a quantifier are literal, like JS
    expect(compile('a{x}').test('a{x}')).toBe(true)
  })
  it('non-capturing groups and empty alternatives', () => {
    expect(compile('(?:ab)+').exec('xababx')).toEqual({ start: 1, end: 5 })
    expect(compile('a(|b)c').findAll('ac abc')).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 6 },
    ])
  })
  it('reports errors with positions', () => {
    const fails = (p: string, msg: RegExp, pos: number) => {
      try {
        compile(p)
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError)
        expect((e as ParseError).message).toMatch(msg)
        expect((e as ParseError).pos).toBe(pos)
        return
      }
      throw new Error(`expected ${p} to fail`)
    }
    fails('a(b', /Missing '\)'/, 1)
    fails('ab)', /Unmatched '\)'/, 2)
    fails('*a', /Nothing to repeat/, 0)
    fails('a**', /Nothing to repeat/, 2)
    fails('a*?', /Lazy/, 2)
    fails('[abc', /Missing '\]'/, 0)
    fails('[z-a]', /out of order/, 0)
    fails('a{3,2}', /out of order/, 1)
    fails('a{999}', /too large/, 1)
    fails('a\\', /Trailing backslash/, 1)
  })
})

describe('Thompson construction', () => {
  it('produces one accept state and no dangling edges', () => {
    for (const p of ['a', 'a|b|c', '(ab)*c?', 'x{2,4}', '[^a]\\d$', '^$', '(a*)*b', '']) {
      const { states, start, accept } = compile(p).nfa
      expect(states.filter((s) => s.kind === 'match')).toHaveLength(1)
      expect(states[accept].kind).toBe('match')
      expect(start).toBeGreaterThanOrEqual(0)
      for (const s of states) {
        if ('out' in s) expect(s.out).toBeGreaterThanOrEqual(0)
        if (s.kind === 'split') expect(s.out1).toBeGreaterThanOrEqual(0)
      }
    }
  })
  it('sizes follow the construction (chars + one split per operator + accept)', () => {
    expect(compile('abc').nfa.states.length).toBe(4)
    expect(compile('a|b').nfa.states.length).toBe(4)
    expect(compile('a*').nfa.states.length).toBe(3)
    expect(compile('a{3}').nfa.states.length).toBe(4)
    expect(compile('a{1,3}').nfa.states.length).toBe(6)
  })
})

describe('Pike VM', () => {
  it('leftmost beats longest', () => {
    // "abc" starting at 0 beats "b" starting at 1 even though "b" accepts first
    expect(compile('abc|b').exec('abc')).toEqual({ start: 0, end: 3 })
    // and the longest match at the leftmost start wins over shorter alternatives
    expect(compile('a|ab|abc').exec('xabcd')).toEqual({ start: 1, end: 4 })
  })
  it('empty matches advance one position at a time', () => {
    expect(compile('x*').findAll('ab')).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 1 },
      { start: 2, end: 2 },
    ])
    expect(compile('a*').findAll('baab')).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 3 },
      { start: 3, end: 3 },
      { start: 4, end: 4 },
    ])
  })
  it('anchors bind to the ends of the input', () => {
    expect(compile('^b').test('ab')).toBe(false)
    expect(compile('a$').test('ab')).toBe(false)
    expect(compile('^ab$').exec('ab')).toEqual({ start: 0, end: 2 })
    expect(compile('^$').exec('')).toEqual({ start: 0, end: 0 })
    expect(compile('^$').exec('a')).toBeNull()
  })
  it('exec honours a starting offset and returns null past the end', () => {
    const r = compile('a')
    expect(r.exec('aXa', 1)).toEqual({ start: 2, end: 3 })
    expect(r.exec('aXa', 4)).toBeNull()
  })
  it('agrees with native RegExp on a bag of patterns', () => {
    const cases: [string, string][] = [
      ['(a|b)*abb', 'aababbabbb'],
      ['[A-Z][a-z]+', 'the Quick Brown fox'],
      ['\\d+(\\.\\d+)?', 'pi is 3.14 and e is 2'],
      ['(ab|a)(bc|c)?', 'abc ac abbc'],
      ['x?y?z?', 'zyx'],
      ['^\\s*\\w+', '  hello world'],
      ['(?:foo|bar)+', 'foobarfoo baz bar'],
    ]
    for (const [p, input] of cases) {
      const native = [...input.matchAll(new RegExp(p, 'g'))].map((m) => ({
        start: m.index,
        end: m.index + m[0].length,
      }))
      // JS is leftmost-first, we are leftmost-longest; these patterns agree on both.
      expect(compile(p).findAll(input), p).toEqual(native)
    }
  })
  it('is linear on the classic catastrophic pattern', () => {
    const r = compile('(a*)*b')
    const t0 = performance.now()
    for (const n of [100, 1000, 10000]) {
      expect(r.test('a'.repeat(n) + 'c')).toBe(false)
    }
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(compile('(a|a)*b').test('a'.repeat(5000) + 'c')).toBe(false)
  })
})

describe('trace', () => {
  it('walks the input one character at a time and commits matches', () => {
    const frames = compile('ab').trace('xab')
    // 0..3 consume the input; the trailing frame is the search resuming at 3 (like JS's empty-match check)
    expect(frames.map((f) => f.pos)).toEqual([0, 1, 2, 3, 3])
    expect(frames[0].seeded).toBe(true)
    expect(frames[3].candidate).toEqual({ start: 1, end: 3 })
    expect(frames[4].matches).toEqual([{ start: 1, end: 3 }])
    expect(frames[4].candidate).toBeNull()
    // consuming 'a' at pos 1 fires exactly one state
    expect(frames[2].fired).toHaveLength(1)
  })
  it('active set includes epsilon states and shrinks as threads die', () => {
    const r = compile('a(b|c)*d')
    const frames = r.trace('abd')
    // after 'a': split, inner split, b, c, d are all reachable
    expect(frames[1].active.length).toBeGreaterThanOrEqual(5)
    expect(frames[3].candidate).toEqual({ start: 0, end: 3 })
  })
  it('rewinds to the match end when a longer thread overshoots', () => {
    // "a+b|a" on "aaac": the a+b thread runs through 'c' (dying at pos 4)
    // before the scan restarts at 1, so findAll semantics are preserved.
    const frames = compile('a+b|a').trace('aaac')
    const positions = frames.map((f) => f.pos)
    expect(positions.slice(0, 6)).toEqual([0, 1, 2, 3, 4, 1])
    expect(frames[4].active).toEqual([])
    expect(frames[4].candidate).toEqual({ start: 0, end: 1 })
    expect(frames[frames.length - 1].matches).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ])
  })
})

describe('layout', () => {
  it('ranks states left to right with accept last', () => {
    const r = compile('a(b|c)*d')
    const l = layout(r.nfa)
    expect(l.points).toHaveLength(r.nfa.states.length)
    expect(l.points[r.nfa.start].x).toBe(0)
    expect(l.points[r.nfa.accept].x).toBe(l.ranks - 1)
    for (const p of l.points) expect(Number.isFinite(p.y)).toBe(true)
    expect(l.height).toBeGreaterThanOrEqual(2)
  })
  it('spreads a rank symmetrically around the centre line', () => {
    const l = layout(compile('a|b|c').nfa)
    const ys = l.points.filter((p) => p.x === l.ranks - 2).map((p) => p.y)
    expect(ys.reduce((a, b) => a + b, 0)).toBeCloseTo(0)
  })
})
