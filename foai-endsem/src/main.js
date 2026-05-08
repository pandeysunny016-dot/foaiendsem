// ===== Mission Control Dashboard — Main Entry =====
import './style.css';
import L from 'leaflet';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

// ===== CONFIG =====
const CONFIG = {
  // Switched to a more reliable API since open-notify is often unstable
  ISS_API: 'https://api.wheretheiss.at/v1/satellites/25544',
  ASTROS_API: 'https://api.open-notify.org/astros.json',
  // NewsData.io — correct endpoint for pub_ keys
  NEWS_API: 'https://newsdata.io/api/1/news',
  NEWS_API_KEY: import.meta.env.VITE_NEWS_API_KEY || '',
  HF_API: 'https://router.huggingface.co/v1/chat/completions',
  HF_TOKEN: import.meta.env.VITE_HF_TOKEN || '',
  HF_MODEL: 'Qwen/Qwen3-0.6B:featherless-ai',
  ISS_INTERVAL_MS: 15000,
  NEWS_CACHE_MINUTES: 15,
  MAX_POSITIONS: 15,
  MAX_SPEED_POINTS: 30,
  MAX_CHAT_MESSAGES: 30,
};

// ===== STATE =====
const state = {
  issPositions: [],
  issSpeeds: [],
  speedTimestamps: [],
  lastPos: null,
  lastTime: null,
  currentSpeed: 0,
  nearestPlace: '—',
  astronauts: [],
  news: [],
  chatMessages: [],
  theme: localStorage.getItem('mc-theme') || 'dark',
  map: null,
  issMarker: null,
  issPath: null,
  speedChart: null,
  newsChart: null,
  issTimer: null,
  autoRefresh: true,
};

// =====================
//   INIT
// =====================
document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  initMap();
  initCharts();
  loadChatHistory();

  fetchISSPosition();
  fetchAstronauts();
  fetchNews();

  state.issTimer = setInterval(fetchISSPosition, CONFIG.ISS_INTERVAL_MS);
  bindEvents();
});

// =====================
//   THEME
// =====================
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  const btn = document.getElementById('theme-toggle');
  if (state.theme === 'dark') {
    btn.innerHTML = '<span class="theme-icon">🌙</span><span class="theme-text">Switch to Light</span>';
  } else {
    btn.innerHTML = '<span class="theme-icon">☀️</span><span class="theme-text">Switch to Dark</span>';
  }
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('mc-theme', state.theme);
  applyTheme();
  showToast(`Switched to ${state.theme} mode`, 'info');
}

// =====================
//   MAP
// =====================
function initMap() {
  state.map = L.map('iss-map', { center: [0, 0], zoom: 2, zoomControl: true });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
  }).addTo(state.map);

  const issIcon = L.divIcon({
    html: '<div style="font-size:30px;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.6));">🛰️</div>',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    className: '',
  });

  state.issMarker = L.marker([0, 0], { icon: issIcon }).addTo(state.map);
  state.issMarker.bindPopup('<b>ISS</b><br>Calculating position...');

  state.issPath = L.polyline([], {
    color: '#e28743',
    weight: 3,
    opacity: 0.85,
    dashArray: '8,5',
  }).addTo(state.map);
}

// =====================
//   ISS TRACKING
// =====================
async function fetchISSPosition() {
  try {
    const res = await fetch(CONFIG.ISS_API);
    if (!res.ok) throw new Error('ISS API ' + res.status);
    const data = await res.json();

    // Data format for wheretheiss.at: { latitude, longitude, velocity, timestamp, ... }
    const lat = parseFloat(data.latitude);
    const lng = parseFloat(data.longitude);
    const ts  = data.timestamp * 1000;
    // Speed via Haversine (REQUIRED by problem statement)
    if (state.lastPos && state.lastTime) {
      const dt = (ts - state.lastTime) / 1000; // seconds
      if (dt > 0) {
        const dist = haversine(state.lastPos.lat, state.lastPos.lng, lat, lng);
        state.currentSpeed = (dist / dt) * 3600; // km/h
        
        if (state.issSpeeds.length >= CONFIG.MAX_SPEED_POINTS) {
          state.issSpeeds.shift(); state.speedTimestamps.shift();
        }
        state.issSpeeds.push(+state.currentSpeed.toFixed(2));
        state.speedTimestamps.push(new Date(ts).toLocaleTimeString());
        updateSpeedChart();
      }
    }

    state.lastPos  = { lat, lng };
    state.lastTime = ts;

    // Trajectory
    state.issPositions.push([lat, lng]);
    if (state.issPositions.length > CONFIG.MAX_POSITIONS) state.issPositions.shift();

    updateISSUI(lat, lng);
    updateMap(lat, lng);
    // Non-blocking geocode
    reverseGeocode(lat, lng).catch(() => {
      state.nearestPlace = 'Over ocean / remote area';
      setText('iss-location', state.nearestPlace);
    });

  } catch (err) {
    console.error('ISS fetch:', err);
    showToast('ISS data error (Server might be busy)', 'error');
    // If it fails, we keep the old data visible but show the error
  }
}

