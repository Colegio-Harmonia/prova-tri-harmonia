#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ "$(git branch --show-current)" != main ]]; then
  echo 'Publicação recusada: use a branch main com o PR já incorporado.' >&2
  exit 1
fi
if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
  echo 'Publicação recusada: há alterações ou arquivos sem registro no Git.' >&2
  exit 1
fi
git fetch origin main
source_commit=$(git rev-parse HEAD)
if [[ "$source_commit" != "$(git rev-parse origin/main)" ]]; then
  echo 'Publicação recusada: o código local não corresponde ao main do GitHub.' >&2
  exit 1
fi
if [[ ! -f .env.local ]]; then
  echo 'Publicação recusada: configuração .env.local ausente neste servidor.' >&2
  exit 1
fi

export PROVA_TRI_IMAGE="prova-tri:$source_commit"
compose=(docker compose --env-file .env.local)
"${compose[@]}" build --build-arg "SOURCE_COMMIT=$source_commit" web
# Banco e serviços auxiliares não são recriados. Sem migração automática.
"${compose[@]}" up -d --no-build --no-deps --wait --wait-timeout 180 web worker scan-worker ocr-worker
"${compose[@]}" ps
echo "Publicação concluída a partir do commit $source_commit. Confira os fluxos autenticados."
