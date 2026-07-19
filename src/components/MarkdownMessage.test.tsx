import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownMessage } from './MarkdownMessage'

describe('MarkdownMessage', () => {
  it('renders common GFM syntax', () => {
    const markup = renderToStaticMarkup(<MarkdownMessage content={'## 结论\n\n- [x] 完成\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst value = 1\n```'} />)
    expect(markup).toContain('<h2>')
    expect(markup).toContain('type="checkbox"')
    expect(markup).toContain('<table>')
    expect(markup).toContain('markdown-code-block')
  })

  it('does not turn model-provided HTML into executable elements', () => {
    const markup = renderToStaticMarkup(<MarkdownMessage content={'<script>alert(1)</script>\n\n<a href="javascript:alert(1)">bad</a>'} />)
    expect(markup).not.toContain('<script>')
    expect(markup).not.toContain('javascript:')
  })
})
