import sharp from 'sharp'
import type { ExamQuestion } from '@/lib/gemini/examSchema'

export type QuestionDataVisual = { buffer: Buffer; kind: 'grid' | 'polygon' | 'temperature' }

function gridSvg(question: ExamQuestion): string | null {
  const text = `${question.supportText ?? ''}\n${question.statement}`
  if (!/malha quadriculada/i.test(text) || !/quadradinhos?/i.test(text)) return null
  const cells = [...new Set([...text.matchAll(/\b([A-F])\s*([1-6])\b/g)].map((match) => `${match[1]}${match[2]}`))]
  if (cells.length < 2 || cells.length > 30) return null
  const size = 76
  const left = 82
  const top = 54
  const grid = Array.from({ length: 6 }, (_, row) => Array.from({ length: 6 }, (_, col) => {
    const letter = String.fromCharCode(65 + col)
    const number = 6 - row
    const filled = cells.includes(`${letter}${number}`)
    return `<rect x="${left + col * size}" y="${top + row * size}" width="${size}" height="${size}" fill="${filled ? '#b9ddcb' : '#fff'}" stroke="#657b72" stroke-width="1.5"/>`
  }).join('')).join('')
  const labels = Array.from({ length: 6 }, (_, col) => `<text x="${left + col * size + size / 2}" y="${top - 18}" text-anchor="middle" font-size="25" font-family="Arial">${String.fromCharCode(65 + col)}</text>`).join('')
    + Array.from({ length: 6 }, (_, row) => `<text x="${left - 25}" y="${top + row * size + size / 2 + 8}" text-anchor="middle" font-size="25" font-family="Arial">${6 - row}</text>`).join('')
  const axis = text.match(/eixo de simetria[^.]*?entre as colunas\s+([A-F])\s+e\s+([A-F])/i)
  const axisCol = axis && axis[2].charCodeAt(0) === axis[1].charCodeAt(0) + 1 ? axis[1].toUpperCase().charCodeAt(0) - 64 : null
  const axisLine = axisCol ? `<line x1="${left + axisCol * size}" y1="${top - 9}" x2="${left + axisCol * size}" y2="${top + 6 * size + 9}" stroke="#9b3c3c" stroke-width="4" stroke-dasharray="12 8"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="580" viewBox="0 0 620 580"><rect width="100%" height="100%" fill="white"/>${grid}${axisLine}${labels}</svg>`
}

