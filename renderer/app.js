import { db, auth, ref, push, onValue, set, remove, serverTimestamp, get,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, updatePassword } from './firebase.js';

const YT_KEY = 'AIzaSyDtbHk4XNsk7ayDF4IyqU5T8idw8BfLV3o';

// ===== STATE =====
let user = null, myName = '', myAvatar = null;
let currentRoom = null, isPlaying = false;
let posTimer = null, lastPos = 0;
let isBrowserHost = false, ignoreBrowserSync = false;
let friends = [], incomingReqs = [];
let selectedFriend = null;
let changeSource = 'youtube';
let quickSource = 'youtube', quickPrivacy = 'public';
let activeModal = null;
let ssStream = null;
let theme = 'dark';
let viewerSrc = '';
let messagesUnsub = null, participantsUnsub = null;
let syncUnsub = null, roomDataUnsub = null;
let roomsUnsub = null, browserSyncUnsub = null;
let typingTimer = null, typingUnsub = null, queueUnsub = null;
let notifsUnsub = null;
let commandUnsub = null;
let unreadNotifs = 0;
let isHost = false;
let ignoreSyncUntil = 0; // timestamp до которого игнорируем входящий sync

// ===== DOM HELPERS =====
const $ = id => document.getElementById(id);
const on = (id, ev, fn) => $(id)?.addEventListener(ev, fn);
const txt = (id, v) => { const e = $(id); if (e) e.textContent = v; };

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
  if (name === 'notifications') markNotifsRead();
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
const themeLabels = { dark: '', light: '', warm: '' };
function applyTheme(t) {
  theme = t;
  document.body.classList.remove('light', 'monke');
  if (t === 'light') document.body.classList.add('light');
  if (t === 'monke') document.body.classList.add('monke');
  
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
  txt('auth-mode-label', isLogin ? 'Sign in' : 'Create account');
  txt('btn-toggle-mode', isLogin ? 'Create account' : 'Already have an account');
  txt('btn-auth', isLogin ? 'Sign in →' : 'Create →');
  $('username-wrap').style.display = isLogin ? 'none' : '';
  txt('auth-error', '');
});
on('btn-auth', 'click', doAuth);
on('input-password', 'keydown', e => { if (e.key === 'Enter') doAuth(); });

async function doAuth() {
  const email = $('input-email').value.trim();
  const pwd = $('input-password').value;
  const uname = $('input-username').value.trim();
  if (!email || !pwd) { txt('auth-error', 'Fill in all fields'); return; }
  if (!isLogin && !uname) { txt('auth-error', 'Choose a username'); return; }
  txt('auth-error', ''); $('btn-auth').disabled = true; txt('btn-auth', '...');
  try {
    if (isLogin) {
      await signInWithEmailAndPassword(auth, email, pwd);
    } else {
      const c = await createUserWithEmailAndPassword(auth, email, pwd);
      await set(ref(db, `users/${c.user.uid}`), { name: uname, email, online: true, friendsCount: 0 });
    }
  } catch(e) {
    txt('auth-error',
      e.code === 'auth/invalid-credential' ? 'Invalid email or password' :
      e.code === 'auth/email-already-in-use' ? 'Email already in use' :
      e.code === 'auth/weak-password' ? 'Minimum 6 characters' :
      e.code === 'auth/invalid-email' ? 'Invalid email' : 'Something went wrong'
    );
  }
  $('btn-auth').disabled = false;
  txt('btn-auth', isLogin ? 'Sign in →' : 'Create →');
}

on('btn-logout-item', 'click', async () => {
  if (user) await set(ref(db, `users/${user.uid}/online`), false);
  if (notifsUnsub) notifsUnsub();
  await signOut(auth);
});

// ===== INIT APP =====
function initApp() {
  updateProfileUI();
  loadRooms();
  loadFriends();
  loadIncomingRequests();
  subscribeNotifications();
  loadStats();
}

function loadStats() {
  if (!user) return;
  onValue(ref(db, `users/${user.uid}/roomsCreated`), snap => {
    txt('stat-rooms', snap.val() || 0);
  });
}

function updateProfileUI() {
  txt('profile-name', myName);
  txt('profile-avatar-letter', myName[0]?.toUpperCase() || '?');
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
  if (dataUrl) { el.style.backgroundImage = `url(${dataUrl})`; el.style.display = ''; }
  else el.style.display = 'none';
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

// ===== NOTIFICATIONS =====
function subscribeNotifications() {
  if (!user) return;
  if (notifsUnsub) notifsUnsub();
  notifsUnsub = onValue(ref(db, `users/${user.uid}/notifications`), snap => {
    const data = snap.val();
    const notifs = data
      ? Object.entries(data).map(([id,v]) => ({id,...v})).sort((a,b) => (b.ts||0)-(a.ts||0))
      : [];
    unreadNotifs = notifs.filter(n => !n.read).length;
    const badge = $('notifs-badge');
    if (badge) {
      badge.style.display = unreadNotifs > 0 ? '' : 'none';
      badge.textContent = unreadNotifs > 9 ? '9+' : unreadNotifs || '';
    }
    renderNotifications(notifs);
  });
}

async function markNotifsRead() {
  if (!user) return;
  const snap = await get(ref(db, `users/${user.uid}/notifications`));
  const data = snap.val();
  if (!data) return;
  const updates = {};
  Object.entries(data).forEach(([id, v]) => {
    if (!v.read) updates[`users/${user.uid}/notifications/${id}/read`] = true;
  });
  if (Object.keys(updates).length) {
    const { update } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
    await update(ref(db, '/'), updates);
  }
}

function renderNotifications(notifs) {
  const el = $('notifs-list');
  if (!el) return;
  if (!notifs.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-text">No notifications</div></div>';
    return;
  }
  el.innerHTML = notifs.map(n => {
    const icons = { friend_request: '♦', room_invite: '▶', watching: '●', system: '○' };
    const icon = icons[n.type] || '◎';
    const unreadDot = !n.read ? '<span style="width:6px;height:6px;border-radius:50%;background:var(--fg);flex-shrink:0;margin-left:auto"></span>' : '';
    let actionBtn = '';
    if (n.type === 'friend_request' && n.fromUid) {
      actionBtn = `<div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn-accept" data-notif-accept="${n.id}" data-uid="${n.fromUid}" data-name="${escA(n.fromName||'')}">Accept</button>
        <button class="btn-sm" data-notif-decline="${n.id}" data-uid="${n.fromUid}">Decline</button>
      </div>`;
    }
    if (n.type === 'room_invite' && n.roomId) {
      actionBtn = `<div style="margin-top:8px">
        <button class="btn-accept" data-notif-join="${n.roomId}" data-notif-id="${n.id}">Join room</button>
      </div>`;
    }
    return `<div class="notif-row ${n.read ? '' : 'notif-unread'}" data-nid="${n.id}">
      <div class="notif-icon">${icon}</div>
      <div style="flex:1;min-width:0">
        <div class="notif-text">${esc(n.text||'')}</div>
        <div class="notif-time">${timeAgo(n.ts)}</div>
        ${actionBtn}
      </div>
      ${unreadDot}
    </div>`;
  }).join('');

  el.querySelectorAll('[data-notif-accept]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await acceptReq(btn.dataset.uid, btn.dataset.name);
      await remove(ref(db, `users/${user.uid}/notifications/${btn.dataset.notifAccept}`));
    });
  });
  el.querySelectorAll('[data-notif-decline]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await declineReq(btn.dataset.uid);
      await remove(ref(db, `users/${user.uid}/notifications/${btn.dataset.notifDecline}`));
    });
  });
  el.querySelectorAll('[data-notif-join]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const roomId = btn.dataset.notifJoin;
      const nid = btn.dataset.notifId;
      await set(ref(db, `users/${user.uid}/notifications/${nid}/read`), true);
      const snap = await get(ref(db, `rooms/${roomId}`));
      const roomData = snap.val();
      if (roomData) { closeModal(); enterRoom({ id: roomId, ...roomData }); }
      else alert('Room no longer exists');
    });
  });
}

