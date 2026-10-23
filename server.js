const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });
const worlds = new Map();
const sides = new Set(['Lula', 'Bolsonaro']);

app.use(express.static(path.join(__dirname)));
app.get('/health', (_req, res) => res.json({ ok: true }));

function leaveWorld(socket) {
  const room = socket.data.room;
  if (!room) return;
  const world = worlds.get(room);
  if (world) {
    world.delete(socket.id);
    socket.to(room).emit('world:leave', socket.id);
    if (!world.size) worlds.delete(room);
  }
  socket.leave(room);
  socket.data.room = null;
}

io.on('connection', socket => {
  socket.on('join', payload => {
    leaveWorld(socket);
    const room = String(payload?.room || 'brasil').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'brasil';
    const name = String(payload?.name || 'Visitante').replace(/[<>]/g, '').trim().slice(0, 18) || 'Visitante';
    const side = sides.has(payload?.side) ? payload.side : 'Lula';
    const color = /^#[0-9a-f]{6}$/i.test(payload?.color) ? payload.color : (side === 'Lula' ? '#c64c42' : '#2e8a58');
    const player = { id: socket.id, name, side, color, x: 0, y: 0 };
    if (!worlds.has(room)) worlds.set(room, new Map());
    const world = worlds.get(room);
    world.set(socket.id, player);
    socket.join(room);
    socket.data.room = room;
    socket.data.player = player;
    socket.emit('world:init', { players: [...world.values()].filter(p => p.id !== socket.id) });
    socket.to(room).emit('world:join', player);
  });

  socket.on('world:move', pos => {
    const room = socket.data.room;
    if (!room || !Number.isFinite(pos?.x) || !Number.isFinite(pos?.y)) return;
    const world = worlds.get(room);
    const player = world?.get(socket.id);
    if (!player) return;
    player.x = Math.max(0, Math.min(4000, pos.x));
    player.y = Math.max(0, Math.min(2400, pos.y));
    socket.to(room).emit('world:move', player);
  });

  socket.on('chat', raw => {
    const room = socket.data.room;
    const player = socket.data.player;
    if (!room || !player || typeof raw !== 'string') return;
    const text = raw.replace(/[<>]/g, '').trim().slice(0, 160);
    if (!text) return;
    io.to(room).emit('chat', { name: player.name, side: player.side, text });
  });

  socket.on('disconnect', () => leaveWorld(socket));
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Cidade das Ideias rodando na porta ${port}`));