function temperatureSvg(question: ExamQuestion): string | null {
  const text = `${question.supportText ?? ''}\n${question.statement}`
  if (!/term[oô]metro|temperatura|amplitude t[eé]rmica/i.test(text)) return null
  const values = new Map<string, number>()
  for (const match of text.matchAll(/\b(?:[àa]s?\s*)?(\d{1,2})h(?:\s*(\d{1,2}))?\s*[—–:\-]\s*(-?\d{1,3})\s*°\s*C\b/gi)) {
    const hour = Number(match[1])
    const minute = Number(match[2] ?? 0)
    const degrees = Number(match[3])
    if (hour > 23 || minute > 59 || degrees < -50 || degrees > 70) return null
    values.set(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, degrees)
  }
  if (values.size < 2 || values.size > 12) return null
  const entries = [...values].sort(([a], [b]) => a.localeCompare(b))
  const temperatures = entries.map(([, temperature]) => temperature)
  const minimum = Math.floor((Math.min(...temperatures) - 2) / 5) * 5
  const maximum = Math.ceil((Math.max(...temperatures) + 2) / 5) * 5
  if (maximum <= minimum) return null
  const x = (index: number) => 100 + index * 620 / (entries.length - 1)
  const y = (value: number) => 410 - (value - minimum) / (maximum - minimum) * 310
  const guides = Array.from({ length: 5 }, (_, index) => {
    const value = minimum + index * (maximum - minimum) / 4
    return `<line x1="100" y1="${y(value)}" x2="720" y2="${y(value)}" stroke="#dce5e1"/><text x="85" y="${y(value) + 7}" text-anchor="end" font-size="19" font-family="Arial">${Number.isInteger(value) ? value : value.toFixed(1)}°C</text>`
  }).join('')
  const path = entries.map(([, temperature], index) => `${index ? 'L' : 'M'} ${x(index)} ${y(temperature)}`).join(' ')
  const points = entries.map(([time, temperature], index) => `<circle cx="${x(index)}" cy="${y(temperature)}" r="8" fill="#006b3f"/><text x="${x(index)}" y="${y(temperature) - 17}" text-anchor="middle" font-size="20" font-family="Arial">${temperature}°C</text><text x="${x(index)}" y="450" text-anchor="middle" font-size="19" font-family="Arial">${time}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="500" viewBox="0 0 820 500"><rect width="100%" height="100%" fill="white"/>${guides}<path d="${path}" fill="none" stroke="#006b3f" stroke-width="4"/>${points}</svg>`
}

function polygonSvg(question: ExamQuestion): string | null {
  const text = `${question.supportText ?? ''}\n${question.statement}`
  if (!/pol[ií]gono/i.test(text) || !/v[eé]rtices/i.test(text)) return null
  const points = [...text.matchAll(/\(\s*(-?\d{1,2})\s*,\s*(-?\d{1,2})\s*\)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
  if (points.length < 3 || points.length > 12 || points.some((point) => Math.abs(point.x) > 20 || Math.abs(point.y) > 20)) return null
  const minX = Math.min(0, ...points.map((point) => point.x)) - 1
  const maxX = Math.max(0, ...points.map((point) => point.x)) + 1
  const minY = Math.min(0, ...points.map((point) => point.y)) - 1
  const maxY = Math.max(0, ...points.map((point) => point.y)) + 1
  const size = Math.min(70, 560 / Math.max(maxX - minX, maxY - minY))
  const left = 90
  const top = 60
  const x = (value: number) => left + (value - minX) * size
  const y = (value: number) => top + (maxY - value) * size
  const verticals = Array.from({ length: maxX - minX + 1 }, (_, index) => `<line x1="${x(minX + index)}" y1="${y(maxY)}" x2="${x(minX + index)}" y2="${y(minY)}" stroke="#d7e2dc"/>`).join('')
  const horizontals = Array.from({ length: maxY - minY + 1 }, (_, index) => `<line x1="${x(minX)}" y1="${y(minY + index)}" x2="${x(maxX)}" y2="${y(minY + index)}" stroke="#d7e2dc"/>`).join('')
  const polygon = points.map((point) => `${x(point.x)},${y(point.y)}`).join(' ')
  const labels = points.map((point) => `<circle cx="${x(point.x)}" cy="${y(point.y)}" r="4" fill="#005c3c"/><text x="${x(point.x) + 8}" y="${y(point.y) - 8}" font-size="17" font-family="Arial">(${point.x},${point.y})</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="750" viewBox="0 0 800 750"><rect width="100%" height="100%" fill="white"/>${verticals}${horizontals}<polygon points="${polygon}" fill="#b9ddcb" stroke="#006b3f" stroke-width="4"/>${labels}</svg>`
}

/** Ilustra apenas dados explícitos; não desenha a solução da questão. */
export async function renderQuestionDataVisual(subject: string, question: ExamQuestion): Promise<QuestionDataVisual | null> {
  if (subject.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() !== 'matematica') return null
  const grid = gridSvg(question)
  if (grid) return { kind: 'grid', buffer: await sharp(Buffer.from(grid)).png().toBuffer() }
  const polygon = polygonSvg(question)
  if (polygon) return { kind: 'polygon', buffer: await sharp(Buffer.from(polygon)).png().toBuffer() }
  const temperature = temperatureSvg(question)
  if (temperature) return { kind: 'temperature', buffer: await sharp(Buffer.from(temperature)).png().toBuffer() }
  return null
}
