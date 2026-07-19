import { describe, expect, it, vi } from 'vitest'
import type { TranscriptResult } from './types'
import { buildAnalysisRequestBody, generateTranscriptAnalysis, isJsonModeUnsupported, parseAnalysisJson } from './analysis'

const transcript: TranscriptResult = {
  id: 'transcript-1',
  fileName: '会议.m4a',
  createdAt: '2026-07-18T00:00:00.000Z',
  text: '第一部分。第二部分。',
  duration: 120,
  segments: [
    { id: 'segment-0', start: 0, text: '第一部分。' },
    { id: 'segment-1', start: 60, text: '第二部分。' },
  ],
}

describe('smart analysis requests', () => {
  it('uses native JSON mode for Xiaomi MiMo providers', () => {
    const body = buildAnalysisRequestBody(transcript, {
      model: 'mimo-v2.5-pro',
      maxOutputTokens: 8192,
      jsonMode: true,
    })

    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages.at(-1)?.content).toContain('startSegmentId')
  })

  it('accepts a fenced JSON result and validates transcript segment references', () => {
    const analysis = parseAnalysisJson(`\`\`\`json
      {"overview":"概述","keywords":["项目"],"chapters":[{"title":"开场","summary":"介绍议题","startSegmentId":"segment-0","endSegmentId":"missing"}],"keyPoints":["要点"],"speechSummary":[],"actionItems":[]}
    \`\`\``, transcript, { id: 'mimo-token-plan', model: 'mimo-v2.5-pro' })

    expect(analysis.overview).toBe('概述')
    expect(analysis.chapters[0]).toMatchObject({ startSegmentId: 'segment-0', endSegmentId: 'segment-0' })
  })

  it('detects an OpenAI-compatible provider that rejects JSON mode', () => {
    expect(isJsonModeUnsupported(400, "Unsupported parameter: 'response_format'")).toBe(true)
    expect(isJsonModeUnsupported(500, 'temporary server error')).toBe(false)
  })

  it('repairs one invalid model result before reporting failure', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '这里是智能速览，但不是 JSON。' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"overview":"修复后的概述","chapters":[]}' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const result = await generateTranscriptAnalysis({
      transcript,
      provider: { id: 'mimo-token-plan', model: 'mimo-v2.5-pro', baseUrl: 'https://example.test/v1', maxOutputTokens: 8192, jsonMode: 'required' },
      headers: { 'api-key': 'secret' },
      fetcher,
    })

    expect(result.overview).toBe('修复后的概述')
    expect(fetcher).toHaveBeenCalledTimes(2)
    const repairBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body))
    expect(repairBody.messages.at(-1).content).toContain('<invalid-output>')
  })

  it('falls back without JSON mode when a compatible provider rejects response_format', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'response_format'" } }), { status: 400, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"overview":"兼容模式概述"}' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const result = await generateTranscriptAnalysis({
      transcript,
      provider: { id: 'custom', model: 'custom-model', baseUrl: 'https://example.test/v1', maxOutputTokens: 4096, jsonMode: 'auto' },
      headers: { Authorization: 'Bearer secret' },
      fetcher,
    })

    expect(result.overview).toBe('兼容模式概述')
    const fallbackBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body))
    expect(fallbackBody).not.toHaveProperty('response_format')
  })
})
