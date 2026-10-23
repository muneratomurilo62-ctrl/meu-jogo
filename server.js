const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });
const rooms = new Map();
const challenges = [
  'Uma cidade tem pouco dinheiro. Qual melhoria deveria receber prioridade?',
  'Como podemos ajudar jovens a encontrar o primeiro emprego?',
  'O que tornaria o transporte da sua cidade melhor para todos?',
  'Como equilibrar crescimento econômico e cuidado com a natureza?',
  'Que mudança faria a escola pública funcionar melhor?'
];
app.use(express.static(path.join(__dirname)));
app.get('/health', (_req, res) => res.json({ ok: true }));

io.on('connection', socket => {
  socket.on('join', payload => {
    const room = String(payload?.room || 'praca').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'praca';
    const name = String(payload?.name || 'Visitante').replace(/[<>]/g, '').trim().slice(0, 18) || 'Visitante';
    const outfit = String(payload?.outfit || 'camisa verde').slice(0, 24);
    const idea = String(payload?.idea || 'Uma ideia para melhorar a cidade').slice(0, 90);
    if (socket.data.room) socket.leave(socket.data.room);
    socket.join(room);
    socket.data.room = room;
    socket.data.name = name;
    socket.data.outfit = outfit;
    socket.data.idea = idea;
    if (!rooms.has(room)) rooms.set(room, []);
    const history = rooms.get(room);
    socket.emit('joined', { id: socket.id, count: io.sockets.adapter.rooms.get(room)?.size || 1, history: history.slice(-30) });
    socket.to(room).emit('notice', `${name} entrou na sala.`);
    io.to(room).emit('count', io.sockets.adapter.rooms.get(room)?.size || 1);
    socket.emit('challenge', challenges[Math.floor(Math.random() * challenges.length)]);
  });

  socket.on('message', raw => {
    const room = socket.data.room;
    if (!room || typeof raw !== 'string') return;
    const text = raw.replace(/[<>]/g, '').trim().slice(0, 240);
    if (!text) return;
    const item = { id: socket.id, name: socket.data.name || 'Visitante', outfit: socket.data.outfit || 'camisa verde', idea: socket.data.idea || '', text, time: Date.now() };
    const history = rooms.get(room) || [];
    history.push(item);
    if (history.length > 60) history.splice(0, history.length - 60);
    rooms.set(room, history);
    io.to(room).emit('message', item);
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (!room) return;
    setTimeout(() => {
      const count = io.sockets.adapter.rooms.get(room)?.size || 0;
      io.to(room).emit('count', count);
      io.to(room).emit('notice', `${socket.data.name || 'Uma pessoa'} saiu da sala.`);
      if (!count) rooms.delete(room);
    }, 50);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Praça de Ideias rodando na porta ${port}`));
