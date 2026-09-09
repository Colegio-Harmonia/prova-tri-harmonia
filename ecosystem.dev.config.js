module.exports = {
  apps: [
    {
      name: 'prova-tri-dev',
      cwd: '/home/eduardo/prova-tri-dev',
      // `npm start` fixa a porta 3010 no package.json; o DEV chama o
      // binário do Next diretamente para nunca disputar a porta de produção.
      script: 'node_modules/.bin/next',
      args: 'start -p 3011',
      env: {
        NODE_ENV: 'production',
        PORT: 3011,
      },
    },
    // Worker da fila de geração (Subtarefa 1a) — versão DEV. Lê o
    // .env.local do diretório DEV (banco prova_tri_dev), nunca o de
    // produção. Não abre porta nenhuma, então não disputa 3010/3011.
    {
      name: 'prova-tri-dev-worker',
      cwd: '/home/eduardo/prova-tri-dev',
      script: 'npm',
      args: 'run worker',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'prova-tri-dev-scan-worker',
      cwd: '/home/eduardo/prova-tri-dev',
      script: 'npm',
      args: 'run worker:scan-transcription',
      instances: 2,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
