'use client'

import React, { lazy, Suspense } from 'react'
import { splitLatexSegments } from '@/lib/math/latexSegments'

const RenderMathText = lazy(() => import('./MathText').then(({ MathText }) => ({ default: MathText })))

/** Carrega o renderizador de fórmulas somente quando há matemática no texto. */
export function LazyMathText({ text }: { text: string | null | undefined }) {
  const segments = splitLatexSegments(text)
  const placeholder = <>{segments.map((segment, index) => segment.type === 'text'
    ? <span key={index}>{segment.content}</span>
    : <span key={index} aria-busy="true" aria-label="Carregando fórmula">…</span>)}</>
  if (!segments.some((segment) => segment.type === 'math')) return placeholder
  return <Suspense fallback={placeholder}><RenderMathText text={text} /></Suspense>
}
