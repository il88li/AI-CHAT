/* ═══════════════════════════════════════════════════════════════════════
   خَيال — Application Layer v7.0
   Vanilla JS · RTL-aware · PWA-ready · State-machine driven
   ═══════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  /* ─────────────── 0. GLOBAL STATE ─────────────── */
  const State = {
    me: window.__ME__ || null,
    tab: 'home',
    sort: 'recent',
    filter: null,
    posts: { home: [], explore: [], liked: [], saved: [], profile: [] },
    chats: [],
    activeChat: null,
    activePost: null,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    online: navigator.onLine,
    _pendingLikes: new Set(),
    _pendingSaves: new Set(),
  };

  /* ─────────────── 1. DOM UTILS ─────────────── */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const byId = (id) => document.getElementById(id);
  const create = (tag, props = {}, children = []) => {
    const el = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  };

  const on = (el, evt, fn, opts) => el && el.addEventListener(evt, fn, opts);
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  /* ─────────────── 2. STORAGE ─────────────── */
  const Store = {
    get(key, fallback = null) {
      try {
        const v = localStorage.getItem(`kh_${key}`);
        return v ? JSON.parse(v) : fallback;
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(`kh_${key}`, JSON.stringify(value)); } catch {}
    },
    remove(key) {
      try { localStorage.removeItem(`kh_${key}`); } catch {}
    },
  };

  /* ─────────────── 3. NETWORK ─────────────── */
  const API = {
    async request(url, options = {}) {
      const opts = {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
      };
      if (opts.body && typeof opts.body === 'object') {
        opts.body = JSON.stringify(opts.body);
      }
      try {
        const res = await fetch(url, opts);
        const text = await res.text();
        const data = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })() : null;
        if (!res.ok) {
          const err = new Error(data?.error || `HTTP ${res.status}`);
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      } catch (e) {
        if (e.name === 'TypeError') {
          U.toast('تعذّر الاتصال بالخادم', 'ph-wifi-slash', 'error');
        }
        throw e;
      }
    },
    get: (url) => API.request(url, { method: 'GET' }),
    post: (url, body) => API.request(url, { method: 'POST', body }),
    patch: (url, body) => API.request(url, { method: 'PATCH', body }),
    del: (url) => API.request(url, { method: 'DELETE' }),
  };

  /* ─────────────── 4. UTILITIES (U) ─────────────── */
  const U = {
    toast(msg, icon = 'ph-check-circle', tone = 'default', duration = 2600) {
      const wrap = byId('toastWrap');
      if (!wrap) return;
      const el = create('div', { class: 'toast', dataset: { tone } }, [
        create('i', { class: `ph ${icon}`, 'aria-hidden': 'true' }),
        create('span', { text: msg }),
      ]);
      wrap.appendChild(el);
      const remove = () => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(10px)';
        el.style.transition = 'opacity .2s, transform .2s';
        setTimeout(() => el.remove(), 220);
      };
      setTimeout(remove, duration);
      return el;
    },

    formatNumber(n) {
      if (n == null) return '0';
      if (n < 1000) return String(n);
      if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'K';
      return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    },

    formatTime(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      const now = new Date();
      const diff = (now - d) / 1000;
      if (diff < 60) return 'الآن';
      if (diff < 3600) return `قبل ${Math.floor(diff / 60)} د`;
      if (diff < 86400) return `قبل ${Math.floor(diff / 3600)} س`;
      if (diff < 604800) return `قبل ${Math.floor(diff / 86400)} ي`;
      return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
    },

    autoGrow(textarea) {
      if (!textarea) return;
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
    },

    debounce(fn, wait = 250) {
      let timer;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
      };
    },

    async copy(text) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return true;
        }
        const ta = create('textarea', { style: { position: 'fixed', opacity: '0' } });
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch { return false; }
    },

    vibrate(ms = 10) {
      if (!State.reducedMotion && navigator.vibrate) {
        try { navigator.vibrate(ms); } catch {}
      }
    },

    focusTrap(container, initialFocus = null) {
      const focusables = $$(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        container
      ).filter(el => el.offsetParent !== null);

      const first = initialFocus || focusables[0];
      const last = focusables[focusables.length - 1];
      const prevActive = document.activeElement;

      const handler = (e) => {
        if (e.key !== 'Tab') return;
        if (focusables.length === 0) { e.preventDefault(); return; }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      };

      container.addEventListener('keydown', handler);
      if (first) first.focus();

      return () => {
        container.removeEventListener('keydown', handler);
        if (prevActive && prevActive.focus) {
          try { prevActive.focus(); } catch {}
        }
      };
    },

    lockScroll(lock) {
      document.body.style.overflow = lock ? 'hidden' : '';
      document.documentElement.style.overflow = lock ? 'hidden' : '';
    },
  };

  /* ─────────────── 5. MODAL / SHEET / DRAWER ─────────────── */
  const Layer = {
    _stack: [],

    open(id, options = {}) {
      const el = typeof id === 'string' ? byId(id) : id;
      if (!el) return;
      el.dataset.open = 'true';
      el.removeAttribute('hidden');
      U.lockScroll(true);

      const releaseFocus = options.trapFocus !== false
        ? U.focusTrap(el.querySelector('[role="dialog"]') || el)
        : () => {};

      const handleKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          Layer.close(el);
        }
      };
      el.addEventListener('keydown', handleKey);

      Layer._stack.push({ el, releaseFocus, handleKey });
    },

    close(id) {
      const el = typeof id === 'string' ? byId(id) : id;
      if (!el) return;
      el.dataset.open = 'false';
      const idx = Layer._stack.findIndex(x => x.el === el);
      if (idx >= 0) {
        const { releaseFocus, handleKey } = Layer._stack[idx];
        el.removeEventListener('keydown', handleKey);
        releaseFocus && releaseFocus();
        Layer._stack.splice(idx, 1);
      }
      if (Layer._stack.length === 0) U.lockScroll(false);
    },

    closeAll() {
      [...Layer._stack].forEach(x => Layer.close(x.el));
    },
  };

  /* ─────────────── 6. AUTH ─────────────── */
  const Auth = {
    _lastFocus: null,

    open(mode = 'login') {
      if (State.me) {
        U.toast('أنت مسجّل دخول بالفعل', 'ph-info');
        return;
      }
      Auth._lastFocus = document.activeElement;
      Auth.switchMode(mode);
      Layer.open('authModal');
      setTimeout(() => {
        const el = mode === 'register' ? byId('regName') : byId('loginIdentifier');
        el && el.focus();
      }, 180);
    },

    close(e) {
      if (e && e.target !== e.currentTarget) return;
      Layer.close('authModal');
      Auth._resetForms();
    },

    switchMode(mode) {
      const tabs = $('.auth-tabs');
      const title = byId('authTitle');
      const sub = byId('authSub');
      if (tabs) tabs.dataset.mode = mode;

      $$('.auth-tab').forEach(t => {
        const isActive = t.dataset.mode === mode;
        t.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      $$('.auth-form').forEach(f => {
        f.classList.toggle('is-active', f.id === `${mode}Form`);
      });

      if (title) title.textContent = mode === 'login' ? 'تسجيل الدخول' : 'أنشئ حسابك';
      if (sub) sub.textContent = mode === 'login'
        ? 'أهلاً بعودتك إلى خَيال'
        : 'دقيقة واحدة للانضمام إلى خَيال';

      Auth._resetErrors();
    },

    _resetForms() {
      const forms = ['loginForm', 'registerForm'];
      forms.forEach(id => {
        const f = byId(id);
        if (f) f.reset();
      });
      Auth._resetErrors();
      const strength = $('.pw-strength');
      if (strength) strength.dataset.level = '0';
      const uStatus = byId('usernameStatus');
      const eStatus = byId('emailStatus');
      if (uStatus) uStatus.removeAttribute('data-state');
      if (eStatus) eStatus.removeAttribute('data-state');
    },

    _resetErrors() {
      $$('.input[aria-invalid="true"]').forEach(el => el.removeAttribute('aria-invalid'));
      $$('.input-status').forEach(el => {
        el.removeAttribute('data-state');
        el.textContent = '';
      });
    },

    togglePassword(btn) {
      const wrap = btn.closest('.input-wrap');
      const input = wrap && wrap.querySelector('input');
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      const icon = btn.querySelector('i');
      if (icon) icon.className = isPassword ? 'ph ph-eye-slash' : 'ph ph-eye';
      btn.setAttribute('aria-label', isPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
    },

    checkStrength(pw) {
      const el = $('.pw-strength');
      if (!el) return;
      let score = 0;
      if (pw.length >= 6) score++;
      if (pw.length >= 10) score++;
      if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
      if (/\d/.test(pw)) score++;
      if (/[^A-Za-z0-9]/.test(pw)) score++;
      el.dataset.level = String(Math.min(4, score));
    },

    async checkUsername(input) {
      const val = input.value.trim();
      const status = byId('usernameStatus');
      if (!status) return;
      if (!/^[a-zA-Z0-9_\-]{3,32}$/.test(val)) {
        status.removeAttribute('data-state');
        status.textContent = '';
        return;
      }
      status.dataset.state = 'loading';
      try {
        const res = await API.post('/api/auth/check-username', { username: val });
        if (res.available) {
          status.dataset.state = 'ok';
          status.className = 'input-status ph ph-check-circle';
        } else {
          status.dataset.state = 'err';
          status.className = 'input-status ph ph-x-circle';
          input.setAttribute('aria-invalid', 'true');
        }
      } catch {
        status.removeAttribute('data-state');
      }
    },

    async checkEmail(input) {
      const val = input.value.trim().toLowerCase();
      const status = byId('emailStatus');
      if (!status) return;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val)) {
        status.removeAttribute('data-state');
        return;
      }
      try {
        const res = await API.post('/api/auth/check-email', { email: val });
        if (res.available) {
          status.dataset.state = 'ok';
          status.className = 'input-status ph ph-check-circle';
        } else {
          status.dataset.state = 'err';
          status.className = 'input-status ph ph-x-circle';
          input.setAttribute('aria-invalid', 'true');
        }
      } catch {}
    },

    async login(e) {
      e.preventDefault();
      const btn = byId('loginSubmit');
      const id = byId('loginIdentifier').value.trim();
      const pw = byId('loginPassword').value;
      const remember = byId('rememberMe')?.checked ?? false;

      if (!id || !pw) return;

      btn.setAttribute('aria-busy', 'true');
      try {
        const user = await API.post('/api/auth/login', {
          identifier: id, password: pw, remember,
        });
        State.me = user;
        Auth.close();
        App.onAuthChange();
        U.toast(`أهلاً ${user.name}!`, 'ph-sparkle', 'success');
        U.vibrate(20);
      } catch (err) {
        if (err.status === 401) {
          byId('loginPassword')?.setAttribute('aria-invalid', 'true');
          U.toast('بيانات الدخول غير صحيحة', 'ph-warning-circle', 'error');
        } else {
          U.toast(err.message || 'تعذّر تسجيل الدخول', 'ph-warning-circle', 'error');
        }
      } finally {
        btn.removeAttribute('aria-busy');
      }
    },

    async register(e) {
      e.preventDefault();
      const btn = byId('registerSubmit');
      const name = byId('regName').value.trim();
      const username = byId('regUsername').value.trim();
      const email = byId('regEmail').value.trim();
      const password = byId('regPassword').value;
      const agree = byId('agreeTerms')?.checked;

      if (!agree) {
        U.toast('يجب الموافقة على الشروط', 'ph-warning-circle', 'warning');
        return;
      }
      if (!name || !username || !email || !password) return;

      btn.setAttribute('aria-busy', 'true');
      try {
        const user = await API.post('/api/auth/register', {
          name, username, email, password,
        });
        State.me = user;
        Auth.close();
        App.onAuthChange();
        U.toast(`مرحباً بك في خَيال، ${user.name}!`, 'ph-confetti', 'success', 3200);
        U.vibrate([15, 40, 15]);
      } catch (err) {
        const msg = err.data?.error || err.message || 'تعذّر إنشاء الحساب';
        if (msg.includes('البريد')) byId('regEmail')?.setAttribute('aria-invalid', 'true');
        if (msg.includes('المستخدم')) byId('regUsername')?.setAttribute('aria-invalid', 'true');
        U.toast(msg, 'ph-warning-circle', 'error');
      } finally {
        btn.removeAttribute('aria-busy');
      }
    },

    async logout() {
      const ok = await App.confirm({
        title: 'تسجيل الخروج؟',
        message: 'ستحتاج لتسجيل الدخول مرة أخرى للوصول إلى حسابك.',
        confirmText: 'خروج',
        danger: true,
      });
      if (!ok) return;
      try { await API.post('/api/auth/logout'); } catch {}
      State.me = null;
      App.onAuthChange();
      App.goHome();
      U.toast('تم تسجيل الخروج', 'ph-sign-out');
    },

    forgot(e) {
      e && e.preventDefault();
      U.toast('قريباً — استعادة كلمة المرور', 'ph-key');
    },

    openEditProfile() {
      if (!State.me) { Auth.open('login'); return; }
      const name = byId('epName');
      const bio = byId('epBio');
      const avatar = byId('epAvatar');
      if (name) name.value = State.me.name || '';
      if (bio) bio.value = State.me.bio || '';
      if (avatar) avatar.value = State.me.avatar || '';
      Layer.open('editProfileModal');
    },

    closeEditProfile(e) {
      if (e && e.target !== e.currentTarget) return;
      Layer.close('editProfileModal');
    },

    async saveProfile(e) {
      e.preventDefault();
      const name = byId('epName').value.trim();
      const bio = byId('epBio').value.trim();
      const avatar = byId('epAvatar').value.trim();
      try {
        const user = await API.patch('/api/me', { name, bio, avatar });
        State.me = { ...State.me, ...user };
        Auth.closeEditProfile();
        App.updateUserUI();
        U.toast('تم حفظ التعديلات', 'ph-check-circle', 'success');
      } catch (err) {
        U.toast(err.message || 'تعذّر الحفظ', 'ph-warning-circle', 'error');
      }
    },
  };

  /* ─────────────── 7. APP CORE ─────────────── */
  const App = {
    _initialized: false,

    async init() {
      if (App._initialized) return;
      App._initialized = true;

      App.applyTheme(Store.get('theme', 'dark'));
      App.bindGlobal();
      App.updateUserUI();
      App.bindTabs();

      // Show dock only in app view
      App.onViewChange();

      // Load initial data
      if (State.me) {
        App.refreshAll();
      } else {
        App.loadLandingFeed();
      }

      // Deep link
      App.handleHashChange();
      on(window, 'hashchange', App.handleHashChange);
    },

    bindGlobal() {
      // Search
      const searchInput = byId('searchInput');
      if (searchInput) {
        searchInput.addEventListener('input', U.debounce((e) => {
          App.performSearch(e.target.value);
        }, 260));
      }

      // Nav scroll state
      const nav = byId('nav');
      if (nav) {
        window.addEventListener('scroll', () => {
          nav.classList.toggle('is-scrolled', window.scrollY > 12);
        }, { passive: true });
      }

      // Online/offline
      on(window, 'online', () => {
        State.online = true;
        byId('netBar')?.setAttribute('data-open', 'false');
        U.toast('عاد الاتصال', 'ph-wifi', 'success');
      });
      on(window, 'offline', () => {
        State.online = false;
        byId('netBar')?.setAttribute('data-open', 'true');
      });

      // Global click — close search results
      on(document, 'click', (e) => {
        if (!e.target.closest('.search')) {
          const results = byId('searchResults');
          if (results) results.dataset.open = 'false';
        }
      });

      // Global Escape
      on(document, 'keydown', (e) => {
        if (e.key === 'Escape') {
          const results = byId('searchResults');
          if (results?.dataset.open === 'true') {
            results.dataset.open = 'false';
            byId('searchInput')?.blur();
          }
        }
        // Cmd/Ctrl + K
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          App.toggleCommandPalette();
        }
      });

      // Username/Email async check
      const regUsername = byId('regUsername');
      const regEmail = byId('regEmail');
      if (regUsername) {
        regUsername.addEventListener('input', U.debounce((e) => Auth.checkUsername(e.target), 500));
      }
      if (regEmail) {
        regEmail.addEventListener('input', U.debounce((e) => Auth.checkEmail(e.target), 500));
      }

      // Composer trigger — keyboard
      $$('.composer-trigger').forEach(trig => {
        trig.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            Composer.open();
          }
        });
      });

      // Sort tabs
      $$('.sort-tab').forEach(t => {
        on(t, 'click', () => {
          $$('.sort-tab').forEach(x => x.setAttribute('aria-selected', 'false'));
          t.setAttribute('aria-selected', 'true');
          App.setSort(t.dataset.sort);
        });
      });

      // Install banner
      Install.init();

      // Visibility — refresh on return
      on(document, 'visibilitychange', () => {
        if (document.visibilityState === 'visible' && State.me) {
          App.refreshChatsBadge();
        }
      });
    },

    bindTabs() {
      const dock = byId('dock');
      if (!dock) return;
      $$('.dock-item[data-tab]').forEach(btn => {
        on(btn, 'click', () => App.switchTab(btn.dataset.tab));
      });
    },

    onAuthChange() {
      App.updateUserUI();
      if (State.me) {
        App.loadFeed('home');
        App.loadChats();
      } else {
        App.goHome();
      }
    },

    updateUserUI() {
      const signIn = byId('signInBtn');
      const avatarBtn = byId('avatarBtn');
      const avatarImg = byId('avatarImg');
      const composerAvatar = byId('composerAvatar');
      const composerFormAvatar = byId('composerFormAvatar');
      const composerUserName = byId('composerUserName');
      const dock = byId('dock');

      if (State.me) {
        if (signIn) signIn.hidden = true;
        if (avatarBtn) avatarBtn.hidden = false;
        if (avatarImg) avatarImg.src = State.me.avatar || '';
        if (composerAvatar) composerAvatar.src = State.me.avatar || '';
        if (composerFormAvatar) composerFormAvatar.src = State.me.avatar || '';
        if (composerUserName) composerUserName.textContent = State.me.name || '—';
        if (dock) dock.hidden = false;
        App.updateProfileUI();
      } else {
        if (signIn) signIn.hidden = false;
        if (avatarBtn) avatarBtn.hidden = true;
        if (dock) dock.hidden = true;
      }
    },

    updateProfileUI() {
      if (!State.me) return;
      const set = (id, val) => { const el = byId(id); if (el) el.textContent = val; };
      const img = byId('profileAvatar');
      if (img) img.src = State.me.avatar || '';
      set('profileName', State.me.name || '');
      set('profileHandle', State.me.handle || '');
      set('profileBio', State.me.bio || '');
      set('statFollowers', U.formatNumber(State.me.followers || 0));
      set('statFollowing', U.formatNumber(State.me.following || 0));
    },

    applyTheme(theme) {
      document.documentElement.dataset.theme = theme;
      const icon = byId('themeIcon');
      if (icon) icon.className = theme === 'dark' ? 'ph ph-moon' : 'ph ph-sun';
      Store.set('theme', theme);
    },

    toggleTheme() {
      const current = document.documentElement.dataset.theme || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      App.applyTheme(next);
      U.vibrate(8);
    },

    switchTab(tab, opts = {}) {
      if (['liked', 'saved', 'profile', 'chat'].includes(tab) && !State.me) {
        Auth.open('login');
        return;
      }

      State.tab = tab;
      $$('.tab-panel').forEach(p => {
        p.classList.toggle('is-active', p.dataset.tab === tab);
      });
      $$('.dock-item[data-tab]').forEach(b => {
        b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false');
      });

      if (!opts.silent) {
        const url = new URL(location.href);
        url.hash = tab === 'home' ? '' : `#${tab}`;
        history.replaceState(null, '', url);
        window.scrollTo({ top: 0, behavior: State.reducedMotion ? 'auto' : 'smooth' });
      }

      // Lazy load
      const loaders = {
        home: () => App.loadFeed('home'),
        explore: () => App.loadFeed('explore'),
        liked: () => App.loadFeed('liked'),
        saved: () => App.loadFeed('saved'),
        profile: () => App.loadProfile(),
        chat: () => App.loadChats(),
      };
      loaders[tab] && loaders[tab]();
    },

    handleHashChange() {
      const hash = location.hash.replace('#', '') || 'home';
      const valid = ['home', 'explore', 'liked', 'saved', 'chat', 'profile'];
      if (valid.includes(hash)) {
        App.switchTab(hash, { silent: true });
      }
    },

    onViewChange() {
      const isApp = location.pathname.startsWith('/app') ||
                    Store.get('entered_app', false);
      const landing = byId('view-landing');
      const app = byId('view-app');
      if (landing) landing.hidden = isApp;
      if (app) app.hidden = !isApp;
    },

    previewFeed() {
      Store.set('entered_app', true);
      const landing = byId('view-landing');
      const app = byId('view-app');
      if (landing) landing.hidden = true;
      if (app) app.hidden = false;
      if (State.me) {
        byId('dock').hidden = false;
        App.loadFeed('home');
      } else {
        App.loadFeed('home');
      }
      window.scrollTo({ top: 0 });
    },

    goHome() {
      Store.remove('entered_app');
      const landing = byId('view-landing');
      const app = byId('view-app');
      if (landing) landing.hidden = false;
      if (app) app.hidden = true;
      const dock = byId('dock');
      if (dock) dock.hidden = true;
      window.scrollTo({ top: 0 });
    },

    setSort(sort) {
      State.sort = sort;
      App.loadFeed(State.tab);
    },

    filterByTag(tag) {
      State.filter = tag;
      $$('.filter').forEach(f => {
        f.setAttribute('aria-pressed', f.dataset.tag === tag ? 'true' : 'false');
      });
      App.loadFeed('home');
    },

    async refreshAll(showToast = false) {
      if (!State.me) { App.loadLandingFeed(); return; }
      const btn = $('.refresh-btn');
      btn?.setAttribute('aria-busy', 'true');
      try {
        await Promise.all([
          App.loadFeed('home'),
          App.loadChats(),
        ]);
        if (showToast) U.toast('تم التحديث', 'ph-check-circle', 'success');
      } finally {
        btn?.removeAttribute('aria-busy');
      }
    },

    async loadLandingFeed() {
      const feed = byId('landingFeed');
      if (!feed) return;
      try {
        const posts = await API.get('/api/posts?limit=6');
        const html = posts.map(p => Render.prompt(p)).join('');
        feed.innerHTML = html || Render.empty('لا توجد برومبتات بعد', 'ph-sparkle');
      } catch {}
    },

    async loadFeed(which) {
      const feedMap = {
        home: 'homeFeed',
        explore: 'exploreFeed',
        liked: 'likedFeed',
        saved: 'savedFeed',
        profile: 'profilePanel',
      };
      const feedId = feedMap[which];
      const feed = byId(feedId);
      if (!feed) return;

      // Show skeletons on first load
      const isFirstLoad = !State.posts[which] || State.posts[which].length === 0;
      if (isFirstLoad) {
        feed.setAttribute('aria-busy', 'true');
        feed.innerHTML = Array(6).fill(Render.skeleton()).join('');
      }

      try {
        let posts = [];
        if (which === 'liked' || which === 'saved') {
          // Fetch all, filter client-side
          const all = await API.get('/api/posts?limit=100');
          posts = all.filter(p => which === 'liked' ? p.liked : p.saved);
          App.updateCountPill(which, posts.length);
        } else if (which === 'profile') {
          posts = await API.get(`/api/users/${State.me.id}/posts`);
        } else if (which === 'home') {
          const params = new URLSearchParams({ sort: State.sort, limit: 50 });
          if (State.filter) params.set('tag', State.filter);
          posts = await API.get(`/api/posts?${params}`);
          App.loadFilters(posts);
        } else if (which === 'explore') {
          posts = await API.get('/api/posts?sort=top&limit=50');
          App.loadExploreFilters(posts);
        }

        State.posts[which] = posts;

        if (posts.length === 0) {
          feed.innerHTML = Render.emptyFor(which);
        } else {
          feed.innerHTML = posts.map(p => Render.prompt(p)).join('');
        }
        feed.setAttribute('aria-busy', 'false');
      } catch (err) {
        feed.innerHTML = Render.empty('تعذّر التحميل', 'ph-warning-circle');
        feed.setAttribute('aria-busy', 'false');
      }
    },

    updateCountPill(which, count) {
      const pill = byId(which === 'liked' ? 'likedCount' : 'savedCount');
      if (!pill) return;
      pill.dataset.count = String(count);
      const label = pill.querySelector('[data-count-label]');
      if (label) label.textContent = U.formatNumber(count);
    },

    loadFilters(posts) {
      const wrap = byId('filters');
      if (!wrap) return;
      const tags = new Set();
      posts.forEach(p => (p.tags || []).forEach(t => tags.add(t)));
      if (tags.size === 0) { wrap.innerHTML = ''; return; }

      const top = [...tags].slice(0, 12);
      wrap.innerHTML = `
        <button class="filter" data-tag="" aria-pressed="${!State.filter ? 'true' : 'false'}" type="button">
          <i class="ph ph-squares-four" aria-hidden="true"></i> الكل
        </button>
        ${top.map(t => `
          <button class="filter" data-tag="${escapeHtml(t)}" aria-pressed="${State.filter === t ? 'true' : 'false'}" type="button">
            ${escapeHtml(t)}
          </button>
        `).join('')}
      `;
      $$('.filter', wrap).forEach(btn => {
        on(btn, 'click', () => {
          const tag = btn.dataset.tag;
          State.filter = tag || null;
          $$('.filter', wrap).forEach(f => {
            f.setAttribute('aria-pressed', f.dataset.tag === (tag || '') ? 'true' : 'false');
          });
          App.loadFeed('home');
        });
      });
    },

    loadExploreFilters(posts) {
      const wrap = byId('exploreFilters');
      if (!wrap) return;
      const models = new Set();
      posts.forEach(p => p.model && models.add(p.model));
      if (models.size === 0) { wrap.innerHTML = ''; return; }

      wrap.innerHTML = `
        <button class="filter" aria-pressed="true" type="button"><i class="ph ph-squares-four" aria-hidden="true"></i> الكل</button>
        ${[...models].slice(0, 8).map(m => `
          <button class="filter" aria-pressed="false" type="button">${escapeHtml(m)}</button>
        `).join('')}
      `;
    },

    async loadProfile() {
      if (!State.me) return;
      App.updateProfileUI();
      try {
        const user = await API.get(`/api/users/${State.me.id}`);
        State.me.followers = user.followers;
        State.me.following = user.following;
        App.updateProfileUI();
        const posts = await API.get(`/api/users/${State.me.id}/posts`);
        const stats = byId('statPosts');
        if (stats) stats.textContent = U.formatNumber(posts.length);
        State.posts.profile = posts;
        const panel = byId('profilePanel');
        if (panel) {
          panel.innerHTML = posts.length
            ? posts.map(p => Render.prompt(p)).join('')
            : Render.emptyFor('profile');
        }
      } catch {}
    },

    async performSearch(q) {
      const results = byId('searchResults');
      if (!results) return;
      if (!q || q.length < 2) {
        results.dataset.open = 'false';
        return;
      }
      try {
        const posts = await API.get(`/api/posts?q=${encodeURIComponent(q)}&limit=8`);
        if (posts.length === 0) {
          results.innerHTML = `<div style="padding:20px;text-align:center;color:var(--fg-3);font-size:var(--fs-2)">لا نتائج</div>`;
        } else {
          results.innerHTML = posts.map(p => `
            <div class="search-result" onclick="Post.openDetail(${p.id})" role="option" tabindex="0">
              <img src="${escapeHtml(p.image || '')}" alt="" loading="lazy">
              <div class="search-result-info">
                <strong>${escapeHtml(p.title)}</strong>
                <span>${escapeHtml(p.prompt.slice(0, 60))}…</span>
              </div>
            </div>
          `).join('');
        }
        results.dataset.open = 'true';
      } catch {
        results.dataset.open = 'false';
      }
    },

    async refreshChatsBadge() {
      if (!State.me) return;
      try {
        const chats = await API.get('/api/chats');
        const unread = chats.reduce((sum, c) => sum + (c.unread || 0), 0);
        const badge = byId('dockChatBadge');
        if (badge) {
          badge.hidden = unread === 0;
          badge.textContent = unread > 99 ? '99+' : String(unread);
        }
      } catch {}
    },

    openProfile(userId) {
      if (!userId) return;
      // Simple stub — could route to /u/<id>
      U.toast('صفحة المبدع قريباً', 'ph-user');
    },

    confirm({ title, message, confirmText = 'تأكيد', cancelText = 'إلغاء', danger = false }) {
      return new Promise((resolve) => {
        const scrim = create('div', {
          class: 'scrim',
          dataset: { open: 'false' },
          role: 'dialog',
          'aria-modal': 'true',
        });
        const modal = create('div', { class: 'modal' });
        modal.innerHTML = `
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-act="cancel">${escapeHtml(cancelText)}</button>
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm">${escapeHtml(confirmText)}</button>
          </div>
        `;
        scrim.appendChild(modal);
        document.body.appendChild(scrim);

        requestAnimationFrame(() => {
          scrim.dataset.open = 'true';
          const release = U.focusTrap(modal);
          const finish = (val) => {
            scrim.dataset.open = 'false';
            release();
            setTimeout(() => scrim.remove(), 300);
            resolve(val);
          };
          modal.querySelector('[data-act="cancel"]').onclick = () => finish(false);
          modal.querySelector('[data-act="confirm"]').onclick = () => finish(true);
          scrim.onclick = (e) => { if (e.target === scrim) finish(false); };
          on(document, 'keydown', function esc(e) {
            if (e.key === 'Escape') {
              document.removeEventListener('keydown', esc);
              finish(false);
            }
          });
        });
      });
    },
  };

  /* ─────────────── 8. RENDER ─────────────── */
  const Render = {
    prompt(p) {
      const author = p.author_data || {};
      const tags = Array.isArray(p.tags) ? p.tags : [];
      const img = p.image || 'https://placehold.co/800x600/0E0E14/22D3EE?text=خَيال';

      return `
        <article class="prompt-card" data-post-id="${p.id}">
          <div class="prompt-media">
            <img
              src="${escapeHtml(img)}"
              alt="${escapeHtml(p.title || '')}"
              loading="lazy"
              data-state="loading"
              onload="this.dataset.state='loaded'"
              onerror="this.dataset.state='error'">

            ${p.model ? `
              <span class="prompt-model">
                <i class="ph ph-sparkle" aria-hidden="true"></i>
                ${escapeHtml(p.model)}
              </span>
            ` : ''}

            <div class="prompt-floats">
              <button
                class="float-btn"
                data-action="like"
                aria-pressed="${p.liked ? 'true' : 'false'}"
                aria-label="إعجاب"
                onclick="Post.like(this, ${p.id})"
                type="button">
                <i class="ph ph-heart" aria-hidden="true"></i>
              </button>

              <button
                class="float-btn"
                data-action="save"
                aria-pressed="${p.saved ? 'true' : 'false'}"
                aria-label="حفظ"
                onclick="Post.save(this, ${p.id})"
                type="button">
                <i class="ph ph-bookmark-simple" aria-hidden="true"></i>
              </button>
            </div>
          </div>

          <div class="prompt-body">
            ${author.id ? `
              <div class="prompt-author" onclick="App.openProfile(${author.id})">
                <img class="avatar avatar-sm" src="${escapeHtml(author.avatar || '')}" alt="" loading="lazy">
                <div class="prompt-author-info">
                  <span class="prompt-author-name">
                    ${escapeHtml(author.name || '')}
                    ${author.verified ? '<i class="ph ph-seal-check" aria-label="موثّق"></i>' : ''}
                  </span>
                  <span class="prompt-author-meta">${escapeHtml(author.handle || '')}</span>
                </div>
              </div>
            ` : ''}

            <h3 class="prompt-title">${escapeHtml(p.title || '')}</h3>

            <div class="prompt-excerpt" onclick="Post.copy('${p.id}', this)">
              ${escapeHtml(p.prompt || '')}
              <button
                type="button"
                class="prompt-excerpt-copy"
                aria-label="نسخ البرومبت"
                onclick="event.stopPropagation();Post.copy('${p.id}', this.parentElement)">
                <i class="ph ph-copy" aria-hidden="true"></i>
              </button>
            </div>

            ${tags.length ? `
              <div class="prompt-tags">
                ${tags.slice(0, 4).map(t => `
                  <button class="tag" type="button" onclick="App.filterByTag('${escapeHtml(t)}')">${escapeHtml(t)}</button>
                `).join('')}
              </div>
            ` : ''}
          </div>

          <div class="prompt-actions">
            <button
              class="action"
              data-action="like"
              aria-pressed="${p.liked ? 'true' : 'false'}"
              onclick="Post.like(this, ${p.id})"
              type="button">
              <i class="ph ph-heart" aria-hidden="true"></i>
              <span data-likes-count>${U.formatNumber(p.likes || 0)}</span>
            </button>

            <button class="action" onclick="Drawers.openComments(${p.id})" type="button">
              <i class="ph ph-chat-circle" aria-hidden="true"></i>
              <span>${U.formatNumber(p.comments || 0)}</span>
            </button>

            <button class="action action-primary" onclick="Post.copy('${p.id}', this)" type="button">
              <i class="ph ph-copy" aria-hidden="true"></i>
              <span>نسخ</span>
            </button>
          </div>
        </article>
      `;
    },

    skeleton() {
      return `
        <article class="prompt-card skeleton-card" aria-hidden="true">
          <div class="prompt-media skeleton skeleton-media"></div>
          <div class="prompt-body">
            <div class="skeleton skeleton-line" style="width:55%"></div>
            <div class="skeleton skeleton-line" style="width:85%;height:18px"></div>
            <div class="skeleton skeleton-line" style="width:100%"></div>
            <div class="skeleton skeleton-line" style="width:75%"></div>
          </div>
        </article>
      `;
    },

    empty(title, icon = 'ph-sparkle') {
      return `
        <div class="empty-block">
          <i class="ph ${icon}" aria-hidden="true"></i>
          <h4>${escapeHtml(title)}</h4>
        </div>
      `;
    },

    emptyFor(which) {
      const map = {
        home: { title: 'لا توجد برومبتات بعد', icon: 'ph-sparkle', text: 'كن أول من ينشر!' },
        explore: { title: 'لا يوجد استكشاف بعد', icon: 'ph-compass', text: 'عُد لاحقاً' },
        liked: { title: 'لا توجد إعجابات بعد', icon: 'ph-heart', text: 'ابدأ بوضع قلبك على ما يعجبك' },
        saved: { title: 'المكتبة فارغة', icon: 'ph-bookmark-simple', text: 'احفظ البرومبتات المميزة' },
        profile: { title: 'لم تنشر بعد', icon: 'ph-image-square', text: 'شارك أول برومبت لك' },
      };
      const cfg = map[which] || map.home;
      return `
        <div class="empty-block">
          <i class="ph ${cfg.icon}" aria-hidden="true"></i>
          <h4>${cfg.title}</h4>
          <p>${cfg.text}</p>
        </div>
      `;
    },
  };

  /* ─────────────── 9. POST ─────────────── */
  const Post = {
    async like(btn, postId) {
      if (!State.me) { Auth.open('login'); return; }
      if (State._pendingLikes.has(postId)) return;
      State._pendingLikes.add(postId);

      const wasLiked = btn.getAttribute('aria-pressed') === 'true';
      const nextLiked = !wasLiked;

      // Optimistic
      Post._toggleLikeUI(postId, nextLiked, wasLiked);
      U.vibrate(12);

      try {
        const res = await API.post(`/api/posts/${postId}/like`);
        Post._syncLikeUI(postId, res.liked, res.likes);
        // Update local state
        Object.values(State.posts).forEach(arr => {
          const p = arr.find(x => x.id === postId);
          if (p) { p.liked = res.liked; p.likes = res.likes; }
        });
      } catch {
        // Rollback
        Post._syncLikeUI(postId, wasLiked, null);
        U.toast('تعذّر تحديث الإعجاب', 'ph-warning-circle', 'error');
      } finally {
        State._pendingLikes.delete(postId);
      }
    },

    _toggleLikeUI(postId, liked, fallback) {
      $$(`[data-post-id="${postId}"] [data-action="like"]`).forEach(el => {
        el.setAttribute('aria-pressed', liked ? 'true' : 'false');
      });
    },

    _syncLikeUI(postId, liked, count) {
      $$(`[data-post-id="${postId}"] [data-action="like"]`).forEach(el => {
        el.setAttribute('aria-pressed', liked ? 'true' : 'false');
      });
      if (count != null) {
        $$(`[data-post-id="${postId}"] [data-likes-count]`).forEach(el => {
          el.textContent = U.formatNumber(count);
        });
      }
    },

    async save(btn, postId) {
      if (!State.me) { Auth.open('login'); return; }
      if (State._pendingSaves.has(postId)) return;
      State._pendingSaves.add(postId);

      const wasSaved = btn.getAttribute('aria-pressed') === 'true';
      const nextSaved = !wasSaved;

      $$(`[data-post-id="${postId}"] [data-action="save"]`).forEach(el => {
        el.setAttribute('aria-pressed', nextSaved ? 'true' : 'false');
      });
      U.vibrate(8);

      try {
        const res = await API.post(`/api/posts/${postId}/save`);
        $$(`[data-post-id="${postId}"] [data-action="save"]`).forEach(el => {
          el.setAttribute('aria-pressed', res.saved ? 'true' : 'false');
        });
        Object.values(State.posts).forEach(arr => {
          const p = arr.find(x => x.id === postId);
          if (p) { p.saved = res.saved; p.saves = res.saves; }
        });
        U.toast(res.saved ? 'تم الحفظ' : 'أُزيل من المحفوظة', res.saved ? 'ph-bookmark-simple-fill' : 'ph-bookmark-simple');
      } catch {
        $$(`[data-post-id="${postId}"] [data-action="save"]`).forEach(el => {
          el.setAttribute('aria-pressed', wasSaved ? 'true' : 'false');
        });
        U.toast('تعذّر الحفظ', 'ph-warning-circle', 'error');
      } finally {
        State._pendingSaves.delete(postId);
      }
    },

    async copy(postId, btn) {
      // Find prompt text
      let text = '';
      Object.values(State.posts).forEach(arr => {
        const p = arr.find(x => x.id === parseInt(postId));
        if (p) text = p.prompt;
      });

      if (!text) {
        const card = btn.closest('.prompt-card');
        if (card) {
          const excerpt = card.querySelector('.prompt-excerpt');
          if (excerpt) text = excerpt.textContent.trim();
        }
      }

      const ok = await U.copy(text);
      if (ok) {
        U.toast('تم نسخ البرومبت', 'ph-check-circle', 'success');
        U.vibrate([10, 30, 10]);
        // Increment server-side counter
        API.post(`/api/posts/${postId}/copy`).catch(() => {});
        // Visual feedback
        if (btn && btn.dataset) {
          btn.dataset.state = 'copied';
          setTimeout(() => delete btn.dataset.state, 1400);
        }
      } else {
        U.toast('تعذّر النسخ', 'ph-warning-circle', 'error');
      }
    },

    openDetail(id) {
      U.toast('عرض التفاصيل قريباً', 'ph-eye');
    },
  };

  /* ─────────────── 10. COMPOSER ─────────────── */
  const Composer = {
    _type: null,

    open() {
      if (!State.me) { Auth.open('login'); return; }
      Composer._type = null;
      Composer._reset();
      Layer.open('composerModal');
    },

    close(e) {
      if (e && e.target !== e.currentTarget) return;
      Layer.close('composerModal');
      Composer._reset();
    },

    _reset() {
      const form = byId('composerForm');
      if (form) { form.reset(); form.classList.remove('is-active'); }
      $$('.type-card').forEach(c => c.removeAttribute('aria-pressed'));
      const img = byId('imgPreview');
      if (img) img.hidden = true;
      const imgEl = byId('imgPreviewEl');
      if (imgEl) imgEl.src = '';
    },

    chooseType(type) {
      Composer._type = type;
      const form = byId('composerForm');
      const types = byId('composerTypes');
      const imageField = byId('imageField');
      const promptField = byId('cPrompt');

      if (types) types.hidden = true;
      if (form) form.classList.add('is-active');
      if (imageField) imageField.hidden = type !== 'prompt';
      if (promptField) {
        promptField.placeholder = type === 'prompt'
          ? 'اكتب البرومبت…'
          : 'اكتب نص المنشور…';
      }
      setTimeout(() => byId('cTitle')?.focus(), 100);
    },

    previewImage(url) {
      const wrap = byId('imgPreview');
      const img = byId('imgPreviewEl');
      if (!wrap || !img) return;
      if (!url || !/^https?:\/\//.test(url)) {
        wrap.hidden = true;
        return;
      }
      img.src = url;
      wrap.hidden = false;
    },

    clearPreview() {
      const wrap = byId('imgPreview');
      const img = byId('imgPreviewEl');
      const input = byId('cImage');
      if (wrap) wrap.hidden = true;
      if (img) img.src = '';
      if (input) input.value = '';
    },

    async publish(e) {
      e.preventDefault();
      if (!State.me) { Auth.open('login'); return; }

      const btn = byId('composerSubmit');
      const title = byId('cTitle').value.trim();
      const prompt = byId('cPrompt').value.trim();
      const image = byId('cImage')?.value.trim() || '';
      const model = byId('cModel')?.value || '';
      const tags = (byId('cTags')?.value || '')
        .split(/[،,]/).map(t => t.trim()).filter(Boolean);

      if (!title || !prompt) {
        U.toast('أكمل العنوان والنص', 'ph-warning-circle', 'warning');
        return;
      }

      btn.setAttribute('aria-busy', 'true');
      try {
        const payload = { title, prompt, tags };
        if (Composer._type === 'prompt') {
          payload.image = image;
          payload.model = model;
        }

        const post = await API.post('/api/posts', payload);

        // Optimistic insert at top of home feed
        if (!State.posts.home) State.posts.home = [];
        State.posts.home.unshift(post);

        const feed = byId('homeFeed');
        if (feed) {
          const emptyBlock = feed.querySelector('.empty-block');
          if (emptyBlock) emptyBlock.remove();
          const card = document.createElement('div');
          card.innerHTML = Render.prompt(post);
          feed.insertBefore(card.firstElementChild, feed.firstChild);
        }

        Composer.close();
        U.toast('تم النشر!', 'ph-confetti', 'success', 3200);
        U.vibrate([15, 40, 15]);
        App.switchTab('home', { silent: true });
      } catch (err) {
        U.toast(err.data?.error || 'تعذّر النشر', 'ph-warning-circle', 'error');
      } finally {
        btn.removeAttribute('aria-busy');
      }
    },
  };

  /* ─────────────── 11. COMMENTS / DRAWERS ─────────────── */
  const Drawers = {
    async openComments(postId) {
      State.activePost = postId;
      const body = byId('commentsBody');
      const count = byId('commentCount');
      const form = byId('commentForm');
      if (!body) return;

      body.innerHTML = `<div class="empty-block"><i class="ph ph-circle-notch" style="animation:spin .8s linear infinite"></i></div>`;

      Layer.open('commentsDrawer');
      if (byId('commentsScrim')) byId('commentsScrim').dataset.open = 'true';

      try {
        const comments = await API.get(`/api/posts/${postId}/comments`);
        if (count) count.textContent = comments.length ? `(${comments.length})` : '';
        if (form) form.style.display = State.me ? 'flex' : 'none';
        body.innerHTML = comments.length
          ? comments.map(c => Render.comment(c)).join('')
          : `<div class="empty-block"><i class="ph ph-chat-circle"></i><h4>لا تعليقات بعد</h4><p>كن أول من يعلّق</p></div>`;
      } catch {
        body.innerHTML = `<div class="empty-block"><i class="ph ph-warning-circle"></i><h4>تعذّر التحميل</h4></div>`;
      }
    },

    closeComments() {
      Layer.close('commentsDrawer');
      if (byId('commentsScrim')) byId('commentsScrim').dataset.open = 'false';
      State.activePost = null;
    },
  };

  const Comments = {
    async send(e) {
      e.preventDefault();
      if (!State.activePost || !State.me) return;
      const input = byId('commentInput');
      const text = input.value.trim();
      if (!text) return;

      const body = byId('commentsBody');
      const tempId = 'temp-' + Date.now();

      // Optimistic
      const emptyBlock = body.querySelector('.empty-block');
      if (emptyBlock) emptyBlock.remove();
      body.insertAdjacentHTML('afterbegin', `
        <div class="comment" data-temp="${tempId}">
          <img class="avatar avatar-sm" src="${escapeHtml(State.me.avatar || '')}" alt="">
          <div class="comment-body">
            <div class="comment-top">
              <span class="comment-name">${escapeHtml(State.me.name)}</span>
              <span class="comment-time">الآن</span>
            </div>
            <div class="comment-text">${escapeHtml(text)}</div>
          </div>
        </div>
      `);
      input.value = '';
      U.autoGrow(input);

      try {
        const c = await API.post(`/api/posts/${State.activePost}/comments`, { text });
        body.querySelector(`[data-temp="${tempId}"]`)?.remove();
        body.insertAdjacentHTML('afterbegin', Render.comment({ ...c, author_data: State.me }));
        const count = byId('commentCount');
        if (count) {
          const n = body.querySelectorAll('.comment').length;
          count.textContent = `(${n})`;
        }
      } catch {
        body.querySelector(`[data-temp="${tempId}"]`)?.remove();
        U.toast('تعذّر إرسال التعليق', 'ph-warning-circle', 'error');
      }
    },
  };

  Render.comment = (c) => {
    const a = c.author_data || {};
    return `
      <div class="comment" data-comment-id="${c.id}">
        <img class="avatar avatar-sm" src="${escapeHtml(a.avatar || '')}" alt="">
        <div class="comment-body">
          <div class="comment-top">
            <span class="comment-name">${escapeHtml(a.name || '')}</span>
            <span class="comment-time">${U.formatTime(c.time)}</span>
          </div>
          <div class="comment-text">${escapeHtml(c.text || '')}</div>
          ${State.me && a.id === State.me.id ? `
            <div class="comment-actions">
              <button type="button" data-action="delete" onclick="Comments.delete(${c.id})">
                <i class="ph ph-trash" aria-hidden="true"></i> حذف
              </button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  };

  Comments.delete = async (id) => {
    const el = document.querySelector(`[data-comment-id="${id}"]`);
    if (el) el.style.opacity = '0.5';
    try {
      await API.del(`/api/comments/${id}`);
      el?.remove();
      const count = byId('commentCount');
      const body = byId('commentsBody');
      if (count && body) {
        const n = body.querySelectorAll('.comment').length;
        count.textContent = n ? `(${n})` : '';
      }
    } catch {
      if (el) el.style.opacity = '1';
      U.toast('تعذّر الحذف', 'ph-warning-circle', 'error');
    }
  };

  /* ─────────────── 12. CHAT ─────────────── */
  const Chat = {
    async load() {
      const list = byId('chatList');
      if (!list || !State.me) return;

      try {
        const chats = await API.get('/api/chats');
        State.chats = chats;
        if (chats.length === 0) {
          list.innerHTML = `<div class="empty-block"><i class="ph ph-chat-circle-dots"></i><h4>لا محادثات</h4><p>ابدأ محادثة جديدة</p></div>`;
          return;
        }
        list.innerHTML = chats.map(c => Render.chatItem(c)).join('');
        App.refreshChatsBadge();
      } catch {
        list.innerHTML = `<div class="empty-block"><i class="ph ph-warning-circle"></i><h4>تعذّر التحميل</h4></div>`;
      }
    },

    async open(id) {
      State.activeChat = id;
      const layout = byId('chatLayout');
      const head = byId('chatHead');
      const body = byId('chatBody');
      if (!layout || !head || !body) return;

      layout.dataset.view = 'thread';

      const chat = State.chats.find(c => c.id === id);
      const other = chat?.with_user;

      if (head) {
        head.innerHTML = `
          <button class="btn btn-icon btn-ghost btn-sm" id="chatBackBtn" onclick="Chat.showList()" aria-label="رجوع" type="button">
            <i class="ph ph-arrow-right" aria-hidden="true"></i>
          </button>
          <img class="avatar avatar-sm" src="${escapeHtml(other?.avatar || '')}" alt="">
          <div class="chat-thread-info">
            <strong>${escapeHtml(other?.name || 'محادثة')}</strong>
            <span>متصل</span>
          </div>
        `;
      }

      body.innerHTML = `<div style="text-align:center;padding:var(--sp-6)"><i class="ph ph-circle-notch" style="animation:spin .8s linear infinite;font-size:24px;color:var(--c-brand)"></i></div>`;

      try {
        const msgs = await API.get(`/api/chats/${id}/messages`);
        body.innerHTML = msgs.length
          ? msgs.map(m => Render.message(m)).join('')
          : `<div class="empty-block" style="padding:32px"><i class="ph ph-chat-circle"></i><p>ابدأ المحادثة</p></div>`;
        Chat.scrollBottom();
      } catch {
        body.innerHTML = `<div class="empty-block"><i class="ph ph-warning-circle"></i><h4>تعذّر التحميل</h4></div>`;
      }
    },

    showList() {
      const layout = byId('chatLayout');
      if (layout) layout.dataset.view = 'list';
      State.activeChat = null;
    },

    async send(e) {
      e.preventDefault();
      const input = byId('chatInput');
      const text = input.value.trim();
      if (!text || !State.activeChat) return;

      const body = byId('chatBody');
      const emptyBlock = body.querySelector('.empty-block');
      if (emptyBlock) emptyBlock.remove();

      body.insertAdjacentHTML('beforeend', `
        <div class="msg msg-me" data-temp>
          ${escapeHtml(text)}
          <span class="msg-time">الآن</span>
        </div>
      `);
      input.value = '';
      U.autoGrow(input);
      Chat.scrollBottom();

      try {
        const m = await API.post(`/api/chats/${State.activeChat}/messages`, { text });
        body.querySelector('[data-temp]')?.remove();
        body.insertAdjacentHTML('beforeend', Render.message(m));
        Chat.scrollBottom();
      } catch {
        body.querySelector('[data-temp]')?.remove();
        U.toast('تعذّر الإرسال', 'ph-warning-circle', 'error');
      }
    },

    scrollBottom() {
      const body = byId('chatBody');
      if (body) body.scrollTop = body.scrollHeight;
    },

    filterList(q) {
      const list = byId('chatList');
      if (!list) return;
      const items = $$('.chat-item', list);
      const query = q.trim().toLowerCase();
      items.forEach(item => {
        const name = (item.dataset.name || '').toLowerCase();
        item.hidden = query && !name.includes(query);
      });
    },

    newChat() {
      U.toast('اختر مستخدماً لبدء محادثة', 'ph-note-pencil');
    },

    attach() {
      U.toast('قريباً — إرفاق ملفات', 'ph-paperclip');
    },
  };

  Render.chatItem = (c) => {
    const other = c.with_user || {};
    const unread = c.unread || 0;
    return `
      <button
        class="chat-item"
        data-chat-id="${c.id}"
        data-name="${escapeHtml(other.name || '')}"
        aria-current="${State.activeChat === c.id ? 'true' : 'false'}"
        onclick="Chat.open(${c.id})"
        type="button"
        role="listitem">
        <img class="avatar" src="${escapeHtml(other.avatar || '')}" alt="" loading="lazy">
        <div class="chat-item-info">
          <div class="chat-item-top">
            <span class="chat-item-name">${escapeHtml(other.name || 'محادثة')}</span>
            <span class="chat-item-time">${escapeHtml(c.time || '')}</span>
          </div>
          <div class="chat-item-preview">${escapeHtml(c.last || '')}</div>
        </div>
        ${unread > 0 ? '<span class="badge badge-dot"></span>' : ''}
      </button>
    `;
  };

  Render.message = (m) => `
    <div class="msg msg-${m.from === 'me' ? 'me' : 'them'}">
      ${escapeHtml(m.text || '')}
      <span class="msg-time">${escapeHtml(m.time || '')}</span>
    </div>
  `;

  /* ─────────────── 13. EXPLORE ─────────────── */
  const Explore = {
    openCollection(kind) {
      U.toast(`فتح: ${kind}`, 'ph-compass');
      App.loadFeed('explore');
    },
  };

  /* ─────────────── 14. INSTALL (PWA) ─────────────── */
  const Install = {
    _deferred: null,

    init() {
      const banner = byId('installBanner');
      if (!banner) return;

      // Skip if dismissed recently
      const dismissed = Store.get('install_dismissed', 0);
      if (Date.now() - dismissed < 7 * 24 * 60 * 60 * 1000) return;

      on(window, 'beforeinstallprompt', (e) => {
        e.preventDefault();
        Install._deferred = e;
        setTimeout(() => {
          banner.hidden = false;
          requestAnimationFrame(() => banner.dataset.open = 'true');
        }, 3000);
      });

      on(window, 'appinstalled', () => {
        banner.dataset.open = 'false';
        setTimeout(() => banner.hidden = true, 400);
        Store.set('install_dismissed', Date.now() + 365 * 24 * 60 * 60 * 1000);
        U.toast('تم التثبيت!', 'ph-download-simple', 'success');
      });
    },

    prompt() {
      const banner = byId('installBanner');
      if (!Install._deferred) {
        U.toast('افتح القائمة واختر "إضافة إلى الشاشة الرئيسية"', 'ph-info', 'default', 4000);
        banner.dataset.open = 'false';
        setTimeout(() => banner.hidden = true, 400);
        return;
      }
      Install._deferred.prompt();
      Install._deferred.userChoice.then(({ outcome }) => {
        banner.dataset.open = 'false';
        setTimeout(() => banner.hidden = true, 400);
        if (outcome === 'dismissed') {
          Store.set('install_dismissed', Date.now());
        }
        Install._deferred = null;
      });
    },

    dismiss() {
      const banner = byId('installBanner');
      if (banner) {
        banner.dataset.open = 'false';
        setTimeout(() => banner.hidden = true, 400);
      }
      Store.set('install_dismissed', Date.now());
    },
  };

  /* ─────────────── 15. COMMAND PALETTE ─────────────── */
  const CommandPalette = {
    open() {
      const scrim = byId('cmdkScrim');
      if (!scrim) return;
      scrim.dataset.open = 'true';
      Layer.open(scrim);
      const input = byId('cmdkInput');
      if (input) {
        input.value = '';
        input.focus();
        CommandPalette.render('');
      }
      on(input, 'input', (e) => CommandPalette.render(e.target.value));
    },

    close(e) {
      if (e && e.target !== e.currentTarget) return;
      const scrim = byId('cmdkScrim');
      if (scrim) {
        scrim.dataset.open = 'false';
        Layer.close(scrim);
      }
    },

    render(q) {
      const results = byId('cmdkResults');
      if (!results) return;
      const query = q.trim().toLowerCase();
      const cmds = [
        { icon: 'ph-house', label: 'الرئيسية', action: () => App.switchTab('home') },
        { icon: 'ph-compass', label: 'استكشف', action: () => App.switchTab('explore') },
        { icon: 'ph-plus', label: 'منشور جديد', action: () => Composer.open() },
        { icon: 'ph-chat-circle-dots', label: 'الرسائل', action: () => App.switchTab('chat') },
        { icon: 'ph-user', label: 'حسابي', action: () => App.switchTab('profile') },
        { icon: 'ph-moon', label: 'تبديل المظهر', action: () => App.toggleTheme() },
      ];
      const filtered = query
        ? cmds.filter(c => c.label.toLowerCase().includes(query))
        : cmds;

      if (filtered.length === 0) {
        results.innerHTML = `<div style="padding:20px;text-align:center;color:var(--fg-3);font-size:14px">لا نتائج</div>`;
        return;
      }

      results.innerHTML = filtered.map((c, i) => `
        <button class="cmdk-item" data-cmd-index="${i}" type="button">
          <i class="ph ${c.icon}" aria-hidden="true"></i>
          <span>${escapeHtml(c.label)}</span>
        </button>
      `).join('');

      $$('.cmdk-item', results).forEach((btn, i) => {
        on(btn, 'click', () => {
          filtered[i].action();
          CommandPalette.close();
        });
      });
    },

    toggle() {
      const scrim = byId('cmdkScrim');
      if (!scrim) return;
      if (scrim.dataset.open === 'true') CommandPalette.close();
      else CommandPalette.open();
    },
  };

  App.toggleCommandPalette = () => CommandPalette.toggle();

  /* ─────────────── 16. INIT ─────────────── */
  function boot() {
    App.init();

    // Global click for composer trigger in composer modal backdrop
    const composerModal = byId('composerModal');
    if (composerModal) {
      on(composerModal, 'click', (e) => {
        if (e.target === composerModal) Composer.close();
      });
    }

    // Chat input — auto-grow
    const chatInput = byId('chatInput');
    if (chatInput) {
      on(chatInput, 'input', () => U.autoGrow(chatInput));
      on(chatInput, 'keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          Chat.send(e);
        }
      });
    }

    // Comment input — auto-grow
    const commentInput = byId('commentInput');
    if (commentInput) {
      on(commentInput, 'input', () => U.autoGrow(commentInput));
    }

    // Composer type buttons — a11y
    $$('.type-card').forEach(btn => {
      on(btn, 'click', () => {
        $$('.type-card').forEach(x => x.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
      });
    });

    // Service Worker
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    }
  }

  // Expose
  window.U = U;
  window.Auth = Auth;
  window.App = App;
  window.Post = Post;
  window.Composer = Composer;
  window.Chat = Chat;
  window.Drawers = Drawers;
  window.Comments = Comments;
  window.Explore = Explore;
  window.Install = Install;
  window.CommandPalette = CommandPalette;
  window.Layer = Layer;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();