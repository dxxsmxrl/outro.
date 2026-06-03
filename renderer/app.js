import { db, auth, ref, push, onValue, set, remove, serverTimestamp, off, get,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, updatePassword } from './firebase.js';

const YT_KEY = 'AIzaSyDtbHk4XNsk7ayDF4IyqU5T8idw8BfLV3o';

// ===== STATE =====
let user = null, myName = '', myAvatar = null;
let currentRoom = null, isPlaying = false;
let isSyncing = false, syncTimer = null;
let posTimer = null, lastPos = 0;
let isBrowserHost = false, ignoreBrowserSync = false;
let friends = [], incomingReqs = [];
let selectedFriend = null;
let createSource = 'youtube', createPrivacy = 'public';
let changeSource = 'youtube';
let quickSource = 'youtube', quickPrivacy = 'public';
let activeModal = null;
let ssStream = null;
let theme = 'dark'; // dark | light | monke
let viewerSrc = ''; // track current webview src to prevent reloads
let messagesUnsub = null, participantsUnsub = null;
let syncUnsub = null, roomDataUnsub = null;
let roomsUnsub = null, browserSyncUnsub = null;

// ===== DOM HELPERS =====
const $ = id => document.getElementById(id);
const on = (id, ev, fn) => $(id)?.addEventListener(ev, fn);
const txt = (id, v) => { const e = $(id); if (e) e.textContent = v; };
const show = id => { const e = $(id); if (e) e.style.display = ''; };
const hide = id => { const e = $(id); if (e) e.style.display = 'none'; };
const showFlex = id => { const e = $(id); if (e) e.style.display = 'flex'; };

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escA(s) { return String(s||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ===== SCREENS =====
function screen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`screen-${name}`)?.classList.add('active');
}
function tab(name) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  $(`tab-${name}`)?.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
}

// ===== MODALS =====
function openModal(id) {
  activeModal = id;
  $('modal-overlay').style.display = 'flex';
  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  $(id).style.display = 'flex';
  if (id === 'modal-yt-search') setTimeout(() => $('yt-search-input')?.focus(), 80);
  if (id === 'modal-change-video') setTimeout(() => $('change-yt-input')?.focus(), 80);
}
function closeModal() {
  $('modal-overlay').style.display = 'none';
  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  activeModal = null;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
on('modal-overlay', 'click', e => { if (e.target === $('modal-overlay')) closeModal(); });
document.querySelectorAll('.modal-close').forEach(btn => btn.addEventListener('click', closeModal));

// ===== WINDOW CONTROLS =====
on('btn-minimize', 'click', () => window.electronAPI?.minimize());
on('btn-maximize', 'click', () => window.electronAPI?.maximize());
on('btn-close', 'click', () => window.electronAPI?.close());

// ===== THEME =====
const themes = ['dark', 'light', 'monke'];
const themeLabels = { dark: '◑', light: '☀', monke: '𝑓𝑚' };
function applyTheme(t) {
  theme = t;
  document.body.classList.remove('light', 'monke');
  if (t === 'light') document.body.classList.add('light');
  if (t === 'monke') document.body.classList.add('monke');
  txt('btn-theme', themeLabels[t]);
}
on('btn-theme', 'click', () => {
  const idx = themes.indexOf(theme);
  applyTheme(themes[(idx + 1) % themes.length]);
});

// ===== AUTH =====
onAuthStateChanged(auth, async u => {
  if (u) {
    user = u;
    const snap = await get(ref(db, `users/${u.uid}`));
    const data = snap.val() || {};
    myName = data.name || u.email.split('@')[0];
    myAvatar = data.avatar || null;
    await set(ref(db, `users/${u.uid}/online`), true);
    if (!data.name) await set(ref(db, `users/${u.uid}/name`), myName);
    if (!data.email) await set(ref(db, `users/${u.uid}/email`), u.email);
    initApp();
    screen('main');
  } else {
    user = null;
    screen('onboarding');
  }
});

let isLogin = true;
on('btn-toggle-mode', 'click', () => {
  isLogin = !isLogin;
  txt('auth-mode-label', isLogin ? 'ВХОД' : 'РЕГИСТРАЦИЯ');
  txt('btn-toggle-mode', isLogin ? 'СОЗДАТЬ АККАУНТ' : 'УЖЕ ЕСТЬ АККАУНТ');
  txt('btn-auth', isLogin ? 'ВОЙТИ →' : 'СОЗДАТЬ →');
  $('username-wrap').style.display = isLogin ? 'none' : '';
  txt('auth-error', '');
});
on('btn-auth', 'click', doAuth);
on('input-password', 'keydown', e => { if (e.key === 'Enter') doAuth(); });

async function doAuth() {
  const email = $('input-email').value.trim();
  const pwd = $('input-password').value;
  const uname = $('input-username').value.trim();
  if (!email || !pwd) { txt('auth-error', 'Заполни все поля'); return; }
  if (!isLogin && !uname) { txt('auth-error', 'Придумай ник'); return; }
  txt('auth-error', ''); $('btn-auth').disabled = true; txt('btn-auth', '...');
  try {
    if (isLogin) {
      await signInWithEmailAndPassword(auth, email, pwd);
    } else {
      const c = await createUserWithEmailAndPassword(auth, email, pwd);
      await set(ref(db, `users/${c.user.uid}`), { name: uname, email, online: true });
    }
  } catch(e) {
    txt('auth-error',
      e.code === 'auth/invalid-credential' ? 'Неверный email или пароль' :
      e.code === 'auth/email-already-in-use' ? 'Email уже используется' :
      e.code === 'auth/weak-password' ? 'Минимум 6 символов' :
      e.code === 'auth/invalid-email' ? 'Неверный email' : 'Ошибка. Попробуй снова'
    );
  }
  $('btn-auth').disabled = false;
  txt('btn-auth', isLogin ? 'ВОЙТИ →' : 'СОЗДАТЬ →');
}

on('btn-logout-item', 'click', async () => {
  if (user) await set(ref(db, `users/${user.uid}/online`), false);
  await signOut(auth);
});

// ===== INIT APP =====
function initApp() {
  updateProfileUI();
  loadRooms();
  loadFriends();
  loadIncomingRequests();
}

function updateProfileUI() {
  txt('profile-name', myName);
  txt('profile-avatar', myName[0]?.toUpperCase() || '?');
  txt('sidebar-avatar', myName[0]?.toUpperCase() || '?');
  $('account-name-input').value = myName;
  if (myAvatar) {
    setAvatarImg('profile-avatar-img', myAvatar);
    setAvatarImg('sidebar-avatar-img', myAvatar);
  }
}

function setAvatarImg(elId, dataUrl) {
  const el = $(elId);
  if (!el) return;
  if (dataUrl) {
    el.style.backgroundImage = `url(${dataUrl})`;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

// ===== AVATAR UPLOAD =====
on('sidebar-avatar-wrap', 'click', () => { tab('profile'); });
on('sidebar-avatar', 'click', () => { tab('profile'); });
on('sidebar-avatar-img', 'click', () => { tab('profile'); });
on('btn-edit-avatar', 'click', e => { e.stopPropagation(); $('profile-avatar-input')?.click(); });
['avatar-file-input', 'profile-avatar-input'].forEach(id => {
  on(id, 'change', async e => {
    const file = e.target.files[0];
    if (!file || !user) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const dataUrl = ev.target.result;
      myAvatar = dataUrl;
      await set(ref(db, `users/${user.uid}/avatar`), dataUrl);
      setAvatarImg('profile-avatar-img', dataUrl);
      setAvatarImg('sidebar-avatar-img', dataUrl);
    };
    reader.readAsDataURL(file);
  });
});

// ===== NAV =====
document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => tab(btn.dataset.tab));
});

