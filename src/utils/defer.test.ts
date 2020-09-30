import { drai, drun } from "./defer"

describe('drun', () => {
  describe('when runner is sync', () => {
    test('must exec defer after process', async () => {
      const actual: number[] = []
      await drun(defer => {
        defer(() => { actual.push(1) })
        defer(() => { actual.push(2) })
        actual.push(3)
        actual.push(4)
      })
      expect(actual).toEqual([3,4,1,2])
    })
    test('must bypass exception', () => {
      return expect(drun(() => { throw new Error('yeah') })).rejects.toEqual(new Error('yeah'))
    })
    test('must return value', () => {
      return expect(drun(() => 100)).resolves.toBe(100)
    })
    test('must exec defer when exception occurred', async () => {
      let actual = 0
      await expect(drun(defer => {
        defer(() => { actual = 1 })
        throw new Error('yeah')
      })).rejects.toEqual(new Error('yeah'))
      expect(actual).toBe(1)
    })
  })
  describe('when runner is async', () => {
    test('must exec defer after process', async () => {
      const actual: number[] = []
      await drun(async defer => {
        defer(() => { actual.push(1) })
        defer(async () => { actual.push(2) })
        actual.push(3)
        actual.push(4)
      })
      expect(actual).toEqual([3,4,1,2])
    })
    test('must bypass exception', () => {
      return expect(drun(async () => { throw new Error('yeah') })).rejects.toEqual(new Error('yeah'))
    })
    test('must return value', () => {
      return expect(drun(async () => 100)).resolves.toBe(100)
    })
    test('must exec defer when exception occurred', async () => {
      let actual = 0
      await expect(drun(async defer => {
        defer(() => { actual = 1 })
        throw new Error('yeah')
      })).rejects.toEqual(new Error('yeah'))
      expect(actual).toBe(1)
    })
  })
})

describe('drai', () => {
  const gall = async <T>(g: AsyncGenerator<T, void, void>) => {
    const r: T[] = []
    for await (const i of g) {
      r.push(i)
    }
    return r
  }
  test('it works', async () => {
    let actualDefer: number[] = []
    const all = await gall(drai(async function * (defer) {
      defer(() => { actualDefer.push(1) })
      defer(async () => { actualDefer.push(2) })
      yield 1
      yield 2
      yield 3
    }))
    expect(all).toEqual([1,2,3])
    expect(actualDefer).toEqual([1,2])
  })
  test('exception', async () => {
    let actualDefer: string = ''
    try {
      for await (const item of drai(async function * (defer) {
        yield 1
        defer(() => { actualDefer = 'yee' })
        throw new Error('wow')
      })) {
        expect(item).toBe(1)
      }
    } catch(e) {
      expect(e).toEqual(new Error('wow'))
      return
    } finally {
      expect(actualDefer).toBe('yee')
    }
    throw new Error('NG')
  })
})
