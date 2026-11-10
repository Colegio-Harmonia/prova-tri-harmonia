// A cadeia antiga não corresponde ao schema completo e não pode ser
// reaplicada indiscriminadamente sobre os dados existentes.
console.error('Migração automática indisponível: o histórico anterior à baseline de 10/11/2026 é incompleto. Para banco vazio, use npm run db:bootstrap -- --database NOME. Para banco existente, siga docs/RECUPERACAO_VERSIONAMENTO.md e revise a migração específica antes de aplicá-la.')
process.exitCode = 1
