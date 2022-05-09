import Semaphore from 'semaphore-async-await'

// The minimum amount of milliseconds before releasing a lock
const REQUEST_TIME = 750

// Max number of simultaneous requets to aito
const PARALLEL_REQUESTS = 10

// Semaphore to limit the number of parallel requests
const requestLocks = new Semaphore(PARALLEL_REQUESTS)

export const withRequestLock = async <T>(f: () => T | Promise<T>): Promise<T> => {
  const start = new Date()
  try {
    await requestLocks.acquire()
    return await f()
  } finally {
    const elapsed = new Date().valueOf() - start.valueOf()
    const remaining = REQUEST_TIME - elapsed
    if (elapsed > 0 && remaining > 0) {
      await new Promise((resolve) => setTimeout(() => resolve(undefined), remaining))
    }
    requestLocks.release()
  }
}

export default withRequestLock
