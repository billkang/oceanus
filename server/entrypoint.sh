#!/bin/sh
set -e
echo "Running Prisma migrations..."
npx prisma migrate deploy
echo "Starting Oceanus server..."
exec node dist/main.js
