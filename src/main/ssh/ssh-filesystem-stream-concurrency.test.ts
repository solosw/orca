import { describe, expect, it, vi } from 'vitest'
import { RelayErrorCode } from './relay-protocol'
import {
  createConcurrencyGate,
  isTooManyStreamsError,
  runWithSshFileStreamSlot,
  SSH_FILE_STREAM_READ_CONCURRENCY
} from './ssh-filesystem-stream-concurrency'

describe('ssh-filesystem-stream-concurrency', () => {
  it('exposes a client ceiling below the relay hard max of 16', () => {
    expect(SSH_FILE_STREAM_READ_CONCURRENCY).toBeLessThan(16)
    expect(SSH_FILE_STREAM_READ_CONCURRENCY).toBeGreaterThan(0)
  })

  it('never runs more than the gated number of callers at once', async () => {
    const gate = createConcurrencyGate(2)
    let inFlight = 0
    let peak = 0
    const run = async (): Promise<void> => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight -= 1
    }

    await Promise.all(Array.from({ length: 8 }, () => gate(run)))
    expect(peak).toBe(2)
  })

  it('detects TooManyStreams by code or message', () => {
    const coded = Object.assign(new Error('refused'), { code: RelayErrorCode.TooManyStreams })
    expect(isTooManyStreamsError(coded)).toBe(true)
    expect(isTooManyStreamsError(new Error('Too many concurrent streams (max 16)'))).toBe(true)
    expect(isTooManyStreamsError(new Error('ENOENT'))).toBe(false)
  })

  it('retries TooManyStreams under the gate until a slot opens', async () => {
    const gate = createConcurrencyGate(1)
    const sleep = vi.fn(async () => undefined)
    let attempts = 0
    const result = await runWithSshFileStreamSlot(
      gate,
      async () => {
        attempts += 1
        if (attempts < 3) {
          throw Object.assign(new Error('Too many concurrent streams (max 16)'), {
            code: RelayErrorCode.TooManyStreams
          })
        }
        return 'ok'
      },
      { delaysMs: [1, 1, 1], sleep }
    )

    expect(result).toBe('ok')
    expect(attempts).toBe(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('stops retrying TooManyStreams after the delay budget is exhausted', async () => {
    const gate = createConcurrencyGate(1)
    const sleep = vi.fn(async () => undefined)
    await expect(
      runWithSshFileStreamSlot(
        gate,
        async () => {
          throw Object.assign(new Error('Too many concurrent streams (max 16)'), {
            code: RelayErrorCode.TooManyStreams
          })
        },
        { delaysMs: [1, 1], sleep }
      )
    ).rejects.toThrow(/too many concurrent streams/i)
    expect(sleep).toHaveBeenCalledTimes(2)
  })
})
