import { memo, useCallback, useEffect, useRef, useState } from 'react'

interface EditableTranscriptSegmentProps {
  index: number
  text: string
  onCommit(index: number, text: string): void
}

const EDIT_COMMIT_DELAY_MS = 600

export const EditableTranscriptSegment = memo(function EditableTranscriptSegment({ index, text, onCommit }: EditableTranscriptSegmentProps) {
  const [draft, setDraft] = useState(text)
  const draftRef = useRef(text)
  const committedRef = useRef(text)
  const timerRef = useRef<number | undefined>(undefined)

  const commit = useCallback(() => {
    window.clearTimeout(timerRef.current)
    timerRef.current = undefined
    if (draftRef.current === committedRef.current) return
    committedRef.current = draftRef.current
    onCommit(index, draftRef.current)
  }, [index, onCommit])

  useEffect(() => {
    if (text === committedRef.current) return
    committedRef.current = text
    draftRef.current = text
    setDraft(text)
  }, [text])

  useEffect(() => () => {
    window.clearTimeout(timerRef.current)
    if (draftRef.current !== committedRef.current) onCommit(index, draftRef.current)
  }, [index, onCommit])

  return <textarea
    aria-label={`转写段落 ${index + 1}`}
    value={draft}
    onBlur={commit}
    onChange={(event) => {
      const value = event.target.value
      draftRef.current = value
      setDraft(value)
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(commit, EDIT_COMMIT_DELAY_MS)
    }}
  />
})
