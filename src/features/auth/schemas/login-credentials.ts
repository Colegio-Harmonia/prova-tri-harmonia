import { z } from 'zod'

const emailAddressSchema = z.string().email()

export const loginCredentialsSchema = z.object({
  email: z
    .string()
    .min(1, 'Informe seu email.')
    .refine(
      (value) => value.length === 0 || emailAddressSchema.safeParse(value).success,
      'Informe um email válido.',
    ),
  password: z.string().min(1, 'Informe sua senha.'),
})

export type LoginCredentials = z.infer<typeof loginCredentialsSchema>
