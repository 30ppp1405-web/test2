const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const JWT_SECRET = 'livechat-secret-key-2024';
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// File uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const store = {
  agents: [
    { id: uuidv4(), name: 'Alice', email: 'alice@demo.com', password: bcrypt.hashSync('demo123', 10), avatar: 'A', color: '#6366f1', online: false },
    { id: uuidv4(), name: 'Bob', email: 'bob@demo.com', password: bcrypt.hashSync('demo123', 10), avatar: 'B', color: '#10b981', online: false }
  ],
  conversations: new Map(),
  visitors: new Map(),
  agentSockets: new Map(),
  visitorSockets: new Map(),
};

function createConversation(visitorId, visitorInfo) {
  const id = uuidv4();
  const conv = { id, visitorId, visitorInfo, messages: [], status: 'open', assignedTo: null, unreadByAgent: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  store.conversations.set(id, conv);
  return conv;
}

function broadcastToAgents(event, data) {
  store.agentSockets.forEach((socketId) => io.to(socketId).emit(event, data));
}

function getPublicConversations() {
  return Array.from(store.conversations.values())
    .map(c => ({ ...c, messages: c.messages.slice(-1) }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

app.post('/api/agent/login', (req, res) => {
  const { email, password } = req.body;
  const agent = store.agents.find(a => a.email === email);
  if (!agent || !bcrypt.compareSync(password, agent.password))
    return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: agent.id, name: agent.name, avatar: agent.avatar, color: agent.color }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, agent: { id: agent.id, name: agent.name, email: agent.email, avatar: agent.avatar, color: agent.color } });
});

app.get('/api/conversations', (req, res) => {
  const auth = req.headers.authorization?.split(' ')[1];
  if (!verifyToken(auth)) return res.status(401).json({ error: 'Unauthorized' });
  res.json(getPublicConversations());
});

app.get('/api/conversations/:id', (req, res) => {
  const auth = req.headers.authorization?.split(' ')[1];
  if (!verifyToken(auth)) return res.status(401).json({ error: 'Unauthorized' });
  const conv = store.conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  conv.unreadByAgent = 0;
  res.json(conv);
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname });
});

app.get('/api/agents/online', (req, res) => {
  const onlineAgents = store.agents.filter(a => a.online).map(a => ({ id: a.id, name: a.name, avatar: a.avatar, color: a.color }));
  res.json({ online: onlineAgents.length > 0, agents: onlineAgents });
});

