import type { ServerWebSocket } from "bun";
import index from "./index.html";
import {
  MODELS,
  LOG_FILE,
  log,
  runGame,
  type GameState,
} from "./game.ts";

// ── Game state ──────────────────────────────────────────────────────────────

const runsArg = process.argv.find((a) => a.startsWith("runs="));
const runs = runsArg ? parseInt(runsArg.split("=")[1] ?? "5", 10) : 5;

if (!process.env.OPENROUTER_API_KEY) {
  console.error("Error: Set OPENROUTER_API_KEY environment variable");
  process.exit(1);
}

const gameState: GameState = {
  completed: [],
  active: null,
  scores: Object.fromEntries(MODELS.map((m) => [m.name, 0])),
  done: false,
};

// ── WebSocket clients ───────────────────────────────────────────────────────

const clients = new Set<ServerWebSocket<unknown>>();

function broadcast() {
  const msg = JSON.stringify({ type: "state", data: gameState, totalRounds: runs });
  for (const ws of clients) {
    ws.send(msg);
  }
}

// ── Server ──────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? "3000", 10);

const server = Bun.serve({
  port,
  routes: {
    "/": index,
  },
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
    }
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      ws.send(JSON.stringify({ type: "state", data: gameState, totalRounds: runs }));
    },
    message(_ws, _message) {
      // Spectator-only, no client messages handled
    },
    close(ws) {
      clients.delete(ws);
    },
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`\n🎮 Quipslop Web — http://localhost:${server.port}`);
console.log(`📡 WebSocket — ws://localhost:${server.port}/ws`);
console.log(`🎯 ${runs} rounds with ${MODELS.length} models\n`);

log("INFO", "server", `Web server started on port ${server.port}`, {
  runs,
  models: MODELS.map((m) => m.id),
});

// ── Start game ──────────────────────────────────────────────────────────────

runGame(runs, gameState, broadcast).then(() => {
  console.log(`\n✅ Game complete! Log: ${LOG_FILE}`);
});