async function sendNotification(toUid, notif) {
  await push(ref(db, `users/${toUid}/notifications`), { ...notif, ts: Date.now(), read: false });
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

// ===== ROOMS =====
function loadRooms() {
  if (roomsUnsub) roomsUnsub();
  roomsUnsub = onValue(ref(db, 'rooms'), snap => {
    const data = snap.val();
    const list = $('rooms-list');
    if (!data) {
      txt('rooms-count', '0');
      list.innerHTML = `<div class="empty-state"><div class="empty-text">No active rooms</div><button class="btn-link" id="btn-cf">Create the first one →</button></div>`;
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
        : `<span style="font-size:22px;color:var(--fg3)">${''}</span>`;
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
    const titles = { youtube: 'YouTube', twitch: 'Twitch', browser: 'Browser', file: 'File' };
    txt('quick-create-title', titles[quickSource] || 'New room');
    if (quickSource === 'youtube') { openModal('modal-yt-search'); return; }
    $('quick-link-section').style.display = (quickSource === 'twitch' || quickSource === 'file') ? '' : 'none';
    if (quickSource === 'twitch') { txt('quick-link-label', 'Channel link'); $('quick-link-input').placeholder = 'twitch.tv/channel'; }
    if (quickSource === 'file') { txt('quick-link-label', 'ПРЯМАЯ ССЫЛКА НА MP4'); $('quick-link-input').placeholder = 'https://...'; }
    openModal('modal-quick-create');
  });
});

on('btn-create-room', 'click', () => { quickSource = 'youtube'; $('quick-link-section').style.display = 'none'; txt('quick-create-title', 'New room'); openModal('modal-yt-search'); });
on('btn-create-first', 'click', () => { quickSource = 'youtube'; openModal('modal-yt-search'); });

document.querySelectorAll('#modal-quick-create .privacy-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#modal-quick-create .privacy-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); quickPrivacy = btn.dataset.privacy;
  });
});

on('btn-do-quick-create', 'click', async () => {
  if (!user) return;
  const title = $('quick-title-input').value.trim() || 'New room';
  const roomData = { title, source: quickSource, host: myName, hostUid: user.uid, privacy: quickPrivacy, createdAt: Date.now() };
  if (quickSource === 'twitch' || quickSource === 'file') {
    const url = $('quick-link-input').value.trim();
    if (!url) return;
    roomData.url = url.startsWith('http') ? url : `https://${url}`;
  }
  const nr = await push(ref(db, 'rooms'), roomData);
  closeModal();
  $('quick-title-input').value = ''; $('quick-link-input').value = '';
  // Increment rooms created counter
  const rcSnap = await get(ref(db, `users/${user.uid}/roomsCreated`));
  await set(ref(db, `users/${user.uid}/roomsCreated`), (rcSnap.val() || 0) + 1);
  enterRoom({ id: nr.key, ...roomData });
});

// ===== YT SEARCH =====
on('btn-back-from-yt', 'click', () => closeModal());
on('btn-do-yt-search', 'click', () => ytSearch($('yt-search-input').value));
on('yt-search-input', 'keydown', e => { if (e.key === 'Enter') ytSearch($('yt-search-input').value); });
on('yt-search-input', 'input', () => { $('btn-clear-yt').style.display = $('yt-search-input').value ? '' : 'none'; });
on('btn-clear-yt', 'click', () => {
  $('yt-search-input').value = ''; $('btn-clear-yt').style.display = 'none';
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
        ${forChange ? `<button class="btn-sm" style="flex-shrink:0;margin-left:auto" data-queue-vid="${escA(i.id.videoId)}" data-queue-title="${escA(i.snippet.title)}">+ В ОЧЕРЕДЬ</button>` : ''}
      </div>`).join('');
    if (forChange) {
      el.querySelectorAll('[data-queue-vid]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          addToQueue(btn.dataset.queueVid, btn.dataset.queueTitle);
          btn.textContent = '✓'; btn.disabled = true;
        });
      });
    }
    el.querySelectorAll('.yt-result').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('[data-queue-vid]')) return;
        if (forChange) applyChange(row.dataset.vid, row.dataset.title, 'youtube');
        else createWithVideo(row.dataset.vid, row.dataset.title);
      });
    });
  } catch { el.innerHTML = '<div class="empty-state"><div class="empty-text">ОШИБКА ПОИСКА</div></div>'; }
}

async function createWithVideo(videoId, title) {
  if (!user) return;
  const roomData = { title, source: 'youtube', videoId, host: myName, hostUid: user.uid, privacy: quickPrivacy, createdAt: Date.now() };
  const nr = await push(ref(db, 'rooms'), roomData);
  closeModal();
  $('yt-search-input').value = '';
  $('yt-search-results').innerHTML = '<div class="empty-state"><div class="empty-text">ВВЕДИТЕ ЗАПРОС</div></div>';
  notifyFriendsWatching(title);
  enterRoom({ id: nr.key, ...roomData });
}

async function notifyFriendsWatching(title) {
  if (!friends.length) return;
  for (const f of friends) {
    await sendNotification(f.uid, { type: 'watching', text: `${myName} started watching «${title}»`, fromUid: user.uid, fromName: myName });
  }
}

on('home-search-input', 'click', () => openModal('modal-yt-search'));
on('home-search-input', 'keydown', e => { if (e.key === 'Enter') { openModal('modal-yt-search'); setTimeout(() => { $('yt-search-input').value = $('home-search-input').value; ytSearch($('home-search-input').value); }, 100); } });

// ===== QUEUE =====
async function addToQueue(videoId, title) {
  if (!currentRoom) return;
  await push(ref(db, `rooms/${currentRoom.id}/queue`), { videoId, title, addedBy: myName, ts: Date.now() });
}

async function skipVideo() {
  if (!currentRoom) return;
  const snap = await get(ref(db, `rooms/${currentRoom.id}/queue`));
  const data = snap.val();
  if (!data) return;
  const entries = Object.entries(data).sort(([,a],[,b]) => (a.ts||0)-(b.ts||0));
  const [nextKey, next] = entries[0];
  await remove(ref(db, `rooms/${currentRoom.id}/queue/${nextKey}`));
  await applyChange(next.videoId, next.title, 'youtube');
}

function subscribeQueue() {
  if (queueUnsub) { queueUnsub(); queueUnsub = null; }
  if (!currentRoom) return;
  queueUnsub = onValue(ref(db, `rooms/${currentRoom.id}/queue`), snap => renderQueue(snap.val()));
}

function renderQueue(data) {
  const el = $('queue-list');
  if (!el) return;
  const btn = $('btn-skip');
  if (!data) {
    el.innerHTML = '<div style="color:var(--fg3);font-size:10px;font-family:var(--mono);letter-spacing:1px;padding:8px 0">ОЧЕРЕДЬ ПУСТА</div>';
    if (btn) btn.style.opacity = '0.4';
    return;
  }
  const entries = Object.entries(data).map(([id,v])=>({id,...v})).sort((a,b)=>(a.ts||0)-(b.ts||0));
  if (btn) btn.style.opacity = entries.length ? '1' : '0.4';
  el.innerHTML = entries.map((v,i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:0.5px solid var(--border)">
      <span style="color:var(--fg3);font-family:var(--mono);font-size:9px;width:14px">${i+1}</span>
      <img src="https://img.youtube.com/vi/${v.videoId}/default.jpg" style="width:40px;height:28px;object-fit:cover;border-radius:3px;flex-shrink:0" />
      <span style="flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg)">${esc(v.title||'')}</span>
    </div>`).join('');
}

