const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { URL } = require('url');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });
const worlds = new Map();
const voiceRooms = new Map();
const sides = new Set(['Lula', 'Bolsonaro']);

app.use(express.static(path.join(__dirname)));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/youtube-search', async (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 100);
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!query) return res.status(400).json({ error: 'Digite o nome da música.' });
  if (!apiKey) return res.status(503).json({ error: 'missing_key' });
  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.search = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '6', q: query, key: apiKey });
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: 'A busca do YouTube não respondeu. Confira a chave da API no Render.' });
    res.json((data.items || []).filter(item => item.id?.videoId).map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.default?.url || ''
    })));
  } catch (error) {
    console.error('Falha na busca do YouTube:', error.message);
    res.status(502).json({ error: 'Não consegui buscar no YouTube agora.' });
  }
});

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
    const side = sides.has(payload?.side) ? payload.side : 'Lula';
    const color = /^#[0-9a-f]{6}$/i.test(payload?.color) ? payload.color : (side === 'Lula' ? '#c64c42' : '#2e8a58');
    const player = { id: socket.id, name, side, color, x: 0, z: 0, yaw: 0, inCar: false, carIndex: -1 };
    if (!worlds.has(room)) worlds.set(room, new Map());
    const world = worlds.get(room);
    world.set(socket.id, player);
    socket.join(room);
    socket.data.room = room;
    socket.data.player = player;
    socket.emit('world:init', { id: socket.id, players: [...world.values()].filter(p => p.id !== socket.id) });
    socket.to(room).emit('world:join', player);
  });

  socket.on('world:move', pos => {
    const room = socket.data.room;
    if (!room || !Number.isFinite(pos?.x) || !Number.isFinite(pos?.z)) return;
    const world = worlds.get(room);
    const player = world?.get(socket.id);
    if (!player) return;
    player.x = Math.max(0, Math.min(4000, pos.x));
    player.z = Math.max(-4000, Math.min(4000, pos.z));
    player.yaw = Number.isFinite(pos.yaw) ? pos.yaw : 0;
    player.inCar = Boolean(pos.inCar);
    player.carIndex = Number.isInteger(pos.carIndex) ? Math.max(-1, Math.min(20, pos.carIndex)) : -1;
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
