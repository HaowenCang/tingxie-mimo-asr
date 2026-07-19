const MIB = 1024 * 1024
const MIN_ASR_MEMORY_BUDGET = 128 * MIB
const MAX_ASR_MEMORY_BUDGET = 192 * MIB

interface ByteWaiter {
  bytes: number
  resolve(release: () => void): void
  reject(error: Error): void
  signal?: AbortSignal
  abort?: () => void
}

export function calculateAsrMemoryBudget(freeMemoryBytes: number): number {
  const adaptive = Math.floor(Math.max(0, freeMemoryBytes) * 0.08)
  return Math.min(MAX_ASR_MEMORY_BUDGET, Math.max(MIN_ASR_MEMORY_BUDGET, adaptive))
}

export function estimateAsrRequestMemory(fileBytes: number): number {
  return Math.max(1, Math.ceil(fileBytes * 4 + 64 * 1024))
}

export class AsyncByteBudget {
  private usedBytes = 0
  private readonly waiters: ByteWaiter[] = []

  constructor(readonly capacityBytes: number) {
    if (!Number.isFinite(capacityBytes) || capacityBytes <= 0) throw new Error('ASR 内存预算必须大于 0')
  }

  get availableBytes(): number {
    return this.capacityBytes - this.usedBytes
  }

  acquire(requestedBytes: number, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new Error('任务已取消'))
    const bytes = Math.min(this.capacityBytes, Math.max(1, Math.ceil(requestedBytes)))
    return new Promise<() => void>((resolve, reject) => {
      const waiter: ByteWaiter = { bytes, resolve, reject, signal }
      if (signal) {
        waiter.abort = () => {
          const index = this.waiters.indexOf(waiter)
          if (index >= 0) this.waiters.splice(index, 1)
          reject(new Error('任务已取消'))
          this.drain()
        }
        signal.addEventListener('abort', waiter.abort, { once: true })
      }
      this.waiters.push(waiter)
      this.drain()
    })
  }

  private drain(): void {
    while (this.waiters.length) {
      const waiter = this.waiters[0]
      if (this.usedBytes + waiter.bytes > this.capacityBytes) return
      this.waiters.shift()
      if (waiter.abort) waiter.signal?.removeEventListener('abort', waiter.abort)
      this.usedBytes += waiter.bytes
      let released = false
      waiter.resolve(() => {
        if (released) return
        released = true
        this.usedBytes -= waiter.bytes
        this.drain()
      })
    }
  }
}

interface AsrRequestAdmissionOptions<TPrepared, TResult> {
  waitForRate(): Promise<void>
  budget: AsyncByteBudget
  estimatedBytes: number
  signal?: AbortSignal
  onMemoryWait?(milliseconds: number): void
  prepare(): Promise<TPrepared>
  execute(prepared: TPrepared): Promise<TResult>
}

export async function withAsrRequestAdmission<TPrepared, TResult>({
  waitForRate,
  budget,
  estimatedBytes,
  signal,
  onMemoryWait,
  prepare,
  execute,
}: AsrRequestAdmissionOptions<TPrepared, TResult>): Promise<TResult> {
  await waitForRate()
  if (signal?.aborted) throw new Error('任务已取消')
  const memoryWaitStartedAt = Date.now()
  const release = await budget.acquire(estimatedBytes, signal)
  onMemoryWait?.(Date.now() - memoryWaitStartedAt)
  try {
    return await execute(await prepare())
  } finally {
    release()
  }
}