on('btn-skip', 'click', skipVideo);
on('btn-add-to-queue', 'click', () => {
  document.querySelectorAll('#change-source-tabs .source-tab').forEach(b => b.classList.remove('active'));
  document.querySelector('#change-source-tabs .source-tab').classList.add('active');
  changeSource = 'youtube'; $('change-yt-section').style.display = '';
  $('change-link-section').style.display = 'none'; $('change-browser-section').style.display = 'none';
  openModal('modal-change-video');
});

// ===== ENTER ROOM =====
function enterRoom(room) {
  [messagesUnsub, participantsUnsub, syncUnsub, roomDataUnsub, browserSyncUnsub, typingUnsub, queueUnsub, commandUnsub].forEach(u => u?.());
  messagesUnsub = participantsUnsub = syncUnsub = roomDataUnsub = browserSyncUnsub = typingUnsub = queueUnsub = commandUnsub = null;
  clearInterval(posTimer);
  if (ssStream) { ssStream.getTracks().forEach(t => t.stop()); ssStream = null; }

  // Глушим оба webview перед входом в новую комнату
  const _wv = $('main-webview'); const _bwv = $('browser-webview');
  if (_wv) { stopWebviewAudio(_wv); _wv.style.display = 'none'; setTimeout(() => { try { if (viewerSrc) _wv.setAttribute('src', 'about:blank'); } catch {} }, 300); }
  if (_bwv) { stopWebviewAudio(_bwv); _bwv.style.display = 'none'; }
  viewerSrc = '';

  currentRoom = room;
  isPlaying = false; isBrowserHost = false; lastPos = 0; ignoreSyncUntil = 0;
  viewerSrc = '';
  isHost = (room.host === myName || room.hostUid === user.uid);

  $('btn-delete-room').style.display = isHost ? '' : 'none';

  roomDataUnsub = onValue(ref(db, `rooms/${room.id}`), snap => {
    const data = snap.val();
    if (!data) { leaveRoom(); return; }
    const oldVideoId = currentRoom.videoId;
    const oldUrl = currentRoom.url;
    const oldSource = currentRoom.source;
    currentRoom = { ...data, id: room.id };
    if (currentRoom.videoId !== oldVideoId || currentRoom.url !== oldUrl || currentRoom.source !== oldSource) {
      viewerSrc = ''; isPlaying = false; lastPos = 0;
      updateViewer();
    }
    txt('room-video-title', currentRoom.title || '');
  });

  // Messages
  $('chat-messages').innerHTML = '';
  let knownMsgIds = new Set();
  messagesUnsub = onValue(ref(db, `rooms/${room.id}/messages`), snap => {
    const data = snap.val();
    if (!data) { $('chat-messages').innerHTML = ''; knownMsgIds.clear(); return; }
    const msgs = Object.entries(data).map(([id,v]) => ({id,...v})).sort((a,b)=>(a.time||0)-(b.time||0));
    const container = $('chat-messages');
    const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 80;
    msgs.forEach(m => {
      if (knownMsgIds.has(m.id)) return;
      knownMsgIds.add(m.id);
      const el = document.createElement('div');
      el.className = 'chat-msg';
      el.dataset.msgId = m.id;
      const av = m.userAvatar
        ? `<div class="chat-av chat-av-clickable" data-user="${escA(m.user||'')}" data-uid="${escA(m.userUid||'')}" style="background-image:url(${m.userAvatar});background-size:cover;background-position:center;cursor:pointer"></div>`
        : `<div class="chat-av chat-av-clickable" data-user="${escA(m.user||'')}" data-uid="${escA(m.userUid||'')}" style="cursor:pointer">${(m.user||'?')[0].toUpperCase()}</div>`;
      const body = buildMsgBody(m);
      el.innerHTML = `${av}<div><div class="chat-msg-user chat-av-clickable" data-user="${escA(m.user||'')}" data-uid="${escA(m.userUid||'')}" style="cursor:pointer">${esc(m.user||'').toUpperCase()}</div>${body}</div>`;
      attachMsgHandlers(el, m);
      el.querySelectorAll('.chat-av-clickable').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); openUserProfileByName(btn.dataset.user, btn.dataset.uid); });
      });
      container.appendChild(el);
    });
    if (wasAtBottom) container.scrollTop = container.scrollHeight;
  });

  // Typing
  typingUnsub = onValue(ref(db, `rooms/${room.id}/typing`), snap => {
    const data = snap.val();
    const typers = data ? Object.entries(data)
      .filter(([uid, v]) => uid !== user.uid && v.active && (Date.now() - (v.ts||0)) < 4000)
      .map(([,v]) => v.name) : [];
    const el = $('typing-indicator');
    if (el) { el.textContent = typers.length ? `${typers.join(', ')} is typing...` : ''; el.style.display = typers.length ? '' : 'none'; }
  });

  // Participants
  set(ref(db, `rooms/${room.id}/participants/${user.uid}`), { name: myName, uid: user.uid, joinedAt: Date.now() });
  participantsUnsub = onValue(ref(db, `rooms/${room.id}/participants`), snap => {
    const data = snap.val();
    const list = data ? Object.entries(data).map(([uid,v]) => ({uid,...v})) : [];
    txt('participants-count', list.length);
    txt('modal-parts-count', list.length);
    $('modal-parts-list').innerHTML = list.map(p => `
      <div class="friend-row" style="cursor:pointer" data-puid="${p.uid}" data-pname="${escA(p.name||'')}">
        <div class="avatar">${(p.name||'?')[0].toUpperCase()}</div>
        <div><div class="friend-name">${esc(p.name||'')}</div>${p.uid===currentRoom.hostUid||p.name===currentRoom.host?'<div class="friend-sub">Host</div>':''}</div>
      </div>`).join('');
    $('modal-parts-list').querySelectorAll('[data-puid]').forEach(row => {
      row.addEventListener('click', () => openUserProfileByName(row.dataset.pname, row.dataset.puid));
    });
  });

  // ===== SYNC =====
  // Хост пишет состояние каждые 2 секунды.
  // Гости читают и применяют с компенсацией задержки.
  // Порог расхождения: 1 секунда.
  syncUnsub = onValue(ref(db, `rooms/${room.id}/sync`), snap => {
    const data = snap.val();
    if (!data || isHost) return;
    if (Date.now() < ignoreSyncUntil) return;
    applySync(data);
  });

  // Commands from guests — host listens and applies to player
  if (commandUnsub) { commandUnsub(); commandUnsub = null; }
  if (isHost) {
    commandUnsub = onValue(ref(db, `rooms/${room.id}/command`), snap => {
      const cmd = snap.val();
      if (!cmd || !cmd.action) return;
      // Ignore old commands (older than 3 seconds)
      if (Date.now() - (cmd.ts || 0) > 3000) return;
      const wv = $('main-webview');
      if (!wv || wv.style.display === 'none') return;
      if (cmd.action === 'pause') {
        wv.executeJavaScript('document.querySelector("video")?.pause()').catch(() => {});
      } else if (cmd.action === 'play') {
        wv.executeJavaScript('document.querySelector("video")?.play()').catch(() => {});
      } else if (cmd.action === 'seek' && cmd.position !== undefined) {
        wv.executeJavaScript(`(function(){var v=document.querySelector('video');if(v)v.currentTime=${cmd.position};})();`).catch(() => {});
      }
    });
  }

  if (isHost) {
    // Хост — постоянно читаем плеер и пишем в Firebase
    posTimer = setInterval(async () => {
      if (!currentRoom) return;
      const wv = $('main-webview');
      if (!wv || wv.style.display === 'none') return;
      try {
        const result = await wv.executeJavaScript(`
          (function() {
            var v = document.querySelector('video');
            if (!v) return null;
            return { t: v.currentTime, p: !v.paused, d: v.duration || 0 };
          })()
        `);
        if (!result) return;
        lastPos = result.t;
        isPlaying = result.p;
        await set(ref(db, `rooms/${currentRoom.id}/sync`), {
          playing: result.p,
          position: result.t,
          duration: result.d,
          ts: Date.now()
        });
      } catch {}
    }, 2000);
  } else {
    // Гость — просто читаем свою позицию для отображения
    posTimer = setInterval(async () => {
      if (!currentRoom || !isPlaying) return;
      const pos = await getVideoPosition();
      if (pos !== null) lastPos = pos;
    }, 2000);
  }

  subscribeQueue();
  updateViewer();

  screen('room');
}