// ===== ROOMS =====
function loadRooms() {
  if (roomsUnsub) roomsUnsub();
  roomsUnsub = onValue(ref(db, 'rooms'), snap => {
    const data = snap.val();
    const list = $('rooms-list');
    if (!data) {
      txt('rooms-count', '0');
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">▶</div><div class="empty-text">НЕТ АКТИВНЫХ КОМНАТ</div><button class="btn-link" id="btn-cf">СОЗДАТЬ ПЕРВУЮ →</button></div>`;
      on('btn-cf', 'click', () => openModal('modal-quick-create'));
      return;
    }
    const rooms = Object.entries(data).map(([id,v]) => ({id,...v}))
      .filter(r => r.privacy === 'public')
      .sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
    txt('rooms-count', rooms.length);
    list.innerHTML = rooms.map(r => {
      const thumb = r.source === 'youtube' && r.videoId
        ? `<img src="https://img.youtube.com/vi/${r.videoId}/mqdefault.jpg" style="width:100%;height:100%;object-fit:cover;border-radius:6px;" />`
        : `<span style="font-size:22px;color:var(--fg3)">${r.source==='youtube'?'▶':r.source==='twitch'?'◈':r.source==='browser'?'⊞':'▤'}</span>`;
      return `<div class="room-card" data-id="${r.id}">
        <div class="room-card-thumb"><div class="room-card-source">${(r.source||'').toUpperCase()}</div>${thumb}</div>
        <div class="room-card-info">
          <div class="room-card-title">${esc(r.title||'—')}</div>
          <div class="room-card-meta">${esc(r.host||'').toUpperCase()} · ${(r.privacy||'').toUpperCase()}</div>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.room-card').forEach(card => {
      card.addEventListener('click', () => {
        const room = rooms.find(r => r.id === card.dataset.id);
        if (room) enterRoom(room);
      });
    });
  });
}

// ===== PLATFORM BUTTONS =====
document.querySelectorAll('.platform-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    quickSource = btn.dataset.platform;
    const titles = { youtube: 'ПОИСК YOUTUBE', twitch: 'TWITCH', browser: 'БРАУЗЕР', file: 'ФАЙЛ' };
    txt('quick-create-title', titles[quickSource] || 'НОВАЯ КОМНАТА');
    if (quickSource === 'youtube') {
      // open YT search directly
      openModal('modal-yt-search');
      return;
    }
    $('quick-link-section').style.display = (quickSource === 'twitch' || quickSource === 'file') ? '' : 'none';
    if (quickSource === 'twitch') { txt('quick-link-label', 'ССЫЛКА НА КАНАЛ'); $('quick-link-input').placeholder = 'twitch.tv/channel'; }
    if (quickSource === 'file') { txt('quick-link-label', 'ПРЯМАЯ ССЫЛКА НА MP4'); $('quick-link-input').placeholder = 'https://...'; }
    openModal('modal-quick-create');
  });
});

on('btn-create-room', 'click', () => {
  quickSource = 'youtube';
  $('quick-link-section').style.display = 'none';
  txt('quick-create-title', 'НОВАЯ КОМНАТА');
  openModal('modal-yt-search');
});

on('btn-create-first', 'click', () => {
  quickSource = 'youtube';
  openModal('modal-yt-search');
});

// Privacy tabs in quick create
document.querySelectorAll('#modal-quick-create .privacy-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#modal-quick-create .privacy-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    quickPrivacy = btn.dataset.privacy;
  });
});

on('btn-do-quick-create', 'click', async () => {
  if (!user) return;
  const title = $('quick-title-input').value.trim() || 'Новая комната';
  const roomData = { title, source: quickSource, host: myName, privacy: quickPrivacy, createdAt: Date.now() };
  if (quickSource === 'twitch' || quickSource === 'file') {
    const url = $('quick-link-input').value.trim();
    if (!url) return;
    roomData.url = url.startsWith('http') ? url : `https://${url}`;
  }
  if (quickSource === 'browser') {
    // no extra data needed
  }
  const nr = await push(ref(db, 'rooms'), roomData);
  closeModal();
  $('quick-title-input').value = '';
  $('quick-link-input').value = '';
  enterRoom({ id: nr.key, ...roomData });
});

// ===== YT SEARCH =====
on('btn-back-from-yt', 'click', () => closeModal());
on('btn-do-yt-search', 'click', () => ytSearch($('yt-search-input').value));
on('yt-search-input', 'keydown', e => { if (e.key === 'Enter') ytSearch($('yt-search-input').value); });
on('yt-search-input', 'input', () => { $('btn-clear-yt').style.display = $('yt-search-input').value ? '' : 'none'; });
on('btn-clear-yt', 'click', () => {
  $('yt-search-input').value = '';
  $('btn-clear-yt').style.display = 'none';
  $('yt-search-results').innerHTML = '<div class="empty-state"><div class="empty-text">ВВЕДИТЕ ЗАПРОС</div></div>';
});

async function ytSearch(query, forChange = false) {
  if (!query?.trim()) return;
  const el = forChange ? $('change-yt-results') : $('yt-search-results');
  el.innerHTML = '<div class="empty-state"><div class="empty-text">...</div></div>';
  try {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=20&key=${YT_KEY}`);
    const d = await r.json();
    if (!d.items?.length) { el.innerHTML = '<div class="empty-state"><div class="empty-text">НИЧЕГО НЕ НАЙДЕНО</div></div>'; return; }
    el.innerHTML = d.items.map(i => `
      <div class="yt-result" data-vid="${escA(i.id.videoId)}" data-title="${escA(i.snippet.title)}">
        <img class="yt-thumb" src="${i.snippet.thumbnails.medium.url}" loading="lazy" />
        <div><div class="yt-title">${esc(i.snippet.title)}</div><div class="yt-channel">${esc(i.snippet.channelTitle).toUpperCase()}</div></div>
      </div>`).join('');
    el.querySelectorAll('.yt-result').forEach(el => {
      el.addEventListener('click', () => {
        if (forChange) applyChange(el.dataset.vid, el.dataset.title, 'youtube');
        else createWithVideo(el.dataset.vid, el.dataset.title);
      });
    });
  } catch { el.innerHTML = '<div class="empty-state"><div class="empty-text">ОШИБКА ПОИСКА</div></div>'; }
}

async function createWithVideo(videoId, title) {
  if (!user) return;
  const roomData = { title, source: 'youtube', videoId, host: myName, privacy: quickPrivacy, createdAt: Date.now() };
  const nr = await push(ref(db, 'rooms'), roomData);
  closeModal();
  $('yt-search-input').value = '';
  $('yt-search-results').innerHTML = '<div class="empty-state"><div class="empty-text">ВВЕДИТЕ ЗАПРОС</div></div>';
  enterRoom({ id: nr.key, ...roomData });
}

// Home search bar
on('home-search-input', 'click', () => openModal('modal-yt-search'));
on('home-search-input', 'keydown', e => { if (e.key === 'Enter') { openModal('modal-yt-search'); setTimeout(() => { $('yt-search-input').value = $('home-search-input').value; ytSearch($('home-search-input').value); }, 100); } });

// ===== ENTER ROOM =====
function enterRoom(room) {
  // cleanup
  [messagesUnsub, participantsUnsub, syncUnsub, roomDataUnsub, browserSyncUnsub].forEach(u => u?.());
  messagesUnsub = participantsUnsub = syncUnsub = roomDataUnsub = browserSyncUnsub = null;
  clearInterval(posTimer);
  if (ssStream) { ssStream.getTracks().forEach(t => t.stop()); ssStream = null; }

  currentRoom = room;
  isPlaying = false; isBrowserHost = false; lastPos = 0;
  viewerSrc = ''; // reset so viewer loads fresh

  // delete button — only for host
  $('btn-delete-room').style.display = room.host === myName ? '' : 'none';

  // Room data changes (video changes only — not messages/participants)
  roomDataUnsub = onValue(ref(db, `rooms/${room.id}`), snap => {
    const data = snap.val();
    if (!data) { leaveRoom(); return; }
    const oldVideoId = currentRoom.videoId;
    const oldUrl = currentRoom.url;
    const oldSource = currentRoom.source;
    currentRoom = { ...data, id: room.id };
    // Only update viewer if video actually changed
    if (currentRoom.videoId !== oldVideoId || currentRoom.url !== oldUrl || currentRoom.source !== oldSource) {
      viewerSrc = '';
      updateViewer();
    }
  });

  // Messages
  $('chat-messages').innerHTML = '';
  messagesUnsub = onValue(ref(db, `rooms/${room.id}/messages`), snap => {
    const data = snap.val();
    if (!data) { $('chat-messages').innerHTML = ''; return; }
    const msgs = Object.entries(data).map(([id,v]) => ({id,...v})).sort((a,b)=>(a.time||0)-(b.time||0));
    const wasAtBottom = $('chat-messages').scrollHeight - $('chat-messages').scrollTop <= $('chat-messages').clientHeight + 60;
    $('chat-messages').innerHTML = msgs.map(m => {
      const av = m.userAvatar ? `<div class="chat-av" style="background-image:url(${m.userAvatar});background-size:cover;background-position:center"></div>`
        : `<div class="chat-av">${(m.user||'?')[0].toUpperCase()}</div>`;
      const body = m.type === 'image' && m.imageUrl
        ? `<img class="chat-msg-img" src="${m.imageUrl}" />`
        : `<div class="chat-msg-text">${esc(m.text||'')}</div>`;
      return `<div class="chat-msg">${av}<div><div class="chat-msg-user">${esc(m.user||'').toUpperCase()}</div>${body}</div></div>`;
    }).join('');
    if (wasAtBottom) $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
  });

  // Participants
  const pRef = ref(db, `rooms/${room.id}/participants/${user.uid}`);
  set(pRef, { name: myName, joinedAt: Date.now() });
  participantsUnsub = onValue(ref(db, `rooms/${room.id}/participants`), snap => {
    const data = snap.val();
    const list = data ? Object.entries(data).map(([uid,v]) => ({uid,...v})) : [];
    txt('participants-count', list.length);
    txt('modal-parts-count', list.length);
    $('modal-parts-list').innerHTML = list.map(p => `
      <div class="friend-row">
        <div class="avatar">${(p.name||'?')[0].toUpperCase()}</div>
        <div><div class="friend-name">${esc(p.name||'')}</div>${p.name===currentRoom.host?'<div class="friend-sub">ХОСТ</div>':''}</div>
      </div>`).join('');
  });

  // Sync — play/pause + position
  syncUnsub = onValue(ref(db, `rooms/${room.id}/sync`), snap => {
    const data = snap.val();
    if (!data || isSyncing) return;
    applySync(data);
  });

  // Position broadcast every 5s
  posTimer = setInterval(async () => {
    if (!currentRoom || !isPlaying) return;
    const wv = $('main-webview');
    if (wv && wv.style.display !== 'none') {
      try {
        const t = await wv.executeJavaScript('document.querySelector("video")?.currentTime || 0');
        if (typeof t === 'number') lastPos = t;
      } catch {}
    }
    if (!isSyncing) syncFirebase(true, lastPos);
  }, 5000);

  updateViewer();
  screen('room');
}

function updateViewer() {
  if (!currentRoom) return;
  const wv = $('main-webview');
  const bwv = $('browser-webview');
  const ph = $('viewer-placeholder');
  const bb = $('browser-bar');
  const pc = $('player-controls');
  const ssv = $('ss-video');

  wv.style.display = 'none';
  bwv.style.display = 'none';
  ph.style.display = 'none';
  if (bb) bb.style.display = 'none';
  pc.style.display = 'none';
  if (ssv) ssv.style.display = 'none';

  if (currentRoom.source === 'youtube' && currentRoom.videoId) {
    const src = `https://www.youtube.com/watch?v=${currentRoom.videoId}&autoplay=1`;
    if (viewerSrc !== src) { wv.setAttribute('src', src); viewerSrc = src; }
    wv.style.display = '';
    pc.style.display = '';
    txt('room-video-title', currentRoom.title || '');
  } else if (currentRoom.source === 'browser') {
    bwv.style.display = '';
    if (bb) { bb.style.display = 'flex'; }
    setupBrowserSync();
  } else if (currentRoom.url) {
    const src = currentRoom.url;
    if (viewerSrc !== src) { wv.setAttribute('src', src); viewerSrc = src; }
    wv.style.display = '';
    pc.style.display = '';
    txt('room-video-title', currentRoom.title || '');
  } else {
    ph.style.display = '';
  }
}

// ===== SYNC =====
async function syncFirebase(playing, pos = 0) {
  if (!currentRoom) return;
  isSyncing = true; clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { isSyncing = false; }, 1500);
  isPlaying = playing;
  updatePlayBtn();
  await set(ref(db, `rooms/${currentRoom.id}/sync`), { playing, position: pos, ts: Date.now() });
}

function applySync(data) {
  isPlaying = data.playing;
  updatePlayBtn();
  const wv = $('main-webview');
  if (wv && wv.style.display !== 'none') {
    try {
      if (data.playing) wv.executeJavaScript('document.querySelector("video")?.play()').catch(()=>{});
      else wv.executeJavaScript('document.querySelector("video")?.pause()').catch(()=>{});
      if (data.position !== undefined && Math.abs(lastPos - data.position) > 8) {
        wv.executeJavaScript(`document.querySelector("video") && (document.querySelector("video").currentTime = ${data.position})`).catch(()=>{});
        lastPos = data.position;
      }
    } catch {}
  }
}

function updatePlayBtn() { txt('btn-play-pause', isPlaying ? '⏸ ПАУЗА' : '▶ ИГРАТЬ'); }

on('btn-play-pause', 'click', () => {
  const newPlaying = !isPlaying;
  syncFirebase(newPlaying, lastPos);
  const wv = $('main-webview');
  if (wv && wv.style.display !== 'none') {
    try {
      if (newPlaying) wv.executeJavaScript('document.querySelector("video")?.play()').catch(()=>{});
      else wv.executeJavaScript('document.querySelector("video")?.pause()').catch(()=>{});
    } catch {}
  }
});

// Get position periodically
setInterval(() => {
  const wv = $('main-webview');
  if (wv && wv.style.display !== 'none' && isPlaying) {
    wv.executeJavaScript('document.querySelector("video")?.currentTime || 0')
      .then(t => { if (typeof t === 'number') lastPos = t; }).catch(()=>{});
  }
}, 2000);

// ===== BROWSER =====
function setupBrowserSync() {
  if (browserSyncUnsub) { browserSyncUnsub(); browserSyncUnsub = null; }
  if (!currentRoom) return;
  browserSyncUnsub = onValue(ref(db, `rooms/${currentRoom.id}/browserUrl`), snap => {
    const data = snap.val();
    if (!data || ignoreBrowserSync) return;
    const bwv = $('browser-webview');
    if (bwv && data.url && bwv.getAttribute('src') !== data.url) {
      bwv.setAttribute('src', data.url);
      $('browser-address').value = data.url;
    }
  });
  const bwv = $('browser-webview');
  if (bwv) {
    const navHandler = e => {
      $('browser-address').value = e.url;
      if (isBrowserHost && currentRoom) syncBrowserUrl(e.url);
    };
    bwv.addEventListener('did-navigate', navHandler);
    bwv.addEventListener('did-navigate-in-page', navHandler);
  }
}

async function syncBrowserUrl(url) {
  if (!currentRoom || !user) return;
  ignoreBrowserSync = true;
  setTimeout(() => { ignoreBrowserSync = false; }, 1000);
  await set(ref(db, `rooms/${currentRoom.id}/browserUrl`), { url, uid: user.uid, ts: Date.now() });
}

function navBrowser(input) {
  let url = input.trim();
  if (!url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = url.includes('.') && !url.includes(' ') ? `https://${url}` : `https://www.google.com/search?q=${encodeURIComponent(url)}&gl=us&hl=en`;
  }
  isBrowserHost = true;
  $('browser-webview').setAttribute('src', url);
  $('browser-address').value = url;
  syncBrowserUrl(url);
}

on('btn-browser-go', 'click', () => navBrowser($('browser-address').value));
on('browser-address', 'keydown', e => { if (e.key === 'Enter') { isBrowserHost = true; navBrowser($('browser-address').value); } });
on('btn-browser-back', 'click', () => { isBrowserHost = true; $('browser-webview')?.goBack?.(); });
on('btn-browser-forward', 'click', () => { isBrowserHost = true; $('browser-webview')?.goForward?.(); });
on('btn-browser-refresh', 'click', () => $('browser-webview')?.reload?.());

// ===== LEAVE / DELETE ROOM =====
on('btn-leave-room', 'click', leaveRoom);
function leaveRoom() {
  clearInterval(posTimer);
  if (currentRoom && user) remove(ref(db, `rooms/${currentRoom.id}/participants/${user.uid}`));
  [messagesUnsub, participantsUnsub, syncUnsub, roomDataUnsub, browserSyncUnsub].forEach(u => u?.());
  messagesUnsub = participantsUnsub = syncUnsub = roomDataUnsub = browserSyncUnsub = null;
  if (ssStream) { ssStream.getTracks().forEach(t => t.stop()); ssStream = null; }
  const wv = $('main-webview');
  if (wv) { wv.setAttribute('src', 'about:blank'); wv.style.display = 'none'; viewerSrc = ''; }
  const bwv = $('browser-webview');
  if (bwv) { bwv.style.display = 'none'; }
  currentRoom = null; isPlaying = false;
  screen('main');
}

on('btn-delete-room', 'click', async () => {
  if (!currentRoom || !user) return;
  if (currentRoom.host !== myName) { alert('Только хост может удалить комнату'); return; }
  if (!confirm('Удалить комнату?')) return;
  const id = currentRoom.id;
  leaveRoom();
  await remove(ref(db, `rooms/${id}`));
});

// ===== CHANGE VIDEO =====
on('btn-change-video', 'click', () => {
  // reset tabs
  document.querySelectorAll('#change-source-tabs .source-tab').forEach(b => b.classList.remove('active'));
  document.querySelector('#change-source-tabs .source-tab').classList.add('active');
  changeSource = 'youtube';
  $('change-yt-section').style.display = '';
  $('change-link-section').style.display = 'none';
  $('change-browser-section').style.display = 'none';
  openModal('modal-change-video');
});

document.querySelectorAll('#change-source-tabs .source-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#change-source-tabs .source-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    changeSource = btn.dataset.source;
    $('change-yt-section').style.display = changeSource === 'youtube' ? '' : 'none';
    $('change-link-section').style.display = (changeSource === 'twitch' || changeSource === 'file') ? '' : 'none';
    $('change-browser-section').style.display = changeSource === 'browser' ? '' : 'none';
    if (changeSource === 'twitch') { txt('change-link-label', 'ССЫЛКА НА КАНАЛ'); $('change-link-input').placeholder = 'twitch.tv/channel'; }
    if (changeSource === 'file') { txt('change-link-label', 'ПРЯМАЯ ССЫЛКА'); $('change-link-input').placeholder = 'https://...'; }
  });
});

