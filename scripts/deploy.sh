#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${repository_root}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${repository_root}/.env"
  set +a
fi

project_id="${VITE_FIREBASE_PROJECT_ID:-praxisagendamentos}"

required_variables=(
  VITE_FIREBASE_API_KEY
  VITE_FIREBASE_AUTH_DOMAIN
  VITE_FIREBASE_PROJECT_ID
)

for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Defina ${variable_name} no arquivo .env antes de publicar." >&2
    exit 1
  fi
done

if [[ -n "${VITE_FIREBASE_AUTH_EMULATOR_URL:-}" || -n "${VITE_FIREBASE_FIRESTORE_EMULATOR_URL:-}" ]]; then
  echo "Remova as URLs dos emuladores antes de publicar em produção." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm não encontrado." >&2
  exit 1
fi

if ! command -v firebase >/dev/null 2>&1; then
  echo "Firebase CLI não encontrado. Execute: npm install -g firebase-tools" >&2
  exit 1
fi

cd "${repository_root}"

npm ci
npm run check
firebase deploy --only firestore:rules,firestore:indexes,functions,hosting --project "${project_id}" --config firebase.production.json

echo "Deploy concluído: https://${project_id}.web.app"
