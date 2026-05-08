// ===== Mission Control Dashboard — Premium Core =====
import './style.css';
import L from 'leaflet';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

// ===== CONFIG =====
const CONFIG = {
  // Switched to a secure proxy tunnel to allow HTTP APIs on HTTPS (Vercel)
  ISS_API: 'https://api.allorigins.win/get?url=' + encodeURIComponent('http://api.open-notify.org/iss-now.json'),
  ASTROS_API: 'https://api.allorigins.win/get?url=' + encodeURIComponent('http://api.open-notify.org/astros.json'),
  
  // NewsData.io
  NEWS_API: 'https://newsdata.io/api/1/news',
  NEWS_API_KEY: import.meta.env.VITE_NEWS_API_KEY || 'pub_da26954bfd324eefb5b78437b8fafd67',
  
  // AI Chatbot (HF)
  HF_API: 'https://router.huggingface.co/v1/chat/completions',
  HF_TOKEN: import.meta.env.VITE_HF_TOKEN || '',
  HF_MODEL: 'Qwen/Qwen3-0.6B:featherless-ai',
  
  ISS_INTERVAL_MS: 15000,
  MAX_POSITIONS: 20,
  MAX_SPEED_POINTS: 30,
};

// ===== STATE =====
const state = {
  issPositions: [],
  issSpeeds: [],
  speedTimestamps: [],
  lastPos: null,
  lastTime: null,
  currentSpeed: 0,
  nearestPlace: 'Loading...',
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
//   INITIALIZATION
// =====================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 System Booting...');
  
  initTheme();
  initMap();
  initCharts();
  loadChatHistory();

  // Load Initial Data
  await Promise.allSettled([
    fetchISSPosition(),
    fetchAstronauts(),
    fetchNews()
  ]);

  setInterval(fetchISSPosition, CONFIG.ISS_INTERVAL_MS);
  bindEvents();
});

// =====================
//   ISS TRACKING
// =====================
async function fetchISSPosition() {
  try {
    const res = await fetch(CONFIG.ISS_API, { signal: AbortSignal.timeout(8000) });
    const wrapper = await res.json();
    const data = JSON.parse(wrapper.contents);

    if (data.message !== 'success') throw new Error('API Message Error');

    const lat = parseFloat(data.iss_position.latitude);
    const lng = parseFloat(data.iss_position.longitude);
    const ts  = data.timestamp * 1000;

    // Speed (Haversine)
    if (state.lastPos) {
      const dist = haversine(state.lastPos.lat, state.lastPos.lng, lat, lng);
      const dt = (ts - state.lastTime) / 1000;
      if (dt > 0) state.currentSpeed = (dist / dt) * 3600;
    } else {
      state.currentSpeed = 27600; // Average orbital speed
    }

    state.lastPos = { lat, lng };
    state.lastTime = ts;

    // History
    state.issPositions.push([lat, lng]);
    if (state.issPositions.length > CONFIG.MAX_POSITIONS) state.issPositions.shift();

    state.issSpeeds.push(+state.currentSpeed.toFixed(2));
    state.speedTimestamps.push(new Date(ts).toLocaleTimeString());
    if (state.issSpeeds.length > CONFIG.MAX_SPEED_POINTS) {
      state.issSpeeds.shift(); state.speedTimestamps.shift();
    }

    updateISSUI(lat, lng);
    updateMap(lat, lng);
    updateSpeedChart();
    
    // Reverse Geocode
    reverseGeocode(lat, lng);

  } catch (err) {
    console.error('ISS Error:', err);
    // Silent fail - don't clear UI so old data stays
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
    showToast('Auto-refresh disabled', 'info');
  }
}

function updateISSUI(lat, lng) {
  setText('iss-coords', `${lat.toFixed(3)}, ${lng.toFixed(3)}`);
  setText('iss-speed',  `${state.currentSpeed.toFixed(0)} km/h`);
  setText('iss-tracked', state.issPositions.length);
}

