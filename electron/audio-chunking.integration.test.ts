import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { parseSilenceDetectOutput, planAudioChunks, selectAudioEncoding } from './audio-chunking'

function run(executable: string, args: string[]) {
  const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(result.stderr || `process failed: ${result.status}`)
  return result
}

describe('FFmpeg silence-aware chunk integration', () => {
  it('encodes oversized PCM sources as high-quality MP3 without changing common sample rate or channels', { timeout: 20_000 }, () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'tingxie-mp3-test-'))
    const source = path.join(directory, 'source.wav')
    const output = path.join(directory, 'output.mp3')
    try {
      run(String(ffmpegStatic), [
        '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8',
        '-ac', '2', '-c:a', 'pcm_s16le', source,
      ])
      const encoding = selectAudioEncoding({ codec: 'pcm_s16le', sourceBitRate: 1_536_000, channels: 2 })
      run(String(ffmpegStatic), ['-y', '-i', source, '-map', '0:a:0', '-vn', ...encoding.codecArgs, output])

      expect(statSync(output).size).toBeLessThan(statSync(source).size / 4)
      const info = JSON.parse(run(ffprobeStatic.path, [
        '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'json', output,
      ]).stdout) as { streams: Array<{ codec_name: string; sample_rate: string; channels: number }> }
      expect(info.streams[0]).toEqual({ codec_name: 'mp3', sample_rate: '48000', channels: 2 })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('finds a real pause and materializes bounded chunks without changing sample rate or channels', { timeout: 20_000 }, () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'tingxie-chunk-test-'))
    const source = path.join(directory, 'source.wav')
    try {
      run(String(ffmpegStatic), [
        '-y',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=1',
        '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=3',
        '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]',
        '-map', '[out]', '-ac', '2', '-c:a', 'pcm_s16le', source,
      ])

      const detection = run(String(ffmpegStatic), [
        '-hide_banner', '-i', source, '-map', '0:a:0',
        '-af', 'silencedetect=noise=-35dB:d=0.45', '-f', 'null', '-',
      ])
      const silences = parseSilenceDetectOutput(detection.stderr, 6)
      expect(silences.some((interval) => interval.start >= 1.9 && interval.end <= 3.1)).toBe(true)

      const bytesPerSecond = 48_000 * 2 * 2
      const hardBytes = bytesPerSecond * 3.5
      const plans = planAudioChunks(6, bytesPerSecond, silences, {
        targetBytes: bytesPerSecond * 2.2,
        hardBytes,
        silenceSearchSeconds: 2,
      })
      expect(plans[0].end).toBeGreaterThan(2.4)
      expect(plans[0].end).toBeLessThan(2.6)

      for (const [index, plan] of plans.entries()) {
        const output = path.join(directory, `chunk-${index}.wav`)
        run(String(ffmpegStatic), [
          '-y', '-ss', plan.start.toFixed(3), '-i', source,
          '-t', (plan.end - plan.start).toFixed(3), '-map', '0:a:0', '-vn', '-c:a', 'copy', output,
        ])
        expect(statSync(output).size).toBeLessThanOrEqual(hardBytes + 1024)
        const info = JSON.parse(run(ffprobeStatic.path, [
          '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'json', output,
        ]).stdout) as { streams: Array<{ sample_rate: string; channels: number }> }
        expect(info.streams[0]).toEqual({ sample_rate: '48000', channels: 2 })
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
