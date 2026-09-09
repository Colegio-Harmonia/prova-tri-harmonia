import { describe, expect, it } from 'vitest'
import { getGradeSheetConfig } from './gradeSheets'

describe('planilhas do Ensino Médio', () => {
  it.each([1, 2, 3])('resolve Língua Portuguesa pelo título padronizado no %iº ano', (gradeYear) => {
    expect(getGradeSheetConfig('ensino-medio', gradeYear).knownTabTitles?.['Língua Portuguesa']).toBe('Língua Portuguesa')
  })
})
