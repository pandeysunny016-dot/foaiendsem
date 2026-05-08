// ===== Mission Control Dashboard — Bulletproof Entry =====
import './style.css';
import L from 'leaflet';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

const CONFIG = {
  // Use HTTPS Primary (Most stable)
  ISS_API: 'https://api.wheretheiss.at/v1/satellites/25544',
  ISS_API_ALT: 'https://api.allorigins.win/get?url=' + encodeURIComponent('http://api.open-notify.org/iss-now.json'),
  ASTROS_API: 'https://api.allorigins.win/get?url=' + encodeURIComponent('http://api.open-notify.org/astros.json'),
  NEWS_API: 'https://newsdata.io/api/1/news',
  NEWS_API_KEY: import.meta.env.VITE_NEWS_API_KEY || 'pub_da26954bfd324eefb5b78437b8fafd67',
  HF_API: 'https://router.huggingface.co/v1/chat/completions',
  HF_TOKEN: import.meta.env.VITE_HF_TOKEN || '',
  HF_MODEL: 'Qwen/Qwen3-0.6B:featherless-ai',
  INTERVAL: 15000,
};

const state = {
  pos: [],
  speeds: [],
  times: [],
  last: null,
  speed: 0,
  place: 'Remote Area',
  astronauts: [],
  news: [],
  map: null,
  marker: null,
  path: null,
  charts: {},
};

// =====================
//   INITIALIZATION
// =====================
window.addEventListener('load', async () => {
  try {
    console.log('Initializing Mission Control...');
    initTheme();
    initMap();
    initCharts();
    
    // Initial Fetch
    fetchISS();
    fetchAstros();
    fetchNews();

    setInterval(fetchISS, CONFIG.INTERVAL);
    bindEvents();
    console.log('Mission Control Ready.');
  } catch (err) {
    console.error('Boot Error:', err);
  }
});

// =====================
//   ISS TRACKING
// =====================
async function fetchISS() {
  let lat, lng, ts;
  try {
    const res = await fetch(CONFIG.ISS_API);
    const data = await res.json();
    lat = data.latitude;
    lng = data.longitude;
    ts = data.timestamp * 1000;
  } catch (e) {
    try {
      const res = await fetch(CONFIG.ISS_API_ALT);
      const wrapper = await res.json();
      const raw = JSON.parse(wrapper.contents);
      lat = parseFloat(raw.iss_position.latitude);
      lng = parseFloat(raw.iss_position.longitude);
      ts = raw.timestamp * 1000;
    } catch (err) {
      updateUI('Offline');
      return;
    }
  }

  // Speed (Haversine)
  if (state.last) {
    const d = haversine(state.last.lat, state.last.lng, lat, lng);
    const t = (ts - state.last.ts) / 1000;
    if (t > 0) state.speed = (d / t) * 3600;
  } else {
    state.speed = 27600;
  }

  state.last = { lat, lng, ts };
  state.pos.push([lat, lng]);
  if (state.pos.length > 20) state.pos.shift();

  // Update Stats
  state.speeds.push(state.speed);
  state.times.push(new Date(ts).toLocaleTimeString());
  if (state.speeds.length > 30) { state.speeds.shift(); state.times.shift(); }

  updateUI(lat, lng);
  updateMap(lat, lng);
  updateCharts();
}

function updateUI(lat, lng) {
  if (lat === 'Offline') {
    setText('iss-coords', 'Offline');
    setText('iss-speed', 'Offline');
    return;
  }
  setText('iss-coords', `${lat.toFixed(2)}, ${lng.toFixed(2)}`);
  setText('iss-speed', `${state.speed.toFixed(0)} km/h`);
  setText('iss-location', state.place);
  setText('iss-tracked', state.pos.length);
}

function updateMap(lat, lng) {
  if (!state.map) return;
  state.marker.setLatLng([lat, lng]);
  state.path.setLatLngs(state.pos);
  state.map.panTo([lat, lng]);
  state.marker.setPopupContent(`<b>ISS Live</b><br>${state.speed.toFixed(0)} km/h`);
}

// =====================
//   ASTRONAUTS & NEWS
// =====================
async function fetchAstros() {
  try {
    const res = await fetch(CONFIG.ASTROS_API);
    const wrapper = await res.json();
    const data = JSON.parse(wrapper.contents);
    state.astronauts = data.people || [];
    setText('astro-count', state.astronauts.length);
    renderAstros();
  } catch (e) {
    state.astronauts = [{name: 'Space Mission Active', craft: 'ISS'}];
    renderAstros();
  }
}

function renderAstros() {
  const el = document.getElementById('astronauts-list');
  if (!el) return;
  el.innerHTML = state.astronauts.map(a => `
    <div class="astronaut-item">
      <div class="astronaut-avatar">${a.name[0]}</div>
      <div class="astronaut-info">
        <div class="astronaut-name">${a.name}</div>
        <div class="astronaut-craft">${a.craft}</div>
      </div>
    </div>`).join('');
}

async function fetchNews() {
  try {
    const res = await fetch(`${CONFIG.NEWS_API}?apikey=${CONFIG.NEWS_API_KEY}&language=en&size=10`);
    const data = await res.json();
    if (data.status === 'success') {
      state.news = data.results;
      renderNews();
    }
  } catch (e) {
    const el = document.getElementById('news-list');
    if (el) el.innerHTML = '<p>News temporarily unavailable.</p>';
  }
}

function renderNews() {
  const el = document.getElementById('news-list');
  if (!el) return;
  el.innerHTML = state.news.map((a, i) => `
    <div class="news-item">
      <div class="news-item-header">
        <div class="news-num">${i+1}</div>
        <div class="news-body">
          <div class="news-meta"><span class="news-source">${a.source_id}</span></div>
          <div class="news-title">${a.title}</div>
        </div>
      </div>
    </div>`).join('');
}

// =====================
//   CORE UTILS
// =====================
function initMap() {
  const el = document.getElementById('iss-map');
  if (!el) return;
  state.map = L.map('iss-map').setView([0, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(state.map);
  state.marker = L.marker([0, 0]).addTo(state.map).bindPopup('ISS');
  state.path = L.polyline([], {color: '#e28743'}).addTo(state.map);
}

function initCharts() {
  const ctxEl = document.getElementById('speed-chart');
  if (!ctxEl) return;
  const ctx = ctxEl.getContext('2d');
  state.charts.speed = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'km/h', data: [], borderColor: '#e28743', fill: true }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function updateCharts() {
  if (!state.charts.speed) return;
  state.charts.speed.data.labels = state.times;
  state.charts.speed.data.datasets[0].data = state.speeds;
  state.charts.speed.update('none');
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function initTheme() {
  document.documentElement.setAttribute('data-theme', localStorage.getItem('theme') || 'dark');
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function bindEvents() {
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem('theme', t);
    });
  }
  const refreshBtn = document.getElementById('iss-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', fetchISS);
}
