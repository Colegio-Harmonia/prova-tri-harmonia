import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

type Rgb = [number, number, number]

const css = source('src/app/globals.css')

function tokens(pattern: RegExp, label: string): Record<string, Rgb> {
  const match = css.match(pattern)
  assert.ok(match, `Bloco de tokens ausente: ${label}`)
  const found: Record<string, Rgb> = {}
  for (const line of match[1].split('\n')) {
    const declaration = line.match(/--([\w-]+):\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*;/)
    if (declaration) found[declaration[1]] = [Number(declaration[2]), Number(declaration[3]), Number(declaration[4])]
  }
  return found
}

const light = tokens(/:root\s*\{([\s\S]*?)\n\}/, 'claro (:root)')
const dark = tokens(/html\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/, 'escuro explicito')
const darkSystem = tokens(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)\s*\{([\s\S]*?)\n\s*\}/, 'escuro do sistema')

function channel(value: number): number {
  const normalized = value / 255
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(channel)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: Rgb, background: Rgb): number {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

function required(theme: Record<string, Rgb>, name: string, label: string): Rgb {
  const value = theme[name]
  assert.ok(value, `Token --${name} ausente no tema ${label}.`)
  return value
}

const pairs: Array<[string, string]> = [
  ['color-content-primary', 'color-surface'],
  ['color-content-secondary', 'color-surface'],
  ['color-content-muted', 'color-surface'],
  ['color-status-success-content', 'color-status-success-surface'],
  ['color-status-warning-content', 'color-status-warning-surface'],
  ['color-status-danger-content', 'color-status-danger-surface'],
  ['color-status-info-content', 'color-status-info-surface'],
]

for (const [label, theme] of [['claro', light], ['escuro', dark], ['escuro do sistema', darkSystem]] as const) {
  for (const [foreground, background] of pairs) {
    const ratio = contrast(required(theme, foreground, label), required(theme, background, label))
    assert.ok(ratio >= 4.5, `Contraste ${foreground} em ${background} no tema ${label} abaixo de AA (${ratio.toFixed(2)}:1).`)
    console.log(`${label.padEnd(18)} ${foreground} em ${background}: ${ratio.toFixed(2)}:1`)
  }
}

const tailwind = source('tailwind.config.ts')
for (const tone of ['success', 'warning', 'danger', 'info']) {
  for (const token of [`--color-status-${tone}`, `--color-status-${tone}-surface`, `--color-status-${tone}-content`, `--color-status-${tone}-border`]) {
    assert.ok(tailwind.includes(token), `Tailwind nao expoe ${token}.`)
  }
}

console.log('theme token contract passed')
