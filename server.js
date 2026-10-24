const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { randomUUID } = require('crypto');
const { URL } = require('url');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });
const worlds = new Map();
const voiceRooms = new Map();
const worldObjects = new Map();
const entityStates = new Map();
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
    leaveVoice(socket);
    leaveWorld(socket);
    const room = String(payload?.room || 'brasil').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'brasil';
    const name = String(payload?.name || 'Visitante').replace(/[<>]/g, '').trim().slice(0, 18) || 'Visitante';
    const isAdmin = name.toLocaleLowerCase('pt-BR') === 'murilo 987';
    const side = sides.has(payload?.side) ? payload.side : 'Lula';
    const color = /^#[0-9a-f]{6}$/i.test(payload?.color) ? payload.color : (side === 'Lula' ? '#c64c42' : '#2e8a58');
    const player = { id: socket.id, name, side, color, admin: isAdmin, x: 0, y: 0, z: 0, yaw: 0, inCar: false, carIndex: -1, signal: 0, fly: false };
    if (!worlds.has(room)) worlds.set(room, new Map());
    const world = worlds.get(room);
    world.set(socket.id, player);
    socket.join(room);
    socket.data.room = room;
    socket.data.player = player;
    socket.data.isAdmin = isAdmin;
    if (!worldObjects.has(room)) worldObjects.set(room, new Map());
    if (!entityStates.has(room)) entityStates.set(room, new Map());
    socket.emit('world:init', { id: socket.id, admin: isAdmin, players: [...world.values()].filter(p => p.id !== socket.id), objects: [...worldObjects.get(room).values()], entityStates: [...entityStates.get(room).values()] });
    socket.to(room).emit('world:join', player);
  });

  socket.on('world:move', pos => {
    const room = socket.data.room;
    if (!room || !Number.isFinite(pos?.x) || !Number.isFinite(pos?.z)) return;
    const world = worlds.get(room);
    const player = world?.get(socket.id);
    if (!player) return;
    const requestedCar = Number.isInteger(pos.carIndex) ? pos.carIndex : -1;
    if (pos.inCar && requestedCar >= 0 && entityStates.get(room)?.get(`car:${requestedCar}`)?.removed) return;
    if (player.inCar && player.carIndex >= 0) {
      const carState = entityStates.get(room)?.get(`car:${player.carIndex}`);
      if (carState?.removed) { player.inCar = false; player.carIndex = -1; }
    }
    player.x = Math.max(-400, Math.min(400, pos.x));
    player.z = Math.max(-400, Math.min(400, pos.z));
    player.y = socket.data.isAdmin && pos.fly ? Math.max(0, Math.min(100, Number(pos.y) || 0)) : 0;
    player.fly = Boolean(socket.data.isAdmin && pos.fly);
    player.yaw = Number.isFinite(pos.yaw) ? pos.yaw : 0;
    player.inCar = Boolean(pos.inCar && requestedCar >= 0);
    player.carIndex = player.inCar ? Math.max(-1, Math.min(20, requestedCar)) : -1;
    player.signal = [-1, 0, 1, 2].includes(pos.signal) ? pos.signal : 0;
    socket.to(room).emit('world:move', player);
  });

  socket.on('admin:place', payload => {
    const room = socket.data.room;
    if (!room || !socket.data.isAdmin) return;
    const kind = ['bench', 'tree', 'lamp'].includes(payload?.kind) ? payload.kind : null;
    if (!kind || !Number.isFinite(payload?.x) || !Number.isFinite(payload?.z)) return;
    const item = { id: randomUUID(), kind, x: Math.max(-320, Math.min(320, payload.x)), z: Math.max(-320, Math.min(320, payload.z)), angle: Number.isFinite(payload.angle) ? payload.angle : 0 };
    worldObjects.get(room).set(item.id, item);
    io.to(room).emit('admin:placed', item);
  });

  socket.on('admin:move-object', payload => {
    const room = socket.data.room;
    if (!room || !socket.data.isAdmin || !Number.isFinite(payload?.x) || !Number.isFinite(payload?.z)) return;
    const item = worldObjects.get(room)?.get(payload.id);
    if (!item) return;
    item.x = Math.max(-320, Math.min(320, payload.x));
    item.z = Math.max(-320, Math.min(320, payload.z));
    io.to(room).emit('admin:moved', item);
  });

  socket.on('admin:remove-object', id => {
    const room = socket.data.room;
    if (!room || !socket.data.isAdmin) return;
    if (worldObjects.get(room)?.delete(id)) io.to(room).emit('admin:removed', id);
  });

  socket.on('admin:move-entity', payload => {
    const room = socket.data.room;
    if (!room || !socket.data.isAdmin || typeof payload?.id !== 'string' || payload.id.length > 100 || !Number.isFinite(payload?.x) || !Number.isFinite(payload?.z)) return;
    if (!entityStates.has(room)) entityStates.set(room, new Map());
    const state = { id: payload.id, x: Math.max(-320, Math.min(320, payload.x)), z: Math.max(-320, Math.min(320, payload.z)), removed: false };
    entityStates.get(room).set(state.id, state);
    io.to(room).emit('admin:entity-moved', state);
  });

  socket.on('admin:delete-entity', id => {
    const room = socket.data.room;
    if (!room || !socket.data.isAdmin || typeof id !== 'string' || id.length > 100) return;
    if (!entityStates.has(room)) entityStates.set(room, new Map());
    const carMatch = /^car:(\d+)$/.exec(id);
    if (carMatch) {
      const index = Number(carMatch[1]);
      worlds.get(room)?.forEach(player => {
        if (player.inCar && player.carIndex === index) { player.inCar = false; player.carIndex = -1; player.y = 0; }
      });
    }
    const state = { id, removed: true };
    entityStates.get(room).set(id, state);
    io.to(room).emit('admin:entity-deleted', id);
  });

  socket.on('admin:music', active => {
    if (!socket.data.room || !socket.data.isAdmin) return;
    socket.to(socket.data.room).emit('admin:music-state', Boolean(active));
  });

  socket.on('chat', raw => {
    const room = socket.data.room;
    const player = socket.data.player;
    if (!room || !player || typeof raw !== 'string') return;
    const text = raw.replace(/[<>]/g, '').trim().slice(0, 160);
    if (!text) return;
    io.to(room).emit('chat', { name: player.name, side: player.side, text });
  });

  socket.on('rtc:join', () => {
    const room = socket.data.room;
    if (!room) return;
    if (!voiceRooms.has(room)) voiceRooms.set(room, new Set());
    const active = voiceRooms.get(room);
    socket.emit('rtc:peers', [...active]);
    active.add(socket.id);
    socket.to(room).emit('rtc:new', socket.id);
  });

  socket.on('rtc:leave', () => leaveVoice(socket));

  socket.on('rtc:signal', ({ to, data } = {}) => {
    if (typeof to !== 'string' || !data || !voiceRooms.get(socket.data.room)?.has(socket.id)) return;
    if (!voiceRooms.get(socket.data.room)?.has(to)) return;
    io.to(to).emit('rtc:signal', { from: socket.id, data });
  });

  socket.on('car:horn', () => {
    if (socket.data.room && socket.data.player) socket.to(socket.data.room).emit('car:horn', socket.id);
  });

  socket.on('disconnect', () => { leaveVoice(socket); leaveWorld(socket); });
});

function leaveVoice(socket) {
  const room = socket.data.room;
  if (!room) return;
  const active = voiceRooms.get(room);
  if (active?.delete(socket.id)) socket.to(room).emit('rtc:leave', socket.id);
  if (active && !active.size) voiceRooms.delete(room);
}

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Cidade das Ideias rodando na porta ${port}`));
