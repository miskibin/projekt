// Cienka warstwa Node: Express (statyki w produkcji) + `ws`.
// Cała logika pokoi/gry siedzi w `shared/host` (działa też w przeglądarce).
// Tutaj tylko mapujemy WebSocket -> Peer i wołamy RoomHost.
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { ServerMessage } from "../shared/protocol";
import { HOST_TICK_MS, MAX_MESSAGE_BYTES, createRoomHost, handleRawMessage, randomId } from "../shared/host";
import type { Peer, RoomHost } from "../shared/host";

const PORT = Number(process.env.PORT ?? 3000);
const IS_PROD = process.env.NODE_ENV === "production";
const HEARTBEAT_MS = 15_000;
/** Twardy limit ramki; warstwa `shared/host` i tak odrzuca >64KB z komunikatem `error`. */
const MAX_PAYLOAD = MAX_MESSAGE_BYTES * 2;
const WS_OPEN = 1;

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const clientDist = path.join(projectRoot, "dist", "client");

/** Adresy IPv4 wszystkich zewnętrznych interfejsów – żeby podać koledze link. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) out.push(addr.address);
    }
  }
  return out;
}

/** Wysyła wiadomość, ignorując zamknięte/zamykające się gniazda. */
export function send(ws: Pick<WebSocket, "readyState" | "send">, msg: ServerMessage): void {
  if (ws.readyState !== WS_OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* gniazdo padło w trakcie – ignorujemy */
  }
}

/** WebSocket -> Peer z `shared/host`. */
export function wsPeer(ws: WebSocket, id = randomId()): Peer {
  return { id, send: (msg) => send(ws, msg) };
}

export function createApp(host: RoomHost): express.Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ ok: true, rooms: host.roomCodes().length, uptime: process.uptime() });
  });

  if (IS_PROD) {
    app.use(express.static(clientDist, { index: "index.html", maxAge: "1h" }));
    // SPA fallback – wszystko poza /ws i /health leci na index.html
    app.get(/^\/(?!ws$|health$).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"), (err) => {
        if (err) res.status(404).send("Brak zbudowanego klienta – uruchom `npm run build`.");
      });
    });
  } else {
    app.get("/", (_req, res) => {
      res.type("text/plain").send("Tryb dev: serwer WS działa na /ws. Klient: http://localhost:5173");
    });
  }

  return app;
}

export function startServer(port = PORT) {
  const host = createRoomHost({ log: (...args) => console.log(...args) });
  const app = createApp(host);
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: MAX_PAYLOAD });

  wss.on("connection", (ws: WebSocket, req) => {
    const peer = wsPeer(ws);
    const ip = req.socket.remoteAddress ?? "?";
    console.log(`[ws] połączenie od ${ip} -> ${peer.id} (aktywnych: ${wss.clients.size})`);
    host.handleConnect(peer, Date.now());

    const sock = ws as WebSocket & { isAlive?: boolean };
    sock.isAlive = true;
    ws.on("pong", () => {
      sock.isAlive = true;
    });

    ws.on("message", (data: Buffer | Buffer[] | ArrayBuffer, isBinary: boolean) => {
      if (isBinary) {
        peer.send({ t: "error", message: "Oczekiwano tekstowego JSON-a." });
        return;
      }
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
      if (buf.byteLength > MAX_MESSAGE_BYTES) {
        peer.send({ t: "error", message: "Wiadomość za duża." });
        return;
      }
      handleRawMessage(host, peer, buf.toString("utf8"), Date.now());
    });

    const bye = () => {
      host.handleDisconnect(peer, Date.now());
    };
    ws.on("close", () => {
      // `wss.clients` bywa już (albo jeszcze nie) posprzątane – liczymy bez tego gniazda.
      let active = 0;
      for (const c of wss.clients) if (c !== ws) active++;
      console.log(`[ws] rozłączenie ${peer.id} (aktywnych: ${active})`);
      bye();
    });
    ws.on("error", bye);
  });

  // Jeden zegar napędza wszystkie pokoje (60 Hz) – RoomHost sam pilnuje fixed stepu.
  const clock = setInterval(() => host.tick(Date.now()), HOST_TICK_MS);

  // Heartbeat: kto nie odpowie na ping w oknie 15 s, leci.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as WebSocket & { isAlive?: boolean };
      if (ws.isAlive === false) {
        console.log("[ws] martwe połączenie – zamykam");
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  wss.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(clock);
  });

  server.listen(port, () => {
    console.log(`\n  Worms Online – serwer wystartował (${IS_PROD ? "produkcja" : "dev"})`);
    console.log(`  Lokalnie:      http://localhost:${port}`);
    if (!IS_PROD) console.log(`  Klient (Vite): http://localhost:5173`);
    for (const ip of lanAddresses()) {
      console.log(`  Graj z kolegami: http://${ip}:${IS_PROD ? port : 5173}`);
    }
    console.log(`  WebSocket:     ws://localhost:${port}/ws\n`);
  });

  const shutdown = () => {
    console.log("\n[serwer] zamykanie...");
    clearInterval(heartbeat);
    clearInterval(clock);
    host.destroy();
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { app, server, wss, host };
}

// Uruchamiamy tylko gdy plik jest wejściem procesu (nie przy imporcie w testach).
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) startServer();
