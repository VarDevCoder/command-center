# 06 — Command Center (Captain's Bridge)

## Qué es
Dashboard web local para monitorear y controlar agentes Claude Code. Lee archivos JSONL de sesión, detecta procesos activos, y permite lanzar agentes en modo headless.

## Stack
- Backend: Express + Socket.IO + chokidar (puerto 3066)
- Frontend: React 19 + Vite + Tailwind v4 (puerto 5166)
- Sin base de datos, sin auth (app local)

## Comandos
```bash
cd backend && npm run dev   # Inicia backend en :3066
cd frontend && npm run dev  # Inicia frontend en :5166
```

## Arquitectura
- Backend lee `~/.claude/projects/` para sesiones JSONL
- chokidar vigila cambios en archivos JSONL en tiempo real
- Socket.IO transmite logs al frontend via WebSocket
- Agentes se lanzan con `claude --print --output-format stream-json`
