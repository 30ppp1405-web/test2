/**
 * LiveChat Embeddable Widget
 * Usage: <script src="/widget/widget.js" data-site-id="your-site"></script>
 */
(function() {
  'use strict';

  const LC_VERSION = '1.0.0';
  const SOCKET_URL = window.LC_SERVER_URL || (window.location.origin);

  // ── Config ──
  const config = {
    primaryColor: '#6366f1',
    position: 'bottom-right',
    welcomeMessage: 'Hi there! 👋 How can we help you today?',
    awayMessage: 'We\'re currently offline. Leave us a message and we\'ll get back to you!',
    placeholder: 'Type a message…',
    teamName: 'Support Team',
    teamAvatars: ['A', 'B'],
  };

  // ── State ──
  let state = {
    open: false,
    phase: 'pre',      // pre | chat
    visitorId: localStorage.getItem('lc_visitor_id') || null,
    conversationId: null,
    messages: [],
    agentsOnline: false,
    typing: false,
    connected: false,
    unread: 0,
    name: localStorage.getItem('lc_visitor_name') || '',
    email: localStorage.getItem('lc_visitor_email') || '',
  };

  let socket = null;
  let typingTimer = null;
  let container = null;

  // ── CSS ──
  const CSS = `
    #lc-widget * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #lc-widget {
      position: fixed; z-index: 2147483647;
      bottom: 24px; right: 24px;
      display: flex; flex-direction: column; align-items: flex-end; gap: 12px;
    }
    /* Bubble */
    #lc-bubble {
      width: 60px; height: 60px; border-radius: 50%;
      background: ${config.primaryColor};
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 20px rgba(99,102,241,.5);
      transition: transform .2s, box-shadow .2s;
      position: relative; border: none; outline: none;
    }
    #lc-bubble:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(99,102,241,.6); }
    #lc-bubble svg { transition: transform .3s, opacity .3s; }
    #lc-bubble.open .icon-chat { transform: scale(0); opacity: 0; position: absolute; }
    #lc-bubble.open .icon-close { transform: scale(1); opacity: 1; }
    #lc-bubble .icon-close { transform: scale(0); opacity: 0; position: absolute; }
    #lc-badge {
      position: absolute; top: -4px; right: -4px;
      background: #ef4444; color: #fff; font-size: 11px; font-weight: 700;
      width: 20px; height: 20px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid #fff; display: none;
    }
    /* Window */
    #lc-window {
      width: 380px; height: 580px; border-radius: 20px;
      background: #fff; box-shadow: 0 20px 60px rgba(0,0,0,.2);
      display: flex; flex-direction: column; overflow: hidden;
      transform-origin: bottom right;
      transition: transform .3s cubic-bezier(.34,1.56,.64,1), opacity .3s;
      transform: scale(0.8) translateY(20px); opacity: 0; pointer-events: none;
    }
    #lc-window.open { transform: scale(1) translateY(0); opacity: 1; pointer-events: all; }
    /* Header */
    #lc-header {
      background: ${config.primaryColor};
      padding: 20px; color: #fff; flex-shrink: 0;
    }
    .lc-header-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .lc-team { display: flex; align-items: center; gap: 10px; }
    .lc-avatars { display: flex; }
    .lc-av {
      width: 36px; height: 36px; border-radius: 50%; border: 2px solid rgba(255,255,255,.4);
      background: rgba(255,255,255,.2); display: flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 700; color: #fff; margin-left: -8px;
    }
    .lc-av:first-child { margin-left: 0; }
    .lc-team-info .name { font-size: 15px; font-weight: 700; }
    .lc-team-info .status { font-size: 12px; opacity: .85; display: flex; align-items: center; gap: 5px; }
    .lc-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; display: inline-block; }
    .lc-status-dot.away { background: #fbbf24; }
    .lc-close-btn {
      background: rgba(255,255,255,.15); border: none; border-radius: 50%;
      width: 32px; height: 32px; cursor: pointer; color: #fff; font-size: 18px;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      transition: background .2s;
    }
    .lc-close-btn:hover { background: rgba(255,255,255,.25); }
    .lc-welcome { font-size: 13px; opacity: .9; line-height: 1.5; }
    /* Pre-chat */
    #lc-prechat { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
    .lc-prechat-inner { padding: 24px; flex: 1; }
    .lc-prechat-inner h3 { font-size: 16px; font-weight: 700; color: #1e293b; margin-bottom: 6px; }
    .lc-prechat-inner p { font-size: 13px; color: #64748b; margin-bottom: 20px; line-height: 1.5; }
    .lc-field { margin-bottom: 14px; }
    .lc-field label { display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 5px; }
    .lc-field input {
      width: 100%; padding: 10px 14px; border: 1.5px solid #e2e8f0; border-radius: 10px;
      font-size: 14px; color: #1e293b; outline: none; transition: border-color .2s;
      background: #f8fafc;
    }
    .lc-field input:focus { border-color: ${config.primaryColor}; background: #fff; }
    .lc-start-btn {
      width: 100%; padding: 13px; background: ${config.primaryColor}; color: #fff;
      border: none; border-radius: 10px; font-size: 15px; font-weight: 600;
      cursor: pointer; transition: opacity .2s;
    }
    .lc-start-btn:hover { opacity: .9; }
    .lc-start-btn:disabled { opacity: .6; cursor: not-allowed; }
    /* Chat area */
    #lc-chat { flex: 1; display: flex; flex-direction: column; }
    #lc-messages {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 10px; background: #f8fafc;
    }
    #lc-messages::-webkit-scrollbar { width: 4px; }
    #lc-messages::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2px; }
    /* Messages */
    .lc-msg-row { display: flex; align-items: flex-end; gap: 6px; }
    .lc-msg-row.visitor { flex-direction: row-reverse; }
    .lc-msg-av {
      width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
      background: ${config.primaryColor}; display: flex; align-items: center;
      justify-content: center; font-size: 11px; font-weight: 700; color: #fff;
    }
    .lc-bubble-wrap { max-width: 72%; display: flex; flex-direction: column; }
    .lc-msg-row.visitor .lc-bubble-wrap { align-items: flex-end; }
    .lc-msg-name { font-size: 10px; color: #94a3b8; margin-bottom: 3px; padding: 0 4px; }
    .lc-bubble {
      padding: 9px 13px; border-radius: 16px; font-size: 14px; line-height: 1.5;
      word-break: break-word; max-width: 100%;
    }
    .lc-msg-row.agent .lc-bubble { background: #fff; color: #1e293b; border-bottom-left-radius: 4px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    .lc-msg-row.visitor .lc-bubble { background: ${config.primaryColor}; color: #fff; border-bottom-right-radius: 4px; }
    .lc-msg-time { font-size: 10px; color: #94a3b8; padding: 2px 4px; }
    .lc-file-link {
      display: flex; align-items: center; gap: 6px; text-decoration: none;
      font-size: 13px; padding: 9px 13px; border-radius: 16px;
    }
    .lc-msg-row.agent .lc-file-link { background: #fff; color: #1e293b; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    .lc-msg-row.visitor .lc-file-link { background: ${config.primaryColor}; color: #fff; }
    /* Typing */
    .lc-typing-row { display: flex; align-items: center; gap: 6px; }
    .lc-typing-dots { display: flex; gap: 3px; padding: 10px 12px; background: #fff; border-radius: 16px; border-bottom-left-radius: 4px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    .lc-typing-dots span { width: 6px; height: 6px; background: #94a3b8; border-radius: 50%; animation: lc-bounce 1.2s infinite; }
    .lc-typing-dots span:nth-child(2) { animation-delay: 0.2s; }
    .lc-typing-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes lc-bounce { 0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)} }
    /* Date sep */
    .lc-date-sep { display: flex; align-items: center; gap: 10px; margin: 4px 0; }
    .lc-date-sep::before, .lc-date-sep::after { content:''; flex:1; height:1px; background:#e2e8f0; }
    .lc-date-sep span { font-size: 10px; color: #94a3b8; white-space: nowrap; }
    /* Resolved banner */
    #lc-resolved-banner { background: #f0fdf4; border-top: 1px solid #86efac; padding: 12px 16px; text-align: center; font-size: 13px; color: #166534; display: none; }
    /* Input */
    #lc-input-area { border-top: 1px solid #e2e8f0; background: #fff; padding: 12px 16px; flex-shrink: 0; }
    .lc-input-row { display: flex; gap: 8px; align-items: flex-end; }
    #lc-attach-btn { width: 36px; height: 36px; border-radius: 8px; border: 1.5px solid #e2e8f0; background: #f8fafc; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; transition: border-color .2s; flex-shrink: 0; }
    #lc-attach-btn:hover { border-color: ${config.primaryColor}; }
    #lc-text-input {
      flex: 1; padding: 9px 13px; border: 1.5px solid #e2e8f0; border-radius: 10px;
      font-size: 14px; resize: none; outline: none; font-family: inherit;
      max-height: 100px; line-height: 1.5; color: #1e293b; background: #f8fafc;
      transition: border-color .2s;
    }
    #lc-text-input:focus { border-color: ${config.primaryColor}; background: #fff; }
    #lc-text-input::placeholder { color: #94a3b8; }
    #lc-send-btn {
      width: 36px; height: 36px; background: ${config.primaryColor}; border: none;
      border-radius: 10px; color: #fff; cursor: pointer; font-size: 16px;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      transition: opacity .2s;
    }
    #lc-send-btn:hover { opacity: .9; }
    #lc-send-btn:disabled { background: #e2e8f0; cursor: not-allowed; }
    .lc-powered { text-align: center; font-size: 10px; color: #cbd5e1; padding: 6px 0 2px; }
    .lc-powered a { color: #94a3b8; text-decoration: none; }
    #lc-file-input { display: none; }
    /* Ripple pulse on bubble */
    @keyframes lc-pulse { 0%{transform:scale(1);opacity:.6} 100%{transform:scale(1.8);opacity:0} }
    #lc-pulse {
      position: absolute; width: 100%; height: 100%; border-radius: 50%;
      background: ${config.primaryColor}; animation: lc-pulse 2s infinite; pointer-events: none;
      display: none;
    }
    #lc-bubble.has-unread #lc-pulse { display: block; }
    /* System message */
    .lc-sys { text-align: center; font-size: 11px; color: #94a3b8; padding: 4px 12px; }
    @media (max-width: 420px) {
      #lc-window { width: calc(100vw - 16px); height: calc(100vh - 90px); bottom: 80px; right: 8px; border-radius: 16px; }
    }
  `;

  // ── Build DOM ──
  function buildWidget() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    container = document.createElement('div');
    container.id = 'lc-widget';
    container.innerHTML = `
      <!-- Window -->
      <div id="lc-window">
        <!-- Header -->
        <div id="lc-header">
          <div class="lc-header-top">
            <div class="lc-team">
              <div class="lc-avatars">
                ${config.teamAvatars.map(a => `<div class="lc-av">${a}</div>`).join('')}
              </div>
              <div class="lc-team-info">
                <div class="name">${config.teamName}</div>
                <div class="status" id="lc-status">
                  <span class="lc-status-dot" id="lc-status-dot"></span>
                  <span id="lc-status-text">Connecting…</span>
                </div>
              </div>
            </div>
            <button class="lc-close-btn" id="lc-close-btn">✕</button>
          </div>
          <div class="lc-welcome" id="lc-welcome-msg">${config.welcomeMessage}</div>
        </div>

        <!-- Pre-chat form -->
        <div id="lc-prechat">
          <div class="lc-prechat-inner">
            <h3>Start a conversation</h3>
            <p>Fill in your details and we'll get back to you as soon as possible.</p>
            <div class="lc-field">
              <label>Your name <span style="color:#ef4444">*</span></label>
              <input type="text" id="lc-name-input" placeholder="John Doe" autocomplete="name" />
            </div>
            <div class="lc-field">
              <label>Email address</label>
              <input type="email" id="lc-email-input" placeholder="john@example.com" autocomplete="email" />
            </div>
            <button class="lc-start-btn" id="lc-start-btn">Start Chat →</button>
          </div>
        </div>

        <!-- Chat -->
        <div id="lc-chat" style="display:none; flex:1; flex-direction:column;">
          <div id="lc-messages"></div>
          <div id="lc-resolved-banner">✅ This conversation has been resolved. <a href="#" id="lc-new-chat-link" style="color:#166534;font-weight:600;">Start new chat</a></div>
          <div id="lc-input-area">
            <div class="lc-input-row">
              <button id="lc-attach-btn" title="Attach file">📎</button>
              <textarea id="lc-text-input" placeholder="${config.placeholder}" rows="1"></textarea>
              <button id="lc-send-btn">➤</button>
            </div>
            <div class="lc-powered"><a href="#" tabindex="-1">Powered by LiveChat</a></div>
          </div>
          <input type="file" id="lc-file-input" accept="image/*,.pdf,.doc,.docx,.zip" />
        </div>
      </div>

      <!-- Bubble -->
      <button id="lc-bubble" aria-label="Open chat">
        <div id="lc-pulse"></div>
        <svg class="icon-chat" width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg class="icon-close" width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M18 6 6 18M6 6l12 12" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <div id="lc-badge"></div>
      </button>`;

    document.body.appendChild(container);

    // Events
    document.getElementById('lc-bubble').addEventListener('click', toggleWidget);
    document.getElementById('lc-close-btn').addEventListener('click', closeWidget);
    document.getElementById('lc-start-btn').addEventListener('click', startChat);
    document.getElementById('lc-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') startChat(); });
    document.getElementById('lc-send-btn').addEventListener('click', sendMessage);
    document.getElementById('lc-text-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    document.getElementById('lc-text-input').addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
      if (socket && state.connected && state.conversationId) {
        socket.emit('visitor:typing', { typing: true });
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => socket.emit('visitor:typing', { typing: false }), 3000);
      }
    });
    document.getElementById('lc-attach-btn').addEventListener('click', () => document.getElementById('lc-file-input').click());
    document.getElementById('lc-file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await uploadAndSend(file);
      e.target.value = '';
    });

    if (state.name) document.getElementById('lc-name-input').value = state.name;
    if (state.email) document.getElementById('lc-email-input').value = state.email;
  }

  // ── Socket ──
  function loadSocketIO(cb) {
    const s = document.createElement('script');
    s.src = SOCKET_URL + '/socket.io/socket.io.js';
    s.onload = cb;
    document.head.appendChild(s);
  }

  function initSocket() {
    socket = io(SOCKET_URL);
    socket.on('connect', () => {
      state.connected = true;
      if (state.visitorId) resumeVisitor();
    });
    socket.on('disconnect', () => {
      state.connected = false;
      updateStatus(false);
    });
    socket.on('visitor:ready', ({ visitorId, conversationId, messages, agentsOnline }) => {
      state.visitorId = visitorId;
      state.conversationId = conversationId;
      state.messages = messages;
      state.agentsOnline = agentsOnline;
      localStorage.setItem('lc_visitor_id', visitorId);
      updateStatus(agentsOnline);
      renderMessages(messages);
      showChatView();
    });
    socket.on('message:new', (msg) => {
      state.messages.push(msg);
      appendMessage(msg);
      if (msg.from === 'agent' && !state.open) {
        state.unread++;
        updateBadge();
      }
      hideTyping();
    });
    socket.on('message:sent', (msg) => {
      // already appended optimistically
    });
    socket.on('agent:typing', ({ typing }) => {
      if (typing) showTyping();
      else hideTyping();
      clearTimeout(typingTimer);
      if (typing) typingTimer = setTimeout(hideTyping, 4000);
    });
    socket.on('conversation:resolved', () => {
      document.getElementById('lc-resolved-banner').style.display = 'block';
      document.getElementById('lc-input-area').style.display = 'none';
    });
  }

  function resumeVisitor() {
    socket.emit('visitor:init', {
      visitorId: state.visitorId,
      name: state.name,
      email: state.email,
      page: window.location.href,
    });
  }

  // ── Toggle ──
  function toggleWidget() {
    state.open ? closeWidget() : openWidget();
  }
  function openWidget() {
    state.open = true;
    state.unread = 0;
    updateBadge();
    document.getElementById('lc-window').classList.add('open');
    document.getElementById('lc-bubble').classList.add('open');
    document.getElementById('lc-bubble').classList.remove('has-unread');
    if (state.phase === 'chat') {
      setTimeout(() => {
        const m = document.getElementById('lc-messages');
        m.scrollTop = m.scrollHeight;
      }, 50);
    }
  }
  function closeWidget() {
    state.open = false;
    document.getElementById('lc-window').classList.remove('open');
    document.getElementById('lc-bubble').classList.remove('open');
  }

  // ── Pre-chat → Chat ──
  function startChat() {
    const nameEl = document.getElementById('lc-name-input');
    const emailEl = document.getElementById('lc-email-input');
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); nameEl.style.borderColor = '#ef4444'; return; }
    nameEl.style.borderColor = '';
    state.name = name;
    state.email = emailEl.value.trim();
    localStorage.setItem('lc_visitor_name', state.name);
    localStorage.setItem('lc_visitor_email', state.email);
    document.getElementById('lc-start-btn').disabled = true;
    document.getElementById('lc-start-btn').textContent = 'Connecting…';
    if (!socket) {
      loadSocketIO(() => {
        initSocket();
        socket.on('connect', () => resumeVisitor());
      });
    } else {
      resumeVisitor();
    }
  }

  function showChatView() {
    state.phase = 'chat';
    document.getElementById('lc-prechat').style.display = 'none';
    document.getElementById('lc-chat').style.display = 'flex';
  }

  // ── Messages ──
  function renderMessages(messages) {
    const area = document.getElementById('lc-messages');
    area.innerHTML = '';
    let lastDate = '';
    messages.forEach(msg => {
      const d = new Date(msg.timestamp).toLocaleDateString();
      if (d !== lastDate) {
        lastDate = d;
        const sep = document.createElement('div');
        sep.className = 'lc-date-sep';
        sep.innerHTML = `<span>${d === new Date().toLocaleDateString() ? 'Today' : d}</span>`;
        area.appendChild(sep);
      }
      area.appendChild(buildMsgEl(msg));
    });
    area.scrollTop = area.scrollHeight;
  }

  function appendMessage(msg) {
    const area = document.getElementById('lc-messages');
    area.appendChild(buildMsgEl(msg));
    area.scrollTop = area.scrollHeight;
  }

  function buildMsgEl(msg) {
    const isVisitor = msg.from === 'visitor';
    const row = document.createElement('div');
    row.className = `lc-msg-row ${msg.from}`;

    const avatarColor = isVisitor ? config.primaryColor : '#6366f1';
    const avatarText = isVisitor ? (state.name?.[0] || 'Y') : (msg.agentAvatar || 'A');

    let bodyHtml = '';
    if (msg.fileUrl) {
      const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(msg.fileUrl);
      if (isImg) bodyHtml = `<img src="${esc(msg.fileUrl)}" style="max-width:200px;border-radius:10px;display:block;" />`;
      else bodyHtml = `<a class="lc-file-link" href="${esc(msg.fileUrl)}" target="_blank">📎 ${esc(msg.fileName||'File')}</a>`;
    }
    if (msg.text) bodyHtml += `<div class="lc-bubble">${esc(msg.text).replace(/\n/g,'<br/>')}</div>`;

    row.innerHTML = `
      <div class="lc-msg-av" style="background:${avatarColor}">${avatarText}</div>
      <div class="lc-bubble-wrap">
        <span class="lc-msg-name">${isVisitor ? 'You' : esc(msg.agentName||'Support')}</span>
        ${bodyHtml}
        <span class="lc-msg-time">${fmtTime(msg.timestamp)}</span>
      </div>`;
    return row;
  }

  // ── Send ──
  function sendMessage() {
    if (!socket || !state.connected || !state.conversationId) return;
    const inp = document.getElementById('lc-text-input');
    const text = inp.value.trim();
    if (!text) return;
    socket.emit('visitor:send', { text });
    // Optimistic
    const msg = { id: Date.now(), from: 'visitor', text, timestamp: new Date().toISOString() };
    appendMessage(msg);
    inp.value = ''; inp.style.height = 'auto';
    socket.emit('visitor:typing', { typing: false });
  }

  async function uploadAndSend(file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(SOCKET_URL + '/api/upload', { method: 'POST', body: fd });
    const { url, name } = await res.json();
    socket.emit('visitor:send', { fileUrl: url, fileName: name });
  }

  // ── Typing ──
  function showTyping() {
    let el = document.getElementById('lc-typing-row');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lc-typing-row';
      el.className = 'lc-typing-row';
      el.innerHTML = `<div class="lc-msg-av" style="background:#6366f1">S</div><div class="lc-typing-dots"><span></span><span></span><span></span></div>`;
      document.getElementById('lc-messages').appendChild(el);
    }
    document.getElementById('lc-messages').scrollTop = 9999;
  }
  function hideTyping() {
    const el = document.getElementById('lc-typing-row');
    if (el) el.remove();
  }

  // ── Status ──
  function updateStatus(online) {
    const dot = document.getElementById('lc-status-dot');
    const txt = document.getElementById('lc-status-text');
    if (!dot || !txt) return;
    dot.className = `lc-status-dot${online ? '' : ' away'}`;
    txt.textContent = online ? 'We\'re online — typically reply in minutes' : 'We\'re away — leave a message';
    document.getElementById('lc-welcome-msg').textContent = online ? config.welcomeMessage : config.awayMessage;
  }

  // ── Badge ──
  function updateBadge() {
    const badge = document.getElementById('lc-badge');
    const bubble = document.getElementById('lc-bubble');
    if (state.unread > 0) {
      badge.textContent = state.unread > 9 ? '9+' : state.unread;
      badge.style.display = 'flex';
      bubble.classList.add('has-unread');
    } else {
      badge.style.display = 'none';
      bubble.classList.remove('has-unread');
    }
  }

  // ── Helpers ──
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ── Init ──
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', build);
    } else { build(); }
  }

  function build() {
    buildWidget();
    // Auto-resume if returning visitor
    if (state.visitorId && state.name) {
      loadSocketIO(() => {
        initSocket();
        socket.on('connect', () => resumeVisitor());
      });
    }
  }

  init();
})();
