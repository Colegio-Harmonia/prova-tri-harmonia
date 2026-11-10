import React from 'react'
import katex from 'katex'
import { splitLatexSegments } from '@/lib/math/latexRender'

export function MathText({ text }: { text: string | null | undefined }) {
  return React.createElement(React.Fragment, null, ...splitLatexSegments(text).map((segment, index) => {
    if (segment.type === 'text') return React.createElement('span', { key: index }, segment.content)
    return React.createElement('span', {
      key: index,
      className: segment.display ? 'my-2 block max-w-full overflow-x-auto overflow-y-hidden py-1' : 'align-middle',
      dangerouslySetInnerHTML: { __html: katex.renderToString(segment.latex, {
        displayMode: segment.display, throwOnError: false, trust: false, output: 'htmlAndMathml',
      }) },
    })
  }))
}
