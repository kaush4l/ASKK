import { describe, expect, test } from 'bun:test'
import { batch, computed, effect, signal } from '../src/index.js'

describe('a signal is a value that says when it changed', () => {
  test('it holds, it hands back, and it wakes only on a real change', () => {
    const n = signal(1)
    let woken = 0
    const stop = n.subscribe(() => { woken += 1 })
    expect(n.get()).toBe(1)
    n.set(2)
    expect(n.get()).toBe(2)
    // THE SAME VALUE IS NOT A CHANGE. Without this every re-read of an
    // unchanged projection re-renders the pane that read it.
    n.set(2)
    expect(woken).toBe(1)
    stop()
    n.set(3)
    expect(woken).toBe(1)
  })

  test('a watcher that stops itself mid-notification does not corrupt the walk', () => {
    const n = signal(0)
    /** @type {string[]} */
    const seen = []
    const stop = n.subscribe(() => { seen.push('first'); stop() })
    n.subscribe(() => seen.push('second'))
    n.set(1)
    expect(seen).toEqual(['first', 'second'])
  })
})

describe('a batch is one notification for a run of writes', () => {
  test('three appends wake a pane once, not three times', () => {
    const n = signal(0)
    let woken = 0
    n.subscribe(() => { woken += 1 })
    batch(() => { n.set(1); n.set(2); n.set(3) })
    expect(woken).toBe(1)
    expect(n.get()).toBe(3)
  })

  test('a throw inside a batch still closes it', () => {
    const n = signal(0)
    let woken = 0
    n.subscribe(() => { woken += 1 })
    expect(() => batch(() => { n.set(1); throw new Error('mid-turn') })).toThrow('mid-turn')
    expect(woken).toBe(1)
    n.set(2)
    expect(woken).toBe(2)
  })
})

describe('a computed records what it read rather than being told', () => {
  test('it derives, it caches, and it recomputes only after a dependency moved', () => {
    const first = signal('ada')
    const last = signal('lovelace')
    let runs = 0
    const whole = computed(() => { runs += 1; return `${first.get()} ${last.get()}` })
    expect(whole.get()).toBe('ada lovelace')
    expect(whole.get()).toBe('ada lovelace')
    expect(runs).toBe(1)
    last.set('byron')
    expect(whole.get()).toBe('ada byron')
    expect(runs).toBe(2)
  })

  test('A BRANCH DROPS THE DEPENDENCY IT NO LONGER READS', () => {
    // The defect a declared dependency list cannot avoid: the list says `b`
    // is read, the body stopped reading it, and every write to `b` wakes a
    // value that cannot have changed.
    const show = signal(true)
    const shown = signal('yes')
    const hidden = signal('no')
    let runs = 0
    const which = computed(() => { runs += 1; return show.get() ? shown.get() : hidden.get() })
    expect(which.get()).toBe('yes')
    hidden.set('still no')
    expect(which.get()).toBe('yes')
    expect(runs).toBe(1)
    shown.set('yes indeed')
    expect(which.get()).toBe('yes indeed')
    expect(runs).toBe(2)
  })

  test('a computed of a computed is one graph, and the inner one is read once', () => {
    const n = signal(2)
    let inner = 0
    const doubled = computed(() => { inner += 1; return n.get() * 2 })
    const labelled = computed(() => `n2 is ${doubled.get()}`)
    expect(labelled.get()).toBe('n2 is 4')
    n.set(5)
    expect(labelled.get()).toBe('n2 is 10')
    expect(inner).toBe(2)
  })

  test('an unread computed announces staleness once, not once per write', () => {
    const n = signal(0)
    const derived = computed(() => n.get() * 2)
    let woken = 0
    derived.subscribe(() => { woken += 1 })
    derived.get()
    n.set(1)
    n.set(2)
    n.set(3)
    expect(woken).toBe(1)
  })
})

describe('an effect is the only thing a read may cause', () => {
  test('it runs at once — which is how it learns what it watches — then on change', () => {
    const n = signal('a')
    /** @type {string[]} */
    const seen = []
    const stop = effect(() => seen.push(n.get()))
    expect(seen).toEqual(['a'])
    n.set('b')
    expect(seen).toEqual(['a', 'b'])
    stop()
    n.set('c')
    expect(seen).toEqual(['a', 'b'])
  })

  test('stopping it detaches every dependency, including ones a later run added', () => {
    const show = signal(false)
    const extra = signal(0)
    /** @type {number[]} */
    const seen = []
    const stop = effect(() => { seen.push(show.get() ? extra.get() : -1) })
    show.set(true)
    expect(seen).toEqual([-1, 0])
    stop()
    extra.set(9)
    expect(seen).toEqual([-1, 0])
  })
})