// ===== GET VIDEO POSITION =====
async function getVideoPosition() {
  const wv = $('main-webview');
  if (wv && wv.style.display !== 'none') {
    try {
      const t = await wv.executeJavaScript('(document.querySelector("video") || {}).currentTime || 0');
      if (typeof t === 'number' && t > 0) return t;
    } catch {}
  }
  return null;
}

// ===== OPEN USER PROFILE =====
async function openUserProfileByName(name, uid) {
  if (uid === user.uid || name === myName) { if (activeModal) closeModal(); tab('profile'); screen('main'); return; }
  let profileData = friends.find(f => f.uid === uid || f.name === name);
  if (!profileData && uid) {
    const snap = await get(ref(db, `users/${uid}`));
    if (snap.val()) profileData = { uid, ...snap.val() };
  }
  if (!profileData && name) {
    const snap = await get(ref(db, 'users'));
    const all = snap.val();
    if (all) { const found = Object.entries(all).find(([, v]) => v.name === name); if (found) profileData = { uid: found[0], ...found[1] }; }
  }
  if (profileData) openFriendProfile(profileData);
}

// ===== STOP WEBVIEW AUDIO =====
function stopWebviewAudio(webview) {
  if (!webview) return;
  // Мьютим через Electron IPC — единственный надёжный способ
  const partition = webview.getAttribute('partition');
  if (partition && window.electronAPI?.mutePartition) {
    window.electronAPI.mutePartition(partition, true);
  }
  // Дополнительно паузим через JS
  try {
    webview.executeJavaScript(`
      document.querySelectorAll('video,audio').forEach(function(m){try{m.pause();m.volume=0;}catch(e){}});
    `).catch(() => {});
  } catch {}
}

function unmuteWebview(webview) {
  if (!webview) return;
  const partition = webview.getAttribute('partition');
  if (partition && window.electronAPI?.mutePartition) {
    window.electronAPI.mutePartition(partition, false);
  }
}


function updateViewer() {
  if (!currentRoom) return;
  const wv = $('main-webview');
  const bwv = $('browser-webview');
  const ph = $('viewer-placeholder');
  const bb = $('browser-bar');
  const pc = $('player-controls');
  const ssv = $('ss-video');

  wv.style.display = 'none'; bwv.style.display = 'none'; ph.style.display = 'none';
  if (bb) bb.style.display = 'none';
  if (pc) pc.style.display = 'none';
  if (ssv) ssv.style.display = 'none';

  if (currentRoom.source === 'youtube' && currentRoom.videoId) {
    stopWebviewAudio(bwv); bwv.style.display = 'none';
    const src = `https://www.youtube.com/watch?v=${currentRoom.videoId}`;
    if (viewerSrc !== src) {
      wv.setAttribute('src', src); viewerSrc = src;
      wv.addEventListener('dom-ready', onWebviewReady, { once: true });
    }
    unmuteWebview(wv);
    wv.style.display = '';
  } else if (currentRoom.source === 'browser') {
    stopWebviewAudio(wv); wv.style.display = 'none'; viewerSrc = '';
    if (!bwv.getAttribute('src') || bwv.getAttribute('src') === 'about:blank') {
      bwv.setAttribute('src', 'https://www.google.com');
      $('browser-address').value = 'https://www.google.com';
    }
    unmuteWebview(bwv);
    bwv.style.display = '';
    if (bb) bb.style.display = 'flex';
    setupBrowserSync();
  } else if (currentRoom.url) {
    stopWebviewAudio(bwv); bwv.style.display = 'none';
    const src = currentRoom.url;
    if (viewerSrc !== src) { wv.setAttribute('src', src); viewerSrc = src; }
    unmuteWebview(wv);
    wv.style.display = '';
    if (pc) pc.style.display = '';
  } else {
    stopWebviewAudio(wv); stopWebviewAudio(bwv);
    viewerSrc = '';
    ph.style.display = '';
  }
}

async function onWebviewReady() {
  if (!currentRoom) return;
  if (!isHost) {
    // Apply last sync state
    const snap = await get(ref(db, `rooms/${currentRoom.id}/sync`));
    const data = snap.val();
    if (data) setTimeout(() => applySync(data), 2000);

    // Inject listener — when guest presses pause/play on YouTube, send command to host
    setTimeout(() => {
      const wv = $('main-webview');
      if (!wv) return;
      wv.executeJavaScript(`
        (function() {
          if (window.__outro_listener) return;
          window.__outro_listener = true;
          document.addEventListener('click', function(e) {
            var btn = e.target.closest('.ytp-play-button, button[aria-label*="Pause"], button[aria-label*="Play"], button[aria-label*="пауз"], button[aria-label*="воспр"]');
            if (!btn) return;
            // Small delay to let YouTube update video state
            setTimeout(function() {
              var v = document.querySelector('video');
              if (!v) return;
              window.__outro_sendState && window.__outro_sendState(v.paused ? 'pause' : 'play', v.currentTime);
            }, 100);
          }, true);
          document.addEventListener('keydown', function(e) {
            if (e.code === 'Space' || e.code === 'KeyK') {
              setTimeout(function() {
                var v = document.querySelector('video');
                if (!v) return;
                window.__outro_sendState && window.__outro_sendState(v.paused ? 'pause' : 'play', v.currentTime);
              }, 100);
            }
          });
        })();
      `).catch(() => {});
    }, 3000);
  }
}

