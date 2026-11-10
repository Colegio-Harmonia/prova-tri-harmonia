import { z } from 'zod'

export const DEFAULT_ACERVO_API_URL = 'https://questoes.colegioharmonia.com.br'

export const acervoUrlSchema = z.string().trim().min(1, 'Informe o IP ou endereço da API.').max(2048)
  .transform((value, ctx) => {
    try {
      const url = new URL(value.includes('://') ? value : `http://${value}`)
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
          url.pathname !== '/' || url.search || url.hash) throw new Error('invalid')
      return url.origin
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe um IP ou URL HTTP/HTTPS válido, com a porta se necessário, sem caminhos ou credenciais.' })
      return z.NEVER
    }
  })
