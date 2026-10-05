import { RelayErrorCode } from './relay-protocol'

/**
 * Client-side ceiling for concurrent `fs.readFileStream` calls on one SSH
 * connection. The relay refuses past `MAX_CONCURRENT_STREAMS` (16) and can also
 * hold a registry slot briefly after the last chunk for the terminal frame, so
 * the client stays well under 16 and leaves room for overlapping bulk work
 * (file snapshots, explorer, editor opens) without racing the hard limit.
 */
export const SSH_FILE_STREAM_READ_CONCURRENCY = 8

const TOO_MANY_STREAMS_RETRY_DELAYS_MS = [50, 150, 350] as const

export type ConcurrencyGate = <T>(run: () => Promise<T>) => Promise<T>

/** Serializes work so at most `maxInFlight` callers run at once. */
export function createConcurrencyGate(maxInFlight: number): ConcurrencyGate {
  const limit = Math.max(1, Math.floor(maxInFlight))
  const waiting: (() => void)[] = []
  let inFlight = 0

  return async <T>(run: () => Promise<T>): Promise<T> => {
    if (inFlight < limit) {
      inFlight++
    } else {
      // The releasing call hands its slot over directly, so a queued caller can
      // never race a fresh one into an over-limit slot.
      await new Promise<void>((resolve) => waiting.push(resolve))
    }
    try {
      return await run()
    } finally {
      const next = waiting.shift()
      if (next) {
        next()
      } else {
        inFlight--
      }
    }
  }
}

export function isTooManyStreamsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const code = (error as { code?: unknown }).code
  if (code === RelayErrorCode.TooManyStreams || code === 'TooManyStreams') {
    return true
  }
  return error instanceof Error && /too many concurrent streams/i.test(error.message)
}

/**
 * Runs a stream-backed read under the connection gate. On relay TooManyStreams
 * (terminal-frame lag or another client on the same registry), waits briefly
 * and retries a few times instead of failing the whole bulk capture.
 */
export async function runWithSshFileStreamSlot<T>(
  gate: ConcurrencyGate,
  run: () => Promise<T>,
  options?: {
    delaysMs?: readonly number[]
    sleep?: (ms: number) => Promise<void>
  }
): Promise<T> {
  const delays = options?.delaysMs ?? TOO_MANY_STREAMS_RETRY_DELAYS_MS
  const sleep =
    options?.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms)
      }))

  let attempt = 0
  while (true) {
    try {
      return await gate(run)
    } catch (error) {
      if (!isTooManyStreamsError(error) || attempt >= delays.length) {
        throw error
      }
      await sleep(delays[attempt]!)
      attempt += 1
    }
  }
}