on('btn-change-yt-search', 'click', () => ytSearch($('change-yt-input').value, true));
on('change-yt-input', 'keydown', e => { if (e.key === 'Enter') ytSearch($('change-yt-input').value, true); });
on('btn-apply-link', 'click', () => { const url = $('change-link-input').value.trim(); if (url) applyChange(undefined, undefined, changeSource, url); });
on('btn-apply-browser', 'click', () => applyChange(undefined, undefined, 'browser'));

async function applyChange(videoId, title, source, url) {
  if (!currentRoom) return;
  const src = source || changeSource;
  const updates = { ...currentRoom, source: src };
  if (title) updates.title = title;
  if (src === 'browser') { delete updates.videoId; delete updates.url; isBrowserHost = true; }
  else if (videoId) { updates.videoId = videoId; delete updates.url; }
  else if (url) { updates.url = url.startsWith('http') ? url : `https://${url}`; delete updates.videoId; }
  await set(ref(db, `rooms/${currentRoom.id}`), updates);
  await set(ref(db, `rooms/${currentRoom.id}/sync`), { playing: false, position: 0, ts: Date.now() });
  isPlaying = false;
  closeModal();
  $('change-yt-input').value = ''; $('change-yt-results').innerHTML = '';
  $('change-link-input').value = '';
}

