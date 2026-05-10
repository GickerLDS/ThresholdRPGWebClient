# ThresholdRPGWebClient

ThresholdRPGWebClient is a browser-based MUD client for ThresholdRPG-compatible servers. It combines a React UI with a Node.js proxy that bridges browser WebSockets to a Telnet MUD connection and streams GMCP state updates to the client.

## Feature Set

- Browser terminal output with ANSI color rendering
- Connect/disconnect controls with host/port input and MUD preset selection
- GMCP-backed character state and vitals updates
- HUD bars for HP, SP, EP, XP, and target status
- Minimap panel rendering from live game output
- Sidebar panels for Character, Quests, Group, and Affects
- In-client automation tools:
  - Aliases
  - Triggers
  - Character variable mappings
- Keyboard quality-of-life features:
  - Numpad movement bindings
  - Command history with Arrow Up/Down
  - Tab completion from command history
- Local persistence for aliases, triggers, and UI settings (cookie-backed)
- Import/export for full client configuration JSON
- Runtime settings endpoint (`/api/settings`) served by the proxy

## Tech Stack

- Frontend: React + TypeScript + Vite
- Server: Node.js + Express + ws
- Shared types/config: TypeScript modules in `shared/`

## Setup

### 1) Install dependencies

```bash
npm install
```

### 2) Run in development

```bash
npm run dev
```

This starts both processes concurrently:

- `dev:client` -> Vite dev server
- `dev:server` -> Node proxy server (`tsx watch`)

Default ports are configured in `shared/app-settings.ts`.

## Production

### Build

```bash
npm run build
```

### Start

```bash
npm run start
```

`start` runs the compiled server from `dist/server/index.js`, which serves both the built frontend and the WebSocket proxy.

## Environment Variables

- `PORT`: Override the server HTTP/WebSocket port (defaults to `appSettings.ports.server`)
- `VITE_WS_URL`: Override the client WebSocket URL target

## Useful Scripts

- `npm run dev` - Run client and server in development
- `npm run build` - Type-check and build production artifacts
- `npm run preview` - Preview the built frontend
- `npm run lint` - Run ESLint
- `npm run start` - Start the built production server

## Configuration

Main runtime configuration lives in `shared/app-settings.ts`:

- Ports (`client`, `server`, `preview`)
- Default host/port
- MUD preset list
- UI personalization text/title

The frontend fetches these values at runtime from `/api/settings`.
