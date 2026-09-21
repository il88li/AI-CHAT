/* ═══════════════════════════════════════════════════════════════════════
   خَيال — app.js v12.1
   Fixes: Settings.open robustness · dock double-binding · settings.html import
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     CONFIG & STATE
     ═══════════════════════════════════════════════════════════════ */
  const CFG = {
    PAGE_SIZE: 20,
    TOAST_MS: 3200,
    SEARCH_DEBOUNCE: 280,
    DRAFT_KEY: 'khayal.composer.draft',
    THEME_KEY: 'khayal.theme',
    BUILD: '12.1',
  };

  const S = {
    me: window.__ME__ || null,
    tab: 'home',
    sort: 'recent',
    filterTag: '',
    filterModel: '',
    viewingUser: null,
    openChatId: null,
    feeds: Object.create(null),
    lastFocused: null,
    booted: false,
    tabHistory: [],
  };

  function feedState(key) {
    if (!S.feeds[key]) {
      S.feeds[key] = {
        items: [],
        before: null,
        busy: false,
        hasMore: true,
        loaded: false,
        controller: null,
      };
    }
    return S.feeds[key];
  }

  /* ═══════════════════════════════════════════════════════════════
     UTILITIES
     ═══════════════════════════════════════════════════════════════ */
  const U = {
    qs(sel, root) { return (root || document).querySelector(sel); },
    qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); },

    el(tag, attrs, html) {
      const node = document.createElement(tag);
      if (attrs) {
        for (const k in attrs) {
          if (k === 'class') node.className = attrs[k];
          else if (k === 'dataset') Object.assign(node.dataset, attrs[k]);
          else if (k.startsWith('on') && typeof attrs[k] === 'function') {
            node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
          } else if (attrs[k] !== null && attrs[k] !== undefined) {
            node.setAttribute(k, attrs[k]);
          }
        }
      }
      if (html !== undefined) node.innerHTML = html;
      return node;
    },

    escapeHtml(s) {
      if (s == null) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    relativeTime(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      const now = Date.now();
      const diff = Math.max(0, now - d.getTime());
      const sec = Math.floor(diff / 1000);
      if (sec < 60) return 'الآن';
      const min = Math.floor(sec / 60);
      if (min < 60) return min + ' د';
      const hr = Math.floor(min / 60);
      if (hr < 24) return hr + ' س';
      const day = Math.floor(hr / 24);
      if (day < 7) return day + ' ي';
      const wk = Math.floor(day / 7);
      if (wk < 5) return wk + ' أ';
      const mo = Math.floor(day / 30);
      if (mo < 12) return mo + ' ش';
      return Math.floor(day / 365) + ' سنة';
    },

    formatNumber(n) {
      n = Number(n) || 0;
      if (n < 1000) return String(n);
      if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'ألف';
      return (n / 1000000).toFixed(1) + 'م';
    },

    debounce(fn, ms) {
      let t;
      return function () {
        const args = arguments, ctx = this;
        clearTimeout(t);
        t = setTimeout(() => fn.apply(ctx, args), ms);
      };
    },

    autoGrow(el) {
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    },

    async copy(text) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch (e) { /* fall through */ }
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     API CLIENT
     ═══════════════════════════════════════════════════════════════ */
  const API = {
    async call(method, path, body, opts) {
      const init = {
        method,
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' },
      };
      if (body !== undefined && body !== null) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      if (opts && opts.signal) init.signal = opts.signal;

      let res;
      try {
        res = await fetch(path, init);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        throw new Error('تعذّر الاتصال بالخادم');
      }

      let data = null;
      const ct = res.headers.get('Content-Type') || '';
      if (ct.includes('application/json')) {
        try { data = await res.json(); } catch (e) { data = null; }
      }

      if (!res.ok) {
        const msg = (data && (data.error || data.message)) || `خطأ ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    },

    get(path, opts) { return API.call('GET', path, null, opts); },
    post(path, body) { return API.call('POST', path, body); },
    patch(path, body) { return API.call('PATCH', path, body); },
    del(path) { return API.call('DELETE', path); },
  };

  /* ═══════════════════════════════════════════════════════════════
     THEME
     ═══════════════════════════════════════════════════════════════ */
  const Theme = {
    get() { return document.documentElement.dataset.theme || 'dark'; },

    set(mode) {
      document.documentElement.dataset.theme = mode;
      try { localStorage.setItem(CFG.THEME_KEY, mode); } catch (e) {}
      this.syncIcon();
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', mode === 'dark' ? '#08080C' : '#F7F7FA');
    },

    toggle() {
      this.set(this.get() === 'dark' ? 'light' : 'dark');
      if (window.Sounds) Sounds.play('toggle');
    },

    syncIcon() {
      const icon = document.getElementById('themeIcon');
      if (!icon) return;
      const dark = this.get() === 'dark';
      icon.className = dark ? 'ph ph-moon' : 'ph ph-sun';
    },

    init() {
      try {
        const saved = localStorage.getItem(CFG.THEME_KEY);
        if (saved === 'light' || saved === 'dark') this.set(saved);
        else {
          const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
          this.set(prefersLight ? 'light' : 'dark');
        }
      } catch (e) { this.syncIcon(); }
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     TOAST
     ═══════════════════════════════════════════════════════════════ */
  const Toast = {
    wrap() { return document.getElementById('toastWrap'); },

    show(msg, tone, ms) {
      const wrap = this.wrap();
      if (!wrap) { console.log('[toast]', msg); return; }
      const icons = {
        success: 'ph-check-circle',
        error: 'ph-warning-circle',
        warning: 'ph-warning',
        info: 'ph-info',
      };
      const t = document.createElement('div');
      t.className = 'toast';
      t.setAttribute('data-tone', tone || 'info');
      t.innerHTML = `<i class="ph ${icons[tone] || icons.info}" aria-hidden="true"></i><span></span>`;
      t.querySelector('span').textContent = msg;
      wrap.appendChild(t);

      setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateY(12px)';
        setTimeout(() => t.remove(), 260);
      }, ms || CFG.TOAST_MS);
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     INSTALL (PWA)
     ═══════════════════════════════════════════════════════════════ */
  const Install = {
    deferred: null,
    dismissed: false,

    init() {
      const banner = document.getElementById('installBanner');
      if (!banner) return;

      try { this.dismissed = localStorage.getItem('khayal.install.dismissed') === '1'; } catch (e) {}

      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this.deferred = e;
        if (!this.dismissed) banner.hidden = false;
        setTimeout(() => banner.setAttribute('data-open', 'true'), 60);
      });

      window.addEventListener('appinstalled', () => {
        banner.setAttribute('data-open', 'false');
        setTimeout(() => { banner.hidden = true; }, 400);
        Toast.show('تم تثبيت التطبيق', 'success');
      });
    },

    async prompt() {
      if (!this.deferred) return;
      this.deferred.prompt();
      const choice = await this.deferred.userChoice;
      if (choice && choice.outcome === 'accepted') this.dismiss();
      this.deferred = null;
    },

    dismiss() {
      this.dismissed = true;
      try { localStorage.setItem('khayal.install.dismissed', '1'); } catch (e) {}
      const banner = document.getElementById('installBanner');
      if (banner) {
        banner.setAttribute('data-open', 'false');
        setTimeout(() => { banner.hidden = true; }, 400);
      }
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     NETWORK MONITOR
     ═══════════════════════════════════════════════════════════════ */
  const Net = {
    init() {
      const bar = document.getElementById('netBar');
      if (!bar) return;
      const update = () => {
        const offline = !navigator.onLine;
        bar.setAttribute('data-open', offline ? 'true' : 'false');
      };
      window.addEventListener('online', () => { update(); Toast.show('عدت متصلاً', 'success'); });
      window.addEventListener('offline', update);
      update();
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     AUTH
     ═══════════════════════════════════════════════════════════════ */
  const Auth = {
    modal() { return document.getElementById('authModal'); },

    open(mode) {
      const m = this.modal();
      if (!m) return;
      S.lastFocused = document.activeElement;
      this.switchMode(mode || 'login');
      m.setAttribute('data-open', 'true');
      document.documentElement.style.overflow = 'hidden';
      setTimeout(() => {
        const first = m.querySelector('.auth-form.is-active input');
        if (first) first.focus({ preventScroll: true });
      }, 200);
      if (window.Sounds) Sounds.play('open');
    },

    close(e) {
      if (e && e.target && e.target.closest('.auth')) return;
      const m = this.modal();
      if (!m) return;
      m.setAttribute('data-open', 'false');
      document.documentElement.style.overflow = '';
      if (S.lastFocused) S.lastFocused.focus({ preventScroll: true });
      if (window.Sounds) Sounds.play('close');
    },

    switchMode(mode) {
      const m = this.modal();
      if (!m) return;
      const tabs = m.querySelector('.auth-tabs');
      if (tabs) tabs.dataset.mode = mode;

      m.querySelectorAll('.auth-tab').forEach(t => {
        t.setAttribute('aria-selected', t.dataset.mode === mode ? 'true' : 'false');
      });
      m.querySelectorAll('.auth-form').forEach(f => {
        f.classList.toggle('is-active', f.id === mode + 'Form');
      });

      const title = m.querySelector('#authTitle');
      const sub = m.querySelector('#authSub');
      if (title) title.textContent = mode === 'register' ? 'حساب جديد' : 'تسجيل الدخول';
      if (sub) sub.textContent = mode === 'register' ? 'انضم إلى خَيال' : 'أهلاً بعودتك إلى خَيال';
    },

    togglePassword(btn) {
      const wrap = btn.closest('.input-wrap');
      const input = wrap && wrap.querySelector('input');
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      const i = btn.querySelector('i');
      if (i) i.className = show ? 'ph ph-eye-slash' : 'ph ph-eye';
      btn.setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
    },

    checkStrength(v) {
      const el = document.querySelector('.pw-strength');
      if (!el) return;
      let score = 0;
      if (v.length >= 6) score++;
      if (v.length >= 10) score++;
      if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
      if (/[0-9]/.test(v)) score++;
      if (/[^A-Za-z0-9]/.test(v)) score = Math.min(4, score + 1);
      el.setAttribute('data-level', String(Math.min(4, score)));
    },

    async login(ev) {
      ev.preventDefault();
      const form = ev.target;
      const btn = form.querySelector('#loginSubmit');
      const identifier = (form.querySelector('#loginIdentifier') || {}).value || '';
      const password = (form.querySelector('#loginPassword') || {}).value || '';
      const remember = !!(form.querySelector('#rememberMe') || {}).checked;

      if (!identifier || !password) {
        if (window.Sounds) Sounds.play('error');
        return Toast.show('أدخل بيانات الدخول', 'warning');
      }

      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;

      try {
        const user = await API.post('/api/auth/login', { identifier, password, remember });
        S.me = user;
        window.__ME__ = user;
        this.afterLogin(user);
      } catch (err) {
        if (window.Sounds) Sounds.play('error');
        Toast.show(err.message, 'error');
      } finally {
        btn.removeAttribute('aria-busy');
        btn.disabled = false;
      }
    },

    async register(ev) {
      ev.preventDefault();
      const form = ev.target;
      const btn = form.querySelector('#registerSubmit');
      const payload = {
        name: (form.querySelector('#regName') || {}).value || '',
        username: (form.querySelector('#regUsername') || {}).value || '',
        email: (form.querySelector('#regEmail') || {}).value || '',
        password: (form.querySelector('#regPassword') || {}).value || '',
      };

      if (!payload.name || !payload.username || !payload.email || !payload.password) {
        if (window.Sounds) Sounds.play('error');
        return Toast.show('املأ جميع الحقول', 'warning');
      }

      const agree = form.querySelector('#agreeTerms');
      if (agree && !agree.checked) {
        if (window.Sounds) Sounds.play('error');
        return Toast.show('وافق على الشروط أولاً', 'warning');
      }

      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;

      try {
        const user = await API.post('/api/auth/register', payload);
        S.me = user;
        window.__ME__ = user;
        this.afterLogin(user);
        Toast.show('أهلاً بك في خَيال', 'success');
      } catch (err) {
        if (window.Sounds) Sounds.play('error');
        Toast.show(err.message, 'error');
      } finally {
        btn.removeAttribute('aria-busy');
        btn.disabled = false;
      }
    },

    afterLogin(user) {
      this.close();
      this.updateChrome(user);
      App.showApp();
      App.switchTab('home');
      if (window.Sounds) Sounds.play('success');
    },

    forgot(e) {
      e.preventDefault();
      Toast.show('تواصل مع الدعم لاستعادة كلمة المرور', 'info');
    },

    updateChrome(user) {
      const signIn = document.getElementById('signInBtn');
      const avatarBtn = document.getElementById('avatarBtn');
      const avatarImg = document.getElementById('avatarImg');
      if (signIn) signIn.hidden = !!user;
      if (avatarBtn) avatarBtn.hidden = !user;
      if (avatarImg && user) {
        avatarImg.src = user.avatar || '';
        avatarImg.alt = user.name || '';
      }
      const dock = document.getElementById('dock');
      if (dock) dock.hidden = !user;
    },

    logout() {
      API.post('/api/auth/logout').then(() => {
        S.me = null;
        window.__ME__ = null;
        this.updateChrome(null);
        App.showLanding();
        Toast.show('تم تسجيل الخروج', 'info');
      }).catch(() => Toast.show('تعذّر تسجيل الخروج', 'error'));
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     POST
     ═══════════════════════════════════════════════════════════════ */
  const Post = {
    renderCard(p) {
      const a = p.author_data || {};
      const liked = !!p.liked;
      const saved = !!p.saved;
      const image = p.image || 'https://placehold.co/800x600/0E0E14/22D3EE?text=خَيال';
      const tags = Array.isArray(p.tags) ? p.tags : [];
      const model = p.model || '';

      const card = document.createElement('article');
      card.className = 'prompt-card';
      card.setAttribute('data-post-id', String(p.id));

      const tagsHtml = tags.length
        ? `<div class="prompt-tags">${tags.slice(0, 4).map(t =>
            `<button class="tag" type="button" data-tag="${U.escapeHtml(t)}">${U.escapeHtml(t)}</button>`
          ).join('')}</div>`
        : '';

      card.innerHTML = `
        <div class="prompt-media">
          <img src="${U.escapeHtml(image)}" alt="${U.escapeHtml(p.title || '')}"
               loading="lazy" data-state="loading">
          ${model ? `<span class="prompt-model"><i class="ph ph-sparkle" aria-hidden="true"></i>${U.escapeHtml(model)}</span>` : ''}
          <div class="prompt-floats">
            <button class="float-btn" data-action="like" aria-pressed="${liked}"
                    aria-label="إعجاب" type="button">
              <i class="ph ph-heart" aria-hidden="true"></i>
            </button>
            <button class="float-btn" data-action="save" aria-pressed="${saved}"
                    aria-label="حفظ" type="button">
              <i class="ph ph-bookmark-simple" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        <div class="prompt-body">
          <div class="prompt-author" data-action="open-author" data-author-id="${a.id || ''}">
            <img class="avatar avatar-sm" src="${U.escapeHtml(a.avatar || '')}" alt="" loading="lazy">
            <div class="prompt-author-info">
              <span class="prompt-author-name">
                ${U.escapeHtml(a.name || 'مستخدم')}
                ${a.verified ? '<i class="ph ph-seal-check" aria-label="موثّق"></i>' : ''}
              </span>
              <span class="prompt-author-meta">${U.escapeHtml(a.handle || '')}</span>
            </div>
          </div>
          <h3 class="prompt-title">${U.escapeHtml(p.title || '')}</h3>
          <div class="prompt-excerpt" data-action="copy-excerpt">
            ${U.escapeHtml(p.prompt || '')}
            <button type="button" class="prompt-excerpt-copy" aria-label="نسخ">
              <i class="ph ph-copy" aria-hidden="true"></i>
            </button>
          </div>
          ${tagsHtml}
        </div>
        <div class="prompt-actions">
          <button class="action" data-action="like" aria-pressed="${liked}" type="button">
            <i class="ph ph-heart" aria-hidden="true"></i>
            <span data-count="likes">${U.formatNumber(p.likes || 0)}</span>
          </button>
          <button class="action" data-action="comments" type="button">
            <i class="ph ph-chat-circle" aria-hidden="true"></i>
            <span>${U.formatNumber(p.comments || 0)}</span>
          </button>
          <button class="action action-primary" data-action="copy" type="button">
            <i class="ph ph-copy" aria-hidden="true"></i>
            <span>نسخ</span>
          </button>
        </div>`;

      const img = card.querySelector('.prompt-media > img');
      img.addEventListener('load', () => { img.dataset.state = 'loaded'; });
      img.addEventListener('error', () => { img.dataset.state = 'error'; });

      card.addEventListener('click', (e) => this.onCardClick(e, card, p));

      return card;
    },

    onCardClick(e, card, p) {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === 'like') { e.stopPropagation(); this.like(btn, p.id); return; }
      if (action === 'save') { e.stopPropagation(); this.save(btn, p.id); return; }
      if (action === 'copy' || action === 'copy-excerpt') {
        e.stopPropagation();
        this.copy(p.id, btn);
        return;
      }
      if (action === 'comments') {
        e.stopPropagation();
        Drawers.openComments(p.id);
        return;
      }
      if (action === 'open-author') {
        e.stopPropagation();
        const aid = btn.dataset.authorId;
        if (aid) App.openProfile(parseInt(aid, 10));
        return;
      }
    },

    async like(btn, id) {
      if (!S.me) { Auth.open('login'); return; }

      const currently = btn.getAttribute('aria-pressed') === 'true';
      const next = !currently;

      document.querySelectorAll(`[data-post-id="${id}"] [data-action="like"]`).forEach(b => {
        b.setAttribute('aria-pressed', String(next));
      });

      try {
        const res = await API.post(`/api/posts/${id}/like`);
        const liked = !!res.liked;
        const count = res.likes;
        document.querySelectorAll(`[data-post-id="${id}"] [data-action="like"]`).forEach(b => {
          b.setAttribute('aria-pressed', String(liked));
        });
        document.querySelectorAll(`[data-post-id="${id}"] [data-count="likes"]`).forEach(el => {
          el.textContent = U.formatNumber(count);
        });
        if (window.Sounds) Sounds.play('like');
      } catch (err) {
        document.querySelectorAll(`[data-post-id="${id}"] [data-action="like"]`).forEach(b => {
          b.setAttribute('aria-pressed', String(currently));
        });
        Toast.show(err.message || 'تعذّر الإعجاب', 'error');
      }
    },

    async save(btn, id) {
      if (!S.me) { Auth.open('login'); return; }

      const currently = btn.getAttribute('aria-pressed') === 'true';
      const next = !currently;

      document.querySelectorAll(`[data-post-id="${id}"] [data-action="save"]`).forEach(b => {
        b.setAttribute('aria-pressed', String(next));
      });

      try {
        const res = await API.post(`/api/posts/${id}/save`);
        const saved = !!res.saved;
        document.querySelectorAll(`[data-post-id="${id}"] [data-action="save"]`).forEach(b => {
          b.setAttribute('aria-pressed', String(saved));
        });
        Toast.show(saved ? 'تم الحفظ' : 'أُزيل من المحفوظة', 'success', 1800);
        if (saved && S.feeds.saved) S.feeds.saved.loaded = false;
      } catch (err) {
        document.querySelectorAll(`[data-post-id="${id}"] [data-action="save"]`).forEach(b => {
          b.setAttribute('aria-pressed', String(currently));
        });
        Toast.show(err.message || 'تعذّر الحفظ', 'error');
      }
    },

    async copy(id, btn) {
      const card = btn.closest('[data-post-id]');
      let text = '';
      if (card) {
        const ex = card.querySelector('.prompt-excerpt');
        if (ex) text = ex.textContent.trim();
      }
      if (!text) {
        try {
          const p = await API.get(`/api/posts/${id}`);
          text = p.prompt || '';
        } catch (e) { /* ignore */ }
      }

      const ok = await U.copy(text);
      if (ok) {
        if (window.Sounds) Sounds.play('copy');
        Toast.show('تم النسخ', 'success', 1600);
        API.post(`/api/posts/${id}/copy`).catch(() => {});
      } else {
        Toast.show('تعذّر النسخ', 'error');
      }
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     FEED
     ═══════════════════════════════════════════════════════════════ */
  const Feed = {
    container(name) {
      const map = {
        home: 'homeFeed',
        explore: 'exploreFeed',
        liked: 'likedFeed',
        saved: 'savedFeed',
        profile: 'profilePanel',
      };
      return document.getElementById(map[name] || '');
    },

    skeletonsHtml() {
      let html = '';
      for (let i = 0; i < 6; i++) html += Feed.skeletonCardHtml();
      return html;
    },

    skeletonCardHtml() {
      return `<article class="prompt-card skeleton-card" aria-hidden="true">
        <div class="prompt-media skeleton skeleton-media"></div>
        <div class="prompt-body">
          <div class="skeleton skeleton-line" style="width:55%"></div>
          <div class="skeleton skeleton-line" style="width:85%;height:18px"></div>
          <div class="skeleton skeleton-line" style="width:100%"></div>
          <div class="skeleton skeleton-line" style="width:75%"></div>
          <div class="cluster" style="gap:6px">
            <div class="skeleton skeleton-line" style="width:60px;height:22px;border-radius:999px"></div>
            <div class="skeleton skeleton-line" style="width:80px;height:22px;border-radius:999px"></div>
          </div>
        </div>
      </article>`;
    },

    emptyHtml(icon, title, msg) {
      return `<div class="empty-block" data-empty-state>
        <i class="ph ${icon}" aria-hidden="true"></i>
        <h4>${U.escapeHtml(title)}</h4>
        <p>${U.escapeHtml(msg)}</p>
      </div>`;
    },

    async load(name, opts) {
      opts = opts || {};
      const fs = feedState(name);
      if (fs.busy && !opts.force) return;
      if (!opts.force && fs.loaded && fs.items.length > 0) return;

      const container = this.container(name);
      if (!container) return;

      if (opts.reset !== false) {
        fs.items = [];
        fs.before = null;
        fs.hasMore = true;
        fs.loaded = false;
      }

      if (fs.items.length === 0) {
        container.innerHTML = this.skeletonsHtml();
        container.setAttribute('aria-busy', 'true');
      }

      fs.busy = true;
      if (fs.controller) fs.controller.abort();
      fs.controller = new AbortController();

      const params = new URLSearchParams();
      if (name === 'home' || name === 'explore') {
        params.set('sort', S.sort);
        if (S.filterTag) params.set('tag', S.filterTag);
        if (S.filterModel) params.set('model', S.filterModel);
      }
      if (name === 'profile' && S.viewingUser) {
        params.set('author', String(S.viewingUser.id));
      }
      params.set('limit', String(CFG.PAGE_SIZE));
      if (fs.before) params.set('before_id', String(fs.before));

      const path = name === 'profile' && S.viewingUser
        ? `/api/users/${S.viewingUser.id}/posts`
        : '/api/posts';

      try {
        const items = await API.get(path + '?' + params.toString(), { signal: fs.controller.signal });
        const list = Array.isArray(items) ? items : [];

        if (list.length === 0 && fs.items.length === 0) {
          this.showEmpty(name);
          fs.hasMore = false;
          fs.loaded = true;
          return;
        }

        const frag = document.createDocumentFragment();
        list.forEach(p => frag.appendChild(Post.renderCard(p)));
        if (fs.items.length === 0) container.innerHTML = '';
        container.appendChild(frag);
        fs.items = fs.items.concat(list);
        fs.before = list[list.length - 1].id;
        fs.hasMore = list.length === CFG.PAGE_SIZE;
        fs.loaded = true;
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (fs.items.length === 0) {
          container.innerHTML = this.emptyHtml(
            'ph-cloud-slash', 'تعذّر التحميل', err.message || 'حاول مرة أخرى'
          );
        } else {
          Toast.show(err.message || 'تعذّر تحميل المزيد', 'error');
        }
      } finally {
        fs.busy = false;
        container.setAttribute('aria-busy', 'false');
      }
    },

    showEmpty(name) {
      const c = this.container(name);
      if (!c) return;
      const emptyMap = {
        home: ['ph-image-square', 'لا توجد برومبتات', 'كن أول من ينشر.'],
        explore: ['ph-compass', 'لا شيء هنا', 'جرّب تصفية أخرى.'],
        liked: ['ph-heart', 'لا توجد إعجابات بعد', 'ابدأ بتصفح المنصة وضع قلبك على ما يعجبك.'],
        saved: ['ph-bookmark-simple', 'المكتبة فارغة', 'احفظ البرومبتات المميزة للرجوع إليها لاحقاً.'],
        profile: ['ph-image-square', 'لا منشورات', 'لم ينشر هذا المستخدم بعد.'],
      };
      const [icon, title, msg] = emptyMap[name] || ['ph-info', 'لا يوجد شيء', ''];
      c.innerHTML = this.emptyHtml(icon, title, msg);
    },

    async loadMore(name) {
      const fs = feedState(name);
      if (fs.busy || !fs.hasMore) return;
      await this.load(name, { reset: false });
    },

    reset(name) {
      const fs = feedState(name);
      fs.items = [];
      fs.before = null;
      fs.hasMore = true;
      fs.loaded = false;
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     COMMENTS
     ═══════════════════════════════════════════════════════════════ */
  const Comments = {
    currentPostId: null,

    async load(postId) {
      const body = document.getElementById('commentsBody');
      const form = document.getElementById('commentForm');
      const countEl = document.getElementById('commentCount');
      if (!body) return;

      body.innerHTML = `<div class="load-more"><div class="spinner"></div></div>`;
      if (form) form.style.display = S.me ? 'flex' : 'none';

      try {
        const items = await API.get(`/api/posts/${postId}/comments`);
        if (!items || items.length === 0) {
          body.innerHTML = `<div class="empty-block">
            <i class="ph ph-chat-circle-dots" aria-hidden="true"></i>
            <h4>لا تعليقات بعد</h4>
            <p>كن أول المعلّقين.</p>
          </div>`;
          if (countEl) countEl.textContent = '';
          return;
        }
        if (countEl) countEl.textContent = '(' + items.length + ')';
        body.innerHTML = items.map(c => this.rowHtml(c)).join('');
      } catch (err) {
        body.innerHTML = `<div class="empty-block">
          <i class="ph ph-warning-circle" aria-hidden="true"></i>
          <h4>تعذّر التحميل</h4>
          <p>${U.escapeHtml(err.message)}</p>
        </div>`;
      }
    },

    rowHtml(c) {
      const a = c.author_data || {};
      const mine = S.me && S.me.id === c.author;
      return `<div class="comment" data-comment-id="${c.id}">
        <img class="avatar avatar-sm" src="${U.escapeHtml(a.avatar || '')}" alt="" loading="lazy">
        <div class="comment-body">
          <div class="comment-top">
            <span class="comment-name">${U.escapeHtml(a.name || 'مستخدم')}</span>
            <span class="comment-time">${U.relativeTime(c.time)}</span>
          </div>
          <div class="comment-text">${U.escapeHtml(c.text || '')}</div>
          ${mine ? `<div class="comment-actions">
            <button type="button" data-action="delete-comment" data-comment-id="${c.id}">
              <i class="ph ph-trash" aria-hidden="true"></i> حذف
            </button>
          </div>` : ''}
        </div>
      </div>`;
    },

    async send(ev) {
      ev.preventDefault();
      if (!S.me) { Auth.open('login'); return; }
      const input = document.getElementById('commentInput');
      if (!input) return;
      const text = input.value.trim();
      if (!text || !this.currentPostId) return;

      input.disabled = true;
      try {
        const c = await API.post(`/api/posts/${this.currentPostId}/comments`, { text });
        input.value = '';
        U.autoGrow(input);
        if (window.Sounds) Sounds.play('send');

        const body = document.getElementById('commentsBody');
        if (body) {
          const empty = body.querySelector('.empty-block');
          if (empty) empty.remove();
          body.insertAdjacentHTML('afterbegin', this.rowHtml(c));
          const countEl = document.getElementById('commentCount');
          if (countEl) {
            const n = body.querySelectorAll('.comment').length;
            countEl.textContent = '(' + n + ')';
          }
        }
      } catch (err) {
        Toast.show(err.message || 'تعذّر الإرسال', 'error');
      } finally {
        input.disabled = false;
        input.focus();
      }
    },

    async delete(id) {
      if (!confirm('حذف التعليق؟')) return;
      try {
        await API.del(`/api/comments/${id}`);
        const row = document.querySelector(`.comment[data-comment-id="${id}"]`);
        if (row) row.remove();
        Toast.show('تم الحذف', 'success', 1500);
      } catch (err) {
        Toast.show(err.message || 'تعذّر الحذف', 'error');
      }
    },

    init() {
      document.addEventListener('click', (e) => {
        const del = e.target.closest('[data-action="delete-comment"]');
        if (del) this.delete(parseInt(del.dataset.commentId, 10));
      });
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     DRAWERS
     ═══════════════════════════════════════════════════════════════ */
  const Drawers = {
    openComments(postId) {
      this.closeNotifications();
      Comments.currentPostId = postId;
      const scrim = document.getElementById('commentsScrim');
      const drawer = document.getElementById('commentsDrawer');
      if (!scrim || !drawer) return;
      scrim.setAttribute('data-open', 'true');
      drawer.setAttribute('data-open', 'true');
      document.documentElement.style.overflow = 'hidden';
      Comments.load(postId);
      if (window.Sounds) Sounds.play('open');
    },

    closeComments() {
      const scrim = document.getElementById('commentsScrim');
      const drawer = document.getElementById('commentsDrawer');
      if (scrim) scrim.setAttribute('data-open', 'false');
      if (drawer) drawer.setAttribute('data-open', 'false');
      document.documentElement.style.overflow = '';
    },

    openNotifications() {
      this.closeComments();
      const scrim = document.getElementById('notificationsScrim');
      const drawer = document.getElementById('notificationsDrawer');
      if (!scrim || !drawer) return;
      scrim.setAttribute('data-open', 'true');
      drawer.setAttribute('data-open', 'true');
      document.documentElement.style.overflow = 'hidden';
      if (window.Sounds) Sounds.play('open');
    },

    closeNotifications() {
      const scrim = document.getElementById('notificationsScrim');
      const drawer = document.getElementById('notificationsDrawer');
      if (scrim) scrim.setAttribute('data-open', 'false');
      if (drawer) drawer.setAttribute('data-open', 'false');
      document.documentElement.style.overflow = '';
    },

    closeAll() {
      this.closeComments();
      this.closeNotifications();
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     COMPOSER
     ═══════════════════════════════════════════════════════════════ */
  const Composer = {
    type: 'text',

    open() {
      if (!S.me) { Auth.open('login'); return; }
      const view = document.getElementById('composerView');
      if (!view) {
        console.error('[خَيال] #composerView غير موجود');
        Toast.show('صفحة النشر غير متوفرة', 'error');
        return;
      }

      const av = document.getElementById('composerFormAvatar');
      if (av) av.src = S.me.avatar || '';
      const name = document.getElementById('composerUserName');
      if (name) name.textContent = S.me.name || '—';

      this.restoreDraft();

      view.hidden = false;
      document.body.classList.add('view-open');
      if (window.Sounds) Sounds.play('open');
    },

    close() {
      const view = document.getElementById('composerView');
      if (!view) return;
      this.saveDraft();
      view.hidden = true;
      document.body.classList.remove('view-open');
      if (window.Sounds) Sounds.play('close');
    },

    saveDraft() {
      if (!S.me) return;
      const draft = {
        title: (document.getElementById('cTitle') || {}).value || '',
        prompt: (document.getElementById('cPrompt') || {}).value || '',
        image: (document.getElementById('cImage') || {}).value || '',
        model: (document.getElementById('cModel') || {}).value || '',
        tags: (document.getElementById('cTags') || {}).value || '',
        type: this.type,
      };
      try { localStorage.setItem(CFG.DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
    },

    restoreDraft() {
      try {
        const raw = localStorage.getItem(CFG.DRAFT_KEY);
        if (!raw) return;
        const d = JSON.parse(raw);
        const el = (id) => document.getElementById(id);
        if (d.title && el('cTitle')) el('cTitle').value = d.title;
        if (d.prompt && el('cPrompt')) el('cPrompt').value = d.prompt;
        if (d.image && el('cImage')) el('cImage').value = d.image;
        if (d.model && el('cModel')) el('cModel').value = d.model;
        if (d.tags && el('cTags')) el('cTags').value = d.tags;
      } catch (e) {}
    },

    clearDraft() {
      try { localStorage.removeItem(CFG.DRAFT_KEY); } catch (e) {}
    },

    chooseType(type) {
      this.type = type;
      const switchEl = document.querySelector('.type-switch');
      if (switchEl) {
        switchEl.querySelectorAll('.type-pill').forEach(b => {
          b.setAttribute('aria-selected', b.dataset.type === type ? 'true' : 'false');
        });
      }
      const imageField = document.getElementById('imageField');
      if (imageField) imageField.hidden = type !== 'prompt';
      if (window.Sounds) Sounds.play('toggle');
    },

    previewImage(url) {
      const wrap = document.getElementById('imgPreview');
      const img = document.getElementById('imgPreviewEl');
      if (!wrap || !img) return;
      if (url && /^https?:\/\//i.test(url)) {
        img.src = url;
        wrap.hidden = false;
      } else {
        wrap.hidden = true;
      }
    },

    clearPreview() {
      const wrap = document.getElementById('imgPreview');
      const img = document.getElementById('imgPreviewEl');
      const input = document.getElementById('cImage');
      if (wrap) wrap.hidden = true;
      if (img) img.src = '';
      if (input) input.value = '';
    },

    async publish(ev) {
      if (ev) ev.preventDefault();
      if (!S.me) { Auth.open('login'); return; }

      const title = ((document.getElementById('cTitle') || {}).value || '').trim();
      const prompt = ((document.getElementById('cPrompt') || {}).value || '').trim();
      const image = ((document.getElementById('cImage') || {}).value || '').trim();
      const model = ((document.getElementById('cModel') || {}).value || '').trim();
      const tagsRaw = ((document.getElementById('cTags') || {}).value || '').trim();

      if (!title || !prompt) {
        if (window.Sounds) Sounds.play('error');
        return Toast.show('العنوان والمحتوى مطلوبان', 'warning');
      }

      const tags = tagsRaw
        ? tagsRaw.split(/[,،]/).map(t => t.trim()).filter(Boolean)
        : [];

      const btn = document.getElementById('composerSubmit');
      if (btn) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true; }

      try {
        const post = await API.post('/api/posts', {
          title, prompt, image: image || null, model: model || null, tags,
        });
        const homeEl = document.getElementById('homeFeed');
        if (homeEl && post) {
          const empty = homeEl.querySelector('.empty-block');
          if (empty) empty.remove();
          const card = Post.renderCard(post);
          homeEl.insertBefore(card, homeEl.firstChild);
        }
        this.clearDraft();
        this.close();
        if (window.Sounds) Sounds.play('success');
        Toast.show('تم النشر', 'success');
      } catch (err) {
        if (window.Sounds) Sounds.play('error');
        Toast.show(err.message || 'تعذّر النشر', 'error');
      } finally {
        if (btn) { btn.removeAttribute('aria-busy'); btn.disabled = false; }
      }
    },

    init() {
      document.querySelectorAll('.type-pill').forEach(btn => {
        btn.addEventListener('click', () => this.chooseType(btn.dataset.type));
      });
      ['cTitle', 'cPrompt', 'cImage', 'cTags'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', U.debounce(() => this.saveDraft(), 1500));
      });
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     CHAT
     ═══════════════════════════════════════════════════════════════ */
  const Chat = {
    allChats: [],

    async loadList() {
      const list = document.getElementById('chatList');
      if (!list || !S.me) return;

      list.innerHTML = `<div class="load-more"><div class="spinner"></div></div>`;

      try {
        const chats = await API.get('/api/chats');
        this.allChats = chats || [];

        if (!this.allChats.length) {
          list.innerHTML = `<div class="empty-block">
            <i class="ph ph-chat-circle-dots" aria-hidden="true"></i>
            <h4>لا محادثات</h4>
            <p>ابدأ محادثة جديدة من ملف أي مستخدم.</p>
          </div>`;
          return;
        }

        list.innerHTML = this.allChats.map(c => this.rowHtml(c)).join('');
        this.bindRows();
      } catch (err) {
        list.innerHTML = `<div class="empty-block">
          <i class="ph ph-warning-circle" aria-hidden="true"></i>
          <h4>تعذّر التحميل</h4>
          <p>${U.escapeHtml(err.message)}</p>
        </div>`;
      }
    },

    rowHtml(c) {
      const u = c.with_user || {};
      const unread = c.unread > 0 ? `<span class="badge">${c.unread}</span>` : '';
      return `<button class="chat-item" type="button" data-chat-id="${c.id}">
        <div style="position:relative">
          <img class="avatar avatar-sm" src="${U.escapeHtml(u.avatar || '')}" alt="">
          ${unread}
        </div>
        <div class="chat-item-info">
          <div class="chat-item-top">
            <span class="chat-item-name">${U.escapeHtml(u.name || 'محادثة')}</span>
            <span class="chat-item-time">${U.escapeHtml(c.time || '')}</span>
          </div>
          <div class="chat-item-preview">${U.escapeHtml(c.last || 'لا رسائل بعد')}</div>
        </div>
      </button>`;
    },

    bindRows() {
      document.querySelectorAll('.chat-item').forEach(row => {
        row.addEventListener('click', () => this.openThread(parseInt(row.dataset.chatId, 10)));
      });
    },

    async openThread(chatId) {
      if (!S.me) return;
      S.openChatId = chatId;
      const layout = document.getElementById('chatLayout');
      const name = document.getElementById('chatThreadName');
      const body = document.getElementById('chatBody');
      const composer = document.querySelector('.chat-composer');

      const chat = this.allChats.find(c => c.id === chatId);
      if (name && chat && chat.with_user) name.textContent = chat.with_user.name;

      if (layout) layout.dataset.view = 'thread';
      document.body.classList.add('chat-fullscreen');
      if (body) body.innerHTML = `<div class="load-more"><div class="spinner"></div></div>`;
      if (composer) composer.style.display = 'flex';

      document.querySelectorAll('.chat-item').forEach(r => {
        r.setAttribute('aria-current', r.dataset.chatId === String(chatId) ? 'true' : 'false');
      });

      try {
        const msgs = await API.get(`/api/chats/${chatId}/messages`);
        if (!msgs || !msgs.length) {
          body.innerHTML = `<div class="empty-block">
            <i class="ph ph-chat-circle-dots" aria-hidden="true"></i>
            <h4>ابدأ المحادثة</h4>
            <p>أرسل أول رسالة.</p>
          </div>`;
        } else {
          body.innerHTML = msgs.map(m => this.msgHtml(m)).join('');
          body.scrollTop = body.scrollHeight;
        }
      } catch (err) {
        body.innerHTML = `<div class="empty-block">
          <i class="ph ph-warning-circle" aria-hidden="true"></i>
          <h4>تعذّر التحميل</h4>
          <p>${U.escapeHtml(err.message)}</p>
        </div>`;
      }
    },

    msgHtml(m) {
      const cls = m.from === 'me' ? 'msg-me' : 'msg-them';
      return `<div class="msg ${cls}">
        ${U.escapeHtml(m.text)}
        <span class="msg-time">${U.escapeHtml(m.time || '')}</span>
      </div>`;
    },

    async send(ev) {
      ev.preventDefault();
      if (!S.me || !S.openChatId) return;
      const input = document.getElementById('chatInput');
      const body = document.getElementById('chatBody');
      if (!input || !body) return;

      const text = input.value.trim();
      if (!text) return;

      input.value = '';
      U.autoGrow(input);

      const empty = body.querySelector('.empty-block');
      if (empty) empty.remove();
      body.insertAdjacentHTML('beforeend', this.msgHtml({ from: 'me', text, time: 'الآن' }));
      body.scrollTop = body.scrollHeight;

      if (window.Sounds) Sounds.play('send');

      try {
        await API.post(`/api/chats/${this.openChatId}/messages`, { text });
      } catch (err) {
        Toast.show(err.message || 'تعذّر الإرسال', 'error');
      }
    },

    filterList(query) {
      const q = (query || '').trim().toLowerCase();
      document.querySelectorAll('.chat-item').forEach(row => {
        const name = (row.querySelector('.chat-item-name') || {}).textContent || '';
        row.style.display = !q || name.toLowerCase().includes(q) ? '' : 'none';
      });
    },

    backToList() {
      const layout = document.getElementById('chatLayout');
      if (layout) layout.dataset.view = 'list';
      document.body.classList.remove('chat-fullscreen');
      S.openChatId = null;
    },

    async openWith(userId) {
      if (!S.me) { Auth.open('login'); return; }
      try {
        const res = await API.post(`/api/chats/with/${userId}`);
        App.switchTab('chat');
        await this.loadList();
        if (res && res.id) setTimeout(() => this.openThread(res.id), 200);
      } catch (err) {
        Toast.show(err.message || 'تعذّر فتح المحادثة', 'error');
      }
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     PROFILE
     ═══════════════════════════════════════════════════════════════ */
  const Profile = {
    current: null,

    async load(userId) {
      const id = userId || (S.me && S.me.id);
      if (!id) return;

      S.viewingUser = { id };
      S.tab = 'profile';
      App.activateTab('profile');
      Feed.reset('profile');

      const skeleton = document.getElementById('profileSkeleton');
      const card = document.getElementById('profileCard');
      const tabs = document.getElementById('profileTabs');
      const panel = document.getElementById('profilePanel');

      if (skeleton) skeleton.hidden = false;
      if (card) card.hidden = true;
      if (tabs) tabs.hidden = true;
      if (panel) panel.innerHTML = '';

      try {
        const u = await API.get(`/api/users/${id}`);
        this.current = u;
        this.render(u);
      } catch (err) {
        Toast.show(err.message || 'تعذّر تحميل الملف', 'error');
      } finally {
        if (skeleton) skeleton.hidden = true;
      }
    },

    render(u) {
      const isMe = S.me && S.me.id === u.id;
      const card = document.getElementById('profileCard');
      const tabs = document.getElementById('profileTabs');
      if (!card) return;

      card.hidden = false;
      card.setAttribute('data-style', u.card_style || 'glass');
      card.style.setProperty('--_accent', u.accent_color || '#22D3EE');

      const cover = document.getElementById('profileCover');
      if (cover) cover.dataset.cover = u.cover || 'aurora';

      const avatar = document.getElementById('profileAvatar');
      if (avatar) {
        avatar.src = u.avatar || '';
        avatar.alt = u.name || '';
        avatar.dataset.frame = u.avatar_shape || 'ring';
      }

      const name = document.getElementById('profileName');
      if (name) name.textContent = u.name || '—';

      const verified = document.getElementById('profileVerified');
      if (verified) verified.hidden = !u.verified;

      const handle = document.getElementById('profileHandle');
      if (handle) handle.textContent = u.handle || '@—';

      const pronouns = document.getElementById('profilePronouns');
      if (pronouns) {
        if (u.pronouns) {
          pronouns.textContent = u.pronouns;
          pronouns.hidden = false;
        } else {
          pronouns.hidden = true;
        }
      }

      const bio = document.getElementById('profileBio');
      if (bio) bio.textContent = u.bio || '';

      const meta = document.getElementById('profileMeta');
      const website = document.getElementById('profileWebsite');
      const link = website ? website.querySelector('a') : null;

      if (u.website && link) {
        link.href = u.website;
        link.textContent = u.website.replace(/^https?:\/\//, '').replace(/\/$/, '');
        website.hidden = false;
      } else if (website) {
        website.hidden = true;
      }

      const joined = document.getElementById('profileJoined');
      if (joined && u.created_at) {
        const d = new Date(u.created_at);
        joined.querySelector('span').textContent = 'انضم ' + d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' });
        joined.hidden = false;
      } else if (joined) {
        joined.hidden = true;
      }

      if (meta && (website.hidden === false || joined.hidden === false)) meta.hidden = false;
      else if (meta) meta.hidden = true;

      const setStat = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = U.formatNumber(v); };
      setStat('statFollowers', u.followers || 0);
      setStat('statFollowing', u.following || 0);
      setStat('statPosts', u.posts_count || 0);
      setStat('statLikes', u.total_likes || 0);

      const actions = document.getElementById('profileActions');
      if (actions) {
        if (isMe) {
          actions.innerHTML = `
            <button class="btn btn-secondary" data-action="open-settings" type="button">
              <i class="ph ph-pencil-simple" aria-hidden="true"></i>
              <span>تعديل الملف</span>
            </button>
            <button class="btn btn-ghost btn-icon" data-action="share-profile" aria-label="مشاركة" type="button">
              <i class="ph ph-share-network" aria-hidden="true"></i>
            </button>`;
        } else {
          actions.innerHTML = `
            <button class="btn ${u.is_following ? 'btn-secondary' : 'btn-primary'}"
                    data-action="follow" data-user-id="${u.id}" type="button">
              <i class="ph ${u.is_following ? 'ph-check' : 'ph-user-plus'}" aria-hidden="true"></i>
              <span>${u.is_following ? 'تتابعه' : 'متابعة'}</span>
            </button>
            <button class="btn btn-secondary" data-action="message" data-user-id="${u.id}" type="button">
              <i class="ph ph-chat-circle" aria-hidden="true"></i>
              <span>رسالة</span>
            </button>`;
        }
      }

      const coverEdit = document.getElementById('profileCoverEditBtn');
      const avatarEdit = document.getElementById('profileAvatarEditBtn');
      if (coverEdit) {
        coverEdit.hidden = !isMe;
        if (isMe) coverEdit.setAttribute('data-action', 'open-settings');
      }
      if (avatarEdit) {
        avatarEdit.hidden = !isMe;
        if (isMe) avatarEdit.setAttribute('data-action', 'open-settings');
      }

      if (tabs) {
        tabs.hidden = false;
        const savedTab = document.getElementById('profileSavedTab');
        const settingsTab = document.getElementById('profileSettingsTab');
        if (savedTab) savedTab.hidden = !isMe;
        if (settingsTab) settingsTab.hidden = !isMe;
      }

      Feed.reset('profile');
      Feed.load('profile');

      this.bindActions();
    },

    bindActions() {
      const card = document.getElementById('profileCard');
      if (!card) return;

      card.querySelectorAll('[data-action="follow"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const uid = parseInt(btn.dataset.userId, 10);
          btn.setAttribute('aria-busy', 'true');
          try {
            const res = await API.post(`/api/users/${uid}/follow`);
            const following = res.following;
            btn.classList.toggle('btn-primary', !following);
            btn.classList.toggle('btn-secondary', following);
            btn.querySelector('i').className = following ? 'ph ph-check' : 'ph ph-user-plus';
            btn.querySelector('span').textContent = following ? 'تتابعه' : 'متابعة';
            if (window.Sounds) Sounds.play(following ? 'success' : 'tab');
          } catch (err) {
            Toast.show(err.message, 'error');
          } finally {
            btn.removeAttribute('aria-busy');
          }
        });
      });

      card.querySelectorAll('[data-action="message"]').forEach(btn => {
        btn.addEventListener('click', () => {
          Chat.openWith(parseInt(btn.dataset.userId, 10));
        });
      });

      card.querySelectorAll('[data-action="open-settings"]').forEach(btn => {
        btn.addEventListener('click', () => Settings.open());
      });

      card.querySelectorAll('[data-action="share-profile"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const url = window.location.origin + '/u/' + (this.current && this.current.username);
          const ok = await U.copy(url);
          Toast.show(ok ? 'تم نسخ الرابط' : 'تعذّر النسخ', ok ? 'success' : 'error', 1600);
        });
      });
    },

    async refresh() {
      if (this.current) await this.load(this.current.id);
    },

    save(ev) {
      if (ev) ev.preventDefault();
      if (window.Settings) Settings.save();
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     EXPLORE
     ═══════════════════════════════════════════════════════════════ */
  const Explore = {
    openCollection(name) {
      App.switchTab('explore');
      S.filterTag = '';
      S.filterModel = '';
      switch (name) {
        case 'trending':
          S.sort = 'top';
          App.setSort('top');
          break;
        case 'new':
          S.sort = 'recent';
          App.setSort('recent');
          break;
        case 'editor':
          S.sort = 'top';
          App.setSort('top');
          break;
      }
      Feed.reset('explore');
      Feed.load('explore', { force: true });
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     SETTINGS (v12 — robust open)
     ═══════════════════════════════════════════════════════════════ */
  const Settings = {
    view: null,
    state: {
      cover: 'aurora',
      avatar_frame: 'ring',
      accent_color: '#22D3EE',
      card_style: 'glass',
      name: '',
      handle: '',
      avatar: '',
      bio: '',
      website: '',
      pronouns: '',
    },

    init() {
      this.view = document.getElementById('settingsView');
      if (!this.view) {
        console.error('[خَيال] #settingsView غير موجود. تأكد من استيراد partials/views/settings.html في base.html');
        return;
      }
      const self = this;

      this.view.querySelector('[data-action="close-settings"]')
        ?.addEventListener('click', () => self.close());
      this.view.querySelector('[data-action="save-settings"]')
        ?.addEventListener('click', () => self.save());

      this.view.querySelectorAll('.settings-nav-item').forEach(btn => {
        btn.addEventListener('click', () => self.switchSection(btn.dataset.section));
      });

      const coverPicker = document.getElementById('settingsCoverPresets');
      if (coverPicker) {
        coverPicker.addEventListener('click', (e) => {
          const b = e.target.closest('.cover-preset');
          if (!b) return;
          coverPicker.querySelectorAll('.cover-preset').forEach(x => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
          self.state.cover = b.dataset.cover;
          self.updatePreview();
          if (window.Sounds) Sounds.play('toggle');
        });
      }

      const framePicker = document.getElementById('settingsFramePicker');
      if (framePicker) {
        framePicker.addEventListener('click', (e) => {
          const b = e.target.closest('.frame-option');
          if (!b) return;
          framePicker.querySelectorAll('.frame-option').forEach(x => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
          self.state.avatar_frame = b.dataset.frame;
          self.updatePreview();
          if (window.Sounds) Sounds.play('toggle');
        });
      }

      const accentPicker = document.getElementById('settingsAccentPicker');
      if (accentPicker) {
        accentPicker.addEventListener('click', (e) => {
          const b = e.target.closest('.accent-swatch');
          if (!b) return;
          accentPicker.querySelectorAll('.accent-swatch').forEach(x => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
          self.state.accent_color = b.dataset.color;
          const hint = document.getElementById('accentHint');
          if (hint) hint.textContent = b.dataset.color;
          self.updatePreview();
          if (window.Sounds) Sounds.play('toggle');
        });
      }

      const stylePicker = document.getElementById('settingsCardStylePicker');
      if (stylePicker) {
        stylePicker.addEventListener('click', (e) => {
          const b = e.target.closest('.style-option');
          if (!b) return;
          stylePicker.querySelectorAll('.style-option').forEach(x => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
          self.state.card_style = b.dataset.style;
          self.updatePreview();
          if (window.Sounds) Sounds.play('toggle');
        });
      }

      const pronounPicker = document.getElementById('settingsPronounPicker');
      const pronounHidden = document.getElementById('setPronouns');
      if (pronounPicker && pronounHidden) {
        pronounPicker.addEventListener('click', (e) => {
          const b = e.target.closest('.pronoun-option');
          if (!b) return;
          pronounPicker.querySelectorAll('.pronoun-option').forEach(x => x.setAttribute('aria-checked', 'false'));
          b.setAttribute('aria-checked', 'true');
          pronounHidden.value = b.dataset.pronoun || '';
          self.state.pronouns = pronounHidden.value;
          if (window.Sounds) Sounds.play('toggle');
        });
      }

      const nameEl = document.getElementById('setName');
      if (nameEl) {
        nameEl.addEventListener('input', () => {
          self.state.name = nameEl.value;
          const p = document.getElementById('settingsPreviewName');
          if (p) p.textContent = nameEl.value || 'اسمك هنا';
        });
      }

      const bioEl = document.getElementById('setBio');
      if (bioEl) {
        bioEl.addEventListener('input', () => {
          const c = document.getElementById('setBioCount');
          if (c) c.textContent = bioEl.value.length;
        });
      }

      const webEl = document.getElementById('setWebsite');
      if (webEl) webEl.addEventListener('input', () => { self.state.website = webEl.value; });

      const soundToggle = document.getElementById('soundsToggle');
      if (soundToggle) {
        soundToggle.addEventListener('click', () => {
          const next = soundToggle.getAttribute('aria-checked') !== 'true';
          soundToggle.setAttribute('aria-checked', next ? 'true' : 'false');
          if (window.Sounds) Sounds.setEnabled(next);
        });
      }

      const vol = document.getElementById('volumeSlider');
      const volHint = document.getElementById('volumeHint');
      if (vol) {
        vol.addEventListener('input', () => {
          const v = parseInt(vol.value, 10) / 100;
          if (window.Sounds) Sounds.setVolume(v);
          if (volHint) volHint.textContent = vol.value + '%';
        });
      }

      this.view.querySelectorAll('.sound-card').forEach(card => {
        card.addEventListener('click', () => {
          if (window.Sounds) Sounds.play(card.dataset.sound);
          card.classList.add('is-playing');
          setTimeout(() => card.classList.remove('is-playing'), 420);
        });
      });

      this.view.querySelectorAll('.switch:not(#soundsToggle)').forEach(sw => {
        sw.addEventListener('click', () => {
          const next = sw.getAttribute('aria-checked') !== 'true';
          sw.setAttribute('aria-checked', next ? 'true' : 'false');
          if (window.Sounds) Sounds.play('toggle');
        });
      });

      const chg = document.getElementById('changePasswordBtn');
      if (chg) {
        chg.addEventListener('click', () => {
          const oldPw = (document.getElementById('setOldPassword') || {}).value || '';
          const newPw = (document.getElementById('setNewPassword') || {}).value || '';
          if (!oldPw || !newPw) {
            if (window.Sounds) Sounds.play('error');
            return Toast.show('املأ الحقلين', 'warning');
          }
          API.post('/api/me/password', { old_password: oldPw, new_password: newPw })
            .then(() => {
              if (window.Sounds) Sounds.play('success');
              Toast.show('تم تحديث كلمة المرور', 'success');
              document.getElementById('setOldPassword').value = '';
              document.getElementById('setNewPassword').value = '';
            })
            .catch(err => {
              if (window.Sounds) Sounds.play('error');
              Toast.show(err.message || 'فشل التحديث', 'error');
            });
        });
      }

      const logout = document.getElementById('logoutBtn');
      if (logout) {
        logout.addEventListener('click', () => {
          Auth.logout();
          self.close();
        });
      }
    },

    open() {
      // إعادة ربط view إذا لم يكن موجوداً — يحمي من سباق تحميل
      if (!this.view) this.view = document.getElementById('settingsView');

      if (!this.view) {
        console.error('[خَيال] لم يُعثر على #settingsView. تحقق من استيراد partials/views/settings.html في base.html');
        if (window.Toast) Toast.show('صفحة الإعدادات غير متوفرة', 'error');
        return;
      }

      // Hydrate دائماً قبل الفتح
      this.hydrate();

      this.view.hidden = false;
      document.body.classList.add('view-open');
      if (window.Sounds) Sounds.play('open');

      setTimeout(() => {
        const first = this.view.querySelector('.settings-nav-item.is-active');
        if (first) first.focus({ preventScroll: true });
      }, 120);
    },

    close() {
      if (!this.view) return;
      this.view.hidden = true;
      document.body.classList.remove('view-open');
      if (window.Sounds) Sounds.play('close');
    },

    switchSection(name) {
      if (!name || !this.view) return;
      this.view.querySelectorAll('.settings-nav-item').forEach(b => {
        const on = b.dataset.section === name;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      this.view.querySelectorAll('.settings-panel').forEach(p => {
        p.classList.toggle('is-active', p.dataset.panel === name);
      });
      if (window.Sounds) Sounds.play('tab');
    },

    hydrate() {
      const u = (S.me && S.me.id && S.me) || window.__ME__ || {};
      this.state = {
        cover: u.cover || 'aurora',
        avatar_frame: u.avatar_shape || 'ring',
        accent_color: u.accent_color || '#22D3EE',
        card_style: u.card_style || 'glass',
        name: u.name || '',
        handle: u.handle || '',
        avatar: u.avatar || '',
        bio: u.bio || '',
        website: u.website || '',
        pronouns: u.pronouns || '',
      };

      const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      set('setName', this.state.name);
      set('setWebsite', this.state.website);
      set('setBio', this.state.bio);
      const bc = document.getElementById('setBioCount');
      if (bc) bc.textContent = (this.state.bio || '').length;

      const pp = document.getElementById('settingsPronounPicker');
      const ph = document.getElementById('setPronouns');
      if (pp && ph) {
        const match = pp.querySelector('.pronoun-option[data-pronoun="' + this.state.pronouns.replace(/"/g, '') + '"]')
                   || pp.querySelector('.pronoun-option[data-pronoun=""]');
        pp.querySelectorAll('.pronoun-option').forEach(b => {
          b.setAttribute('aria-checked', b === match ? 'true' : 'false');
        });
        ph.value = match ? (match.dataset.pronoun || '') : '';
      }

      const cp = document.getElementById('settingsCoverPresets');
      if (cp) cp.querySelectorAll('.cover-preset').forEach(b => {
        b.setAttribute('aria-pressed', b.dataset.cover === this.state.cover ? 'true' : 'false');
      });

      const fp = document.getElementById('settingsFramePicker');
      if (fp) fp.querySelectorAll('.frame-option').forEach(b => {
        b.setAttribute('aria-pressed', b.dataset.frame === this.state.avatar_frame ? 'true' : 'false');
      });

      const ap = document.getElementById('settingsAccentPicker');
      if (ap) ap.querySelectorAll('.accent-swatch').forEach(b => {
        b.setAttribute('aria-pressed', b.dataset.color === this.state.accent_color ? 'true' : 'false');
      });
      const ah = document.getElementById('accentHint');
      if (ah) ah.textContent = this.state.accent_color;

      const sp = document.getElementById('settingsCardStylePicker');
      if (sp) sp.querySelectorAll('.style-option').forEach(b => {
        b.setAttribute('aria-pressed', b.dataset.style === this.state.card_style ? 'true' : 'false');
      });

      const st = document.getElementById('soundsToggle');
      if (st && window.Sounds) st.setAttribute('aria-checked', Sounds.isEnabled() ? 'true' : 'false');
      const vs = document.getElementById('volumeSlider');
      if (vs && window.Sounds) vs.value = Math.round(Sounds.getVolume() * 100);
      const vh = document.getElementById('volumeHint');
      if (vh && window.Sounds) vh.textContent = Math.round(Sounds.getVolume() * 100) + '%';

      this.updatePreview();
    },

    updatePreview() {
      const pc = document.getElementById('settingsPreviewCover');
      const pa = document.getElementById('settingsPreviewAvatar');
      const pn = document.getElementById('settingsPreviewName');
      const ph = document.getElementById('settingsPreviewHandle');
      const card = document.getElementById('settingsPreviewCard');

      if (pc) pc.dataset.cover = this.state.cover;
      if (pa) {
        pa.dataset.frame = this.state.avatar_frame;
        if (this.state.avatar && !pa.src) pa.src = this.state.avatar;
      }
      if (pn) pn.textContent = this.state.name || 'اسمك هنا';
      if (ph) ph.textContent = this.state.handle || '@username';
      if (card) card.dataset.style = this.state.card_style;
    },

    async save() {
      const btn = document.getElementById('settingsSave');
      if (btn) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true; }

      const payload = {
        name: (document.getElementById('setName') || {}).value || '',
        bio: (document.getElementById('setBio') || {}).value || '',
        website: (document.getElementById('setWebsite') || {}).value || '',
        pronouns: (document.getElementById('setPronouns') || {}).value || '',
        cover: this.state.cover,
        avatar_frame: this.state.avatar_frame,
        accent_color: this.state.accent_color,
        card_style: this.state.card_style,
      };

      try {
        const user = await API.patch('/api/me', payload);
        S.me = user;
        window.__ME__ = user;
        if (window.Sounds) Sounds.play('success');
        Toast.show('تم الحفظ', 'success');
        Auth.updateChrome(user);
        if (S.tab === 'profile' && S.viewingUser && S.viewingUser.id === user.id) {
          Profile.load(user.id);
        }
      } catch (err) {
        if (window.Sounds) Sounds.play('error');
        Toast.show(err.message || 'تعذّر الحفظ', 'error');
      } finally {
        if (btn) { btn.removeAttribute('aria-busy'); btn.disabled = false; }
      }
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     PULL TO REFRESH
     ═══════════════════════════════════════════════════════════════ */
  const PTR = {
    init() {
      const main = document.querySelector('.app-main');
      if (!main) return;

      let startY = 0;
      let pulling = false;
      let indicator = null;
      const THRESHOLD = 70;

      const createIndicator = () => {
        const el = document.createElement('div');
        el.className = 'ptr';
        el.innerHTML = '<i class="ph ph-arrow-down" aria-hidden="true"></i>';
        main.appendChild(el);
        return el;
      };

      main.addEventListener('touchstart', (e) => {
        if (window.scrollY > 5) return;
        startY = e.touches[0].clientY;
        pulling = true;
        indicator = indicator || createIndicator();
      }, { passive: true });

      main.addEventListener('touchmove', (e) => {
        if (!pulling || !indicator) return;
        const delta = e.touches[0].clientY - startY;
        if (delta <= 0) return;
        const progress = Math.min(delta / THRESHOLD, 1.2);
        indicator.classList.add('pulling');
        indicator.style.marginTop = Math.min(16, delta * 0.35) + 'px';
        indicator.style.opacity = String(progress);
        if (delta > THRESHOLD) indicator.classList.add('ready');
        else indicator.classList.remove('ready');
      }, { passive: true });

      main.addEventListener('touchend', async () => {
        if (!pulling || !indicator) return;
        pulling = false;
        if (indicator.classList.contains('ready')) {
          indicator.classList.add('refreshing');
          await App.refreshAll(true);
          indicator.classList.remove('refreshing', 'ready');
        }
        setTimeout(() => {
          indicator.classList.remove('pulling');
          indicator.style.marginTop = '';
          indicator.style.opacity = '';
        }, 240);
      });
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     APP
     ═══════════════════════════════════════════════════════════════ */
  const App = {
    boot() {
      if (S.booted) return;
      S.booted = true;

      console.log('[خَيال] booting v' + CFG.BUILD);

      Theme.init();
      Net.init();
      Install.init();
      Composer.init();
      Comments.init();
      Settings.init();
      PTR.init();
      this.bindGlobal();
      this.bindNav();
      this.bindDock();
      this.bindSearch();
      this.bindInfiniteScroll();
      this.bindKeyboard();

      Auth.updateChrome(S.me);

      if (S.me) {
        this.showApp();
        this.switchTab('home', { silent: true });
      } else {
        this.showLanding();
        this.bindLanding();
      }

      this.updateHeroStats();

      console.log('[خَيال] booted. Settings module:',
                  window.Settings ? 'ready' : 'missing');
    },

    bindGlobal() {
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;

        if (action === 'switch-mode') { e.preventDefault(); Auth.switchMode(btn.dataset.mode); return; }
        if (action === 'close-auth') { e.preventDefault(); Auth.close(); return; }
        if (action === 'close-composer') { e.preventDefault(); Composer.close(); return; }
        if (action === 'close-settings') { e.preventDefault(); Settings.close(); return; }
        if (action === 'close-edit-profile') { e.preventDefault(); Settings.close(); return; }
        if (action === 'submit-composer') { e.preventDefault(); Composer.publish(); return; }
        if (action === 'save-profile') { e.preventDefault(); Settings.save(); return; }
        if (action === 'save-settings') { e.preventDefault(); Settings.save(); return; }
        if (action === 'choose-type') { e.preventDefault(); Composer.chooseType(btn.dataset.type); return; }
        if (action === 'chat-list') { e.preventDefault(); Chat.backToList(); return; }
        if (action === 'chat-new') { e.preventDefault(); Toast.show('ابدأ محادثة من ملف أي مستخدم', 'info'); return; }
        if (action === 'share-profile') {
          const url = window.location.origin + '/u/' + (Profile.current && Profile.current.username);
          U.copy(url).then(ok => Toast.show(ok ? 'تم نسخ الرابط' : 'تعذّر النسخ', ok ? 'success' : 'error'));
          return;
        }
        if (action === 'open-settings') { e.preventDefault(); Settings.open(); return; }
        if (action === 'pick-avatar-file') { e.preventDefault(); const i = document.getElementById('avatarFileInput'); if (i) i.click(); return; }
        if (action === 'pick-cover-file') { e.preventDefault(); const i = document.getElementById('coverFileInput'); if (i) i.click(); return; }
        if (action === 'toggle-notifications') {
          e.preventDefault();
          Drawers.openNotifications();
          return;
        }
      });

      document.addEventListener('click', (e) => {
        const tag = e.target.closest('.tag[data-tag]');
        if (tag) {
          const t = tag.dataset.tag;
          App.filterByTag(t);
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const composerView = document.getElementById('composerView');
        const settingsView = document.getElementById('settingsView');
        const authModal = document.getElementById('authModal');

        if (composerView && !composerView.hidden) { Composer.close(); return; }
        if (settingsView && !settingsView.hidden) { Settings.close(); return; }
        if (authModal && authModal.getAttribute('data-open') === 'true') { Auth.close(); return; }
        Drawers.closeAll();
      });
    },

    bindNav() {
      const themeBtn = document.querySelector('button[aria-label="تبديل المظهر"]');
      if (themeBtn) {
        themeBtn.removeAttribute('onclick');
        themeBtn.addEventListener('click', () => Theme.toggle());
      }

      const signIn = document.getElementById('signInBtn');
      if (signIn) {
        signIn.removeAttribute('onclick');
        signIn.addEventListener('click', () => Auth.open('login'));
      }

      const avatarBtn = document.getElementById('avatarBtn');
      if (avatarBtn) {
        avatarBtn.removeAttribute('onclick');
        avatarBtn.addEventListener('click', () => {
          if (S.me) this.switchTab('profile');
          else Auth.open('login');
        });
      }

      let ticking = false;
      window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const nav = document.querySelector('.nav');
          if (nav) nav.classList.toggle('is-scrolled', window.scrollY > 12);
          ticking = false;
        });
      }, { passive: true });
    },

    bindDock() {
      document.querySelectorAll('.dock-item[data-tab]').forEach(btn => {
        btn.removeAttribute('onclick');
        const tab = btn.dataset.tab;
        btn.addEventListener('click', () => {
          if (tab === 'settings') {
            if (window.Settings) {
              Settings.open();
            } else {
              console.error('[خَيال] Settings module غير محمّل');
              if (window.Toast) Toast.show('تعذّر فتح الإعدادات', 'error');
            }
          } else {
            this.switchTab(tab);
          }
        });
      });

      const create = document.querySelector('.dock-create');
      if (create) {
        create.removeAttribute('onclick');
        create.addEventListener('click', () => {
          if (window.Composer) Composer.open();
        });
      }
    },

    bindSearch() {
      const input = document.getElementById('searchInput');
      const results = document.getElementById('searchResults');
      if (!input || !results) return;

      const run = U.debounce(async () => {
        const q = input.value.trim();
        if (!q) {
          results.setAttribute('data-open', 'false');
          results.innerHTML = '';
          return;
        }
        try {
          const items = await API.get('/api/posts?q=' + encodeURIComponent(q) + '&limit=6');
          if (!items || !items.length) {
            results.innerHTML = `<div style="padding:var(--sp-4);text-align:center;color:var(--fg-3);font-size:var(--fs-2)">لا نتائج</div>`;
          } else {
            results.innerHTML = items.map(p => `
              <div class="search-result" data-post-id="${p.id}">
                <img src="${U.escapeHtml(p.image || '')}" alt="" loading="lazy">
                <div class="search-result-info">
                  <strong>${U.escapeHtml(p.title || '')}</strong>
                  <span>${U.escapeHtml((p.prompt || '').slice(0, 80))}</span>
                </div>
              </div>`).join('');
            results.querySelectorAll('.search-result').forEach(r => {
              r.addEventListener('click', () => {
                const pid = r.dataset.postId;
                results.setAttribute('data-open', 'false');
                input.value = '';
                const existing = document.querySelector(`[data-post-id="${pid}"]`);
                if (existing) existing.scrollIntoView({ behavior: 'smooth', block: 'center' });
              });
            });
          }
          results.setAttribute('data-open', 'true');
        } catch (err) { /* silent */ }
      }, CFG.SEARCH_DEBOUNCE);

      input.addEventListener('input', run);
      input.addEventListener('focus', () => { if (input.value.trim()) results.setAttribute('data-open', 'true'); });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.search')) results.setAttribute('data-open', 'false');
      });
    },

    bindInfiniteScroll() {
      const onScroll = () => {
        if (window.innerHeight + window.scrollY < document.body.offsetHeight - 800) return;
        const fs = feedState(S.tab);
        if (!fs.hasMore || fs.busy || !fs.loaded) return;
        Feed.loadMore(S.tab);
      };
      window.addEventListener('scroll', U.debounce(onScroll, 200), { passive: true });
    },

    bindKeyboard() {
      document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          const input = document.getElementById('searchInput');
          if (input) input.focus();
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
          e.preventDefault();
          if (S.me) Composer.open();
        }
      });
    },

    bindLanding() {
      document.querySelectorAll('button[onclick*="previewFeed"]').forEach(b => {
        b.removeAttribute('onclick');
        b.addEventListener('click', () => this.previewFeed());
      });
      document.querySelectorAll('button[onclick*="Auth.open"]').forEach(b => {
        b.removeAttribute('onclick');
        b.addEventListener('click', () => Auth.open('register'));
      });
    },

    showLanding() {
      const landing = document.getElementById('view-landing');
      const appView = document.getElementById('view-app');
      if (landing) { landing.hidden = false; landing.classList.add('is-active'); }
      if (appView) appView.hidden = true;
      const dock = document.getElementById('dock');
      if (dock) dock.hidden = true;
      document.querySelectorAll('.nav-links').forEach(n => { n.style.display = ''; });
    },

    showApp() {
      const landing = document.getElementById('view-landing');
      const appView = document.getElementById('view-app');
      if (landing) { landing.hidden = true; landing.classList.remove('is-active'); }
      if (appView) { appView.hidden = false; appView.classList.add('is-active'); }
      const dock = document.getElementById('dock');
      if (dock) dock.hidden = !S.me;
      document.querySelectorAll('.nav-links').forEach(n => { n.style.display = 'none'; });
    },

    previewFeed() {
      if (!S.me) { Auth.open('register'); return; }
      this.showApp();
      this.switchTab('home');
    },

    activateTab(name) {
      document.querySelectorAll('.tab-panel').forEach(p => {
        p.classList.toggle('is-active', p.dataset.tab === name);
      });
      document.querySelectorAll('.dock-item[data-tab]').forEach(b => {
        const on = b.dataset.tab === name;
        b.setAttribute('aria-current', on ? 'page' : 'false');
      });
    },

    switchTab(name, opts) {
      if (!name) return;
      opts = opts || {};
      if (S.tab !== name) S.tabHistory.push(S.tab);
      S.tab = name;
      this.activateTab(name);

      if (window.Sounds && !opts.silent) Sounds.play('tab');

      if (name === 'home' || name === 'explore') {
        Feed.load(name);
      } else if (name === 'chat') {
        Chat.loadList();
      } else if (name === 'profile') {
        if (S.viewingUser) Profile.load(S.viewingUser.id);
        else Profile.load();
      } else if (name === 'liked' || name === 'saved') {
        Feed.load(name);
      }

      if (!opts.noScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    setSort(sort) {
      S.sort = sort;
      document.querySelectorAll('.sort-tab').forEach(b => {
        b.setAttribute('aria-selected', b.dataset.sort === sort ? 'true' : 'false');
      });
      Feed.reset('home');
      Feed.reset('explore');
      Feed.load(S.tab === 'explore' ? 'explore' : 'home', { force: true });
    },

    filterByTag(tag) {
      if (!tag) return;
      S.filterTag = tag;
      S.sort = 'recent';
      this.switchTab('explore');
      Feed.reset('explore');
      Feed.load('explore', { force: true });
    },

    openProfile(userId) {
      if (!userId) return;
      Profile.load(userId);
    },

    async refreshAll(force) {
      Feed.reset(S.tab);
      await Feed.load(S.tab, { force: true });
      if (S.tab === 'chat') await Chat.loadList();
      if (S.tab === 'profile' && S.viewingUser) await Profile.load(S.viewingUser.id);
      if (force) Toast.show('تم التحديث', 'success', 1600);
    },

    async updateHeroStats() {
      try {
        const health = await API.get('/api/health');
        const postEl = document.getElementById('heroStatPosts');
        const userEl = document.getElementById('heroStatUsers');
        if (postEl) postEl.textContent = U.formatNumber(health.posts || 0);
        if (userEl) userEl.textContent = U.formatNumber(health.users || 0);
      } catch (e) { /* silent */ }
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     UNLOCK AUDIO ON FIRST GESTURE
     ═══════════════════════════════════════════════════════════════ */
  function unlockAudioOnce() {
    if (window.Sounds) Sounds.unlock();
    ['click', 'touchstart', 'keydown'].forEach(evt => {
      document.removeEventListener(evt, unlockAudioOnce);
    });
  }
  ['click', 'touchstart', 'keydown'].forEach(evt => {
    document.addEventListener(evt, unlockAudioOnce, { once: true, passive: true });
  });

  /* ═══════════════════════════════════════════════════════════════
     EXPORT + BOOT
     ═══════════════════════════════════════════════════════════════ */
  window.App = App;
  window.Auth = Auth;
  window.Post = Post;
  window.Chat = Chat;
  window.Comments = Comments;
  window.Drawers = Drawers;
  window.Composer = Composer;
  window.Profile = Profile;
  window.Explore = Explore;
  window.Settings = Settings;
  window.Toast = Toast;
  window.Install = Install;
  window.U = U;
  window.Theme = Theme;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.boot());
  } else {
    App.boot();
  }
})();