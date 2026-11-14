import { customType } from 'drizzle-orm/pg-core'
import { decryptField, encryptField } from '@/lib/security/fieldCrypto'

/**
 * Coluna de texto com dado pessoal de aluno: cifrada ao gravar e decifrada ao
 * ler, de forma transparente para quem usa o Drizzle (ver fieldCrypto.ts).
 *
 * ⚠️ NUNCA compare nem ordene por esta coluna no banco (`eq`, `inArray`,
 * `orderBy`): a cifra muda a cada gravação, então a comparação nunca casa e a
 * ordem é aleatória. Para "é o mesmo aluno?" use a coluna `*_hash`
 * correspondente com os helpers de `src/lib/security/studentIdentity.ts`;
 * para ordenar por nome, ordene na aplicação depois de ler.
 */
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType: () => 'text',
  toDriver: (value) => encryptField(value),
  fromDriver: (value) => decryptField(value),
})

const JSON_ENVELOPE_KEY = '__enc'

/**
 * Coluna `jsonb` cujo conteúdo inteiro traz dados pessoais (ex.: a análise do
 * simulado SAE, com o nome de cada aluno). Com chave, o JSON é gravado como
 * `{"__enc": "enc:v1:…"}`; sem chave, ou em linhas antigas, fica o JSON puro.
 * O banco não consegue consultar dentro dela — só a aplicação lê.
 */
export const encryptedJson = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => 'jsonb',
  toDriver: (value) => {
    const json = JSON.stringify(value)
    const stored = encryptField(json)
    return stored === json ? json : JSON.stringify({ [JSON_ENVELOPE_KEY]: stored })
  },
  fromDriver: (value) => {
    const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed)
      const envelope = (parsed as Record<string, unknown>)[JSON_ENVELOPE_KEY]
      if (keys.length === 1 && typeof envelope === 'string') return JSON.parse(decryptField(envelope)) as unknown
    }
    return parsed
  },
})
