# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

remoteCli is a remote PowerShell terminal system that allows accessing Windows PowerShell from a mobile browser. It uses a reverse tunnel architecture where the Windows Agent initiates the connection to the cloud server, eliminating the need for public IP or port forwarding.

**Architecture:**
```
Mobile Browser <--WebSocket--> Linux Cloud Server <--WebSocket--> Windows Agent
```

## Build and Development Commands

```bash
# Install dependencies (monorepo)
pnpm install

# If node-pty compilation fails on Windows
pnpm approve-builds
# Then select node-pty

# Development (run all packages)
pnpm dev

# Build all packages
pnpm build

# Run server tests
cd packages/server && pnpm test

# Run server tests in watch mode
cd packages/server && pnpm test:watch

# Type check web package
cd packages/web && pnpm typecheck
```

## Package Structure

This is a pnpm monorepo with four packages:

| Package | Purpose | Tech Stack |
|---------|---------|------------|
| `packages/shared` | Shared TypeScript types | TypeScript |
| `packages/server` | Cloud server (Linux) | Fastify, ws, sql.js, bcryptjs |
| `packages/agent` | Windows agent | node-pty, ws |
| `packages/web` | Mobile frontend | Vue 3, xterm.js, Pinia, PWA |

## Environment Setup

Each package has its own `.env.example`:

**packages/server/.env:**
- `PORT` - Server port (default: 3000)
- `JWT_SECRET` - JWT signing secret
- `DATABASE_PATH` - SQLite database path

**packages/agent/.env:**
- `SERVER_URL` - WebSocket URL of server (e.g., `ws://localhost:3000/ws/agent`)
- `AGENT_ID` - Unique agent identifier
- `USER_ID` - User ID this agent belongs to

## Key Architecture Patterns

### WebSocket Message Protocol

All messages follow this structure (defined in `packages/shared/src/types.ts`):
```typescript
interface Message {
  type: MessageType;
  payload: unknown;
  sessionId?: string;
  timestamp: number;
}
```

Key message types:
- `register`/`register:result` - Agent registration
- `auth`/`auth:result` - Browser authentication
- `session:create`/`session:start` - Terminal session creation
- `session:input`/`session:output` - Terminal I/O
- `session:resize`/`session:close` - Session control
- `ping`/`pong` - Heartbeat

### Session Persistence

The system supports session persistence when browsers disconnect:
1. When browser disconnects, server sends `session:pause` to agent (not `session:close`)
2. Agent buffers PTY output and keeps session alive for 30 minutes
3. When browser reconnects, it can resume via `session:resume`
4. Buffered output is sent to the reconnected browser

This is implemented in:
- `packages/server/src/ws/tunnel.ts` - TunnelManager handles connection state
- `packages/agent/src/pty.ts` - PtyManager handles pause/resume with buffering

### Connection Flow

1. **Agent startup:** Connects to server, sends `register` message
2. **Browser connects:** Authenticates via JWT, waits for user to select agent
3. **Session creation:** Browser sends `session:create`, server routes to agent, agent spawns PTY
4. **Data flow:** Terminal I/O flows through server (browser <-> server <-> agent)

### Database

The server uses sql.js (SQLite compiled to WebAssembly):
- Database schema and queries in `packages/server/src/db/index.ts`
- Agent metadata stored in SQLite (last seen, name, user binding)
- Users and refresh tokens stored in SQLite

## Development Workflow

1. Start server first: `cd packages/server && pnpm dev`
2. Start agent: `cd packages/agent && pnpm dev`
3. Start web: `cd packages/web && pnpm dev`
4. Access frontend at `http://localhost:5173`

## Notes

- The `tsx` tool is used for TypeScript execution in development
- Tests use Vitest with a setup file at `packages/server/src/__tests__/setup.ts`
- Web package uses PWA for mobile installation support
- The agent uses `node-pty` to spawn PowerShell processes (requires native compilation on Windows)