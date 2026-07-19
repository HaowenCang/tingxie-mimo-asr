import { promises as fs } from 'node:fs'
import path from 'node:path'

interface DiagnosticLogWriterOptions {
  maxBytes?: number
  backups?: number
  flushIntervalMs?: number
  maxBatchEntries?: number
}

export class DiagnosticLogWriter {
  private readonly maxBytes: number
  private readonly backups: number
  private readonly flushIntervalMs: number
  private readonly maxBatchEntries: number
  private readonly pending: string[] = []
  private timer: NodeJS.Timeout | undefined
  private currentSize: number | undefined
  private writeChain = Promise.resolve()

  constructor(private readonly file: string, options: DiagnosticLogWriterOptions = {}) {
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024
    this.backups = options.backups ?? 3
    this.flushIntervalMs = options.flushIntervalMs ?? 150
    this.maxBatchEntries = options.maxBatchEntries ?? 32
  }

  write(event: string, details: Record<string, unknown>): void {
    this.pending.push(JSON.stringify({ timestamp: new Date().toISOString(), event, ...details }))
    if (this.pending.length >= this.maxBatchEntries) {
      void this.flush().catch(() => undefined)
      return
    }
    if (!this.timer) this.timer = setTimeout(() => void this.flush().catch(() => undefined), this.flushIntervalMs)
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const lines = this.pending.splice(0)
    if (lines.length) {
      this.writeChain = this.writeChain
        .catch(() => undefined)
        .then(() => this.appendBatch(lines))
    }
    return this.writeChain
  }

  private async appendBatch(lines: string[]): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    if (this.currentSize === undefined) {
      this.currentSize = await fs.stat(this.file).then((stat) => stat.size).catch(() => 0)
    }
    const payload = `${lines.join('\n')}\n`
    const payloadBytes = Buffer.byteLength(payload)
    if (this.currentSize > 0 && this.currentSize + payloadBytes > this.maxBytes) await this.rotate()
    await fs.appendFile(this.file, payload, 'utf8')
    this.currentSize += payloadBytes
  }

  private async rotate(): Promise<void> {
    await fs.rm(`${this.file}.${this.backups}`, { force: true }).catch(() => undefined)
    for (let index = this.backups - 1; index >= 1; index -= 1) {
      await fs.rename(`${this.file}.${index}`, `${this.file}.${index + 1}`).catch(() => undefined)
    }
    await fs.rename(this.file, `${this.file}.1`).catch(() => undefined)
    this.currentSize = 0
  }
}
