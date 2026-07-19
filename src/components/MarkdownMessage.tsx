import { Check, Copy } from 'lucide-react'
import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

interface MarkdownMessageProps {
  content: string
}

export const MarkdownMessage = memo(function MarkdownMessage({ content }: MarkdownMessageProps) {
  const [copiedCode, setCopiedCode] = useState('')

  async function copyCode(code: string) {
    if (window.tingxie) await window.tingxie.copyText(code)
    else await navigator.clipboard.writeText(code)
    setCopiedCode(code)
    window.setTimeout(() => setCopiedCode(''), 1500)
  }

  return <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    rehypePlugins={[rehypeSanitize]}
    components={{
      a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener">{children}</a>,
      pre: ({ children }) => {
        const code = String((children as { props?: { children?: unknown } })?.props?.children ?? '').replace(/\n$/, '')
        return <div className="markdown-code-block">
          <button aria-label="复制代码" onClick={() => void copyCode(code)}>{copiedCode === code ? <Check size={13} /> : <Copy size={13} />}{copiedCode === code ? '已复制' : '复制'}</button>
          <pre>{children}</pre>
        </div>
      },
    }}
  >{content}</ReactMarkdown>
})
