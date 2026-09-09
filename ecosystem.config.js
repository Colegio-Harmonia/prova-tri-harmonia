module.exports = {
  apps: [
    {
      name: 'prova-tri',
      cwd: '/home/eduardo/prova-tri',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: 3010,
      },
    },
    // Worker da fila de geração (Subtarefa 1a, 24/07/2026) — consome
    // generation_jobs. Lê .env.local por conta própria na subida; mesmo
    // assim vale a regra do projeto: mudou .env.local em produção,
    // `pm2 delete` + `pm2 start ecosystem.config.js` + `pm2 save`.
    {
      name: 'prova-tri-worker',
      cwd: '/home/eduardo/prova-tri',
      script: 'npm',
      args: 'run worker',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'prova-tri-scan-worker',
      cwd: '/home/eduardo/prova-tri',
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
