import { describe, expect, it } from 'vitest'
import { questionImageUrl } from './questionImageUrl'

describe('questionImageUrl', () => {
  it('creates a same-origin route and escapes the Drive file ID', () => {
    expect(questionImageUrl(319, 'file/id?x=1')).toBe('/api/exams/319/images/file%2Fid%3Fx%3D1')
  })
})
