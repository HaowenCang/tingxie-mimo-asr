import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GlassSelect } from './GlassSelect'

describe('GlassSelect', () => {
  it('renders the selected label through an accessible glass trigger', () => {
    const markup = renderToStaticMarkup(<GlassSelect
      ariaLabel="转写状态筛选"
      value="transcribed"
      onValueChange={() => undefined}
      options={[
        { value: 'all', label: '全部状态' },
        { value: 'transcribed', label: '已转写' },
      ]}
    />)

    expect(markup).toContain('aria-label="转写状态筛选"')
    expect(markup).toContain('glass-select-trigger')
    expect(markup).toContain('已转写')
  })
})
