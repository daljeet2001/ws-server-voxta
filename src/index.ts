import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PORT = Number(process.env.WS_PORT);

interface ExtWebSocket extends WebSocket {
  room?: string;
  username?: string;
}

// ✅ Create HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket server is running\n");
});


const wss = new WebSocketServer({ server });

console.log(`WS server running on ws://localhost:${PORT}`);

const rooms: Map<string, Set<ExtWebSocket>> = new Map();

function broadcastToRoom(room: string, payload: any) {
  const clients = rooms.get(room);
  if (!clients) return;
  const data = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function broadcastRoomCount(room: string) {
  const clients = rooms.get(room);
  const count = clients ? clients.size : 0;
  broadcastToRoom(room, { type: "room_count", count });
}

wss.on("connection", (ws: ExtWebSocket) => {
  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return ws.send(JSON.stringify({ type: "error", error: "invalid_json" }));
    }

    if (msg.type === "join_room") {
      const { room, username } = msg;
      if (!room) return;
      ws.room = room;
      ws.username = username || `anon_${Math.random().toString(36).slice(2, 8)}`;

      if (!rooms.has(room)) rooms.set(room, new Set());
      rooms.get(room)!.add(ws);

      broadcastToRoom(room, { type: "system", text: `${ws.username} joined` });
      broadcastRoomCount(room);
      return;
    }

    if (msg.type === "leave_room") {
      if (ws.room && rooms.has(ws.room)) {
        rooms.get(ws.room)!.delete(ws);
        broadcastToRoom(ws.room, { type: "system", text: `${ws.username} left` });
        broadcastRoomCount(ws.room);
      }
      return;
    }

    if (msg.type === "message") {
      if (!ws.room || !msg.content) return;

      const dbRoom = await prisma.room.findUnique({ where: { slug: ws.room } });
      if (!dbRoom) return;

      const dbMessage = await prisma.message.create({
        data: {
          roomId: dbRoom.id,
          username: ws.username,
          content: msg.content,
        },
      });

      const payload = {
        type: "message",
        id: dbMessage.id,
        room: ws.room,
        content: dbMessage.content,
        user: { username: dbMessage.username },
        createdAt: dbMessage.createdAt,
      };

      broadcastToRoom(ws.room, payload);
    }
  });

  ws.on("close", () => {
    if (ws.room && rooms.has(ws.room)) {
      rooms.get(ws.room)!.delete(ws);
      broadcastToRoom(ws.room, {
        type: "system",
        text: `${ws.username} disconnected`,
      });
      broadcastRoomCount(ws.room);
    }
  });
});


server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
