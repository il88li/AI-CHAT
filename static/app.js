/* ═══════════════════════════════════════════════════════════
   خَيال — Aurora App 6.0
   Composer فيسبوك + Auth مصغّر + استقرار + لا كيبورد تلقائي
   ═══════════════════════════════════════════════════════════ */

(() => {
'use strict';

const K = {
  me: window.__ME__ || null,
  users: {},
  models: ['Midjourney v6', 'DALL·E 3', 'Stable Diffusion XL', 'Flux 1.1 Pro', 'Adobe Firefly']
};


/* ═══ UTILS ═══ */
const U = {
  $: (s, r = document) => r.querySelector(s),
  $$: (s, r = document) => [...r.querySelectorAll(s)],

  esc(s) {
    return s == null ? '' : String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  debounce(fn, ms = 300) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  },

  throttle(fn, ms = 100) {
    let l = 0;
    return (...a) => {
      const n = Date.now();
      if (n - l >= ms) { l = n; fn(...a); }
    };
  },

  fmtNum(n) { return (n || 0).toLocaleString('ar-EG'); },

  fmtDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const diff = (Date.now() - d) / 1000;
    if (diff < 60) return 'الآن';
    if (diff < 3600) return `قبل ${Math.floor(diff / 60)} د`;
    if (diff < 86400) return `قبل ${Math.floor(diff / 3600)} س`;
    if (diff < 604800) return `قبل ${Math.floor(diff / 86400)} ي`;
    return d.toLocaleDateString('ar-EG');
  },

  storage: {
    get(k, f) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    rm(k) { try { localStorage.removeItem(k); } catch {} }
  },

  toast(msg, icon = 'ph-check-circle', undoFn = null) {
    const w = U.$('#toastWrap');
    if (!w) return;
    const el = document.createElement('div');
    el.className = 'toast';
    const undoHtml = undoFn ? `<button class="undo-btn" data-undo>تراجع</button>` : '';
    el.innerHTML = `<i class="ph ${icon}"></i><span>${U.esc(msg)}</span>${undoHtml}`;
    if (undoFn) {
      el.querySelector('[data-undo]').addEventListener('click', () => {
        undoFn(); el.remove();
      });
    }
    w.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(() => el.remove(), 320);
    }, undoFn ? 4200 : 2400);
  },

  autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  },

  copy(text, cb) {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); cb(); }
      catch { U.toast('فشل النسخ', 'ph-warning'); }
      ta.remove();
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(cb).catch(fallback);
    } else fallback();
  },

  speak(text) {
    if (!('speechSynthesis' in window)) {
      U.toast('غير مدعوم', 'ph-warning'); return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 0.95;
    speechSynthesis.speak(u);
    U.toast('يُقرأ البرومبت…', 'ph-speaker-high');
  },

  haptic() { try { navigator.vibrate && navigator.vibrate(8); } catch {} },

  blur() {
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
  }
};


/* ═══ API ═══ */
const API = {
  timeout: 12000,

  async req(method, path, body, retries = 1) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), this.timeout);
    const opt = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      signal: ctrl.signal
    };
    if (body) opt.body = JSON.stringify(body);

    try {
      const r = await fetch(path, opt);
      clearTimeout(tid);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw Object.assign(new Error(err.error || `HTTP ${r.status}`), { status: r.status });
      }
      if (r.status === 204) return null;
      return await r.json();
    } catch (e) {
      clearTimeout(tid);
      if (e.name === 'AbortError') throw new Error('انتهت المهلة');
      if (retries > 0 && (e.message.includes('fetch') || e.status >= 500)) {
        await new Promise(r => setTimeout(r, 500));
        return this.req(method, path, body, retries - 1);
      }
      throw e;
    }
  },

  get: (p) => API.req('GET', p),
  post: (p, b) => API.req('POST', p, b),
  patch: (p, b) => API.req('PATCH', p, b),
  del: (p) => API.req('DELETE', p)
};


/* ═══ PTR ═══ */
const PTR = {
  startY: 0, pulling: false, threshold: 70, wrap: null, indicator: null,

  init() {
    this.wrap = U.$('#ptrWrap');
    this.indicator = U.$('#ptr');
    if (!this.wrap || !this.indicator) return;
    if (!('ontouchstart' in window)) return;

    this.wrap.addEventListener('touchstart', (e) => this.onStart(e), { passive: true });
    this.wrap.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
    this.wrap.addEventListener('touchend', () => this.onEnd(), { passive: true });
    this.wrap.addEventListener('touchcancel', () => this.reset(), { passive: true });
  },

  onStart(e) {
    if (window.scrollY > 0) return;
    if (App.state.tab !== 'home') return;
    this.startY = e.touches[0].clientY;
    this.pulling = false;
  },

  onMove(e) {
    if (!this.startY) return;
    const dy = e.touches[0].clientY - this.startY;
    if (dy <= 0) return;
    if (window.scrollY > 5) return;

    this.pulling = true;
    e.preventDefault();
    const distance = Math.min(dy * 0.5, 100);
    this.indicator.style.marginTop = (-56 + distance) + 'px';
    this.indicator.style.opacity = Math.min(distance / this.threshold, 1);

    if (distance >= this.threshold) {
      this.indicator.classList.add('pulling', 'ready');
    } else {
      this.indicator.classList.add('pulling');
      this.indicator.classList.remove('ready');
    }
  },

  onEnd() {
    if (!this.pulling) { this.reset(); return; }
    const distance = parseFloat(this.indicator.style.marginTop || -56) + 56;
    if (distance >= this.threshold) this.trigger();
    else this.reset();
    this.startY = 0; this.pulling = false;
  },

  async trigger() {
    this.indicator.classList.add('refreshing');
    this.indicator.classList.remove('ready');
    this.indicator.style.marginTop = '16px';
    U.haptic();
    try {
      await App.refreshAll(true);
      U.toast('تم التحديث', 'ph-check-circle');
    } catch {
      U.toast('تعذّر التحديث', 'ph-warning');
    } finally {
      setTimeout(() => this.reset(), 400);
    }
  },

  reset() {
    if (!this.indicator) return;
    this.indicator.classList.remove('pulling', 'ready', 'refreshing');
    this.indicator.style.marginTop = '-56px';
    this.indicator.style.opacity = '0';
  }
};


/* ═══ ROUTER ═══ */
const Router = {
  validTabs: ['home', 'explore', 'liked', 'saved', 'chat', 'profile'],

  init() {
    const hash = location.hash.slice(1);
    if (hash && this.validTabs.includes(hash)) {
      setTimeout(() => App.switchTab(hash, { skipHistory: true }), 120);
    }
    window.addEventListener('hashchange', () => {
      const tab = location.hash.slice(1);
      if (this.validTabs.includes(tab) && tab !== App.state.tab) {
        App.switchTab(tab, { skipHistory: true });
      }
    });
  },

  push(tab) {
    if (!this.validTabs.includes(tab)) return;
    const current = location.hash.slice(1);
    if (current === tab) return;
    try { history.replaceState(null, '', '#' + tab); } catch {}
  }
};


