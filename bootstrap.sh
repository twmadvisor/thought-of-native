#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
npm install
cp -n .env.example .env || true
npx expo start
