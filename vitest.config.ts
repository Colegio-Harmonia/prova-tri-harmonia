import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/config/enemAreaMap.ts',
        'src/config/pedagogicalConfidence.ts',
        'src/app/api/admin/ai-models/route.ts',
        'src/app/api/admin/ai-operations/route.ts',
        'src/app/api/admin/audit/route.ts',
        'src/app/api/analytics/enem-sae/route.ts',
        'src/app/api/users/route.ts',
        'src/lib/auth/roles.ts',
        'src/lib/notifications/googleChatInstallation.ts',
        'src/lib/pedagogical/questionHeuristics.ts',
        'src/lib/sheets/habilidadesParser.ts',
        'src/lib/sheets/headerResolver.ts',
        'src/lib/sheets/objetivosParser.ts',
        'src/lib/sheets/rowParser.ts',
      ],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  },
})