/* ═══ COUNTS ═══ */
const Counts = {
  update() {
    const likedEl = U.$('#likedCount');
    if (likedEl) {
      const n = App.state.posts.filter(p => p.liked).length;
      const span = likedEl.querySelector('span');
      if (span) span.textContent = U.fmtNum(n);
      likedEl.setAttribute('data-count', n);
    }
    const savedEl = U.$('#savedCount');
    if (savedEl) {
      const n = App.state.posts.filter(p => p.saved).length;
      const span = savedEl.querySelector('span');
      if (span) span.textContent = U.fmtNum(n);
      savedEl.setAttribute('data-count', n);
    }
  }
};


/* ═══ IMAGE LOADER ═══ */
const ImageLoader = {
  observe() {
    U.$$('.prompt-img img').forEach(img => {
      if (img.dataset.loadObserved) return;
      img.dataset.loadObserved = '1';

      if (img.complete && img.naturalHeight !== 0) {
        img.classList.add('loaded');
      } else {
        img.classList.add('loading');
        img.addEventListener('load', () => {
          img.classList.add('loaded');
          img.classList.remove('loading');
        }, { once: true });
        img.addEventListener('error', () => img.classList.remove('loading'), { once: true });
      }
    });
  }
};


/* ═══ COMMAND PALETTE ═══ */
const CommandPalette = {
  _items: [],

  open() {
    U.$('#cmdkScrim')?.classList.add('open');
    setTimeout(() => U.$('#cmdkInput')?.focus(), 100);
    this.render('');
  },

  close(e) {
    if (e && e.target !== e.currentTarget) return;
    U.$('#cmdkScrim')?.classList.remove('open');
    const i = U.$('#cmdkInput'); if (i) i.value = '';
  },

  render(query) {
    const q = (query || '').toLowerCase().trim();
    const items = [
      { icon: 'ph-house', label: 'الرئيسية', action: () => App.switchTab('home'), keys: 'G H' },
      { icon: 'ph-compass', label: 'استكشف', action: () => App.switchTab('explore'), keys: 'G E' },
      { icon: 'ph-chat-circle-dots', label: 'الرسائل', action: () => App.switchTab('chat'), keys: 'G C' },
      { icon: 'ph-user', label: 'حسابي', action: () => App.switchTab('profile'), keys: 'G P' },
      { icon: 'ph-heart', label: 'المُعجَبة', action: () => App.switchTab('liked'), keys: 'G L' },
      { icon: 'ph-bookmark-simple', label: 'المحفوظة', action: () => App.switchTab('saved'), keys: 'G S' },
      { icon: 'ph-plus', label: 'منشور جديد', action: () => Composer.open(), keys: 'N' },
      { icon: 'ph-moon', label: 'تبديل المظهر', action: () => App.toggleTheme() },
      { icon: 'ph-magnifying-glass', label: 'بحث', action: () => U.$('#searchInput')?.focus(), keys: '/' },
      { icon: 'ph-sign-out', label: 'تسجيل الخروج', action: () => Auth.logout() }
    ];
    const filtered = items.filter(c => !q || c.label.toLowerCase().includes(q));
    this._items = filtered;

    const results = U.$('#cmdkResults');
    if (!results) return;
    if (!filtered.length) {
      results.innerHTML = '<div style="padding:20px;text-align:center;color:var(--fg-3)">لا نتائج</div>';
      return;
    }
    results.innerHTML = filtered.map((c, i) => `
      <div class="cmdk-item" onclick="CommandPalette.run(${i})">
        <i class="ph ${c.icon}"></i>
        <span>${U.esc(c.label)}</span>
        ${c.keys ? `<kbd>${c.keys}</kbd>` : ''}
      </div>
    `).join('');
  },

  run(i) {
    const item = this._items?.[i];
    if (!item) return;
    this.close();
    setTimeout(() => item.action(), 80);
  }
};