io.on('connection', (socket) => {
  socket.on('agent:join', ({ token }) => {
    const payload = verifyToken(token);
    if (!payload) return socket.emit('error', 'Unauthorized');
    const agent = store.agents.find(a => a.id === payload.id);
    if (!agent) return;
    agent.online = true;
    store.agentSockets.set(agent.id, socket.id);
    socket.agentId = agent.id;
    socket.join('agents');
    socket.emit('agent:joined', { agent: { id: agent.id, name: agent.name, avatar: agent.avatar, color: agent.color } });
    socket.emit('conversations:list', getPublicConversations());
    broadcastToAgents('agent:online', { agentId: agent.id, name: agent.name });
  });

  socket.on('agent:send', ({ conversationId, text, fileUrl, fileName }) => {
    if (!socket.agentId) return;
    const conv = store.conversations.get(conversationId);
    if (!conv) return;
    const agent = store.agents.find(a => a.id === socket.agentId);
    const msg = { id: uuidv4(), conversationId, from: 'agent', agentId: socket.agentId, agentName: agent?.name || 'Agent', agentAvatar: agent?.avatar || 'A', agentColor: agent?.color || '#6366f1', text: text || '', fileUrl: fileUrl || null, fileName: fileName || null, timestamp: new Date().toISOString(), seen: false };
    conv.messages.push(msg);
    conv.updatedAt = msg.timestamp;
    conv.assignedTo = conv.assignedTo || socket.agentId;
    broadcastToAgents('message:new', { conversationId, message: msg });
    const visitorSocketId = store.visitorSockets.get(conv.visitorId);
    if (visitorSocketId) io.to(visitorSocketId).emit('message:new', msg);
  });

  socket.on('agent:typing', ({ conversationId, typing }) => {
    if (!socket.agentId) return;
    const conv = store.conversations.get(conversationId);
    if (!conv) return;
    const visitorSocketId = store.visitorSockets.get(conv.visitorId);
    if (visitorSocketId) io.to(visitorSocketId).emit('agent:typing', { typing });
  });

  socket.on('conversation:resolve', ({ conversationId }) => {
    if (!socket.agentId) return;
    const conv = store.conversations.get(conversationId);
    if (!conv) return;
    conv.status = 'resolved';
    conv.updatedAt = new Date().toISOString();
    broadcastToAgents('conversation:updated', conv);
    const visitorSocketId = store.visitorSockets.get(conv.visitorId);
    if (visitorSocketId) io.to(visitorSocketId).emit('conversation:resolved');
  });

  socket.on('conversation:reopen', ({ conversationId }) => {
    if (!socket.agentId) return;
    const conv = store.conversations.get(conversationId);
    if (!conv) return;
    conv.status = 'open';
    conv.updatedAt = new Date().toISOString();
    broadcastToAgents('conversation:updated', conv);
  });

  socket.on('messages:seen', ({ conversationId }) => {
    if (!socket.agentId) return;
    const conv = store.conversations.get(conversationId);
    if (!conv) return;
    conv.unreadByAgent = 0;
    broadcastToAgents('conversations:list', getPublicConversations());
  });

  socket.on('visitor:init', ({ visitorId, name, email, page }) => {
    let visitorId_ = visitorId || uuidv4();
    let visitor = store.visitors.get(visitorId_);
    if (!visitor) {
      visitor = { id: visitorId_, name: name || 'Visitor', email: email || '', page: page || '/', joinedAt: new Date().toISOString(), conversationId: null };
      store.visitors.set(visitorId_, visitor);
    } else {
      visitor.name = name || visitor.name;
      visitor.email = email || visitor.email;
      visitor.page = page || visitor.page;
    }
    store.visitorSockets.set(visitorId_, socket.id);
    socket.visitorId = visitorId_;
    if (!visitor.conversationId) {
      const conv = createConversation(visitorId_, { name: visitor.name, email: visitor.email, page: visitor.page, joinedAt: visitor.joinedAt });
      visitor.conversationId = conv.id;
      broadcastToAgents('conversation:new', conv);
    }
    const conv = store.conversations.get(visitor.conversationId);
    socket.emit('visitor:ready', { visitorId: visitorId_, conversationId: visitor.conversationId, messages: conv?.messages || [], agentsOnline: store.agentSockets.size > 0 });
  });

  socket.on('visitor:send', ({ text, fileUrl, fileName }) => {
    if (!socket.visitorId) return;
    const visitor = store.visitors.get(socket.visitorId);
    if (!visitor?.conversationId) return;
    const conv = store.conversations.get(visitor.conversationId);
    if (!conv) return;
    const msg = { id: uuidv4(), conversationId: conv.id, from: 'visitor', visitorName: visitor.name, text: text || '', fileUrl: fileUrl || null, fileName: fileName || null, timestamp: new Date().toISOString(), seen: false };
    conv.messages.push(msg);
    conv.updatedAt = msg.timestamp;
    conv.unreadByAgent += 1;
    broadcastToAgents('message:new', { conversationId: conv.id, message: msg });
    broadcastToAgents('conversations:list', getPublicConversations());
    socket.emit('message:sent', msg);
  });

  socket.on('visitor:typing', ({ typing }) => {
    if (!socket.visitorId) return;
    const visitor = store.visitors.get(socket.visitorId);
    if (!visitor?.conversationId) return;
    broadcastToAgents('visitor:typing', { conversationId: visitor.conversationId, typing, visitorName: visitor.name });
  });

  socket.on('disconnect', () => {
    if (socket.agentId) {
      const agent = store.agents.find(a => a.id === socket.agentId);
      if (agent) agent.online = false;
      store.agentSockets.delete(socket.agentId);
      broadcastToAgents('agent:offline', { agentId: socket.agentId });
    }
    if (socket.visitorId) store.visitorSockets.delete(socket.visitorId);
  });
});

server.listen(PORT, () => console.log(`LiveChat running at http://localhost:${PORT}`));
