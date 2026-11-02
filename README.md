# Command Center (Captain's Bridge)

Dashboard web local para monitorear y controlar agentes Claude Code, Codex y sesiones de VS Code.

## Features
- Monitoreo de sesiones Claude Code en tiempo real
- Visualización de logs JSONL
- Lanzamiento de agentes headless
- Inventario de sesiones reales de la ventana Agents de VS Code
- Apertura de proyectos y cancelación de turnos activos mediante la CLI oficial de VS Code
- Métricas de tokens de Claude Code y ChatGPT/Codex con costo API equivalente estimado
- Herramientas de Violet para consultar sesiones, consumo y operar VS Code Agents
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
- Las sesiones de VS Code se leen en modo read-only desde `agentSessionData/session.db`
- La actividad y cancelación usan `code agent ps` y `code agent stop`
- Los costos son estimaciones equivalentes basadas en tokens; no representan cargos reales de las suscripciones
- La revisión automática usa Codex `gpt-6.1-sol` con razonamiento `max` y sandbox read-only; puede configurarse con `CODEX_REVIEW_MODEL` y `CODEX_REVIEW_EFFORT`

Probado por el pipeline supervisado el 2026-11-01, intento 2.
