import React from 'react'
import { LazyMathText as MathText } from './LazyMathText'
import { originalAcervoMediaUrl, type AcervoContentPart } from '@/lib/exams/acervoMedia'

export function AcervoText({ text, parts, examId }: { text: string; parts?: AcervoContentPart[]; examId: number }) {
  const plain = parts?.map((part) => part.type === 'text' ? part.text : '').join('')
  // A local teacher edit can precede the next server refresh of the sidecar.
  if (parts && plain?.replace(/\s+/g, '') !== text.replace(/\s+/g, '') && !(plain === '' && /^Figura [A-Z]$/.test(text))) parts = undefined
  if (!parts) return React.createElement(MathText, { text })
  return React.createElement(React.Fragment, null, ...parts.map((part, index) => part.type === 'text'
    ? React.createElement(MathText, { key: index, text: part.text })
    : React.createElement('img', {
      key: index, src: originalAcervoMediaUrl(examId, part.mediaId), alt: part.alt,
      className: 'inline-block max-h-32 max-w-full align-middle', style: { width: part.width, height: 'auto' }, loading: 'lazy',
    })))
}