function toggleAutoRefresh() {
  state.autoRefresh = !state.autoRefresh;
  const btn = document.getElementById('auto-refresh-toggle');
  
  if (state.autoRefresh) {
    state.issTimer = setInterval(fetchISSPosition, CONFIG.ISS_INTERVAL_MS);
    btn.textContent = 'Auto-Refresh: ON';
    btn.className = 'badge badge-success';
    showToast('Auto-refresh enabled', 'success');
  } else {
    clearInterval(state.issTimer);
    state.issTimer = null;
    btn.textContent = 'Auto-Refresh: OFF';
    btn.className = 'badge';
    btn.style.background = 'var(--bg-input)';
    btn.style.color = 'var(--text-dim)';
    showToast('Auto-refresh disabled', 'info');
  }
}

function updateISSUI(lat, lng) {
  setText('iss-coords', `${lat.toFixed(3)}, ${lng.toFixed(3)}`);
  setText('iss-speed',  state.currentSpeed > 0 ? `${state.currentSpeed.toFixed(2)} km/h` : 'Calculating…');
  setText('iss-tracked', state.issPositions.length);
  setText('iss-location', state.nearestPlace);
}

function updateMap(lat, lng) {
  state.issMarker.setLatLng([lat, lng]);
  state.issMarker.setPopupContent(
    `<b>ISS</b><br>Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}<br>Speed: ${state.currentSpeed.toFixed(0)} km/h`
  );
  state.issPath.setLatLngs(state.issPositions);
  state.map.panTo([lat, lng], { animate: true, duration: 1 });
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=5`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const d = await res.json();
    const addr = d.address || {};
    state.nearestPlace =
      addr.country || addr.state || addr.ocean ||
      d.display_name?.split(',').slice(0, 2).join(', ').trim() ||
      'Over ocean / remote area';
  } catch {
    state.nearestPlace = 'Over ocean / remote area';
  }
  setText('iss-location', state.nearestPlace);
}

// =====================
//   HAVERSINE
// =====================
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const rad = d => d * Math.PI / 180;

// =====================
//   ASTRONAUTS
// =====================
async function fetchAstronauts() {
  try {
    const res = await fetch(CONFIG.ASTROS_API);
    if (!res.ok) throw new Error('API down');
    const data = await res.json();
    state.astronauts = data.people || [];
    setText('astro-count', data.number || state.astronauts.length);
    renderAstronauts();
  } catch (e) {
    console.error('Astros:', e);
    // Fallback data so UI doesn't look broken
    state.astronauts = [
      { name: 'Oleg Kononenko', craft: 'ISS' },
      { name: 'Nikolai Chub', craft: 'ISS' },
      { name: 'Tracy Caldwell Dyson', craft: 'ISS' },
      { name: 'Matthew Dominick', craft: 'ISS' },
      { name: 'Michael Barratt', craft: 'ISS' }
    ];
    setText('astro-count', state.astronauts.length);
    renderAstronauts();
    showToast('Using mission fallback for astronaut data', 'info');
  }
}
window.refetchAstronauts = fetchAstronauts;

function renderAstronauts() {
  const list = document.getElementById('astronauts-list');
  if (!state.astronauts.length) {
    list.innerHTML = '<p class="muted-center">No data</p>'; return;
  }
  list.innerHTML = state.astronauts.map(a => `
    <div class="astronaut-item">
      <div class="astronaut-avatar">${a.name[0]}</div>
      <div class="astronaut-info">
        <div class="astronaut-name">${a.name}</div>
        <div class="astronaut-craft">${a.craft}</div>
      </div>
    </div>`).join('');
}

// =====================
//   NEWS (NewsData.io)
// =====================
async function fetchNews(force = false) {
  if (!force) {
    const cached = localStorage.getItem('mc-news');
    if (cached) {
      try {
        const { articles, ts } = JSON.parse(cached);
        if ((Date.now() - ts) / 60000 < CONFIG.NEWS_CACHE_MINUTES) {
          state.news = articles;
          renderNews();
          updateNewsChart();
          showToast('News loaded from cache', 'info');
          return;
        }
      } catch { /* stale */ }
    }
  }

  document.getElementById('news-list').innerHTML = '<div class="spinner"></div>';

  try {
    // NewsData.io endpoint — pub_ API key
    const params = new URLSearchParams({
      apikey:   CONFIG.NEWS_API_KEY,
      language: 'en',
      size:     10,
    });

    const res = await fetch(`${CONFIG.NEWS_API}?${params}`);
    if (!res.ok) throw new Error(`News API error: ${res.status}`);
    const data = await res.json();

    if (data.status !== 'success') throw new Error(data.message || 'News API failed');

    state.news = (data.results || []).map(a => ({
      title:       a.title       || 'Untitled',
      source:      a.source_id   || 'Unknown',
      author:      Array.isArray(a.creator) ? a.creator.join(', ') : (a.creator || 'Unknown'),
      date:        a.pubDate     || '',
      image:       a.image_url   || '',
      description: a.description || a.content?.substring(0, 200) || 'No description.',
      url:         a.link        || '#',
      category:    a.category?.[0] || 'general',
    }));

    localStorage.setItem('mc-news', JSON.stringify({ articles: state.news, ts: Date.now() }));
    renderNews();
    updateNewsChart();
    showToast('News loaded successfully', 'success');

  } catch (err) {
    console.error('News error:', err);
    document.getElementById('news-list').innerHTML = `
      <div class="error-state">
        <p>⚠️ Failed to load news</p>
        <small>${err.message}</small>
        <button class="btn btn-outline" onclick="retryNews()">Retry</button>
      </div>`;
  }
}
window.retryNews = () => { localStorage.removeItem('mc-news'); fetchNews(true); };

function renderNews(filter = '') {
  const list  = document.getElementById('news-list');
  const sortBy = document.getElementById('news-sort').value;
  let articles = [...state.news];

  if (filter) {
    const q = filter.toLowerCase();
    articles = articles.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.source.toLowerCase().includes(q) ||
      a.author.toLowerCase().includes(q)
    );
  }

  articles.sort((a, b) =>
    sortBy === 'date'
      ? new Date(b.date) - new Date(a.date)
      : a.source.localeCompare(b.source)
  );

  if (!articles.length) {
    list.innerHTML = '<p class="muted-center">No articles found.</p>'; return;
  }

  list.innerHTML = articles.map((a, i) => `
    <div class="news-item" onclick="toggleArticle(${i})">
      <div class="news-item-header">
        <div class="news-num">${i + 1}</div>
        <img class="news-thumb"
             src="${a.image || 'https://placehold.co/80x60/2a2a3d/e28743?text=News'}"
             alt="thumbnail"
             onerror="this.src='https://placehold.co/80x60/2a2a3d/e28743?text=News'"
             loading="lazy" />
        <div class="news-body">
          <div class="news-meta">
            <span class="news-source">${a.source.toUpperCase()}</span>
            <span class="news-date">${fmtDate(a.date)}</span>
          </div>
          <div class="news-title">${a.title}</div>
        </div>
        <span class="news-toggle-icon" id="toggle-icon-${i}">▾</span>
      </div>
      <div class="news-expand" id="news-expand-${i}">
        ${a.author && a.author !== 'Unknown' ? `<p class="news-author">By ${a.author}</p>` : ''}
        <p class="news-desc">${a.description}</p>
        <a href="${a.url}" target="_blank" rel="noopener" class="btn btn-primary news-readmore"
           onclick="event.stopPropagation()">Read Full Article →</a>
      </div>
    </div>`).join('');
}

window.toggleArticle = (i) => {
  const el   = document.getElementById(`news-expand-${i}`);
  const icon = document.getElementById(`toggle-icon-${i}`);
  const open = el.classList.toggle('news-expand--open');
  icon.textContent = open ? '▴' : '▾';
};

function fmtDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return d; }
}

// =====================
//   CHARTS
// =====================
const CHART_COLORS = {
  accent:   '#e28743',
  grid:     'rgba(160,160,184,0.12)',
  text:     '#a0a0b8',
  fill:     'rgba(226,135,67,0.12)',
  tooltipBg:'rgba(20,20,32,0.95)',
  palette: ['#e28743','#3498db','#2ecc71','#e74c3c','#9b59b6','#f1c40f','#1abc9c','#e67e22','#34495e','#16a085'],
};

function initCharts() {
  // Speed Chart
  const sCtx = document.getElementById('speed-chart').getContext('2d');
  state.speedChart = new Chart(sCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'ISS Speed (km/h)',
        data: [],
        borderColor: CHART_COLORS.accent,
        backgroundColor: CHART_COLORS.fill,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 2.5,
        pointHoverRadius: 5,
        pointBackgroundColor: CHART_COLORS.accent,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { labels: { color: CHART_COLORS.text, font: { family: 'Inter', size: 11 }, boxWidth: 12 } },
        tooltip: {
          backgroundColor: CHART_COLORS.tooltipBg,
          titleColor: '#f0f0f5',
          bodyColor: CHART_COLORS.text,
          borderColor: 'rgba(226,135,67,0.3)',
          borderWidth: 1,
          cornerRadius: 8,
        }
      },
      scales: {
        x: { ticks: { color: CHART_COLORS.text, font: { size: 9 }, maxRotation: 45, maxTicksLimit: 8 }, grid: { color: CHART_COLORS.grid } },
        y: { ticks: { color: CHART_COLORS.text, font: { size: 9 } }, grid: { color: CHART_COLORS.grid } }
      }
    }
  });

  // News Doughnut
  const nCtx = document.getElementById('news-chart').getContext('2d');
  state.newsChart = new Chart(nCtx, {
    type: 'doughnut',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: CHART_COLORS.palette,
        borderColor: 'rgba(15,15,20,0.6)',
        borderWidth: 2,
        hoverOffset: 10,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: CHART_COLORS.text, font: { family: 'Inter', size: 11 }, padding: 16 } },
        tooltip: { backgroundColor: CHART_COLORS.tooltipBg, titleColor: '#f0f0f5', bodyColor: CHART_COLORS.text, cornerRadius: 8 }
      },
      onClick(_, elements) {
        if (!elements.length) return;
        const label = state.newsChart.data.labels[elements[0].index];
        const search = document.getElementById('news-search');
        search.value = label;
        renderNews(label);
        showToast(`Filtered by: ${label}`, 'info');
      }
    }
  });
}

function updateSpeedChart() {
  if (!state.speedChart) return;
  state.speedChart.data.labels = [...state.speedTimestamps];
  state.speedChart.data.datasets[0].data = [...state.issSpeeds];
  state.speedChart.update('none');
}

function updateNewsChart() {
  if (!state.newsChart || !state.news.length) return;
  const counts = {};
  state.news.forEach(a => { counts[a.category] = (counts[a.category] || 0) + 1; });
  state.newsChart.data.labels = Object.keys(counts);
  state.newsChart.data.datasets[0].data = Object.values(counts);
  state.newsChart.update();
}

// =====================
//   CHATBOT
// =====================
function loadChatHistory() {
  try {
    const saved = localStorage.getItem('mc-chat');
    if (saved) state.chatMessages = JSON.parse(saved);
  } catch { state.chatMessages = []; }
  renderChat();
}

function saveChat() {
  localStorage.setItem('mc-chat', JSON.stringify(state.chatMessages.slice(-CONFIG.MAX_CHAT_MESSAGES)));
}

function renderChat() {
  const box = document.getElementById('chat-messages');
  box.innerHTML = `
    <div class="chat-message bot-message">
      <p>Hello! I'm your Mission AI. Ask me about the ISS position, speed, astronauts, or the news shown on this dashboard. I only answer using dashboard data.</p>
    </div>`;
  state.chatMessages.forEach(m => {
    const div = document.createElement('div');
    div.className = `chat-message ${m.role === 'user' ? 'user-message' : 'bot-message'}`;
    div.innerHTML = `<p>${escHtml(m.content)}</p>`;
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

async function sendChat(text) {
  if (!text.trim()) return;
  state.chatMessages.push({ role: 'user', content: text });
  renderChat();
  saveChat();

  document.getElementById('chat-typing').classList.remove('hidden');
  document.getElementById('chat-send').disabled = true;

  const ctx = buildCtx();
  try {
    const res = await fetch(CONFIG.HF_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.HF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CONFIG.HF_MODEL,
        max_tokens: 512,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: `You are an AI assistant embedded in a Mission Control Dashboard. You MUST answer ONLY using the real-time dashboard data below. Do not use external knowledge. If the question cannot be answered from the data, say so politely.

LIVE DASHBOARD DATA:
${ctx}`,
          },
          ...state.chatMessages.slice(-12).map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content,
          })),
        ],
      }),
    });

    const result = await res.json();
    let reply = result.choices?.[0]?.message?.content || 'Sorry, I could not respond.';
    reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    state.chatMessages.push({ role: 'assistant', content: reply });

  } catch (e) {
    console.error('Chat error:', e);
    state.chatMessages.push({ role: 'assistant', content: 'Connection error. Please try again.' });
  }

  document.getElementById('chat-typing').classList.add('hidden');
  document.getElementById('chat-send').disabled = false;
  renderChat();
  saveChat();
}

function buildCtx() {
  const lines = [];
  if (state.lastPos) {
    lines.push(`ISS Latitude: ${state.lastPos.lat.toFixed(4)}`);
    lines.push(`ISS Longitude: ${state.lastPos.lng.toFixed(4)}`);
  }
  lines.push(`ISS Speed: ${state.currentSpeed.toFixed(2)} km/h`);
  lines.push(`ISS Nearest Place: ${state.nearestPlace}`);
  lines.push(`ISS Positions Tracked: ${state.issPositions.length}`);
  if (state.astronauts.length) {
    lines.push(`People in Space: ${state.astronauts.length}`);
    lines.push(`Astronauts: ${state.astronauts.map(a => `${a.name} on ${a.craft}`).join('; ')}`);
  }
  if (state.news.length) {
    lines.push(`Total News Articles: ${state.news.length}`);
    state.news.slice(0, 10).forEach((a, i) => {
      lines.push(`News ${i + 1}: "${a.title}" — ${a.source} (${a.date}) — ${a.description.slice(0, 120)}`);
    });
  }
  return lines.join('\n');
}

// =====================
//   HELPERS
// =====================
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showToast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span>${icons[type]}</span> ${msg}`;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// =====================
//   EVENTS
// =====================
function bindEvents() {
  // Theme
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // ISS refresh
  document.getElementById('iss-refresh-btn').addEventListener('click', () => {
    fetchISSPosition();
    showToast('ISS refreshed', 'success');
  });

  // Auto-Refresh toggle
  document.getElementById('auto-refresh-toggle').addEventListener('click', toggleAutoRefresh);

  // News refresh
  document.getElementById('news-refresh-btn').addEventListener('click', () => {
    localStorage.removeItem('mc-news');
    fetchNews(true);
  });

  // Search
  let st;
  document.getElementById('news-search').addEventListener('input', e => {
    clearTimeout(st);
    st = setTimeout(() => renderNews(e.target.value), 280);
  });

  // Sort
  document.getElementById('news-sort').addEventListener('change', () => {
    renderNews(document.getElementById('news-search').value);
  });

  // Chatbot open/close
  document.getElementById('chatbot-toggle').addEventListener('click', () => {
    document.getElementById('chatbot-window').classList.toggle('chatbot-hidden');
    document.getElementById('chat-input').focus();
  });
  document.getElementById('chatbot-close').addEventListener('click', () => {
    document.getElementById('chatbot-window').classList.add('chatbot-hidden');
  });

  // Chat send
  const doSend = () => {
    const inp = document.getElementById('chat-input');
    sendChat(inp.value);
    inp.value = '';
  };
  document.getElementById('chat-send').addEventListener('click', doSend);
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });

  // Clear chat
  document.getElementById('chat-clear').addEventListener('click', () => {
    state.chatMessages = [];
    localStorage.removeItem('mc-chat');
    renderChat();
    showToast('Chat cleared', 'info');
  });
}