// ===== SCREENSHARE =====
on('btn-screenshare', 'click', async () => {
  const sources = await window.electronAPI?.getSources();
  if (!sources) return;
  $('ss-sources').innerHTML = sources.map(s => `
    <div class="ss-item" data-id="${escA(s.id)}">
      <img class="ss-thumb" src="${s.thumbnail}" />
      <div class="ss-name">${esc(s.name)}</div>
    </div>`).join('');
  $('ss-sources').querySelectorAll('.ss-item').forEach(el => {
    el.addEventListener('click', () => startScreenshare(el.dataset.id));
  });
  openModal('modal-screenshare');
});

async function startScreenshare(sourceId) {
  try {
    if (ssStream) ssStream.getTracks().forEach(t => t.stop());
    ssStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } }
    });
    $('main-webview').style.display = 'none';
    $('browser-webview').style.display = 'none';
    $('viewer-placeholder').style.display = 'none';
    let ssv = $('ss-video');
    if (!ssv) {
      ssv = document.createElement('video');
      ssv.id = 'ss-video';
      ssv.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;';
      ssv.autoplay = true;
      $('viewer-area').appendChild(ssv);
    }
    ssv.srcObject = ssStream;
    ssv.style.display = '';
    ssStream.getVideoTracks()[0].onended = () => { if (ssStream) { ssStream.getTracks().forEach(t=>t.stop()); ssStream=null; } updateViewer(); };
    closeModal();
  } catch { alert('Не удалось запустить screen share. Проверь разрешения в системных настройках.'); }
}

