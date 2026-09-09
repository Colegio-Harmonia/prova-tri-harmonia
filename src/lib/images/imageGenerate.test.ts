import { describe, expect, it } from 'vitest'
import { openAiImageGenerationPayload } from './imageGenerate'

describe('openAiImageGenerationPayload', () => {
  it('does not send the legacy response_format parameter to GPT Image', () => {
    expect(openAiImageGenerationPayload('gpt-image-2', 'diagrama')).toEqual({
      model: 'gpt-image-2',
      prompt: 'diagrama',
      size: '1024x1024',
    })
  })

  it('keeps b64_json for DALL·E models', () => {
    expect(openAiImageGenerationPayload('dall-e-3', 'diagrama')).toEqual({
      model: 'dall-e-3',
      prompt: 'diagrama',
      size: '1024x1024',
      response_format: 'b64_json',
    })
  })
})
