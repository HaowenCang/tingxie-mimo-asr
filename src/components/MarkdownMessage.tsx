import { Check, Copy } from 'lucide-react'
import { memo, useState, type ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

interface MarkdownMessageProps {
  content: string
}

const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [rehypeSanitize]

const MarkdownCodeBlock = memo(function MarkdownCodeBlock({ children }: Pick<ComponentProps<'pre'>, 'children'>) {
  const [copiedCode, setCopiedCode] = useState('')

  async function copyCode(code: string) {
    if (window.tingxie) await window.tingxie.copyText(code)
    else await navigator.clipboard.writeText(code)
    setCopiedCode(code)
    window.setTimeout(() => setCopiedCode(''), 1500)
  }

  const code = String((children as { props?: { children?: unknown } })?.props?.children ?? '').replace(/\n$/, '')
  return <div className="markdown-code-block">
    <button aria-label="复制代码" onClick={() => void copyCode(code)}>{copiedCode === code ? <Check size={13} /> : <Copy size={13} />}{copiedCode === code ? '已复制' : '复制'}</button>
    <pre>{children}</pre>
  </div>
})

const MARKDOWN_COMPONENTS = {
  a: ({ children, ...props }: ComponentProps<'a'>) => <a {...props} target="_blank" rel="noreferrer noopener">{children}</a>,
  pre: MarkdownCodeBlock,
}

export const MarkdownMessage = memo(function MarkdownMessage({ content }: MarkdownMessageProps) {
  return <ReactMarkdown
    remarkPlugins={REMARK_PLUGINS}
    rehypePlugins={REHYPE_PLUGINS}
    components={MARKDOWN_COMPONENTS}
  >{content}</ReactMarkdown>
})