// ===== PARTICIPANTS & INVITE =====
on('btn-participants', 'click', () => openModal('modal-participants'));
on('btn-invite', 'click', () => openModal('modal-invite'));
on('btn-copy-invite', 'click', () => {
  navigator.clipboard.writeText('https://outro-web-znla.vercel.app');
  txt('btn-copy-invite', 'СКОПИРОВАНО ✓');
  setTimeout(() => txt('btn-copy-invite', 'КОПИРОВАТЬ'), 2000);
});

// ===== CHAT =====
on('btn-send', 'click', sendMsg);
on('chat-input', 'keydown', e => { if (e.key === 'Enter') sendMsg(); });

async function sendMsg() {
  const msg = $('chat-input').value.trim();
  if (!msg || !currentRoom || !user) return;
  await push(ref(db, `rooms/${currentRoom.id}/messages`), {
    user: myName, userAvatar: myAvatar || null,
    text: msg, type: 'text', time: serverTimestamp()
  });
  $('chat-input').value = '';
}

on('btn-send-image', 'click', () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async e => {
    const file = e.target.files[0];
    if (!file || !currentRoom) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      await push(ref(db, `rooms/${currentRoom.id}/messages`), {
        user: myName, userAvatar: myAvatar || null,
        imageUrl: ev.target.result, type: 'image', time: serverTimestamp()
      });
    };
    reader.readAsDataURL(file);
  };
  inp.click();
});