// Called from injected script context via executeJavaScript polling
function startGuestEventPoll() {
  if (isHost) return;
  // Poll guest player state and send commands when it changes
  let lastPaused = null;
  setInterval(async () => {
    if (!currentRoom || isHost) return;
    const wv = $('main-webview');
    if (!wv || wv.style.display === 'none') return;
    try {
      const state = await wv.executeJavaScript(`
        (function() {
          var v = document.querySelector('video');
          if (!v) return null;
          return { paused: v.paused, t: v.currentTime };
        })()
      `);
      if (!state) return;
      if (lastPaused === null) { lastPaused = state.paused; return; }
      if (state.paused !== lastPaused) {
        lastPaused = state.paused;
        await sendCommand(state.paused ? 'pause' : 'play', { position: state.t });
      }
    } catch {}
  }, 500);
}

// ===== APPLY SYNC (только для гостей) =====
function applySync(data) {
  if (!data || isHost) return;
  isPlaying = data.playing;
  const wv = $('main-webview');
  if (!wv || wv.style.display === 'none') return;

  // Компенсируем задержку передачи
  let targetPos = data.position || 0;
  if (data.playing && data.ts) {
    targetPos += (Date.now() - data.ts) / 1000;
  }

  try {
    if (data.playing) {
      wv.executeJavaScript(`
        (function(){
          var v = document.querySelector('video');
          if (!v) return;
          var t = ${targetPos};
          if (Math.abs(v.currentTime - t) > 1) v.currentTime = t;
          if (v.paused) v.play().catch(function(){});
        })();
      `).catch(()=>{});
    } else {
      wv.executeJavaScript(`
        (function(){
          var v = document.querySelector('video');
          if (!v) return;
          var t = ${targetPos};
          if (!v.paused) v.pause();
          if (Math.abs(v.currentTime - t) > 1) v.currentTime = t;
        })();
      `).catch(()=>{});
    }
    lastPos = targetPos;
  } catch {}
}

// ===== BROWSER =====
function setupBrowserSync() {
  if (browserSyncUnsub) { browserSyncUnsub(); browserSyncUnsub = null; }
  if (!currentRoom) return;

  // Guest: listen for URL changes from Firebase and apply to webview
  // Host: skip applying (ignoreBrowserSync prevents host from being redirected by own writes)
  browserSyncUnsub = onValue(ref(db, `rooms/${currentRoom.id}/browserUrl`), snap => {
    const data = snap.val();
    if (!data) return;
    // Don't apply if we just wrote this ourselves (host or whoever navigated)
    if (ignoreBrowserSync) return;
    const bwv = $('browser-webview');
    if (bwv && data.url && bwv.getAttribute('src') !== data.url) {
      bwv.setAttribute('src', data.url);
      $('browser-address').value = data.url;
    }
  });

  const bwv = $('browser-webview');
  if (bwv) {
    // Remove any previously attached handlers to avoid duplicates
    if (bwv.__navHandler) {
      bwv.removeEventListener('did-navigate', bwv.__navHandler);
      bwv.removeEventListener('did-navigate-in-page', bwv.__navHandler);
    }
    // Always sync navigation — whoever navigates (host typing URL, clicking links) syncs to Firebase.
    // Guests won't navigate themselves so this is effectively host-only.
    const navHandler = e => {
      $('browser-address').value = e.url;
      // Sync any navigation (address bar, link clicks, back/forward) if we are the one driving
      if (currentRoom && (isBrowserHost || isHost)) syncBrowserUrl(e.url);
    };
    bwv.__navHandler = navHandler;
    bwv.addEventListener('did-navigate', navHandler);
    bwv.addEventListener('did-navigate-in-page', navHandler);
  }
}

async function syncBrowserUrl(url) {
  if (!currentRoom || !user) return;
  // Temporarily ignore incoming Firebase updates so we don't apply our own write back to ourselves
  ignoreBrowserSync = true;
  setTimeout(() => { ignoreBrowserSync = false; }, 2000);
  await set(ref(db, `rooms/${currentRoom.id}/browserUrl`), { url, uid: user.uid, ts: Date.now() });
}

function navBrowser(input) {
  let url = input.trim();
  if (!url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = url.includes('.') && !url.includes(' ') ? `https://${url}` : `https://www.google.com/search?q=${encodeURIComponent(url)}&gl=us&hl=en`;
  }
  isBrowserHost = true;
  const bwv = $('browser-webview');
  bwv.setAttribute('src', url);
  $('browser-address').value = url;
  syncBrowserUrl(url);
}

on('btn-browser-go', 'click', () => navBrowser($('browser-address').value));
on('browser-address', 'keydown', e => { if (e.key === 'Enter') { isBrowserHost = true; navBrowser($('browser-address').value); } });
on('btn-browser-back', 'click', () => { isBrowserHost = true; $('browser-webview')?.goBack?.(); });
on('btn-browser-forward', 'click', () => { isBrowserHost = true; $('browser-webview')?.goForward?.(); });
on('btn-browser-refresh', 'click', () => $('browser-webview')?.reload?.());

// ===== TYPING =====
on('chat-input', 'input', async () => {
  if (!currentRoom || !user) return;
  await set(ref(db, `rooms/${currentRoom.id}/typing/${user.uid}`), { name: myName, active: true, ts: Date.now() });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(async () => {
    if (currentRoom && user) await set(ref(db, `rooms/${currentRoom.id}/typing/${user.uid}`), { name: myName, active: false, ts: Date.now() });
  }, 3000);
});

// ===== LEAVE / DELETE ROOM =====
on('btn-leave-room', 'click', leaveRoom);
function leaveRoom() {
  clearInterval(posTimer); clearTimeout(typingTimer);
  if (currentRoom && user) {
    remove(ref(db, `rooms/${currentRoom.id}/participants/${user.uid}`));
    set(ref(db, `rooms/${currentRoom.id}/typing/${user.uid}`), { name: myName, active: false, ts: Date.now() });
  }
  [messagesUnsub, participantsUnsub, syncUnsub, roomDataUnsub, browserSyncUnsub, typingUnsub, queueUnsub, commandUnsub].forEach(u => u?.());
  messagesUnsub = participantsUnsub = syncUnsub = roomDataUnsub = browserSyncUnsub = typingUnsub = queueUnsub = commandUnsub = null;
  if (ssStream) { ssStream.getTracks().forEach(t => t.stop()); ssStream = null; }
  const wv = $('main-webview');
  if (wv) {
    stopWebviewAudio(wv);
    setTimeout(() => { try { wv.setAttribute('src', 'about:blank'); } catch {} }, 300);
    wv.style.display = 'none'; viewerSrc = '';
  }
  const bwv = $('browser-webview');
  if (bwv) {
    stopWebviewAudio(bwv);
    setTimeout(() => { try { bwv.setAttribute('src', 'about:blank'); } catch {} }, 300);
    bwv.style.display = 'none';
  }
  currentRoom = null; isPlaying = false; isHost = false;
  screen('main');
}

on('btn-delete-room', 'click', async () => {
  if (!currentRoom || !user || !isHost) return;
  if (!confirm('Delete this room?')) return;
  const id = currentRoom.id;
  leaveRoom();
  await remove(ref(db, `rooms/${id}`));
});

