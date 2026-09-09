'use client'

import React, { useId } from 'react'
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export type RechartsBarChartProps = {
  title: string
  categories: string[]
  values: number[]
  colors: string[] | string
  subtitle?: string
  height?: number
}

export function RechartsBarChart({ title, categories, values, colors, subtitle, height }: RechartsBarChartProps) {
  const titleId = useId()
  const summaryId = useId()
  const data = categories.map((category, index) => ({
    category,
    value: values[index] ?? 0,
    color: Array.isArray(colors) ? (colors[index] ?? colors[0]) : colors,
  }))

  if (!data.length) return null

  return (
    <div className="rounded border border-neutral-200 bg-white p-4">
      <p id={titleId} className="text-sm font-medium text-neutral-700">{title}</p>
      {subtitle && <p className="text-xs text-neutral-400">{subtitle}</p>}
      <div
        role="img"
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        className="mt-2"
        style={{ height: height ?? Math.max(160, data.length * 34) }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 0 }}>
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="category" width={108} tick={{ fontSize: 11 }} />
            <Tooltip cursor={{ fill: 'rgb(0 134 73 / 0.08)' }} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {data.map((entry) => (
                <Cell key={entry.category} fill={entry.color} />
              ))}
              <LabelList dataKey="value" position="right" fill="#374151" fontSize={11} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul id={summaryId} className="sr-only">
        {data.map((entry) => (
          <li key={entry.category}>{entry.category}: {entry.value}</li>
        ))}
      </ul>
    </div>
  )
}