// ===== FRIENDS =====
function loadFriends() {
  if (!user) return;
  onValue(ref(db, `users/${user.uid}/friends`), snap => {
    const data = snap.val();
    friends = data ? Object.entries(data).map(([uid,v]) => ({uid,...v})) : [];
    txt('friends-count', friends.length);
    txt('stat-friends', friends.length);
    renderFriends();
  });
}

function loadIncomingRequests() {
  if (!user) return;
  onValue(ref(db, `users/${user.uid}/friendRequests/incoming`), snap => {
    const data = snap.val();
    incomingReqs = data ? Object.entries(data).map(([id,v])=>({id,...v})).filter(r=>r.status==='pending') : [];
    $('friends-badge').style.display = incomingReqs.length > 0 ? '' : 'none';
    renderIncoming();
  });
}

function renderFriends() {
  const el = $('friends-list');
  if (!friends.length) { el.innerHTML = '<div class="empty-state"><div class="empty-text">ПОКА НИКОГО</div></div>'; return; }
  el.innerHTML = friends.map(f => {
    const av = f.avatar
      ? `<div class="avatar" style="background-image:url(${f.avatar});background-size:cover;background-position:center"></div>`
      : `<div class="avatar">${(f.name||'?')[0].toUpperCase()}</div>`;
    return `<div class="friend-row" data-uid="${f.uid}">${av}<div><div class="friend-name">${esc(f.name||'')}</div><div class="friend-sub">ОНЛАЙН</div></div><span style="color:var(--fg3)">→</span></div>`;
  }).join('');
  el.querySelectorAll('.friend-row').forEach(row => {
    row.addEventListener('click', () => {
      const f = friends.find(f => f.uid === row.dataset.uid);
      if (f) openFriendProfile(f);
    });
  });
}