// ===== CHANGE VIDEO =====
on('btn-change-video', 'click', () => {
  document.querySelectorAll('#change-source-tabs .source-tab').forEach(b => b.classList.remove('active'));
  document.querySelector('#change-source-tabs .source-tab').classList.add('active');
  changeSource = 'youtube'; $('change-yt-section').style.display = '';
  $('change-link-section').style.display = 'none'; $('change-browser-section').style.display = 'none';
  openModal('modal-change-video');
});

document.querySelectorAll('#change-source-tabs .source-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#change-source-tabs .source-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); changeSource = btn.dataset.source;
    $('change-yt-section').style.display = changeSource === 'youtube' ? '' : 'none';
    $('change-link-section').style.display = (changeSource === 'twitch' || changeSource === 'file') ? '' : 'none';
    $('change-browser-section').style.display = changeSource === 'browser' ? '' : 'none';
    if (changeSource === 'twitch') { txt('change-link-label', 'Channel link'); $('change-link-input').placeholder = 'twitch.tv/channel'; }
    if (changeSource === 'file') { txt('change-link-label', 'Direct link'); $('change-link-input').placeholder = 'https://...'; }
  });
});

on('btn-change-yt-search', 'click', () => ytSearch($('change-yt-input').value, true));
on('change-yt-input', 'keydown', e => { if (e.key === 'Enter') ytSearch($('change-yt-input').value, true); });
on('btn-apply-link', 'click', () => { const url = $('change-link-input').value.trim(); if (url) applyChange(undefined, undefined, changeSource, url); });
on('btn-apply-browser', 'click', () => applyChange(undefined, undefined, 'browser'));

async function applyChange(videoId, title, source, url) {
  if (!currentRoom) return;
  const src = source || changeSource;
  const roomId = currentRoom.id;

  // Write each field individually — no null, no batch update
  await set(ref(db, `rooms/${roomId}/source`), src);
  await set(ref(db, `rooms/${roomId}/title`), title || currentRoom.title);

  if (src === 'browser') {
    isBrowserHost = true;
    await remove(ref(db, `rooms/${roomId}/videoId`));
    await remove(ref(db, `rooms/${roomId}/url`));
  } else if (videoId) {
    await set(ref(db, `rooms/${roomId}/videoId`), videoId);
    await remove(ref(db, `rooms/${roomId}/url`));
  } else if (url) {
    await set(ref(db, `rooms/${roomId}/url`), url.startsWith('http') ? url : `https://${url}`);
    await remove(ref(db, `rooms/${roomId}/videoId`));
  }

  await set(ref(db, `rooms/${roomId}/sync`), { playing: false, position: 0, ts: Date.now() });
  isPlaying = false;
  closeModal();
  $('change-yt-input').value = '';
  $('change-yt-results').innerHTML = '';
  $('change-link-input').value = '';
}

// ===== SCREENSHARE =====
on('btn-screenshare', 'click', async () => {
  const sources = await window.electronAPI?.getSources();
  if (!sources) return;
  $('ss-sources').innerHTML = sources.map(s => `<div class="ss-item" data-id="${escA(s.id)}"><img class="ss-thumb" src="${s.thumbnail}" /><div class="ss-name">${esc(s.name)}</div></div>`).join('');
  $('ss-sources').querySelectorAll('.ss-item').forEach(el => el.addEventListener('click', () => startScreenshare(el.dataset.id)));
  openModal('modal-screenshare');
});

async function startScreenshare(sourceId) {
  try {
    if (ssStream) ssStream.getTracks().forEach(t => t.stop());
    ssStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } } });
    $('main-webview').style.display = 'none'; $('browser-webview').style.display = 'none'; $('viewer-placeholder').style.display = 'none';
    let ssv = $('ss-video');
    if (!ssv) { ssv = document.createElement('video'); ssv.id = 'ss-video'; ssv.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;'; ssv.autoplay = true; $('viewer-area').appendChild(ssv); }
    ssv.srcObject = ssStream; ssv.style.display = '';
    ssStream.getVideoTracks()[0].onended = () => { if (ssStream) { ssStream.getTracks().forEach(t=>t.stop()); ssStream=null; } updateViewer(); };
    closeModal();
  } catch { alert('Screen share failed. Check your system permissions.'); }
}

// ===== PARTICIPANTS & INVITE =====
on('btn-participants', 'click', () => openModal('modal-participants'));
on('btn-invite', 'click', () => { renderInviteFriends(); openModal('modal-invite'); });
on('btn-copy-invite', 'click', () => {
  navigator.clipboard.writeText('https://outro-web-znla.vercel.app');
  txt('btn-copy-invite', 'Copied ✓');
  setTimeout(() => txt('btn-copy-invite', 'Copy link'), 2000);
});

function renderInviteFriends() {
  const el = $('invite-friends-list');
  if (!el || !currentRoom) return;
  if (!friends.length) { el.innerHTML = '<div style="color:var(--fg3);font-size:10px;font-family:var(--mono);letter-spacing:1px;padding:8px 0">No friends yet</div>'; return; }
  el.innerHTML = friends.map(f => `
    <div class="friend-row">
      <div class="avatar">${(f.name||'?')[0].toUpperCase()}</div>
      <div style="flex:1"><div class="friend-name">${esc(f.name||'')}</div></div>
      <button class="btn-sm" data-invite-uid="${f.uid}" data-invite-name="${escA(f.name||'')}">ПРИГЛАСИТЬ</button>
    </div>`).join('');
  el.querySelectorAll('[data-invite-uid]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await sendRoomInvite(btn.dataset.inviteUid, btn.dataset.inviteName);
      btn.textContent = 'Sent ✓'; btn.disabled = true;
    });
  });
}

async function sendRoomInvite(toUid, toName) {
  if (!currentRoom || !user) return;
  await sendNotification(toUid, {
    type: 'room_invite', text: `${myName} invites you to watch «${currentRoom.title||'видео'}»`,
    fromUid: user.uid, fromName: myName, roomId: currentRoom.id, roomTitle: currentRoom.title || ''
  });
}

// ===== CHAT =====
on('btn-send', 'click', sendMsg);
on('chat-input', 'keydown', e => { if (e.key === 'Enter') sendMsg(); });

async function sendMsg() {
  const msg = $('chat-input').value.trim();
  if (!msg || !currentRoom || !user) return;
  $('chat-input').value = '';
  clearTimeout(typingTimer);
  set(ref(db, `rooms/${currentRoom.id}/typing/${user.uid}`), { name: myName, active: false, ts: Date.now() });
  await push(ref(db, `rooms/${currentRoom.id}/messages`), {
    user: myName, userUid: user.uid, userAvatar: myAvatar || null,
    text: msg, type: 'text', time: serverTimestamp()
  });
}

on('btn-send-image', 'click', () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip,.rar';
  inp.onchange = async e => {
    const file = e.target.files[0];
    if (!file || !currentRoom) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const dataUrl = ev.target.result;
      const isImg = file.type.startsWith('image/');
      const isVid = file.type.startsWith('video/');
      const isAud = file.type.startsWith('audio/');
      await push(ref(db, `rooms/${currentRoom.id}/messages`), {
        user: myName, userUid: user.uid, userAvatar: myAvatar || null,
        fileUrl: dataUrl, fileName: file.name, fileType: file.type, fileSize: file.size,
        type: isImg ? 'image' : isVid ? 'video' : isAud ? 'audio' : 'file',
        time: serverTimestamp()
      });
    };
    reader.readAsDataURL(file);
  };
  inp.click();
});