/* ═══ APP ═══ */
const App = {
  state: {
    posts: [], chats: [], filter: 'all', model: 'all', sort: 'recent',
    tab: 'home', activeChat: null, profileTab: 'posts',
    search: '', theme: 'dark', loading: false
  },

  async init() {
    this.state.theme = U.storage.get('khayal_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', this.state.theme);
    this.syncThemeIcon();

    window.addEventListener('scroll', U.throttle(() => {
      const n = U.$('#nav');
      if (n) n.classList.toggle('scrolled', window.scrollY > 20);
    }, 100), { passive: true });

    window.addEventListener('online', () => {
      U.$('#netBar')?.classList.remove('show');
      this.refreshAll(true);
    });
    window.addEventListener('offline', () => U.$('#netBar')?.classList.add('show'));
    if (!navigator.onLine) U.$('#netBar')?.classList.add('show');

    this.bindSearch();
    this.bindProfileTabs();
    this.bindKeyboard();
    this.bindGestures();
    this.renderFilters('filters');
    this.renderFilters('exploreFilters');
    this.renderSortTabs();

    PTR.init();
    Router.init();

    document.addEventListener('mousemove', U.throttle(e => {
      U.$$('.bento-card').forEach(c => {
        const r = c.getBoundingClientRect();
        c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        c.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    }, 80), { passive: true });

    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('/sw.js', { scope: '/' }); } catch {}
    }

    await this.refreshAll();

    if (K.me) { this.applyUser(); this.enterApp(); }

    const params = new URLSearchParams(location.search);
    if (params.get('action') === 'new' && K.me) Composer.open();
  },

  async refreshAll(silent = false) {
    if (this.state.loading) return;
    this.state.loading = true;
    const refreshBtn = U.$('#refreshBtn');
    if (refreshBtn && silent) refreshBtn.classList.add('loading');

    try {
      const [meResult, postsResult] = await Promise.allSettled([
        API.get('/api/me'),
        API.get('/api/posts?limit=100')
      ]);

      K.me = meResult.status === 'fulfilled' ? meResult.value : K.me;
      const posts = postsResult.status === 'fulfilled' ? postsResult.value : [];
      this.state.posts = posts || [];
      this.state.posts.forEach(p => {
        if (p.author_data) K.users[p.author_data.id] = p.author_data;
      });

      const hp = U.$('#heroStatPosts');
      if (hp) hp.textContent = U.fmtNum(this.state.posts.length);
      const hu = U.$('#heroStatUsers');
      if (hu) hu.textContent = U.fmtNum(Object.keys(K.users).length);

      if (K.me) {
        try { this.state.chats = await API.get('/api/chats'); }
        catch { this.state.chats = []; }
      } else this.state.chats = [];

      this.renderLandingPreview();
      this.renderAllFeeds();
      if (K.me) Chat.render();
      Counts.update();
      ImageLoader.observe();
    } catch (e) {
      console.error('refreshAll', e);
      if (!silent) U.toast('تعذّر التحميل', 'ph-warning');
      throw e;
    } finally {
      this.state.loading = false;
      if (refreshBtn) refreshBtn.classList.remove('loading');
    }
  },

  goHome() { this.showView('view-landing'); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  scrollTo(id) { U.$('#' + id)?.scrollIntoView({ behavior: 'smooth' }); },

  showView(id) {
    U.$$('.view').forEach(v => v.classList.remove('active'));
    U.$('#' + id)?.classList.add('active');
    const d = U.$('#dock');
    if (d) d.style.display = id === 'view-app' ? 'flex' : 'none';
  },

  previewFeed() { if (!K.me) { Auth.open(); return; } this.enterApp(); },

  enterApp() {
    this.showView('view-app');
    this.switchTab('home');
    this.renderAllFeeds();
    if (K.me) Chat.render();
    this.updateProfileStats();
  },

  switchTab(tab, options = {}) {
    if (!Router.validTabs.includes(tab)) tab = 'home';
    this.state.tab = tab;
    U.$$('.tab-panel').forEach(p => p.classList.remove('active'));
    U.$('#tab-' + tab)?.classList.add('active');
    U.$$('.dock-item[data-tab]').forEach(i => i.classList.toggle('active', i.dataset.tab === tab));

    if (tab === 'chat') { Chat.render(); U.$('#chatLayout')?.classList.remove('show-list'); }
    if (tab === 'profile') this.renderProfilePanel();
    if (tab === 'home') this.renderHomeFeed();
    if (tab === 'explore') this.renderExploreFeed();
    if (tab === 'liked') this.renderLikedFeed();
    if (tab === 'saved') this.renderSavedFeed();

    if (!options.skipHistory) Router.push(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    U.haptic();
    requestAnimationFrame(() => ImageLoader.observe());
  },

  toggleTheme() {
    this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', this.state.theme);
    U.storage.set('khayal_theme', this.state.theme);
    this.syncThemeIcon();
    U.haptic();
  },

  syncThemeIcon() {
    const i = U.$('#themeIcon');
    if (i) i.className = this.state.theme === 'dark' ? 'ph ph-moon' : 'ph ph-sun';
  },

  renderFilters(id) {
    const el = U.$('#' + id);
    if (!el) return;
    const tags = ['all', 'بورتريه', 'مناظر', 'سايبربانك', 'ثلاثي الأبعاد', 'فيلم', 'معمار', 'تصوير', 'سينمائي'];
    const labels = { all: 'الكل' };

    let html = tags.map(t => {
      const a = this.state.filter === t ? ' active' : '';
      return `<button class="filter${a}" onclick="App.setFilter('${t}')">${labels[t] || '#' + t}</button>`;
    }).join('');

    html += `<span style="width:1px;background:var(--glass-border);margin:0 var(--s2);flex-shrink:0"></span>`;
    html += K.models.map(m => {
      const a = this.state.model === m ? ' active' : '';
      return `<button class="filter${a}" onclick="App.setModel('${m}')"><i class="ph ph-cpu"></i> ${m}</button>`;
    }).join('');

    el.innerHTML = html;
  },

  setFilter(f) {
    this.state.filter = f;
    this.renderFilters('filters');
    this.renderFilters('exploreFilters');
    this.renderHomeFeed();
    this.renderExploreFeed();
  },

  setModel(m) {
    this.state.model = this.state.model === m ? 'all' : m;
    this.renderFilters('filters');
    this.renderFilters('exploreFilters');
    this.renderHomeFeed();
    this.renderExploreFeed();
  },

  renderSortTabs() {
    U.$$('.sort-tab').forEach(b => b.classList.toggle('active', b.dataset.sort === this.state.sort));
  },

  setSort(s) { this.state.sort = s; this.renderSortTabs(); this.renderHomeFeed(); },

  filterPosts() {
    let posts = this.state.posts.slice();
    const { filter, model, search, sort } = this.state;
    if (filter !== 'all' && filter !== 'following') {
      posts = posts.filter(p => (p.tags || []).includes(filter));
    }
    if (model !== 'all') posts = posts.filter(p => p.model === model);
    if (search) {
      const q = search.toLowerCase();
      posts = posts.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.prompt.toLowerCase().includes(q) ||
        (p.tags || []).some(t => t.includes(q))
      );
    }
    if (sort === 'top') posts.sort((a, b) => b.likes - a.likes);
    return posts;
  },

  renderHomeFeed() { Feed.render('homeFeed', this.filterPosts()); },
  renderExploreFeed() { Feed.render('exploreFeed', this.state.posts.slice().sort((a, b) => b.likes - a.likes)); },
  renderLikedFeed() {
    Feed.render('likedFeed', this.state.posts.filter(p => p.liked),
      'لا إعجابات بعد', 'اضغط القلب في أي منشور ليظهر هنا.');
    Counts.update();
  },
  renderSavedFeed() {
    Feed.render('savedFeed', this.state.posts.filter(p => p.saved),
      'لا شيء محفوظ بعد', 'احفظ المنشورات لتعود إليها.');
    Counts.update();
  },
  renderLandingPreview() { Feed.render('landingFeed', this.state.posts.slice(0, 6), null, null, true); },

  renderAllFeeds() {
    this.renderHomeFeed();
    if (this.state.tab === 'explore') this.renderExploreFeed();
    if (this.state.tab === 'liked') this.renderLikedFeed();
    if (this.state.tab === 'saved') this.renderSavedFeed();
    this.updateProfileStats();
    this.updateBadges();
    Counts.update();
    requestAnimationFrame(() => ImageLoader.observe());
  },

  updateProfileStats() {
    if (!K.me) return;
    const mine = this.state.posts.filter(p => p.author === K.me.id);
    const set = (id, v) => { const e = U.$('#' + id); if (e) e.textContent = U.fmtNum(v); };
    set('statPosts', mine.length);
    set('statLikes', mine.reduce((a, p) => a + p.likes, 0));
    set('statFollowers', K.me.followers || 0);
    set('statFollowing', K.me.following || 0);
  },

  updateBadges() {
    const unread = this.state.chats.reduce((a, c) => a + (c.unread || 0), 0);
    const b = U.$('#dockChatBadge');
    if (b) { b.textContent = U.fmtNum(unread); b.style.display = unread ? 'grid' : 'none'; }
  },

  bindSearch() {
    const input = U.$('#searchInput');
    const results = U.$('#searchResults');
    if (!input || !results) return;

    const doSearch = U.debounce(async (q) => {
      if (!q) { results.classList.remove('open'); this.renderHomeFeed(); return; }
      try {
        const matches = await API.get(`/api/posts?q=${encodeURIComponent(q)}&limit=6`);
        if (!matches.length) {
          results.innerHTML = '<div style="padding:20px;text-align:center;color:var(--fg-3);font-size:13px">لا نتائج</div>';
        } else {
          results.innerHTML = matches.map(p => `
            <div class="search-result" onclick="App.openPostFromSearch(${p.id})">
              <img src="${p.image || ''}" alt="" loading="lazy">
              <div class="search-result-info">
                <strong>${U.esc(p.title)}</strong>
                <span>${U.esc(p.prompt)}</span>
              </div>
            </div>
          `).join('');
        }
        results.classList.add('open');
      } catch {}
    }, 280);

    input.addEventListener('input', e => {
      const q = e.target.value.trim();
      this.state.search = q;
      if (this.state.tab !== 'home') this.switchTab('home');
      else this.renderHomeFeed();
      doSearch(q);
    });

    input.addEventListener('blur', () => setTimeout(() => results.classList.remove('open'), 200));
    input.addEventListener('focus', () => { if (input.value.trim()) results.classList.add('open'); });
  },

  async openPostFromSearch(id) {
    try {
      const p = await API.get(`/api/posts/${id}`);
      U.copyText(p.prompt, async () => {
        U.toast('تم نسخ البرومبت', 'ph-copy');
        try { await API.post(`/api/posts/${id}/copy`); } catch {}
      });
      U.$('#searchResults')?.classList.remove('open');
      U.$('#searchInput').value = '';
      this.state.search = '';
    } catch {}
  },

  bindProfileTabs() {
    U.$$('#profileTabs .tab').forEach(t => t.addEventListener('click', () => {
      U.$$('#profileTabs .tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      this.state.profileTab = t.dataset.ptab;
      this.renderProfilePanel();
    }));
  },

  renderProfilePanel() {
    const panel = U.$('#profilePanel');
    if (!panel) return;
    const tab = this.state.profileTab;
    if (tab === 'posts') {
      const mine = K.me ? this.state.posts.filter(p => p.author === K.me.id) : [];
      panel.innerHTML = '<div class="feed" id="profilePostsFeed"></div>';
      Feed.render('profilePostsFeed', mine, 'لم تنشر منشوراً بعد', 'شارِك أول واحد.');
    } else if (tab === 'liked') {
      const liked = this.state.posts.filter(p => p.liked);
      panel.innerHTML = '<div class="feed" id="profileLikedFeed"></div>';
      Feed.render('profileLikedFeed', liked, 'لا إعجابات بعد', 'اضغط القلب في أي منشور.');
    } else if (tab === 'settings') {
      panel.innerHTML = `
        <div class="settings-list">
          ${this.settingRow('إشعارات البريد', 'احصل على إشعار عند الإعجاب', true)}
          ${this.settingRow('ملف عام', 'يمكن لأي شخص رؤية منشوراتك', true)}
          ${this.settingRow('تقليل الحركة', 'تقليل الرسوم المتحركة', false)}
        </div>
      `;
      U.$$('.switch').forEach(s => s.addEventListener('click', () => {
        const on = s.getAttribute('aria-checked') === 'true';
        s.setAttribute('aria-checked', String(!on));
        U.haptic();
      }));
    }
  },

  settingRow(title, desc, on) {
    return `<div class="setting-row">
      <div class="meta"><strong>${title}</strong><span>${desc}</span></div>
      <button class="switch" role="switch" aria-checked="${on}" aria-label="${title}"></button>
    </div>`;
  },

  async openPublisher(uid) {
    try {
      const [u, posts] = await Promise.all([
        API.get(`/api/users/${uid}`),
        API.get(`/api/users/${uid}/posts`)
      ]);
      const isMe = K.me && K.me.id === u.id;
      U.$('#commentsBody').innerHTML = `
        <div style="padding:var(--s6);text-align:center;position:relative">
          <div style="position:absolute;top:0;left:0;right:0;height:100px;background:linear-gradient(135deg,rgba(34,211,238,.3),rgba(139,92,246,.3))"></div>
          <img src="${u.avatar}" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:4px solid var(--bg-0);position:relative;margin:40px auto 0">
          <h3 style="margin-top:var(--s4);font-size:var(--t-2xl);font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px">
            ${U.esc(u.name)}${u.verified ? '<i class="ph ph-seal-check" style="color:var(--cyan);font-size:22px"></i>' : ''}
          </h3>
          <div style="color:var(--fg-3);font-size:var(--t-sm);margin-top:4px">${U.esc(u.handle)}</div>
          <p style="margin-top:var(--s4);color:var(--fg-2);line-height:1.7;max-width:44ch;margin-inline:auto">${U.esc(u.bio || '')}</p>
          <div class="profile-stats" style="justify-content:center;margin-top:var(--s5)">
            <div class="stat"><strong>${U.fmtNum(posts.length)}</strong><span>منشور</span></div>
            <div class="stat"><strong>${U.fmtNum(u.followers)}</strong><span>متابِع</span></div>
            <div class="stat"><strong>${U.fmtNum(u.following)}</strong><span>يتابع</span></div>
          </div>
          ${!isMe ? `
          <div style="display:flex;gap:var(--s2);justify-content:center;margin-top:var(--s5);flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="App.followUser(${u.id},this)"><i class="ph ph-user-plus"></i> متابعة</button>
            <button class="btn btn-glass btn-sm" onclick="Chat.openWithUser(${u.id})"><i class="ph ph-chat-circle-dots"></i> راسل</button>
          </div>` : ''}
        </div>`;
      const cf = U.$('#commentForm');
      if (cf) cf.style.display = 'none';
      U.$('#commentsDrawer').classList.add('open');
      document.body.style.overflow = 'hidden';
    } catch (e) {
      U.toast('تعذّر التحميل', 'ph-warning');
    }
  },

  async followUser(uid, btn) {
    if (!K.me) { Auth.open(); return; }
    try {
      const r = await API.post(`/api/users/${uid}/follow`);
      btn.innerHTML = r.following ? '<i class="ph ph-check"></i> تتابعه' : '<i class="ph ph-user-plus"></i> متابعة';
      btn.classList.toggle('btn-primary', !r.following);
      btn.classList.toggle('btn-glass', r.following);
      U.toast(r.following ? 'بدأت المتابعة' : 'أُلغيت المتابعة');
      U.haptic();
    } catch (e) { U.toast(e.message, 'ph-warning'); }
  },

  bindKeyboard() {
    let lastG = 0;
    document.addEventListener('keydown', e => {
      const t = e.target;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) {
        if (e.key === 'Escape') t.blur();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); CommandPalette.open(); return; }
      if (e.key === 'Escape') {
        U.$$('.scrim').forEach(s => s.classList.remove('open'));
        U.$$('.drawer').forEach(d => d.classList.remove('open'));
        CommandPalette.close();
        document.body.style.overflow = '';
        return;
      }
      if (e.key === '/') { e.preventDefault(); U.$('#searchInput')?.focus(); return; }
      if (e.key === 'n') { e.preventDefault(); Composer.open(); return; }
      if (e.key === 'g') { lastG = Date.now(); return; }
      if (Date.now() - lastG < 800) {
        const map = { h: 'home', e: 'explore', c: 'chat', p: 'profile', l: 'liked', s: 'saved' };
        const k = e.key.toLowerCase();
        if (map[k]) { this.switchTab(map[k]); lastG = 0; }
      }
    });
  },

  bindGestures() {
    let sx = 0, sy = 0;
    const layout = U.$('#chatLayout');
    if (!layout) return;
    layout.addEventListener('touchstart', e => {
      if (window.innerWidth > 820) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    layout.addEventListener('touchend', e => {
      if (window.innerWidth > 820) return;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = Math.abs(e.changedTouches[0].clientY - sy);
      if (dy > 40) return;
      if (dx > 80 && layout.classList.contains('show-list')) layout.classList.remove('show-list');
      else if (dx < -80 && !layout.classList.contains('show-list')) layout.classList.add('show-list');
    }, { passive: true });
  },

  applyUser() {
    const u = K.me;
    if (!u) return;
    U.$('#signInBtn').style.display = 'none';
    U.$('#avatarBtn').style.display = 'grid';
    const av = U.$('#avatarImg'); if (av) av.src = u.avatar;
    const pn = U.$('#profileName'); if (pn) pn.textContent = u.name;
    const ph = U.$('#profileHandle'); if (ph) ph.textContent = u.handle;
    const pb = U.$('#profileBio'); if (pb) pb.textContent = u.bio || '';
    const pa = U.$('#profileAvatar'); if (pa) pa.src = u.avatar;
    const ca = U.$('#composerAvatar'); if (ca) ca.src = u.avatar;
  }
};


/* ═══ FEED ═══ */
const Feed = {
  render(id, posts, emptyT, emptyB, compact) {
    const el = U.$('#' + id);
    if (!el) return;

    if (!posts.length) {
      el.innerHTML = `<div class="empty">
        <i class="ph ph-sparkle"></i>
        <h4>${emptyT || 'لا توجد منشورات'}</h4>
        <p>${emptyB || 'جرّب فلتراً آخر.'}</p>
      </div>`;
      return;
    }

    requestAnimationFrame(() => {
      el.innerHTML = posts.map(p => this.card(p, compact)).join('');
      requestAnimationFrame(() => ImageLoader.observe());
    });
  },

  card(p, compact) {
    const a = p.author_data || K.users[p.author] || { name: 'غير معروف', handle: '@?', avatar: '' };
    if (a.id) K.users[a.id] = a;
    const tags = (p.tags || []).slice(0, 3).map(t =>
      `<span class="tag" onclick="event.stopPropagation();App.setFilter('${U.esc(t)}')">#${U.esc(t)}</span>`
    ).join('');
    const v = a.verified ? '<i class="ph ph-seal-check verified"></i>' : '';
    const hasImage = !!p.image;

    return `<article class="prompt-card ${hasImage ? '' : 'no-image'}" data-post="${p.id}">
      ${hasImage ? `
      <div class="prompt-img" onclick="App.openPublisher(${a.id || p.author})">
        <img src="${p.image}" alt="${U.esc(p.title)}" loading="lazy" decoding="async"
             onerror="this.style.display='none';this.parentElement.style.background='linear-gradient(135deg,rgba(34,211,238,.2),rgba(139,92,246,.2))'">
        <span class="model-tag"><i class="ph ph-cpu"></i> ${U.esc(p.model || '')}</span>
        <div class="card-actions-top" onclick="event.stopPropagation()">
          <button class="glass-btn ${p.liked ? 'liked' : ''}" data-like="${p.id}" onclick="Feed.toggleLike(${p.id})" aria-label="إعجاب">
            <i class="ph${p.liked ? '-fill' : ''} ph-heart"></i>
          </button>
          <button class="glass-btn ${p.saved ? 'saved' : ''}" data-save="${p.id}" onclick="Feed.toggleSave(${p.id})" aria-label="حفظ">
            <i class="ph${p.saved ? '-fill' : ''} ph-bookmark-simple"></i>
          </button>
        </div>
      </div>` : `
      <div style="padding:14px 16px 0;display:flex;justify-content:space-between;align-items:center">
        <span class="model-tag" style="position:static"><i class="ph ph-cpu"></i> ${U.esc(p.model || 'منشور نصي')}</span>
        <div style="display:flex;gap:6px">
          <button class="glass-btn ${p.liked ? 'liked' : ''}" data-like="${p.id}" onclick="Feed.toggleLike(${p.id})" aria-label="إعجاب" style="position:static">
            <i class="ph${p.liked ? '-fill' : ''} ph-heart"></i>
          </button>
          <button class="glass-btn ${p.saved ? 'saved' : ''}" data-save="${p.id}" onclick="Feed.toggleSave(${p.id})" aria-label="حفظ" style="position:static">
            <i class="ph${p.saved ? '-fill' : ''} ph-bookmark-simple"></i>
          </button>
        </div>
      </div>`}
      <div class="prompt-body">
        <div class="author-row" onclick="App.openPublisher(${a.id || p.author})">
          <img class="author-avatar" src="${a.avatar || ''}" alt="" loading="lazy">
          <div class="author-info">
            <span class="author-name">${U.esc(a.name)}${v}</span>
            <span class="author-meta">${U.esc(a.handle)} · ${U.fmtDate(p.time)}</span>
          </div>
        </div>
        <h3 class="prompt-title">${U.esc(p.title)}</h3>
        <div class="prompt-excerpt" onclick="event.stopPropagation();Feed.copyPrompt(${p.id})" title="انقر للنسخ">${U.esc(p.prompt)}</div>
        <div class="prompt-tags">${tags}</div>
      </div>
      <div class="prompt-actions">
        <button class="action ${p.liked ? 'liked' : ''}" data-like-action="${p.id}" onclick="Feed.toggleLike(${p.id})">
          <i class="ph${p.liked ? '-fill' : ''} ph-heart"></i>
          <span data-like-count="${p.id}">${U.fmtNum(p.likes)}</span>
        </button>
        <button class="action" onclick="Drawers.openComments(${p.id})" aria-label="تعليقات">
          <i class="ph ph-chat-circle"></i>
          <span data-comment-count="${p.id}">${U.fmtNum(p.comments || 0)}</span>
        </button>
        <button class="action" onclick="Feed.share(${p.id})" aria-label="مشاركة">
          <i class="ph ph-share-network"></i>
        </button>
        <button class="action" onclick="U.speak(${JSON.stringify(p.prompt)})" aria-label="استماع">
          <i class="ph ph-speaker-high"></i>
        </button>
        ${!compact ? `
        <button class="action action-primary" data-copy="${p.id}" onclick="Feed.copyPrompt(${p.id})">
          <i class="ph ph-copy"></i><span>نسخ</span>
        </button>` : `
        <button class="action" data-copy="${p.id}" onclick="Feed.copyPrompt(${p.id})">
          <i class="ph ph-copy"></i><span data-copies="${p.id}">${U.fmtNum(p.copies)}</span>
        </button>`}
      </div>
    </article>`;
  },

  async toggleLike(id) {
    if (!K.me) { Auth.open(); return; }
    const p = App.state.posts.find(x => x.id === id);
    if (!p) return;
    const wasLiked = p.liked;
    p.liked = !p.liked;
    p.likes += p.liked ? 1 : -1;
    this.syncCard(p);
    U.haptic();

    try {
      const r = await API.post(`/api/posts/${id}/like`);
      p.liked = r.liked; p.likes = r.likes;
      this.syncCard(p);
      Counts.update();
    } catch (e) {
      p.liked = wasLiked;
      p.likes += wasLiked ? 1 : -1;
      this.syncCard(p);
      U.toast(e.message, 'ph-warning');
    }
  },

  async toggleSave(id) {
    if (!K.me) { Auth.open(); return; }
    const p = App.state.posts.find(x => x.id === id);
    if (!p) return;
    const wasSaved = p.saved;
    p.saved = !p.saved;
    p.saves = (p.saves || 0) + (p.saved ? 1 : -1);
    this.syncCard(p);
    U.haptic();

    try {
      const r = await API.post(`/api/posts/${id}/save`);
      p.saved = r.saved; p.saves = r.saves;
      this.syncCard(p);
      Counts.update();
      U.toast(r.saved ? 'حُفظ' : 'أُزيل', 'ph-bookmark-simple');
    } catch (e) {
      p.saved = wasSaved;
      p.saves = (p.saves || 0) + (wasSaved ? 1 : -1);
      this.syncCard(p);
      U.toast(e.message, 'ph-warning');
    }
  },

  syncCard(p) {
    U.$$(`[data-like="${p.id}"]`).forEach(b => {
      b.classList.toggle('liked', p.liked);
      const i = b.querySelector('i'); if (i) i.className = `ph${p.liked ? '-fill' : ''} ph-heart`;
    });
    U.$$(`[data-save="${p.id}"]`).forEach(b => {
      b.classList.toggle('saved', p.saved);
      const i = b.querySelector('i'); if (i) i.className = `ph${p.saved ? '-fill' : ''} ph-bookmark-simple`;
    });
    U.$$(`[data-like-action="${p.id}"]`).forEach(b => {
      b.classList.toggle('liked', p.liked);
      const i = b.querySelector('i'); if (i) i.className = `ph${p.liked ? '-fill' : ''} ph-heart`;
    });
    U.$$(`[data-like-count="${p.id}"]`).forEach(el => el.textContent = U.fmtNum(p.likes));
  },

  async copyPrompt(id) {
    const p = App.state.posts.find(x => x.id === id);
    if (!p) return;
    U.copyText(p.prompt, async () => {
      U.$$(`[data-copy="${id}"]`).forEach(btn => {
        btn.classList.add('copied');
        const lbl = btn.querySelector('span');
        const orig = lbl ? lbl.textContent : '';
        if (lbl) lbl.textContent = 'تم النسخ';
        setTimeout(() => { btn.classList.remove('copied'); if (lbl) lbl.textContent = orig; }, 1600);
      });
      U.toast('تم نسخ البرومبت', 'ph-copy');
      U.haptic();
      try {
        const r = await API.post(`/api/posts/${id}/copy`);
        U.$$(`[data-copies="${id}"]`).forEach(el => el.textContent = U.fmtNum(r.copies));
      } catch {}
    });
  },

  share(id) {
    const p = App.state.posts.find(x => x.id === id);
    if (!p) return;
    const url = location.origin + '/#prompt-' + id;
    if (navigator.share) navigator.share({ title: p.title, text: p.prompt.slice(0, 100), url }).catch(() => {});
    else U.copyText(url, () => U.toast('تم نسخ الرابط', 'ph-link'));
  }
};


/* ═══ COMPOSER — نمط فيسبوك ═══ */
const Composer = {
  _mode: null,

  open() {
    if (!K.me) { Auth.open(); return; }

    this._mode = null;
    U.$$('.type-card').forEach(c => c.classList.remove('active'));
    const form = U.$('#composerForm');
    if (form) { form.style.display = 'none'; form.reset(); }
    U.$('#composerTypes').style.display = 'grid';
    U.$('#imageField').style.display = 'none';

    const av = U.$('#composerFormAvatar');
    if (av && K.me.avatar) av.src = K.me.avatar;
    const nm = U.$('#composerUserName');
    if (nm) nm.textContent = K.me.name;

    U.$('#composerModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    // ❌ لا كيبورد تلقائي
  },

  close(e) {
    if (e && e.target !== e.currentTarget) return;
    U.$('#composerModal').classList.remove('open');
    document.body.style.overflow = '';
    U.blur();
    setTimeout(() => {
      const form = U.$('#composerForm');
      if (form) { form.reset(); form.style.display = 'none'; }
      U.$$('.type-card').forEach(c => c.classList.remove('active'));
      U.$('#composerTypes').style.display = 'grid';
      U.$('#imageField').style.display = 'none';
      this._mode = null;
    }, 300);
  },

  chooseType(type) {
    this._mode = type;
    U.$$('.type-card').forEach(c => c.classList.toggle('active', c.dataset.type === type));

    const form = U.$('#composerForm');
    if (form) form.style.display = 'flex';

    const imgField = U.$('#imageField');
    const promptTextarea = U.$('#cPrompt');
    const imgInput = U.$('#cImage');

    if (type === 'prompt') {
      if (imgField) imgField.style.display = 'flex';
      if (imgInput) imgInput.required = true;
      if (promptTextarea) promptTextarea.placeholder = 'Paste the exact prompt here…';
    } else {
      if (imgField) imgField.style.display = 'none';
      if (imgInput) imgInput.required = false;
      if (promptTextarea) promptTextarea.placeholder = 'اكتب برومبتك أو نصاً…';
    }
    // ❌ لا كيبورد تلقائي
  },

  async publish(e) {
    e.preventDefault();
    if (!K.me) { Auth.open(); return; }
    if (!this._mode) { U.toast('اختر نوع المنشور أولاً', 'ph-warning'); return; }

    const btn = U.$('#composerSubmit');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = '<span>جارٍ…</span>';

    const body = {
      title: (U.$('#cTitle').value || '').trim(),
      prompt: (U.$('#cPrompt').value || '').trim(),
      image: (U.$('#cImage')?.value || '').trim(),
      model: U.$('#cModel').value,
      tags: (U.$('#cTags').value || '').split(/[,،]/).map(t => t.trim()).filter(Boolean)
    };

    if (!body.title) { U.toast('أدخل عنواناً', 'ph-warning'); btn.disabled = false; btn.classList.remove('loading'); btn.innerHTML = orig; return; }
    if (!body.prompt) { U.toast('أدخل نص البرومبت', 'ph-warning'); btn.disabled = false; btn.classList.remove('loading'); btn.innerHTML = orig; return; }
    if (this._mode === 'prompt' && !body.image) { U.toast('أدخل رابط الصورة', 'ph-warning'); btn.disabled = false; btn.classList.remove('loading'); btn.innerHTML = orig; return; }

    try {
      const post = await API.post('/api/posts', body);
      App.state.posts.unshift(post);
      if (post.author_data) K.users[post.author_data.id] = post.author_data;

      this.close();
      App.renderAllFeeds();
      U.toast('نُشر المنشور بنجاح', 'ph-sparkle');
      U.haptic();

      App.switchTab('profile');
      App.state.profileTab = 'posts';
      U.$$('#profileTabs .tab').forEach(x => x.classList.toggle('active', x.dataset.ptab === 'posts'));
      App.renderProfilePanel();
    } catch (err) {
      U.toast(err.message, 'ph-warning');
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.innerHTML = orig;
    }
  }
};


/* ═══ AUTH ═══ */
const Auth = {
  open(mode = 'login') {
    U.$('#authModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    this.switchMode(mode);
    // ❌ لا كيبورد تلقائي
  },

  close(e) {
    if (e && e.target !== e.currentTarget) return;
    U.$('#authModal').classList.remove('open');
    document.body.style.overflow = '';
    U.blur();
    setTimeout(() => {
      U.$('#loginForm')?.reset();
      U.$('#registerForm')?.reset();
      const ps = U.$('#pwStrength'); if (ps) ps.dataset.level = '0';
    }, 350);
  },

  switchMode(mode) {
    U.$$('.auth-mini-form').forEach(f => {
      f.classList.toggle('active',
        (mode === 'login' && f.id === 'loginForm') ||
        (mode === 'register' && f.id === 'registerForm')
      );
    });
    const title = U.$('#authMiniTitle');
    const sub = U.$('#authMiniSub');
    if (title) title.textContent = mode === 'login' ? 'تسجيل الدخول' : 'حساب جديد';
    if (sub) sub.textContent = mode === 'login' ? 'أهلاً بعودتك إلى خَيال' : 'دقيقة واحدة للانضمام';
    // ❌ لا كيبورد تلقائي
  },

  togglePassword(btn) {
    const input = btn.parentElement.querySelector('input');
    const icon = btn.querySelector('i');
    if (input.type === 'password') {
      input.type = 'text';
      icon.className = 'ph ph-eye-slash';
    } else {
      input.type = 'password';
      icon.className = 'ph ph-eye';
    }
  },

  checkStrength(pw) {
    const bar = U.$('#pwStrength');
    if (!bar) return;
    if (!pw) { bar.dataset.level = '0'; return; }
    let score = 0;
    if (pw.length >= 6) score++;
    if (pw.length >= 10) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
    bar.dataset.level = String(Math.max(1, Math.min(4, score)));
  },

  async login(e) {
    e.preventDefault();
    const btn = U.$('#loginSubmit');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = '<span>جارٍ…</span>';

    try {
      const user = await API.post('/api/auth/login', {
        identifier: U.$('#loginIdentifier').value.trim(),
        password: U.$('#loginPassword').value,
        remember: true
      });
      K.me = user;
      this.close();
      App.applyUser();
      await App.refreshAll();
      App.enterApp();
      U.toast('أهلاً ' + user.name + '!', 'ph-hand-waving');
      U.haptic();
    } catch (err) {
      U.toast(err.message, 'ph-warning');
      const card = U.$('.auth-mini');
      if (card) { card.style.animation = 'none'; setTimeout(() => card.style.animation = 'shake .4s', 10); }
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.innerHTML = orig;
    }
  },

  async register(e) {
    e.preventDefault();
    const btn = U.$('#registerSubmit');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = '<span>جارٍ…</span>';

    try {
      const user = await API.post('/api/auth/register', {
        name: U.$('#regName').value.trim(),
        username: U.$('#regUsername').value.trim(),
        email: U.$('#regEmail').value.trim(),
        password: U.$('#regPassword').value
      });
      K.me = user;
      this.close();
      App.applyUser();
      await App.refreshAll();
      App.enterApp();
      U.toast('مرحباً بك في خَيال!', 'ph-confetti');
      U.haptic();
    } catch (err) {
      U.toast(err.message, 'ph-warning');
      const card = U.$('.auth-mini');
      if (card) { card.style.animation = 'none'; setTimeout(() => card.style.animation = 'shake .4s', 10); }
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.innerHTML = orig;
    }
  },

  async logout() {
    try { await API.post('/api/auth/logout'); } catch {}
    K.me = null;
    App.state.posts = [];
    App.state.chats = [];
    U.$('#signInBtn').style.display = '';
    U.$('#avatarBtn').style.display = 'none';
    App.showView('view-landing');
    U.toast('تم تسجيل الخروج', 'ph-sign-out');
    try { history.replaceState(null, '', '/'); } catch {}
  },

  openEditProfile() {
    if (!K.me) return;
    U.$('#epName').value = K.me.name;
    U.$('#epBio').value = K.me.bio || '';
    U.$('#epAvatar').value = K.me.avatar || '';
    U.$('#editProfileModal').classList.add('open');
    document.body.style.overflow = 'hidden';
  },

  closeEditProfile(e) {
    if (e && e.target !== e.currentTarget) return;
    U.$('#editProfileModal').classList.remove('open');
    document.body.style.overflow = '';
    U.blur();
  },

  async saveProfile(e) {
    e.preventDefault();
    try {
      const updated = await API.patch('/api/me', {
        name: U.$('#epName').value.trim(),
        bio: U.$('#epBio').value.trim(),
        avatar: U.$('#epAvatar').value.trim()
      });
      K.me = { ...K.me, ...updated };
      this.closeEditProfile();
      App.applyUser();
      U.toast('تم الحفظ', 'ph-check-circle');
    } catch (e) { U.toast(e.message, 'ph-warning'); }
  }
};


/* ═══ CHAT ═══ */
const Chat = {
  render() {
    const list = U.$('#chatList'); if (!list) return;
    if (!App.state.chats.length) {
      list.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--fg-3);font-size:13px">
        لا محادثات بعد.<br><br>ابدأ محادثة من ملف أي مبدع.
      </div>`;
      this.renderThread(); return;
    }
    list.innerHTML = App.state.chats.map(c => {
      const u = c.with_user || { name: '?', avatar: '' };
      const active = c.id === App.state.activeChat;
      return `<div class="chat-item ${active ? 'active' : ''} ${c.unread ? 'unread' : ''}" onclick="Chat.open(${c.id})">
        <img class="author-avatar" src="${u.avatar || ''}" alt="" loading="lazy">
        <div class="chat-item-info">
          <div class="chat-item-top">
            <span class="chat-name">${U.esc(u.name)}</span>
            <span class="chat-time">${c.time || ''}</span>
          </div>
          <div class="chat-preview">${U.esc(c.last || '')}</div>
        </div>
        ${c.unread ? '<span class="unread-dot"></span>' : ''}
      </div>`;
    }).join('');
    if (!App.state.activeChat && App.state.chats[0]) App.state.activeChat = App.state.chats[0].id;
    this.renderThread();
    App.updateBadges();
  },

  open(id) {
    App.state.activeChat = id;
    this.render();
    const layout = U.$('#chatLayout');
    if (layout && window.innerWidth > 820) layout.classList.add('show-list');
    if (layout && window.innerWidth <= 820) layout.classList.remove('show-list');
    U.haptic();
  },

  async openWithUser(uid) {
    if (!K.me) { Auth.open(); return; }
    U.$$('.drawer').forEach(d => d.classList.remove('open'));
    document.body.style.overflow = '';
    try {
      const r = await API.post(`/api/chats/with/${uid}`);
      App.state.chats = await API.get('/api/chats');
      App.state.activeChat = r.id;
      App.switchTab('chat');
    } catch (e) { U.toast(e.message, 'ph-warning'); }
  },

  async renderThread() {
    const cid = App.state.activeChat;
    const head = U.$('#chatHead');
    const body = U.$('#chatBody');
    if (!head || !body) return;
    if (!cid) { head.innerHTML = ''; body.innerHTML = ''; return; }
    const chat = App.state.chats.find(x => x.id === cid);
    if (!chat) { head.innerHTML = ''; body.innerHTML = ''; return; }
    const u = chat.with_user || { name: '?', avatar: '', id: 0 };

    head.innerHTML = `
      <button class="icon-btn" onclick="Chat.backToList()" style="display:${window.innerWidth <= 820 ? 'grid' : 'none'}">
        <i class="ph ph-arrow-right"></i>
      </button>
      <img class="author-avatar" src="${u.avatar || ''}" alt="">
      <div class="chat-head-info">
        <strong>${U.esc(u.name)}</strong>
        <span>متصل الآن</span>
      </div>
      <button class="icon-btn" onclick="App.openPublisher(${u.id || 0})" aria-label="الملف">
        <i class="ph ph-user-circle"></i>
      </button>
    `;

    try {
      const msgs = await API.get(`/api/chats/${cid}/messages`);
      body.innerHTML = msgs.map(m => `
        <div class="msg ${m.from === 'me' ? 'me' : 'them'}">
          ${U.esc(m.text).replace(/\n/g, '<br>')}
          <span class="msg-time">${m.time}</span>
        </div>
      `).join('');
      body.scrollTop = body.scrollHeight;
    } catch { body.innerHTML = ''; }
  },

  backToList() { U.$('#chatLayout')?.classList.add('show-list'); },

  async send(e) {
    e.preventDefault();
    const input = U.$('#chatInput');
    const text = input.value.trim();
    if (!text) return;
    const cid = App.state.activeChat;
    if (!cid) return;

    const body = U.$('#chatBody');
    const time = new Date().toTimeString().slice(0, 5);
    body.insertAdjacentHTML('beforeend',
      `<div class="msg me">${U.esc(text).replace(/\n/g, '<br>')}<span class="msg-time">${time}</span></div>`);
    body.scrollTop = body.scrollHeight;
    input.value = '';
    input.style.height = 'auto';

    try {
      await API.post(`/api/chats/${cid}/messages`, { text });
      const chats = await API.get('/api/chats');
      App.state.chats = chats;
      this.render();
    } catch (err) {
      U.toast(err.message, 'ph-warning');
      this.renderThread();
    }
  },

  filterList(q) {
    const items = U.$$('#chatList .chat-item');
    const query = q.toLowerCase().trim();
    items.forEach(it => {
      const name = it.querySelector('.chat-name')?.textContent.toLowerCase() || '';
      it.style.display = (!query || name.includes(query)) ? '' : 'none';
    });
  },

  newChat() { U.toast('افتح ملف أي مبدع', 'ph-info'); },
  attach() { U.toast('الملفات قريباً', 'ph-paperclip'); }
};


/* ═══ DRAWERS ═══ */
const Drawers = {
  currentPost: null,

  async openComments(pid) {
    this.currentPost = pid;
    U.$('#commentsDrawer').classList.add('open');
    document.body.style.overflow = 'hidden';
    const cf = U.$('#commentForm');
    if (cf) cf.style.display = 'flex';
    try {
      const comments = await API.get(`/api/posts/${pid}/comments`);
      U.$('#commentCount').textContent = `(${U.fmtNum(comments.length)})`;
      this.renderComments(comments);
    } catch {
      U.$('#commentsBody').innerHTML = '<div class="empty"><p>تعذّر التحميل</p></div>';
    }
  },

  closeComments() {
    U.$('#commentsDrawer').classList.remove('open');
    document.body.style.overflow = '';
    U.blur();
  },

  renderComments(comments) {
    const body = U.$('#commentsBody');
    if (!comments.length) {
      body.innerHTML = `<div class="empty">
        <i class="ph ph-chat-circle"></i>
        <h4>لا تعليقات بعد</h4>
        <p>كن أول من يعلّق.</p>
      </div>`;
      return;
    }
    body.innerHTML = comments.map(c => {
      const a = c.author_data || K.users[c.author] || { name: '?', avatar: '' };
      return `<div class="comment">
        <img class="author-avatar" src="${a.avatar || ''}" alt="" loading="lazy">
        <div class="comment-body">
          <div class="comment-top">
            <span class="comment-name">${U.esc(a.name)}</span>
            <span class="comment-time">${U.fmtDate(c.time)}</span>
          </div>
          <div class="comment-text">${U.esc(c.text)}</div>
        </div>
      </div>`;
    }).join('');
  }
};

const Comments = {
  async send(e) {
    e.preventDefault();
    const input = U.$('#commentInput');
    const text = input.value.trim();
    if (!text) return;
    const pid = Drawers.currentPost;
    if (!pid) return;
    try {
      await API.post(`/api/posts/${pid}/comments`, { text });
      input.value = '';
      input.style.height = 'auto';
      const comments = await API.get(`/api/posts/${pid}/comments`);
      Drawers.renderComments(comments);
      U.$('#commentCount').textContent = `(${U.fmtNum(comments.length)})`;
      U.$$(`[data-comment-count="${pid}"]`).forEach(el => el.textContent = U.fmtNum(comments.length));
      const p = App.state.posts.find(x => x.id === pid);
      if (p) p.comments = comments.length;
      U.toast('أُضيف تعليقك', 'ph-chat-circle');
    } catch (err) { U.toast(err.message, 'ph-warning'); }
  }
};


/* ═══ BOOT ═══ */
const style = document.createElement('style');
style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', () => App.init());

window.App = App;
window.Feed = Feed;
window.Composer = Composer;
window.Auth = Auth;
window.Chat = Chat;
window.Drawers = Drawers;
window.Comments = Comments;
window.U = U;
window.CommandPalette = CommandPalette;

})();