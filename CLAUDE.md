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

## Seguridad
- Todo es local: el backend escucha solo en `127.0.0.1` y no tiene login. No exponerlo a la red.
- WhatsApp es la única vía externa: sale de la PC como dispositivo vinculado (`@whiskeysockets/baileys`, versión exacta) y no abre puertos.
- Violet solo atiende el chat "Mensajes a mí mismo". El resto de tus chats llega descifrado a la librería, y el código lo descarta sin usarlo ni guardarlo.
- La sesión vive en `~/command-center-data/whatsapp/`, nunca en este repo público.
- Vincular, con el backend apagado: `cd backend && npm run whatsapp:link`, y escanear el QR con tu WhatsApp.
- Por WhatsApp, lanzar o detener agentes pide `CONFIRMAR <código>`; el modelo nunca conoce ese código.

## Arquitectura
- Backend lee `~/.claude/projects/` para sesiones JSONL
- chokidar vigila cambios en archivos JSONL en tiempo real
- Socket.IO transmite logs al frontend via WebSocket
- Agentes se lanzan con `claude --print --output-format stream-json`