// ===== MSG BODY BUILDER =====
function buildMsgBody(m) {
  const type = m.type; const url = m.fileUrl || m.imageUrl || '';
  const name = m.fileName || 'file'; const size = m.fileSize ? formatSize(m.fileSize) : '';
  if (type === 'image' && url) return `<div class="msg-img-wrap"><img class="chat-msg-img msg-clickable" src="${url}" data-url="${escA(url)}" data-name="${escA(name)}" /><div class="msg-file-actions"><span class="msg-action-btn" data-open-url="${escA(url)}" data-open-name="${escA(name)}">⊙ открыть</span><span class="msg-action-btn" data-save-url="${escA(url)}" data-save-name="${escA(name)}">⤓ сохранить</span></div></div>`;
  if (type === 'video' && url) return `<div class="msg-video-wrap"><video class="chat-msg-video msg-clickable" src="${url}" data-url="${escA(url)}" data-name="${escA(name)}" preload="metadata"></video><div class="msg-file-info"><span class="msg-file-name">${esc(name)}</span><span class="msg-file-size">${size}</span></div><div class="msg-file-actions"><span class="msg-action-btn" data-open-url="${escA(url)}" data-open-name="${escA(name)}">⊙ открыть</span><span class="msg-action-btn" data-save-url="${escA(url)}" data-save-name="${escA(name)}">⤓ сохранить</span></div></div>`;
  if (type === 'audio' && url) return `<div class="msg-audio-wrap"><audio class="chat-msg-audio" src="${url}" controls preload="metadata"></audio><div class="msg-file-actions"><span class="msg-action-btn" data-save-url="${escA(url)}" data-save-name="${escA(name)}">⤓ сохранить</span></div></div>`;
  if (type === 'file' && url) return `<div class="msg-file-wrap msg-clickable" data-open-url="${escA(url)}" data-open-name="${escA(name)}"><span class="msg-file-icon">${getFileIcon(name)}</span><div class="msg-file-info"><span class="msg-file-name">${esc(name)}</span><span class="msg-file-size">${size}</span></div><div class="msg-file-actions"><span class="msg-action-btn" data-open-url="${escA(url)}" data-open-name="${escA(name)}">⊙ открыть</span><span class="msg-action-btn" data-save-url="${escA(url)}" data-save-name="${escA(name)}">⤓ сохранить</span></div></div>`;
  return `<div class="chat-msg-text">${esc(m.text||'')}</div>`;
}

function attachMsgHandlers(el, m) {
  el.querySelectorAll('[data-open-url]').forEach(btn => { btn.addEventListener('click', e => { e.stopPropagation(); openFileOrLightbox(btn.dataset.openUrl, btn.dataset.openName, m.type); }); });
  el.querySelectorAll('[data-save-url]').forEach(btn => { btn.addEventListener('click', e => { e.stopPropagation(); saveFile(btn.dataset.saveUrl, btn.dataset.saveName); }); });
  el.querySelectorAll('.msg-clickable').forEach(item => {
    item.addEventListener('click', () => {
      if (m.type === 'image') openLightbox(item.dataset.url, item.dataset.name);
      else if (m.type === 'video') openFileOrLightbox(item.dataset.url, item.dataset.name, 'video');
      else if (m.type === 'file') openFileOrLightbox(item.dataset.openUrl, item.dataset.openName, 'file');
    });
  });
}

function openFileOrLightbox(url, name, type) {
  if (type === 'image') { openLightbox(url, name); return; }
  if (window.electronAPI?.openFile) window.electronAPI.openFile({ dataUrl: url, filename: name });
}
function saveFile(url, name) {
  if (window.electronAPI?.saveFile) window.electronAPI.saveFile({ dataUrl: url, filename: name });
  else { const a = document.createElement('a'); a.href = url; a.download = name || 'file'; a.click(); }
}
function openLightbox(url, name) {
  let lb = $('msg-lightbox');
  if (!lb) {
    lb = document.createElement('div'); lb.id = 'msg-lightbox';
    lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:zoom-out;';
    lb.innerHTML = `<div style="position:absolute;top:16px;right:16px;display:flex;gap:8px;z-index:1">
      <button id="lb-open" style="background:rgba(255,255,255,0.1);border:0.5px solid rgba(255,255,255,0.2);color:#fff;border-radius:6px;padding:6px 12px;font-family:var(--mono);font-size:10px;letter-spacing:1px;cursor:pointer">Open</button>
      <button id="lb-save" style="background:rgba(255,255,255,0.1);border:0.5px solid rgba(255,255,255,0.2);color:#fff;border-radius:6px;padding:6px 12px;font-family:var(--mono);font-size:10px;letter-spacing:1px;cursor:pointer">Save</button>
      <button id="lb-close" style="background:rgba(255,255,255,0.1);border:0.5px solid rgba(255,255,255,0.2);color:#fff;border-radius:6px;padding:6px 12px;font-family:var(--mono);font-size:10px;letter-spacing:1px;cursor:pointer">✕</button>
    </div>
    <img id="lb-img" style="max-width:90vw;max-height:88vh;object-fit:contain;border-radius:4px;box-shadow:0 8px 40px rgba(0,0,0,0.6)" />
    <div id="lb-name" style="color:rgba(255,255,255,0.4);font-size:10px;font-family:var(--mono);margin-top:10px;letter-spacing:1px"></div>`;
    document.body.appendChild(lb);
    lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });
  }
  $('lb-img').src = url; $('lb-name').textContent = name || ''; lb.style.display = 'flex';
  $('lb-close').onclick = closeLightbox;
  $('lb-open').onclick = () => { if (window.electronAPI?.openFile) window.electronAPI.openFile({ dataUrl: url, filename: name }); };
  $('lb-save').onclick = () => saveFile(url, name);
}
function closeLightbox() { const lb = $('msg-lightbox'); if (lb) lb.style.display = 'none'; }
function formatSize(b) { if(!b)return''; if(b<1024)return`${b} B`; if(b<1048576)return`${(b/1024).toFixed(1)} KB`; return`${(b/1048576).toFixed(1)} MB`; }
function getFileIcon(name) { const e=(name||'').split('.').pop().toLowerCase(); return {pdf:'▤',doc:'▤',docx:'▤',txt:'▤',zip:'▦',rar:'▦','7z':'▦',mp3:'♫',wav:'♫',flac:'♫'}[e]||'▢'; }

