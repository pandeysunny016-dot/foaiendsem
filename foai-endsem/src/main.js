// ===== Mission Control Dashboard — Main Entry =====
import './style.css';
import L from 'leaflet';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

// ===== CONFIG =====
const CONFIG = {
  // Primary stable API with Fallback
  ISS_API: 'https://api.wheretheiss.at/v1/satellites/25544',
  ISS_API_FALLBACK: 'https://api.allorigins.win/get?url=' + encodeURIComponent('http://api.open-notify.org/iss-now.json'),
  
  ASTROS_API: 'https://api.allorigins.win/get?url=' + encodeURIComponent('http://api.open-notify.org/astros.json'),
  NEWS_API: 'https://newsdata.io/api/1/news',
  NEWS_API_KEY: import.meta.env.VITE_NEWS_API_KEY || '',
  HF_API: 'https://router.huggingface.co/v1/chat/completions',
  HF_TOKEN: import.meta.env.VITE_HF_TOKEN || '',
  HF_MODEL: 'Qwen/Qwen3-0.6B:featherless-ai',
  
  ISS_INTERVAL_MS: 15000,
  NEWS_CACHE_MINUTES: 15,
  MAX_POSITIONS: 15,
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
//   ISS TRACKING
// =====================
async function fetchISSPosition() {
  let data = null;
  let lat, lng, ts, velocity;

  try {
    // Try primary HTTPS API (Very reliable)
    const res = await fetch(CONFIG.ISS_API, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      data = await res.json();
      lat = parseFloat(data.latitude);
      lng = parseFloat(data.longitude);
      ts  = data.timestamp * 1000;
      velocity = data.velocity || 0;
    } else {
      throw new Error('Primary API failed');
    }
  } catch (e) {
    console.warn('Switching to Fallback API...', e);
    try {
      // Try Fallback (Open Notify via Proxy)
      const res = await fetch(CONFIG.ISS_API_FALLBACK, { signal: AbortSignal.timeout(8000) });
      const wrapper = await res.json();
      const raw = JSON.parse(wrapper.contents);
      lat = parseFloat(raw.iss_position.latitude);
      lng = parseFloat(raw.iss_position.longitude);
      ts  = raw.timestamp * 1000;
      velocity = 0;
    } catch (err) {
      console.error('All ISS APIs failed:', err);
      showToast('ISS Connection Error — Retrying...', 'error');
      setText('iss-coords', 'Connection Error');
      return;
    }
  }

  // Speed Calculation (Haversine)
  if (state.lastPos && state.lastTime) {
    const dt = (ts - state.lastTime) / 1000; // seconds
    if (dt > 0) {
      const dist = haversine(state.lastPos.lat, state.lastPos.lng, lat, lng);
      state.currentSpeed = (dist / dt) * 3600; // km/h
    }
  } else {
    state.currentSpeed = velocity || 27600; // Default orbit speed if first point
  }

  // Update Data
  if (state.issSpeeds.length >= CONFIG.MAX_SPEED_POINTS) {
    state.issSpeeds.shift(); state.speedTimestamps.shift();
  }
  state.issSpeeds.push(+state.currentSpeed.toFixed(2));
  state.speedTimestamps.push(new Date(ts).toLocaleTimeString());
  updateSpeedChart();

  state.lastPos  = { lat, lng };
  state.lastTime = ts;

  state.issPositions.push([lat, lng]);
  if (state.issPositions.length > CONFIG.MAX_POSITIONS) state.issPositions.shift();

  updateISSUI(lat, lng);
  updateMap(lat, lng);
  reverseGeocode(lat, lng);
}

function updateISSUI(lat, lng) {
  setText('iss-coords', `${lat.toFixed(3)}, ${lng.toFixed(3)}`);
  setText('iss-speed',  `${state.currentSpeed.toFixed(0)} km/h`);
  setText('iss-tracked', state.issPositions.length);
  setText('iss-location', state.nearestPlace);
}

function updateMap(lat, lng) {
  state.issMarker.setLatLng([lat, lng]);
  state.issMarker.setPopupContent(
    `<b>ISS Live</b><br>Lat: ${lat.toFixed(4)}<br>Lng: ${lng.toFixed(4)}<br>Speed: ${state.currentSpeed.toFixed(0)} km/h`
  );
  state.issPath.setLatLngs(state.issPositions);
  state.map.panTo([lat, lng], { animate: true });
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=5`);
    const d = await res.json();
    state.nearestPlace = d.address?.country || d.address?.ocean || 'Remote Area';
  } catch {
    state.nearestPlace = 'Ocean / Unknown';
  }
  setText('iss-location', state.nearestPlace);
}

// Haversine
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const rad = d => d * Math.PI / 180;

// =====================
//   ASTRONAUTS
// =====================
async function fetchAstronauts() {
  try {
    const res = await fetch(CONFIG.ASTROS_API);
    const wrapper = await res.json();
    const data = JSON.parse(wrapper.contents);
    state.astronauts = data.people || [];
    setText('astro-count', data.number || state.astronauts.length);
    renderAstronauts();
  } catch (e) {
    state.astronauts = [{ name: 'Oleg Kononenko', craft: 'ISS' }, { name: 'Tracy Caldwell Dyson', craft: 'ISS' }];
    renderAstronauts();
  }
}

function renderAstronauts() {
  const list = document.getElementById('astronauts-list');
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
        description: a.description || 'No summary available.',
        url: a.link,
        category: a.category?.[0] || 'general'
      }));
      renderNews();
      updateNewsChart();
    }
  } catch (e) {
    console.error('News Error:', e);
  }
}

function renderNews() {
  const list = document.getElementById('news-list');
  list.innerHTML = state.news.map((a, i) => `
    <div class="news-item" onclick="toggleArticle(${i})">
      <div class="news-item-header">
        <div class="news-num">${i + 1}</div>
        <img class="news-thumb" src="${a.image || 'https://placehold.co/40x40?text=ISS'}" />
        <div class="news-body">
          <div class="news-meta">
            <span class="news-source">${a.source}</span>
            <span class="news-date">${new Date(a.date).toLocaleDateString()}</span>
          </div>
          <div class="news-title">${a.title}</div>
        </div>
      </div>
      <div class="news-expand" id="news-expand-${i}">
        <p class="news-desc">${a.description}</p>
        <a href="${a.url}" target="_blank" class="btn btn-primary">Read More</a>
      </div>
    </div>`).join('');
}

window.toggleArticle = (i) => {
  document.getElementById(`news-expand-${i}`).classList.toggle('news-expand--open');
};

// =====================
//   MAP & CHARTS INIT
// =====================
function initMap() {
  state.map = L.map('iss-map', { center: [0, 0], zoom: 2 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(state.map);
  const icon = L.divIcon({ html: '<div style="font-size:30px;">🛰️</div>', iconSize: [30, 30] });
  state.issMarker = L.marker([0, 0], { icon }).addTo(state.map).bindPopup('Calculating...');
  state.issPath = L.polyline([], { color: '#e28743' }).addTo(state.map);
}

function initCharts() {
  const sCtx = document.getElementById('speed-chart').getContext('2d');
  state.speedChart = new Chart(sCtx, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Speed (km/h)', data: [], borderColor: '#e28743', fill: true, backgroundColor: 'rgba(226,135,67,0.1)' }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: false } } }
  });

  const nCtx = document.getElementById('news-chart').getContext('2d');
  state.newsChart = new Chart(nCtx, {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: ['#e28743', '#3498db', '#2ecc71'] }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function updateSpeedChart() {
  state.speedChart.data.labels = state.speedTimestamps;
  state.speedChart.data.datasets[0].data = state.issSpeeds;
  state.speedChart.update('none');
}

function updateNewsChart() {
  const c = {}; state.news.forEach(a => c[a.category] = (c[a.category] || 0) + 1);
  state.newsChart.data.labels = Object.keys(c);
  state.newsChart.data.datasets[0].data = Object.values(c);
  state.newsChart.update();
}

// =====================
//   HELPERS & THEME
// =====================
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function showToast(msg, type) {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function bindEvents() {
  document.getElementById('theme-toggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
  });
  document.getElementById('iss-refresh-btn').addEventListener('click', fetchISSPosition);
  document.getElementById('news-refresh-btn').addEventListener('click', fetchNews);
  document.getElementById('chatbot-toggle').addEventListener('click', () => {
    document.getElementById('chatbot-window').classList.toggle('chatbot-hidden');
  });
}

loadChatHistory = () => {}; // Stub for now
