/**
 * Go の defer 構文のようなものを提供する utility
 */

export type DeferFunc = () => void | Promise<void>
type RegisterDefer = (deferFunc: DeferFunc) => void

const waitAll = async (funcs: DeferFunc[]) => {
  const onError = (e: any) => {
    console.error(e)
  }
  const promises: Promise<void>[] = []
  for (const f of funcs) {
    try {
      const r = f()
      if (r && 'then' in r) {
        promises.push(r.catch(onError))
      }
    } catch(e) {
      onError(e)
    }
  }
  await Promise.all(promises)
  return
}

export const drun = async <T>(runner: (defer: RegisterDefer) => T | Promise<T>): Promise<T> => {
  const handlers: DeferFunc[] = []
  const register: RegisterDefer = func => {
    handlers.push(func)
  }

  try {
    return runner(register)    
  } catch (e) {
    throw e
  } finally {
    await waitAll(handlers)
  }
}

// 簡単のため return なし next なにも受けとらない前提で考える
export const drai = async function * <N, R>(runner: (defer: RegisterDefer) => AsyncGenerator<N, void, void>): AsyncGenerator<N, void, void> {
  let handlers: DeferFunc[] = []
  const register: RegisterDefer = func => {
    handlers.push(func)
  }

  try {
    for await (const i of runner(register)) {
      yield i
    }
  } catch (e) {
    throw e
  } finally {
    await waitAll(handlers)
  }
}
