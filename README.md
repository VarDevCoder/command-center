# Command Center (Captain's Bridge)

Dashboard web local para monitorear y controlar agentes Claude Code.

## Features
- Monitoreo de sesiones Claude Code en tiempo real
- Visualización de logs JSONL
- Lanzamiento de agentes headless
- UI estilo "Captain's Bridge" con tema oscuro

## Stack
- **Backend:** Express + Socket.IO + chokidar (puerto 3066)
- **Frontend:** React 19 + Vite + Tailwind v4 (puerto 5166)
- Sin base de datos, sin auth (app local)

## Setup
```bash
# Backend
cd backend && npm install && npm run dev

# Frontend
cd frontend && npm install && npm run dev
```

## Arquitectura
- Backend lee `~/.claude/projects/` para sesiones JSONL
- chokidar vigila cambios en archivos en tiempo real
- Socket.IO transmite logs al frontend via WebSocket
- Agentes se lanzan con `claude --print --output-format stream-json`