// ===== FRIENDS =====
function loadFriends() {
  if (!user) return;
  onValue(ref(db, `users/${user.uid}/friends`), snap => {
    const data = snap.val();
    friends = data ? Object.entries(data).map(([uid,v]) => ({uid,...v})) : [];
    txt('friends-count', friends.length); txt('stat-friends', friends.length);
    set(ref(db, `users/${user.uid}/friendsCount`), friends.length);
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
  if (!friends.length) { el.innerHTML = '<div class="empty-state"><div class="empty-text">No friends yet</div></div>'; return; }
  el.innerHTML = friends.map(f => {
    const av = f.avatar ? `<div class="avatar" style="background-image:url(${f.avatar});background-size:cover;background-position:center"></div>` : `<div class="avatar">${(f.name||'?')[0].toUpperCase()}</div>`;
    return `<div class="friend-row" data-uid="${f.uid}">${av}<div><div class="friend-name">${esc(f.name||'')}</div><div class="friend-sub">Friend</div></div><span style="color:var(--fg3)">→</span></div>`;
  }).join('');
  el.querySelectorAll('.friend-row').forEach(row => {
    row.addEventListener('click', () => { const f = friends.find(f => f.uid === row.dataset.uid); if (f) openFriendProfile(f); });
  });
}

function renderIncoming() {
  const sec = $('incoming-section'); const list = $('incoming-list');
  if (!incomingReqs.length) { sec.style.display = 'none'; return; }
  sec.style.display = ''; txt('requests-count', incomingReqs.length);
  list.innerHTML = incomingReqs.map(r => `
    <div class="friend-row">
      <div class="avatar">${(r.fromName||'?')[0].toUpperCase()}</div>
      <div style="flex:1"><div class="friend-name">${esc(r.fromName||'')}</div><div class="friend-sub">wants to add you</div></div>
      <div style="display:flex;gap:6px">
        <button class="btn-accept" data-uid="${r.fromUid}" data-name="${escA(r.fromName)}">ОК</button>
        <button class="btn-sm" data-dec="${r.fromUid}">✕</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('.btn-accept').forEach(btn => btn.addEventListener('click', () => acceptReq(btn.dataset.uid, btn.dataset.name)));
  list.querySelectorAll('[data-dec]').forEach(btn => btn.addEventListener('click', () => declineReq(btn.dataset.dec)));
}

async function acceptReq(fromUid, fromName) {
  const snap = await get(ref(db, `users/${fromUid}`));
  const fromData = snap.val() || {};
  await set(ref(db, `users/${user.uid}/friends/${fromUid}`), { uid: fromUid, name: fromName, avatar: fromData.avatar || null });
  await set(ref(db, `users/${fromUid}/friends/${user.uid}`), { uid: user.uid, name: myName, avatar: myAvatar || null });
  await remove(ref(db, `users/${user.uid}/friendRequests/incoming/${fromUid}`));
  await sendNotification(fromUid, { type: 'system', text: `${myName} accepted your friend request`, fromUid: user.uid, fromName: myName });
}

async function declineReq(fromUid) { await remove(ref(db, `users/${user.uid}/friendRequests/incoming/${fromUid}`)); }

on('btn-search-users', 'click', searchUsers);
on('friends-search-input', 'keydown', e => { if (e.key === 'Enter') searchUsers(); });

async function searchUsers() {
  const q = $('friends-search-input').value.trim().toLowerCase();
  if (!q) return;
  const snap = await get(ref(db, 'users'));
  const data = snap.val();
  const sec = $('search-results-section'); const list = $('search-results-list');
  if (!data) { sec.style.display = 'none'; return; }
  const results = Object.entries(data).filter(([uid, v]) => uid !== user.uid && v.name?.toLowerCase().includes(q)).map(([uid, v]) => ({ uid, ...v }));
  if (!results.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  list.innerHTML = results.map(u => {
    const isFriend = friends.some(f => f.uid === u.uid);
    const av = u.avatar ? `<div class="avatar" style="background-image:url(${u.avatar});background-size:cover;background-position:center"></div>` : `<div class="avatar">${(u.name||'?')[0].toUpperCase()}</div>`;
    return `<div class="friend-row" data-uid="${u.uid}">${av}<div style="flex:1"><div class="friend-name">${esc(u.name||'')}</div><div class="friend-sub">${u.friendsCount||0} friends</div></div>${isFriend?'<span style="color:var(--fg3);font-size:9px;font-family:var(--mono);letter-spacing:1px">ДРУГ</span>':`<button class="btn-sm" data-add="${u.uid}" data-aname="${escA(u.name)}">+</button>`}</div>`;
  }).join('');
  list.querySelectorAll('[data-add]').forEach(btn => { btn.addEventListener('click', e => { e.stopPropagation(); sendFriendReq(btn.dataset.add, btn.dataset.aname); }); });
  list.querySelectorAll('.friend-row').forEach(row => { row.addEventListener('click', () => { const u = results.find(r => r.uid === row.dataset.uid); if (u) openFriendProfile(u); }); });
}

async function sendFriendReq(toUid, toName) {
  await set(ref(db, `users/${toUid}/friendRequests/incoming/${user.uid}`), { fromUid: user.uid, fromName: myName, status: 'pending', ts: Date.now() });
  await sendNotification(toUid, { type: 'friend_request', text: `${myName} wants to add you as a friend`, fromUid: user.uid, fromName: myName });
  alert(`Friend request sent to ${toName}`);
}

function openFriendProfile(friend) {
  selectedFriend = friend;
  const isFriend = friends.some(f => f.uid === friend.uid);
  txt('fp-avatar', (friend.name||'?')[0].toUpperCase());
  txt('fp-name', friend.name || '');
  txt('fp-friends-count', (friend.friendsCount || 0) + ' friends');
  if (friend.avatar) { $('fp-avatar-img').style.backgroundImage = `url(${friend.avatar})`; $('fp-avatar-img').style.display = ''; }
  else $('fp-avatar-img').style.display = 'none';
  $('btn-add-friend').style.display = isFriend ? 'none' : '';
  $('fp-already').style.display = isFriend ? '' : 'none';
  const invBtn = $('btn-fp-invite-room');
  if (invBtn) invBtn.style.display = (currentRoom && isFriend) ? '' : 'none';
  openModal('modal-friend-profile');
  if (friend.uid) { get(ref(db, `users/${friend.uid}`)).then(snap => { const d = snap.val(); if (d) txt('fp-friends-count', (d.friendsCount || 0) + ' friends'); }); }
}

on('btn-add-friend', 'click', () => { if (selectedFriend) sendFriendReq(selectedFriend.uid, selectedFriend.name); closeModal(); });
on('btn-fp-invite-room', 'click', async () => {
  if (selectedFriend && currentRoom) {
    await sendRoomInvite(selectedFriend.uid, selectedFriend.name);
    txt('btn-fp-invite-room', 'Sent ✓');
    setTimeout(() => txt('btn-fp-invite-room', 'Invite to room'), 2000);
  }
});

// ===== ACCOUNT =====
on('settings-account-item', 'click', () => { $('account-name-input').value = myName; openModal('modal-account'); });
on('btn-save-name', 'click', async () => {
  const name = $('account-name-input').value.trim();
  if (!name || !user) return;
  await set(ref(db, `users/${user.uid}/name`), name);
  myName = name; updateProfileUI();
  txt('btn-save-name', 'Saved ✓'); setTimeout(() => txt('btn-save-name', 'Save username'), 2000);
});
on('btn-save-pwd', 'click', async () => {
  const pwd = $('account-pwd-input').value;
  if (!pwd || pwd.length < 6) { alert('Minimum 6 characters'); return; }
  try {
    await updatePassword(user, pwd); $('account-pwd-input').value = '';
    txt('btn-save-pwd', 'Saved ✓'); setTimeout(() => txt('btn-save-pwd', 'Save password'), 2000);
  } catch { alert('Please sign in again and retry'); }
});