function renderIncoming() {
  const sec = $('incoming-section');
  const list = $('incoming-list');
  if (!incomingReqs.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  txt('requests-count', incomingReqs.length);
  list.innerHTML = incomingReqs.map(r => `
    <div class="friend-row">
      <div class="avatar">${(r.fromName||'?')[0].toUpperCase()}</div>
      <div style="flex:1"><div class="friend-name">${esc(r.fromName||'')}</div><div class="friend-sub">ХОЧЕТ ДОБАВИТЬ ВАС</div></div>
      <div style="display:flex;gap:6px">
        <button class="btn-accept" data-uid="${r.fromUid}" data-name="${escA(r.fromName)}">ОК</button>
        <button class="btn-sm" data-dec="${r.fromUid}">✕</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('.btn-accept').forEach(btn => btn.addEventListener('click', () => acceptReq(btn.dataset.uid, btn.dataset.name)));
  list.querySelectorAll('[data-dec]').forEach(btn => btn.addEventListener('click', () => declineReq(btn.dataset.dec)));
}

async function acceptReq(fromUid, fromName) {
  await set(ref(db, `users/${user.uid}/friends/${fromUid}`), { uid: fromUid, name: fromName });
  await set(ref(db, `users/${fromUid}/friends/${user.uid}`), { uid: user.uid, name: myName, avatar: myAvatar || null });
  await remove(ref(db, `users/${user.uid}/friendRequests/incoming/${fromUid}`));
}

async function declineReq(fromUid) {
  await remove(ref(db, `users/${user.uid}/friendRequests/incoming/${fromUid}`));
}

on('btn-search-users', 'click', searchUsers);
on('friends-search-input', 'keydown', e => { if (e.key === 'Enter') searchUsers(); });

async function searchUsers() {
  const q = $('friends-search-input').value.trim().toLowerCase();
  if (!q) return;
  const snap = await get(ref(db, 'users'));
  const data = snap.val();
  const sec = $('search-results-section');
  const list = $('search-results-list');
  if (!data) { sec.style.display = 'none'; return; }
  const results = Object.entries(data)
    .filter(([uid, v]) => uid !== user.uid && v.name?.toLowerCase().includes(q))
    .map(([uid, v]) => ({ uid, ...v }));
  if (!results.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  list.innerHTML = results.map(u => {
    const isFriend = friends.some(f => f.uid === u.uid);
    const av = u.avatar
      ? `<div class="avatar" style="background-image:url(${u.avatar});background-size:cover;background-position:center"></div>`
      : `<div class="avatar">${(u.name||'?')[0].toUpperCase()}</div>`;
    return `<div class="friend-row" data-uid="${u.uid}">
      ${av}
      <div style="flex:1"><div class="friend-name">${esc(u.name||'')}</div></div>
      ${isFriend ? '<span style="color:var(--fg3);font-size:9px;font-family:var(--mono);letter-spacing:1px">ДРУГ</span>'
        : `<button class="btn-sm" data-add="${u.uid}" data-aname="${escA(u.name)}">+</button>`}
    </div>`;
  }).join('');
  list.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); sendFriendReq(btn.dataset.add, btn.dataset.aname); });
  });
  list.querySelectorAll('.friend-row').forEach(row => {
    row.addEventListener('click', () => {
      const u = results.find(r => r.uid === row.dataset.uid);
      if (u) openFriendProfile(u);
    });
  });
}

async function sendFriendReq(toUid, toName) {
  await set(ref(db, `users/${toUid}/friendRequests/incoming/${user.uid}`), {
    fromUid: user.uid, fromName: myName, status: 'pending', ts: Date.now()
  });
  alert(`Запрос отправлен ${toName}`);
}

function openFriendProfile(friend) {
  selectedFriend = friend;
  const isFriend = friends.some(f => f.uid === friend.uid);
  txt('fp-avatar', (friend.name||'?')[0].toUpperCase());
  txt('fp-name', friend.name || '');
  if (friend.avatar) {
    $('fp-avatar-img').style.backgroundImage = `url(${friend.avatar})`;
    $('fp-avatar-img').style.display = '';
  } else {
    $('fp-avatar-img').style.display = 'none';
  }
  $('btn-add-friend').style.display = isFriend ? 'none' : '';
  $('fp-already').style.display = isFriend ? '' : 'none';
  openModal('modal-friend-profile');
}

on('btn-add-friend', 'click', () => {
  if (selectedFriend) sendFriendReq(selectedFriend.uid, selectedFriend.name);
  closeModal();
});

// ===== ACCOUNT =====
on('settings-account-item', 'click', () => {
  $('account-name-input').value = myName;
  openModal('modal-account');
});
on('btn-save-name', 'click', async () => {
  const name = $('account-name-input').value.trim();
  if (!name || !user) return;
  await set(ref(db, `users/${user.uid}/name`), name);
  myName = name;
  updateProfileUI();
  txt('btn-save-name', 'СОХРАНЕНО ✓');
  setTimeout(() => txt('btn-save-name', 'СОХРАНИТЬ НИК'), 2000);
});
on('btn-save-pwd', 'click', async () => {
  const pwd = $('account-pwd-input').value;
  if (!pwd || pwd.length < 6) { alert('Минимум 6 символов'); return; }
  try {
    await updatePassword(user, pwd);
    $('account-pwd-input').value = '';
    txt('btn-save-pwd', 'СОХРАНЕНО ✓');
    setTimeout(() => txt('btn-save-pwd', 'СОХРАНИТЬ ПАРОЛЬ'), 2000);
  } catch { alert('Войди заново и попробуй снова'); }
});