function updateMap(lat, lng) {
  state.issMarker.setLatLng([lat, lng]);
  state.issPath.setLatLngs(state.issPositions);
  state.map.panTo([lat, lng]);
  state.issMarker.setPopupContent(`<b>ISS Live</b><br>Speed: ${state.currentSpeed.toFixed(0)} km/h`);
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=5`);
    const d = await res.json();
    state.nearestPlace = d.address?.country || d.address?.ocean || 'Remote Area';
  } catch {
    state.nearestPlace = 'Unknown Location';
  }
  setText('iss-location', state.nearestPlace);
}

// =====================
//   ASTRONAUTS
// =====================
async function fetchAstronauts() {
  try {
    const res = await fetch(CONFIG.ASTROS_API, { signal: AbortSignal.timeout(6000) });
    const wrapper = await res.json();
    const data = JSON.parse(wrapper.contents);
    
    if (data.message !== 'success') throw new Error('API Error');
    
    state.astronauts = data.people || [];
    setText('astro-count', data.number || state.astronauts.length);
    renderAstronauts();
  } catch (e) {
    console.warn('Astros API failed, using mission fallback.');
    // Mission-accurate fallback (Expedition 71)
    state.astronauts = [
      { name: 'Oleg Kononenko', craft: 'ISS' },
      { name: 'Nikolai Chub', craft: 'ISS' },
      { name: 'Tracy Caldwell-Dyson', craft: 'ISS' },
      { name: 'Matthew Dominick', craft: 'ISS' },
      { name: 'Michael Barratt', craft: 'ISS' },
      { name: 'Jeanette Epps', craft: 'ISS' },
      { name: 'Alexander Grebenkin', craft: 'ISS' }
    ];
    setText('astro-count', state.astronauts.length);
    renderAstronauts();
  }
}

function renderAstronauts() {
  const el = document.getElementById('astronauts-list');
  el.innerHTML = state.astronauts.map(a => `
    <div class="astronaut-item">
      <div class="astronaut-avatar">${a.name[0]}</div>
      <div class="astronaut-info">
        <div class="astronaut-name">${a.name}</div>
        <div class="astronaut-craft">${a.craft}</div>
      </div>
    </div>`).join('');
}

// =====================
//   NEWS
// =====================
async function fetchNews() {
  try {
    const res = await fetch(`${CONFIG.NEWS_API}?apikey=${CONFIG.NEWS_API_KEY}&language=en&size=10`);
    const data = await res.json();
    if (data.status === 'success') {
      state.news = data.results.map(a => ({
        title: a.title,
        source: a.source_id,
        date: a.pubDate,
        image: a.image_url,
        description: a.description || 'No summary.',
        url: a.link,
        category: a.category?.[0] || 'general'
      }));
      renderNews();
      updateNewsChart();
    }
  } catch (e) {
    document.getElementById('news-list').innerHTML = '<p class="muted-center">News feed currently offline.</p>';
  }
}

function renderNews() {
  const el = document.getElementById('news-list');
  el.innerHTML = state.news.map((a, i) => `
    <div class="news-item" onclick="toggleArticle(${i})">
      <div class="news-item-header">
        <div class="news-num">${i + 1}</div>
        <img class="news-thumb" src="${a.image || 'https://placehold.co/50x50/2a2a3d/e28743?text=NEWS'}" />
        <div class="news-body">
          <div class="news-meta">
            <span class="news-source">${a.source.toUpperCase()}</span>
            <span class="news-date">${new Date(a.date).toLocaleDateString()}</span>
          </div>
          <div class="news-title">${a.title}</div>
        </div>
      </div>
      <div class="news-expand" id="news-expand-${i}">
        <p class="news-desc">${a.description}</p>
        <a href="${a.url}" target="_blank" class="btn btn-primary btn-sm" onclick="event.stopPropagation()">Read More →</a>
      </div>
    </div>`).join('');
}

window.toggleArticle = (i) => {
  const el = document.getElementById(`news-expand-${i}`);
  el.classList.toggle('news-expand--open');
};

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

function renderChat() {
  const box = document.getElementById('chat-messages');
  box.innerHTML = `<div class="chat-message bot-message"><p>Mission Control AI Online. How can I assist you today?</p></div>`;
  state.chatMessages.forEach(m => {
    const div = document.createElement('div');
    div.className = `chat-message ${m.role === 'user' ? 'user-message' : 'bot-message'}`;
    div.innerHTML = `<p>${m.content}</p>`;
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

async function sendChat(text) {
  if (!text.trim()) return;
  state.chatMessages.push({ role: 'user', content: text });
  renderChat();
  
  document.getElementById('chat-typing').classList.remove('hidden');

  try {
    const res = await fetch(CONFIG.HF_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CONFIG.HF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CONFIG.HF_MODEL,
        messages: [{ role: 'system', content: 'You are a Mission Control Assistant. Answer using dashboard data.' }, ...state.chatMessages.slice(-5)],
      })
    });
    const result = await res.json();
    const reply = result.choices?.[0]?.message?.content || 'System connection error.';
    state.chatMessages.push({ role: 'assistant', content: reply });
  } catch (e) {
    state.chatMessages.push({ role: 'assistant', content: 'AI offline. Check internet connection.' });
  }

  document.getElementById('chat-typing').classList.add('hidden');
  renderChat();
  localStorage.setItem('mc-chat', JSON.stringify(state.chatMessages.slice(-20)));
}

// =====================
//   CHARTS & MAP
// =====================
function initMap() {
  state.map = L.map('iss-map', { center: [0, 0], zoom: 2 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(state.map);
  const icon = L.divIcon({ html: '<div style="font-size:30px;">🛰️</div>', iconSize: [30, 30] });
  state.issMarker = L.marker([0, 0], { icon }).addTo(state.map).bindPopup('ISS Tracking...');
  state.issPath = L.polyline([], { color: '#e28743', weight: 2, dashArray: '5,5' }).addTo(state.map);
}

function initCharts() {
  const sCtx = document.getElementById('speed-chart').getContext('2d');
  state.speedChart = new Chart(sCtx, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'ISS Speed (km/h)', data: [], borderColor: '#e28743', backgroundColor: 'rgba(226,135,67,0.1)', fill: true, tension: 0.4 }] },
    options: { responsive: true, maintainAspectRatio: false }
  });

  const nCtx = document.getElementById('news-chart').getContext('2d');
  state.newsChart = new Chart(nCtx, {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: ['#e28743', '#3498db', '#2ecc71', '#e74c3c'] }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function updateSpeedChart() {
  state.speedChart.data.labels = state.speedTimestamps;
  state.speedChart.data.datasets[0].data = state.issSpeeds;
  state.speedChart.update('none');
}

function updateNewsChart() {
  const counts = {};
  state.news.forEach(a => counts[a.category] = (counts[a.category] || 0) + 1);
  state.newsChart.data.labels = Object.keys(counts);
  state.newsChart.data.datasets[0].data = Object.values(counts);
  state.newsChart.update();
}

// =====================
//   UTILS
// =====================
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function initTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function showToast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span>${icons[type]}</span> ${msg}`;
  const container = document.getElementById('toast-container');
  if (container) {
    container.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
}

function bindEvents() {
  document.getElementById('theme-toggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('mc-theme', state.theme);
    initTheme();
  });
  document.getElementById('iss-refresh-btn').addEventListener('click', () => {
    fetchISSPosition();
    showToast('ISS Data Refreshed', 'success');
  });
  document.getElementById('auto-refresh-toggle').addEventListener('click', toggleAutoRefresh);
  document.getElementById('chatbot-toggle').addEventListener('click', () => {
    document.getElementById('chatbot-window').classList.toggle('chatbot-hidden');
  });
  document.getElementById('chatbot-close').addEventListener('click', () => {
    document.getElementById('chatbot-window').classList.add('chatbot-hidden');
  });
  document.getElementById('chat-send').addEventListener('click', () => {
    const inp = document.getElementById('chat-input');
    sendChat(inp.value);
    inp.value = '';
  });
}
