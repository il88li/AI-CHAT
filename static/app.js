/* ═══════════════════════════════════════════════════════════════════════
   خَيال — Application v7.1 (Hardened)
   - Global error reporting
   - Event delegation (works even if inline onclick fails)
   - Robust init (per-step try/catch)
   - No silent failures
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ═══════════════ 0. ERROR REPORTING (first thing) ═══════════════ */
  window.addEventListener('error', (e) => {
    console.error('[خَيال ❌]', e.error || e.message, e.filename, e.lineno);
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[خَيال ❌ promise]', e.reason);
  });

  /* ═══════════════ 1. STATE ═══════════════ */
  const S = {
    me: (typeof window.__ME__ !== 'undefined' && window.__ME__) || null,
    tab: 'home',
    sort: 'recent',
    filter: null,
    posts: { home: [], explore: [], liked: [], saved: [], profile: [], landing: [] },
    chats: [],
    activeChat: null,
    activePost: null,
    reducedMotion: false,
    pendingLikes: new Set(),
    pendingSaves: new Set(),
  };

  try {
    S.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) {}

  /* ═══════════════ 2. DOM HELPERS ═══════════════ */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const id = (x) => document.getElementById(x);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] || c));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && v && typeof v === 'object') Object.assign(node.style, v);
        else if (k === 'dataset' && v) Object.assign(node.dataset, v);
        else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (v != null) node.setAttribute(k, String(v));
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach((c) => {
        if (c == null || c === false) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  /* ═══════════════ 3. STORAGE ═══════════════ */
  const Store = {
    get(k, def) {
      try {
        const v = localStorage.getItem('kh_' + k);
        return v == null ? def : JSON.parse(v);
      } catch (_) { return def; }
    },
    set(k, v) {
      try { localStorage.setItem('kh_' + k, JSON.stringify(v)); } catch (_) {}
    },
    del(k) {
      try { localStorage.removeItem('kh_' + k); } catch (_) {}
    },
  };

  /* ═══════════════ 4. NETWORK ═══════════════ */
  const API = {
    async call(url, opt) {
      opt = opt || {};
      const init = {
        method: opt.method || 'GET',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      };
      if (opt.body !== undefined) init.body = JSON.stringify(opt.body);
      const res = await fetch(url, init);
      const text = await res.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); }
        catch (_) { data = { raw: text }; }
      }
      if (!res.ok) {
        const err = new Error((data && data.error) || ('HTTP ' + res.status));
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    },
    get: (u) => API.call(u, { method: 'GET' }),
    post: (u, b) => API.call(u, { method: 'POST', body: b }),
    patch: (u, b) => API.call(u, { method: 'PATCH', body: b }),
    del: (u) => API.call(u, { method: 'DELETE' }),
  };

  /* ═══════════════ 5. UTILITIES ═══════════════ */
  const U = {
    toast(msg, icon, tone, ms) {
      const wrap = id('toastWrap');
      if (!wrap) return;
      icon = icon || 'ph-check-circle';
      tone = tone || 'default';
      ms = ms || 2600;
      const node = el('div', { class: 'toast', dataset: { tone } }, [
        el('i', { class: 'ph ' + icon, 'aria-hidden': 'true' }),
        el('span', { text: msg }),
      ]);
      wrap.appendChild(node);
      setTimeout(() => {
        node.style.transition = 'opacity .22s, transform .22s';
        node.style.opacity = '0';
        node.style.transform = 'translateY(10px)';
        setTimeout(() => node.remove(), 240);
      }, ms);
    },

    num(n) {
      if (n == null) return '0';
      n = Number(n) || 0;
      if (n < 1000) return String(n);
      if (n < 1e6) return (n / 1000).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'K';
      return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    },

    time(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      const sec = (Date.now() - d.getTime()) / 1000;
      if (sec < 60) return 'الآن';
      if (sec < 3600) return 'قبل ' + Math.floor(sec / 60) + ' د';
      if (sec < 86400) return 'قبل ' + Math.floor(sec / 3600) + ' س';
      if (sec < 604800) return 'قبل ' + Math.floor(sec / 86400) + ' ي';
      return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
    },

    autoGrow(ta) {
      if (!ta) return;
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    },

    debounce(fn, wait) {
      let t;
      return function () {
        const args = arguments, ctx = this;
        clearTimeout(t);
        t = setTimeout(() => fn.apply(ctx, args), wait || 250);
      };
    },

    async copy(text) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return true;
        }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (_) { return false; }
    },

    buzz(ms) {
      if (S.reducedMotion) return;
      try { navigator.vibrate && navigator.vibrate(ms || 10); } catch (_) {}
    },

    lockScroll(lock) {
      document.body.style.overflow = lock ? 'hidden' : '';
    },

    focusTrap(container) {
      if (!container) return function () {};
      const sel = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
      const focusables = $$(sel, container).filter((x) => x.offsetParent !== null);
      const prev = document.activeElement;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      function onKey(e) {
        if (e.key !== 'Tab' || focusables.length === 0) return;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      container.addEventListener('keydown', onKey);
      if (first) setTimeout(() => { try { first.focus(); } catch (_) {} }, 60);
      return function () {
        container.removeEventListener('keydown', onKey);
        if (prev && prev.focus) { try { prev.focus(); } catch (_) {} }
      };
    },
  };

  /* ═══════════════ 6. LAYER (modals/sheets/drawers) ═══════════════ */
  const Layer = {
    stack: [],
    open(ref, opts) {
      const node = typeof ref === 'string' ? id(ref) : ref;
      if (!node) { console.warn('[Layer.open] not found:', ref); return; }
      node.dataset.open = 'true';
      node.removeAttribute('hidden');
      U.lockScroll(true);
      const release = U.focusTrap(node.querySelector('[role="dialog"]') || node);
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); Layer.close(node); } };
      node.addEventListener('keydown', onKey);
      Layer.stack.push({ node, release, onKey });
    },
    close(ref) {
      const node = typeof ref === 'string' ? id(ref) : ref;
      if (!node) return;
      node.dataset.open = 'false';
      const i = Layer.stack.findIndex((x) => x.node === node);
      if (i >= 0) {
        const { release, onKey } = Layer.stack[i];
        node.removeEventListener('keydown', onKey);
        try { release(); } catch (_) {}
        Layer.stack.splice(i, 1);
      }
      if (Layer.stack.length === 0) U.lockScroll(false);
    },
  };

  /* ═══════════════ 7. AUTH ═══════════════ */
  const Auth = {
    open(mode) {
      mode = mode || 'login';
      if (S.me) { U.toast('أنت مسجّل دخول بالفعل', 'ph-info'); return; }
      const modal = id('authModal');
      if (!modal) { console.error('[Auth] #authModal not found'); U.toast('تعذّر فتح النافذة', 'ph-warning-circle', 'error'); return; }
      Auth.switchMode(mode);
      Layer.open(modal);
      setTimeout(() => {
        const target = mode === 'register' ? id('regName') : id('loginIdentifier');
        if (target) { try { target.focus(); } catch (_) {} }
      }, 200);
    },

    close(e) {
      if (e && e.target !== e.currentTarget) return;
      Layer.close('authModal');
      Auth.resetForms();
    },

    switchMode(mode) {
      const tabs = $('.auth-tabs');
      if (tabs) tabs.dataset.mode = mode;
      $$('.auth-tab').forEach((t) => {
        t.setAttribute('aria-selected', t.dataset.mode === mode ? 'true' : 'false');
      });
      $$('.auth-form').forEach((f) => {
        f.classList.toggle('is-active', f.id === mode + 'Form');
      });
      const title = id('authTitle');
      const sub = id('authSub');
      if (title) title.textContent = mode === 'login' ? 'تسجيل الدخول' : 'أنشئ حسابك';
      if (sub) sub.textContent = mode === 'login' ? 'أهلاً بعودتك إلى خَيال' : 'دقيقة واحدة للانضمام';
    },

    resetForms() {
      ['loginForm', 'registerForm'].forEach((fid) => { const f = id(fid); if (f) f.reset(); });
      $$('.input[aria-invalid="true"]').forEach((x) => x.removeAttribute('aria-invalid'));
      $$('.input-status').forEach((x) => { x.removeAttribute('data-state'); x.textContent = ''; });
      const ps = $('.pw-strength');
      if (ps) ps.dataset.level = '0';
    },

    togglePassword(btn) {
      const wrap = btn.closest('.input-wrap');
      const input = wrap && wrap.querySelector('input');
      if (!input) return;
      const isPw = input.type === 'password';
      input.type = isPw ? 'text' : 'password';
      const ico = btn.querySelector('i');
      if (ico) ico.className = isPw ? 'ph ph-eye-slash' : 'ph ph-eye';
    },

    checkStrength(pw) {
      const bar = $('.pw-strength');
      if (!bar) return;
      let score = 0;
      if (pw.length >= 6) score++;
      if (pw.length >= 10) score++;
      if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
      if (/\d/.test(pw)) score++;
      if (/[^A-Za-z0-9]/.test(pw)) score++;
      bar.dataset.level = String(Math.min(4, score));
    },

    async login(e) {
      if (e && e.preventDefault) e.preventDefault();
      const btn = id('loginSubmit');
      const idn = (id('loginIdentifier') || {}).value || '';
      const pw = (id('loginPassword') || {}).value || '';
      const remember = (id('rememberMe') || {}).checked;
      if (!idn || !pw) return;
      if (btn) btn.setAttribute('aria-busy', 'true');
      try {
        const user = await API.post('/api/auth/login', { identifier: idn.trim(), password: pw, remember: !!remember });
        S.me = user;
        Auth.close();
        App.onAuthChange();
        U.toast('أهلاً ' + (user.name || '') + '!', 'ph-sparkle', 'success');
        U.buzz(20);
      } catch (err) {
        const msg = (err.data && err.data.error) || err.message || 'تعذّر الدخول';
        U.toast(msg, 'ph-warning-circle', 'error');
        const p = id('loginPassword');
        if (p && err.status === 401) p.setAttribute('aria-invalid', 'true');
      } finally {
        if (btn) btn.removeAttribute('aria-busy');
      }
    },

    async register(e) {
      if (e && e.preventDefault) e.preventDefault();
      const btn = id('registerSubmit');
      const name = (id('regName') || {}).value || '';
      const username = (id('regUsername') || {}).value || '';
      const email = (id('regEmail') || {}).value || '';
      const password = (id('regPassword') || {}).value || '';
      const agree = (id('agreeTerms') || {}).checked;
      if (!agree) { U.toast('يجب الموافقة على الشروط', 'ph-warning-circle', 'warning'); return; }
      if (!name || !username || !email || !password) return;
      if (btn) btn.setAttribute('aria-busy', 'true');
      try {
        const user = await API.post('/api/auth/register', { name: name.trim(), username: username.trim(), email: email.trim(), password: password });
        S.me = user;
        Auth.close();
        App.onAuthChange();
        U.toast('مرحباً بك في خَيال!', 'ph-confetti', 'success', 3200);
        U.buzz([15, 40, 15]);
      } catch (err) {
        const msg = (err.data && err.data.error) || err.message || 'تعذّر إنشاء الحساب';
        U.toast(msg, 'ph-warning-circle', 'error');
        if (msg.indexOf('البريد') >= 0) { const x = id('regEmail'); x && x.setAttribute('aria-invalid', 'true'); }
        if (msg.indexOf('المستخدم') >= 0) { const x = id('regUsername'); x && x.setAttribute('aria-invalid', 'true'); }
      } finally {
        if (btn) btn.removeAttribute('aria-busy');
      }
    },

    async logout() {
      const ok = await App.confirm({
        title: 'تسجيل الخروج؟',
        message: 'ستحتاج لتسجيل الدخول مجدداً للوصول إلى حسابك.',
        confirmText: 'خروج',
        danger: true,
      });
      if (!ok) return;
      try { await API.post('/api/auth/logout'); } catch (_) {}
      S.me = null;
      App.onAuthChange();
      App.goHome();
      U.toast('تم تسجيل الخروج', 'ph-sign-out');
    },

    forgot(e) { if (e && e.preventDefault) e.preventDefault(); U.toast('قريباً — استعادة كلمة المرور', 'ph-key'); },

    openEditProfile() {
      if (!S.me) { Auth.open('login'); return; }
      const n = id('epName'), b = id('epBio'), a = id('epAvatar');
      if (n) n.value = S.me.name || '';
      if (b) b.value = S.me.bio || '';
      if (a) a.value = S.me.avatar || '';
      Layer.open('editProfileModal');
    },

    closeEditProfile(e) {
      if (e && e.target !== e.currentTarget) return;
      Layer.close('editProfileModal');
    },

    async saveProfile(e) {
      if (e && e.preventDefault) e.preventDefault();
      const name = ((id('epName') || {}).value || '').trim();
      const bio = ((id('epBio') || {}).value || '').trim();
      const avatar = ((id('epAvatar') || {}).value || '').trim();
      try {
        const user = await API.patch('/api/me', { name, bio, avatar });
        S.me = Object.assign({}, S.me, user);
        Auth.closeEditProfile();
        App.updateUserUI();
        U.toast('تم حفظ التعديلات', 'ph-check-circle', 'success');
      } catch (err) {
        U.toast((err.data && err.data.error) || 'تعذّر الحفظ', 'ph-warning-circle', 'error');
      }
    },
  };

  /* ═══════════════ 8. RENDER (pure functions) ═══════════════ */
  const Render = {
    prompt(p) {
      const a = p.author_data || {};
      const tags = Array.isArray(p.tags) ? p.tags : [];
      const img = p.image || 'https://placehold.co/800x600/0E0E14/22D3EE?text=خَيال';
      const liked = p.liked ? 'true' : 'false';
      const saved = p.saved ? 'true' : 'false';
      return [
        '<article class="prompt-card" data-post-id="' + p.id + '">',
        '  <div class="prompt-media">',
        '    <img src="' + esc(img) + '" alt="' + esc(p.title) + '" loading="lazy" data-state="loading" onload="this.dataset.state=\'loaded\'" onerror="this.dataset.state=\'error\'">',
        p.model ? '<span class="prompt-model"><i class="ph ph-sparkle"></i> ' + esc(p.model) + '</span>' : '',
        '    <div class="prompt-floats">',
        '      <button class="float-btn" data-action="like" data-post="' + p.id + '" aria-pressed="' + liked + '" aria-label="إعجاب" type="button"><i class="ph ph-heart"></i></button>',
        '      <button class="float-btn" data-action="save" data-post="' + p.id + '" aria-pressed="' + saved + '" aria-label="حفظ" type="button"><i class="ph ph-bookmark-simple"></i></button>',
        '    </div>',
        '  </div>',
        '  <div class="prompt-body">',
        a.id ? '    <div class="prompt-author" data-action="open-profile" data-user="' + a.id + '"><img class="avatar avatar-sm" src="' + esc(a.avatar) + '" alt=""><div class="prompt-author-info"><span class="prompt-author-name">' + esc(a.name) + (a.verified ? ' <i class="ph ph-seal-check"></i>' : '') + '</span><span class="prompt-author-meta">' + esc(a.handle) + '</span></div></div>' : '',
        '    <h3 class="prompt-title">' + esc(p.title) + '</h3>',
        '    <div class="prompt-excerpt" data-action="copy" data-post="' + p.id + '">' + esc(p.prompt) + '<button type="button" class="prompt-excerpt-copy" aria-label="نسخ"><i class="ph ph-copy"></i></button></div>',
        tags.length ? '    <div class="prompt-tags">' + tags.slice(0, 4).map((t) => '<button class="tag" type="button" data-action="filter-tag" data-tag="' + esc(t) + '">' + esc(t) + '</button>').join('') + '</div>' : '',
        '  </div>',
        '  <div class="prompt-actions">',
        '    <button class="action" data-action="like" data-post="' + p.id + '" aria-pressed="' + liked + '" type="button"><i class="ph ph-heart"></i><span data-likes-count>' + U.num(p.likes) + '</span></button>',
        '    <button class="action" data-action="open-comments" data-post="' + p.id + '" type="button"><i class="ph ph-chat-circle"></i><span>' + U.num(p.comments) + '</span></button>',
        '    <button class="action action-primary" data-action="copy" data-post="' + p.id + '" type="button"><i class="ph ph-copy"></i><span>نسخ</span></button>',
        '  </div>',
        '</article>',
      ].join('');
    },

    skeleton() {
      return '<article class="prompt-card skeleton-card" aria-hidden="true"><div class="prompt-media skeleton skeleton-media"></div><div class="prompt-body"><div class="skeleton skeleton-line" style="width:55%"></div><div class="skeleton skeleton-line" style="width:85%;height:18px"></div><div class="skeleton skeleton-line" style="width:100%"></div><div class="skeleton skeleton-line" style="width:75%"></div></div></article>';
    },

    empty(title, icon, text) {
      return '<div class="empty-block"><i class="ph ' + (icon || 'ph-sparkle') + '"></i><h4>' + esc(title) + '</h4>' + (text ? '<p>' + esc(text) + '</p>' : '') + '</div>';
    },

    emptyFor(which) {
      const m = {
        home: ['لا توجد برومبتات بعد', 'ph-sparkle', 'كن أول من ينشر!'],
        explore: ['لا يوجد استكشاف بعد', 'ph-compass', 'عُد لاحقاً'],
        liked: ['لا توجد إعجابات بعد', 'ph-heart', 'ابدأ بوضع قلبك على ما يعجبك'],
        saved: ['المكتبة فارغة', 'ph-bookmark-simple', 'احفظ البرومبتات المميزة'],
        profile: ['لم تنشر بعد', 'ph-image-square', 'شارك أول برومبت لك'],
      };
      const c = m[which] || m.home;
      return Render.empty(c[0], c[1], c[2]);
    },

    comment(c) {
      const a = c.author_data || {};
      const canDel = S.me && a.id === S.me.id;
      return [
        '<div class="comment" data-comment-id="' + c.id + '">',
        '  <img class="avatar avatar-sm" src="' + esc(a.avatar) + '" alt="">',
        '  <div class="comment-body">',
        '    <div class="comment-top"><span class="comment-name">' + esc(a.name) + '</span><span class="comment-time">' + U.time(c.time) + '</span></div>',
        '    <div class="comment-text">' + esc(c.text) + '</div>',
        canDel ? '<div class="comment-actions"><button type="button" data-action="delete-comment" data-comment="' + c.id + '"><i class="ph ph-trash"></i> حذف</button></div>' : '',
        '  </div>',
        '</div>',
      ].join('');
    },

    chatItem(c) {
      const o = c.with_user || {};
      return [
        '<button class="chat-item" data-action="open-chat" data-chat="' + c.id + '" data-name="' + esc(o.name) + '" aria-current="' + (S.activeChat === c.id ? 'true' : 'false') + '" type="button" role="listitem">',
        '  <img class="avatar" src="' + esc(o.avatar) + '" alt="">',
        '  <div class="chat-item-info">',
        '    <div class="chat-item-top"><span class="chat-item-name">' + esc(o.name || 'محادثة') + '</span><span class="chat-item-time">' + esc(c.time) + '</span></div>',
        '    <div class="chat-item-preview">' + esc(c.last) + '</div>',
        '  </div>',
        c.unread ? '<span class="badge badge-dot"></span>' : '',
        '</button>',
      ].join('');
    },

    message(m) {
      return '<div class="msg msg-' + (m.from === 'me' ? 'me' : 'them') + '">' + esc(m.text) + '<span class="msg-time">' + esc(m.time) + '</span></div>';
    },
  };

  /* ═══════════════ 9. APP CORE ═══════════════ */
  const App = {
    _ready: false,

    init() {
      if (App._ready) return;
      App._ready = true;
      console.log('[خَيال] booting…');

      const steps = [
        ['theme', () => App.applyTheme(Store.get('theme', 'dark'))],
        ['global', () => App.bindGlobal()],
        ['user-ui', () => App.updateUserUI()],
        ['sort-tabs', () => App.bindSortTabs()],
        ['views', () => App.syncViews()],
        ['hash', () => App.handleHash()],
      ];
      steps.forEach(([name, fn]) => {
        try { fn(); }
        catch (e) { console.error('[خَيال] step "' + name + '" failed:', e); }
      });

      // Async data
      if (S.me) App.refreshAll();
      else App.loadLandingFeed();

      console.log('[خَيال] ready ✓');
    },

    bindGlobal() {
      // Nav scroll state
      const nav = id('nav');
      if (nav) {
        window.addEventListener('scroll', () => {
          nav.classList.toggle('is-scrolled', window.scrollY > 12);
        }, { passive: true });
      }

      // Search
      const search = id('searchInput');
      if (search) {
        search.addEventListener('input', U.debounce((e) => App.doSearch(e.target.value), 260));
        search.addEventListener('focus', () => {
          if (search.value.length >= 2) App.doSearch(search.value);
        });
      }

      // Online/offline
      window.addEventListener('online', () => {
        const nb = id('netBar');
        if (nb) nb.dataset.open = 'false';
        U.toast('عاد الاتصال', 'ph-wifi', 'success');
      });
      window.addEventListener('offline', () => {
        const nb = id('netBar');
        if (nb) nb.dataset.open = 'true';
      });

      // Close search on outside click
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.search')) {
          const r = id('searchResults');
          if (r) r.dataset.open = 'false';
        }
      });

      // Keyboard
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const r = id('searchResults');
          if (r && r.dataset.open === 'true') {
            r.dataset.open = 'false';
            const si = id('searchInput');
            if (si) si.blur();
          }
        }
      });

      // Composer trigger keyboard support
      $$('.composer-trigger').forEach((t) => {
        if (t.dataset.kbBound) return;
        t.dataset.kbBound = '1';
        t.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            Composer.open();
          }
        });
      });

      // Async username/email check
      const un = id('regUsername');
      if (un) un.addEventListener('input', U.debounce((e) => Auth.checkUsername(e.target), 500));
      const em = id('regEmail');
      if (em) em.addEventListener('input', U.debounce((e) => Auth.checkEmail(e.target), 500));

      // Chat input auto-grow
      const ci = id('chatInput');
      if (ci) {
        ci.addEventListener('input', () => U.autoGrow(ci));
        ci.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); Chat.send(); }
        });
      }
      const cmi = id('commentInput');
      if (cmi) cmi.addEventListener('input', () => U.autoGrow(cmi));

      // Install banner
      Install.init();
    },

    bindSortTabs() {
      $$('.sort-tab').forEach((t) => {
        if (t.dataset.bound) return;
        t.dataset.bound = '1';
        t.addEventListener('click', () => {
          $$('.sort-tab').forEach((x) => x.setAttribute('aria-selected', 'false'));
          t.setAttribute('aria-selected', 'true');
          App.setSort(t.dataset.sort);
        });
      });
    },

    syncViews() {
      const isApp = location.pathname.indexOf('/app') === 0 || !!Store.get('entered_app', false);
      const landing = id('view-landing');
      const app = id('view-app');
      const dock = id('dock');
      if (landing) landing.hidden = isApp;
      if (app) app.hidden = !isApp;
      if (dock) dock.hidden = !isApp;   // ← FIX: dock always visible when app view is on
    },

    handleHash() {
      const h = (location.hash || '').replace('#', '') || 'home';
      const valid = ['home', 'explore', 'liked', 'saved', 'chat', 'profile'];
      if (valid.indexOf(h) >= 0) App.switchTab(h, { silent: true });
    },

    onAuthChange() {
      App.updateUserUI();
      App.syncViews();
      if (S.me) { App.loadFeed('home'); App.loadChats(); }
      else { App.goHome(); }
    },

    updateUserUI() {
      const signIn = id('signInBtn');
      const avatarBtn = id('avatarBtn');
      const avatarImg = id('avatarImg');
      const cAvatar = id('composerAvatar');
      const cFormAvatar = id('composerFormAvatar');
      const cName = id('composerUserName');

      if (S.me) {
        if (signIn) signIn.hidden = true;
        if (avatarBtn) avatarBtn.hidden = false;
        if (avatarImg) avatarImg.src = S.me.avatar || '';
        if (cAvatar) cAvatar.src = S.me.avatar || '';
        if (cFormAvatar) cFormAvatar.src = S.me.avatar || '';
        if (cName) cName.textContent = S.me.name || '—';
        App.updateProfileUI();
      } else {
        if (signIn) signIn.hidden = false;
        if (avatarBtn) avatarBtn.hidden = true;
      }
    },

    updateProfileUI() {
      if (!S.me) return;
      const set = (x, v) => { const n = id(x); if (n) n.textContent = v; };
      const img = id('profileAvatar');
      if (img) img.src = S.me.avatar || '';
      set('profileName', S.me.name || '');
      set('profileHandle', S.me.handle || '');
      set('profileBio', S.me.bio || '');
      set('statFollowers', U.num(S.me.followers || 0));
      set('statFollowing', U.num(S.me.following || 0));
    },

    applyTheme(theme) {
      document.documentElement.dataset.theme = theme;
      const icon = id('themeIcon');
      if (icon) icon.className = theme === 'dark' ? 'ph ph-moon' : 'ph ph-sun';
      Store.set('theme', theme);
    },

    toggleTheme() {
      const cur = document.documentElement.dataset.theme || 'dark';
      App.applyTheme(cur === 'dark' ? 'light' : 'dark');
      U.buzz(8);
    },

    switchTab(tab, opts) {
      opts = opts || {};
      if (['liked', 'saved', 'profile', 'chat'].indexOf(tab) >= 0 && !S.me) {
        Auth.open('login');
        return;
      }
      S.tab = tab;

      // Ensure app view is visible when switching to app tabs
      const landing = id('view-landing');
      const app = id('view-app');
      if (app && app.hidden && tab !== 'home') {
        // Already in app
      } else if (app && app.hidden) {
        // Coming from landing via dock (rare)
        Store.set('entered_app', true);
        if (landing) landing.hidden = true;
        app.hidden = false;
        const dock = id('dock');
        if (dock) dock.hidden = false;
      }

      $$('.tab-panel').forEach((p) => {
        p.classList.toggle('is-active', p.dataset.tab === tab);
      });
      $$('.dock-item[data-tab]').forEach((b) => {
        b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false');
      });

      if (!opts.silent) {
        const url = new URL(location.href);
        url.hash = tab === 'home' ? '' : '#' + tab;
        history.replaceState(null, '', url.toString());
        window.scrollTo({ top: 0, behavior: S.reducedMotion ? 'auto' : 'smooth' });
      }

      const loaders = {
        home: () => App.loadFeed('home'),
        explore: () => App.loadFeed('explore'),
        liked: () => App.loadFeed('liked'),
        saved: () => App.loadFeed('saved'),
        profile: () => App.loadProfile(),
        chat: () => App.loadChats(),
      };
      if (loaders[tab]) {
        try { loaders[tab](); } catch (e) { console.error('[خَيال] loader failed:', e); }
      }
    },

    previewFeed() {
      Store.set('entered_app', true);
      const landing = id('view-landing');
      const app = id('view-app');
      const dock = id('dock');
      if (landing) landing.hidden = true;
      if (app) app.hidden = false;
      if (dock) dock.hidden = false;   // ← FIX: always show dock
      window.scrollTo({ top: 0 });
      App.switchTab('home', { silent: true });
    },

    goHome() {
      Store.del('entered_app');
      const landing = id('view-landing');
      const app = id('view-app');
      const dock = id('dock');
      if (landing) landing.hidden = false;
      if (app) app.hidden = true;
      if (dock) dock.hidden = true;
      window.scrollTo({ top: 0 });
    },

    setSort(sort) {
      S.sort = sort;
      App.loadFeed(S.tab === 'home' ? 'home' : 'explore');
    },

    filterByTag(tag) {
      S.filter = tag;
      $$('.filter').forEach((f) => {
        f.setAttribute('aria-pressed', f.dataset.tag === tag ? 'true' : 'false');
      });
      App.loadFeed('home');
    },

    async refreshAll(showToast) {
      const btn = $('.refresh-btn');
      if (btn) btn.setAttribute('aria-busy', 'true');
      try {
        await Promise.all([App.loadFeed('home'), App.loadChats()]);
        if (showToast) U.toast('تم التحديث', 'ph-check-circle', 'success');
      } catch (e) { console.error(e); }
      finally { if (btn) btn.removeAttribute('aria-busy'); }
    },

    async loadLandingFeed() {
      const feed = id('landingFeed');
      if (!feed) return;
      try {
        const posts = await API.get('/api/posts?limit=6');
        S.posts.landing = posts;
        feed.innerHTML = posts.length ? posts.map(Render.prompt).join('') : Render.empty('لا توجد برومبتات بعد', 'ph-sparkle');
      } catch (e) {
        console.warn('[خَيال] landing feed failed:', e);
      }
    },

    async loadFeed(which) {
      const feeds = { home: 'homeFeed', explore: 'exploreFeed', liked: 'likedFeed', saved: 'savedFeed', profile: 'profilePanel' };
      const feed = id(feeds[which]);
      if (!feed) return;

      const isEmpty = !S.posts[which] || S.posts[which].length === 0;
      if (isEmpty) {
        feed.setAttribute('aria-busy', 'true');
        feed.innerHTML = Array(6).fill(Render.skeleton()).join('');
      }

      try {
        let posts = [];
        if (which === 'liked' || which === 'saved') {
          const all = await API.get('/api/posts?limit=100');
          posts = all.filter((p) => which === 'liked' ? p.liked : p.saved);
          App.updateCountPill(which, posts.length);
        } else if (which === 'profile') {
          if (!S.me) return;
          posts = await API.get('/api/users/' + S.me.id + '/posts');
        } else if (which === 'home') {
          const params = new URLSearchParams({ sort: S.sort, limit: '50' });
          if (S.filter) params.set('tag', S.filter);
          posts = await API.get('/api/posts?' + params.toString());
          App.loadFilters(posts);
        } else if (which === 'explore') {
          posts = await API.get('/api/posts?sort=top&limit=50');
          App.loadExploreFilters(posts);
        }

        S.posts[which] = posts;
        feed.innerHTML = posts.length ? posts.map(Render.prompt).join('') : Render.emptyFor(which);
        feed.setAttribute('aria-busy', 'false');
      } catch (e) {
        console.warn('[خَيال] feed ' + which + ' failed:', e);
        feed.innerHTML = Render.empty('تعذّر التحميل', 'ph-warning-circle', 'حاول مرة أخرى');
        feed.setAttribute('aria-busy', 'false');
      }
    },

    updateCountPill(which, n) {
      const pill = id(which === 'liked' ? 'likedCount' : 'savedCount');
      if (!pill) return;
      pill.dataset.count = String(n);
      const lbl = pill.querySelector('[data-count-label]');
      if (lbl) lbl.textContent = U.num(n);
    },

    loadFilters(posts) {
      const wrap = id('filters');
      if (!wrap) return;
      const tags = new Set();
      posts.forEach((p) => (p.tags || []).forEach((t) => tags.add(t)));
      if (tags.size === 0) { wrap.innerHTML = ''; return; }
      const top = Array.from(tags).slice(0, 12);
      wrap.innerHTML =
        '<button class="filter" data-tag="" aria-pressed="' + (!S.filter ? 'true' : 'false') + '" type="button"><i class="ph ph-squares-four"></i> الكل</button>' +
        top.map((t) => '<button class="filter" data-tag="' + esc(t) + '" aria-pressed="' + (S.filter === t ? 'true' : 'false') + '" type="button">' + esc(t) + '</button>').join('');
    },

    loadExploreFilters(posts) {
      const wrap = id('exploreFilters');
      if (!wrap) return;
      const models = new Set();
      posts.forEach((p) => p.model && models.add(p.model));
      if (models.size === 0) { wrap.innerHTML = ''; return; }
      wrap.innerHTML =
        '<button class="filter" aria-pressed="true" type="button"><i class="ph ph-squares-four"></i> الكل</button>' +
        Array.from(models).slice(0, 8).map((m) => '<button class="filter" aria-pressed="false" type="button">' + esc(m) + '</button>').join('');
    },

    async loadProfile() {
      if (!S.me) return;
      App.updateProfileUI();
      try {
        const user = await API.get('/api/users/' + S.me.id);
        S.me.followers = user.followers;
        S.me.following = user.following;
        App.updateProfileUI();
        const posts = await API.get('/api/users/' + S.me.id + '/posts');
        const st = id('statPosts');
        if (st) st.textContent = U.num(posts.length);
        S.posts.profile = posts;
        const panel = id('profilePanel');
        if (panel) panel.innerHTML = posts.length ? posts.map(Render.prompt).join('') : Render.emptyFor('profile');
      } catch (e) { console.warn('[خَيال] profile failed:', e); }
    },

    async doSearch(q) {
      const results = id('searchResults');
      if (!results) return;
      if (!q || q.length < 2) { results.dataset.open = 'false'; return; }
      try {
        const posts = await API.get('/api/posts?q=' + encodeURIComponent(q) + '&limit=8');
        if (posts.length === 0) {
          results.innerHTML = '<div style="padding:20px;text-align:center;color:var(--fg-3);font-size:14px">لا نتائج</div>';
        } else {
          results.innerHTML = posts.map((p) =>
            '<div class="search-result" data-action="open-post" data-post="' + p.id + '" role="option" tabindex="0">' +
            '<img src="' + esc(p.image) + '" alt="">' +
            '<div class="search-result-info"><strong>' + esc(p.title) + '</strong><span>' + esc((p.prompt || '').slice(0, 60)) + '…</span></div>' +
            '</div>'
          ).join('');
        }
        results.dataset.open = 'true';
      } catch (_) { results.dataset.open = 'false'; }
    },

    async loadChats() {
      const list = id('chatList');
      if (!list) return;
      if (!S.me) {
        list.innerHTML = Render.empty('سجّل دخولك للمحادثات', 'ph-lock');
        return;
      }
      try {
        const chats = await API.get('/api/chats');
        S.chats = chats;
        if (chats.length === 0) {
          list.innerHTML = Render.empty('لا محادثات', 'ph-chat-circle-dots', 'ابدأ محادثة جديدة');
        } else {
          list.innerHTML = chats.map(Render.chatItem).join('');
        }
        App.refreshChatsBadge();
      } catch (_) {
        list.innerHTML = Render.empty('تعذّر التحميل', 'ph-warning-circle');
      }
    },

    async refreshChatsBadge() {
      if (!S.me) return;
      try {
        const chats = await API.get('/api/chats');
        const unread = chats.reduce((sum, c) => sum + (c.unread || 0), 0);
        const badge = id('dockChatBadge');
        if (badge) {
          badge.hidden = unread === 0;
          badge.textContent = unread > 99 ? '99+' : String(unread);
        }
      } catch (_) {}
    },

    openProfile(userId) {
      if (!userId) return;
      U.toast('صفحة المبدع قريباً', 'ph-user');
    },

    confirm(opts) {
      return new Promise((resolve) => {
        const scrim = el('div', { class: 'scrim', dataset: { open: 'false' }, role: 'dialog', 'aria-modal': 'true' });
        const modal = el('div', { class: 'modal' });
        modal.innerHTML =
          '<h3>' + esc(opts.title) + '</h3>' +
          '<p>' + esc(opts.message) + '</p>' +
          '<div class="modal-actions">' +
          '<button type="button" class="btn btn-ghost" data-act="cancel">' + esc(opts.cancelText || 'إلغاء') + '</button>' +
          '<button type="button" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-act="confirm">' + esc(opts.confirmText || 'تأكيد') + '</button>' +
          '</div>';
        scrim.appendChild(modal);
        document.body.appendChild(scrim);

        requestAnimationFrame(() => {
          scrim.dataset.open = 'true';
          const release = U.focusTrap(modal);
          const finish = (val) => {
            scrim.dataset.open = 'false';
            try { release(); } catch (_) {}
            setTimeout(() => scrim.remove(), 300);
            resolve(val);
          };
          modal.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(false));
          modal.querySelector('[data-act="confirm"]').addEventListener('click', () => finish(true));
          scrim.addEventListener('click', (e) => { if (e.target === scrim) finish(false); });
          const onKey = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); finish(false); } };
          document.addEventListener('keydown', onKey);
        });
      });
    },
  };

  /* ═══════════════ 10. POST (like/save/copy) ═══════════════ */
  const Post = {
    async like(btn, postId) {
      if (!S.me) { Auth.open('login'); return; }
      if (S.pendingLikes.has(postId)) return;
      S.pendingLikes.add(postId);

      const wasLiked = btn.getAttribute('aria-pressed') === 'true';
      const nextLiked = !wasLiked;

      Post.syncLike(postId, nextLiked, null);
      U.buzz(12);

      try {
        const res = await API.post('/api/posts/' + postId + '/like');
        Post.syncLike(postId, res.liked, res.likes);
        Object.keys(S.posts).forEach((k) => {
          const p = S.posts[k].find((x) => x.id === postId);
          if (p) { p.liked = res.liked; p.likes = res.likes; }
        });
      } catch (e) {
        Post.syncLike(postId, wasLiked, null);
        U.toast('تعذّر تحديث الإعجاب', 'ph-warning-circle', 'error');
      } finally {
        S.pendingLikes.delete(postId);
      }
    },

    syncLike(postId, liked, count) {
      $$('[data-post-id="' + postId + '"] [data-action="like"]').forEach((x) => {
        x.setAttribute('aria-pressed', liked ? 'true' : 'false');
      });
      if (count != null) {
        $$('[data-post-id="' + postId + '"] [data-likes-count]').forEach((x) => {
          x.textContent = U.num(count);
        });
      }
    },

    async save(btn, postId) {
      if (!S.me) { Auth.open('login'); return; }
      if (S.pendingSaves.has(postId)) return;
      S.pendingSaves.add(postId);

      const wasSaved = btn.getAttribute('aria-pressed') === 'true';
      const nextSaved = !wasSaved;

      $$('[data-post-id="' + postId + '"] [data-action="save"]').forEach((x) => {
        x.setAttribute('aria-pressed', nextSaved ? 'true' : 'false');
      });
      U.buzz(8);

      try {
        const res = await API.post('/api/posts/' + postId + '/save');
        $$('[data-post-id="' + postId + '"] [data-action="save"]').forEach((x) => {
          x.setAttribute('aria-pressed', res.saved ? 'true' : 'false');
        });
        Object.keys(S.posts).forEach((k) => {
          const p = S.posts[k].find((x) => x.id === postId);
          if (p) { p.saved = res.saved; p.saves = res.saves; }
        });
        U.toast(res.saved ? 'تم الحفظ' : 'أُزيل من المحفوظة', res.saved ? 'ph-bookmark-simple-fill' : 'ph-bookmark-simple');
      } catch (e) {
        $$('[data-post-id="' + postId + '"] [data-action="save"]').forEach((x) => {
          x.setAttribute('aria-pressed', wasSaved ? 'true' : 'false');
        });
        U.toast('تعذّر الحفظ', 'ph-warning-circle', 'error');
      } finally {
        S.pendingSaves.delete(postId);
      }
    },

    async copy(postId, btn) {
      let text = '';
      Object.keys(S.posts).forEach((k) => {
        const p = S.posts[k].find((x) => x.id === Number(postId));
        if (p && p.prompt) text = p.prompt;
      });
      if (!text && btn) {
        const card = btn.closest('.prompt-card');
        const ex = card && card.querySelector('.prompt-excerpt');
        if (ex) text = ex.textContent.trim();
      }
      const ok = await U.copy(text);
      if (ok) {
        U.toast('تم نسخ البرومبت', 'ph-check-circle', 'success');
        U.buzz([10, 30, 10]);
        API.post('/api/posts/' + postId + '/copy').catch(() => {});
        if (btn && btn.dataset) {
          btn.dataset.state = 'copied';
          setTimeout(() => { try { delete btn.dataset.state; } catch (_) {} }, 1400);
        }
      } else {
        U.toast('تعذّر النسخ', 'ph-warning-circle', 'error');
      }
    },

    open(postId) {
      U.toast('عرض التفاصيل قريباً', 'ph-eye');
    },
  };

  /* ═══════════════ 11. COMPOSER ═══════════════ */
  const Composer = {
    _type: null,

    open() {
      if (!S.me) { Auth.open('login'); return; }
      Composer._type = null;
      Composer.reset();
      Layer.open('composerModal');
    },

    close(e) {
      if (e && e.target !== e.currentTarget) return;
      Layer.close('composerModal');
      Composer.reset();
    },

    reset() {
      const form = id('composerForm');
      const types = id('composerTypes');
      const img = id('imgPreview');
      const imgEl = id('imgPreviewEl');
      if (form) { form.reset(); form.classList.remove('is-active'); }
      if (types) types.hidden = false;
      if (img) img.hidden = true;
      if (imgEl) imgEl.src = '';
      $$('.type-card').forEach((x) => x.removeAttribute('aria-pressed'));
    },

    chooseType(type) {
      Composer._type = type;
      $$('.type-card').forEach((x) => {
        x.setAttribute('aria-pressed', x.dataset.type === type ? 'true' : 'false');
      });
      const types = id('composerTypes');
      const form = id('composerForm');
      const imgField = id('imageField');
      const prompt = id('cPrompt');
      if (types) types.hidden = true;
      if (form) form.classList.add('is-active');
      if (imgField) imgField.hidden = type !== 'prompt';
      if (prompt) prompt.placeholder = type === 'prompt' ? 'اكتب البرومبت…' : 'اكتب نص المنشور…';
      setTimeout(() => { const t = id('cTitle'); if (t) t.focus(); }, 100);
    },

    previewImage(url) {
      const wrap = id('imgPreview');
      const img = id('imgPreviewEl');
      if (!wrap || !img) return;
      if (!url || !/^https?:\/\//.test(url)) { wrap.hidden = true; return; }
      img.src = url;
      wrap.hidden = false;
    },

    clearPreview() {
      const wrap = id('imgPreview');
      const img = id('imgPreviewEl');
      const inp = id('cImage');
      if (wrap) wrap.hidden = true;
      if (img) img.src = '';
      if (inp) inp.value = '';
    },

    async publish(e) {
      if (e && e.preventDefault) e.preventDefault();
      if (!S.me) { Auth.open('login'); return; }
      const btn = id('composerSubmit');
      const title = ((id('cTitle') || {}).value || '').trim();
      const prompt = ((id('cPrompt') || {}).value || '').trim();
      const image = ((id('cImage') || {}).value || '').trim();
      const model = ((id('cModel') || {}).value) || '';
      const tags = (((id('cTags') || {}).value) || '').split(/[،,]/).map((t) => t.trim()).filter(Boolean);
      if (!title || !prompt) { U.toast('أكمل العنوان والنص', 'ph-warning-circle', 'warning'); return; }
      if (btn) btn.setAttribute('aria-busy', 'true');
      try {
        const payload = { title, prompt, tags };
        if (Composer._type === 'prompt') { payload.image = image; payload.model = model; }
        const post = await API.post('/api/posts', payload);
        if (!S.posts.home) S.posts.home = [];
        S.posts.home.unshift(post);
        const feed = id('homeFeed');
        if (feed) {
          const empty = feed.querySelector('.empty-block');
          if (empty) empty.remove();
          const tmp = el('div', { html: Render.prompt(post) });
          feed.insertBefore(tmp.firstElementChild, feed.firstChild);
        }
        Composer.close();
        U.toast('تم النشر!', 'ph-confetti', 'success', 3200);
        U.buzz([15, 40, 15]);
        App.switchTab('home', { silent: true });
      } catch (err) {
        U.toast((err.data && err.data.error) || 'تعذّر النشر', 'ph-warning-circle', 'error');
      } finally {
        if (btn) btn.removeAttribute('aria-busy');
      }
    },
  };

  /* ═══════════════ 12. COMMENTS ═══════════════ */
  const Drawers = {
    async openComments(postId) {
      S.activePost = postId;
      const body = id('commentsBody');
      const count = id('commentCount');
      const form = id('commentForm');
      if (!body) return;
      body.innerHTML = '<div class="empty-block"><i class="ph ph-circle-notch" style="animation:spin .8s linear infinite;font-size:24px;color:var(--c-brand)"></i></div>';
      Layer.open('commentsDrawer');
      const scrim = id('commentsScrim');
      if (scrim) scrim.dataset.open = 'true';
      try {
        const comments = await API.get('/api/posts/' + postId + '/comments');
        if (count) count.textContent = comments.length ? '(' + comments.length + ')' : '';
        if (form) form.style.display = S.me ? 'flex' : 'none';
        body.innerHTML = comments.length ? comments.map(Render.comment).join('') : Render.empty('لا تعليقات بعد', 'ph-chat-circle', 'كن أول من يعلّق');
      } catch (_) {
        body.innerHTML = Render.empty('تعذّر التحميل', 'ph-warning-circle');
      }
    },
    closeComments() {
      Layer.close('commentsDrawer');
      const scrim = id('commentsScrim');
      if (scrim) scrim.dataset.open = 'false';
      S.activePost = null;
    },
  };

  const Comments = {
    async send(e) {
      if (e && e.preventDefault) e.preventDefault();
      if (!S.activePost || !S.me) return;
      const input = id('commentInput');
      const text = (input && input.value || '').trim();
      if (!text) return;
      const body = id('commentsBody');
      const tmp = 'tmp-' + Date.now();
      const empty = body.querySelector('.empty-block');
      if (empty) empty.remove();
      body.insertAdjacentHTML('afterbegin',
        '<div class="comment" data-temp="' + tmp + '"><img class="avatar avatar-sm" src="' + esc(S.me.avatar) + '" alt=""><div class="comment-body"><div class="comment-top"><span class="comment-name">' + esc(S.me.name) + '</span><span class="comment-time">الآن</span></div><div class="comment-text">' + esc(text) + '</div></div></div>'
      );
      input.value = '';
      U.autoGrow(input);
      try {
        const c = await API.post('/api/posts/' + S.activePost + '/comments', { text });
        const t = body.querySelector('[data-temp="' + tmp + '"]');
        if (t) t.remove();
        body.insertAdjacentHTML('afterbegin', Render.comment(Object.assign({}, c, { author_data: S.me })));
        const count = id('commentCount');
        if (count) {
          const n = body.querySelectorAll('.comment').length;
          count.textContent = '(' + n + ')';
        }
      } catch (_) {
        const t = body.querySelector('[data-temp="' + tmp + '"]');
        if (t) t.remove();
        U.toast('تعذّر إرسال التعليق', 'ph-warning-circle', 'error');
      }
    },

    async delete(cid) {
      const node = document.querySelector('[data-comment-id="' + cid + '"]');
      if (node) node.style.opacity = '0.5';
      try {
        await API.del('/api/comments/' + cid);
        if (node) node.remove();
        const count = id('commentCount');
        const body = id('commentsBody');
        if (count && body) {
          const n = body.querySelectorAll('.comment').length;
          count.textContent = n ? '(' + n + ')' : '';
        }
      } catch (_) {
        if (node) node.style.opacity = '1';
        U.toast('تعذّر الحذف', 'ph-warning-circle', 'error');
      }
    },
  };

  /* ═══════════════ 13. CHAT ═══════════════ */
  const Chat = {
    async open(chatId) {
      S.activeChat = chatId;
      const layout = id('chatLayout');
      const head = id('chatHead');
      const body = id('chatBody');
      if (!layout || !head || !body) return;
      layout.dataset.view = 'thread';

      const chat = S.chats.find((c) => c.id === chatId);
      const other = (chat && chat.with_user) || {};
      head.innerHTML =
        '<button class="btn btn-icon btn-ghost btn-sm" data-action="chat-list" aria-label="رجوع" type="button"><i class="ph ph-arrow-right"></i></button>' +
        '<img class="avatar avatar-sm" src="' + esc(other.avatar) + '" alt="">' +
        '<div class="chat-thread-info"><strong>' + esc(other.name || 'محادثة') + '</strong><span>متصل</span></div>';

      body.innerHTML = '<div style="text-align:center;padding:var(--sp-6)"><i class="ph ph-circle-notch" style="animation:spin .8s linear infinite;font-size:24px;color:var(--c-brand)"></i></div>';
      try {
        const msgs = await API.get('/api/chats/' + chatId + '/messages');
        body.innerHTML = msgs.length ? msgs.map(Render.message).join('') : Render.empty('ابدأ المحادثة', 'ph-chat-circle');
        Chat.scrollBottom();
      } catch (_) {
        body.innerHTML = Render.empty('تعذّر التحميل', 'ph-warning-circle');
      }
    },

    showList() {
      const layout = id('chatLayout');
      if (layout) layout.dataset.view = 'list';
      S.activeChat = null;
    },

    async send(e) {
      if (e && e.preventDefault) e.preventDefault();
      const input = id('chatInput');
      const text = (input && input.value || '').trim();
      if (!text || !S.activeChat) return;
      const body = id('chatBody');
      const empty = body.querySelector('.empty-block');
      if (empty) empty.remove();
      body.insertAdjacentHTML('beforeend', '<div class="msg msg-me" data-temp>' + esc(text) + '<span class="msg-time">الآن</span></div>');
      input.value = '';
      U.autoGrow(input);
      Chat.scrollBottom();
      try {
        const m = await API.post('/api/chats/' + S.activeChat + '/messages', { text });
        const t = body.querySelector('[data-temp]');
        if (t) t.remove();
        body.insertAdjacentHTML('beforeend', Render.message(m));
        Chat.scrollBottom();
      } catch (_) {
        const t = body.querySelector('[data-temp]');
        if (t) t.remove();
        U.toast('تعذّر الإرسال', 'ph-warning-circle', 'error');
      }
    },

    scrollBottom() {
      const body = id('chatBody');
      if (body) body.scrollTop = body.scrollHeight;
    },

    filterList(q) {
      const list = id('chatList');
      if (!list) return;
      const query = (q || '').trim().toLowerCase();
      $$('.chat-item', list).forEach((item) => {
        const name = (item.dataset.name || '').toLowerCase();
        item.hidden = !!(query && name.indexOf(query) < 0);
      });
    },

    newChat() { U.toast('اختر مستخدماً لبدء محادثة', 'ph-note-pencil'); },
    attach() { U.toast('قريباً — إرفاق ملفات', 'ph-paperclip'); },
  };

  /* ═══════════════ 14. EXPLORE ═══════════════ */
  const Explore = {
    openCollection(kind) { U.toast('فتح: ' + kind, 'ph-compass'); App.loadFeed('explore'); },
  };

  /* ═══════════════ 15. INSTALL (PWA) ═══════════════ */
  const Install = {
    _deferred: null,
    init() {
      const banner = id('installBanner');
      if (!banner) return;
      const dismissed = Store.get('install_dismissed', 0);
      if (Date.now() - dismissed < 7 * 24 * 3600 * 1000) return;
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        Install._deferred = e;
        setTimeout(() => {
          banner.hidden = false;
          requestAnimationFrame(() => { banner.dataset.open = 'true'; });
        }, 3000);
      });
      window.addEventListener('appinstalled', () => {
        banner.dataset.open = 'false';
        setTimeout(() => { banner.hidden = true; }, 400);
        Store.set('install_dismissed', Date.now() + 365 * 24 * 3600 * 1000);
        U.toast('تم التثبيت!', 'ph-download-simple', 'success');
      });
    },
    prompt() {
      const banner = id('installBanner');
      if (!Install._deferred) {
        U.toast('افتح القائمة واختر "إضافة إلى الشاشة"', 'ph-info', 'default', 4000);
        if (banner) { banner.dataset.open = 'false'; setTimeout(() => { banner.hidden = true; }, 400); }
        return;
      }
      Install._deferred.prompt();
      Install._deferred.userChoice.then(({ outcome }) => {
        if (banner) { banner.dataset.open = 'false'; setTimeout(() => { banner.hidden = true; }, 400); }
        if (outcome === 'dismissed') Store.set('install_dismissed', Date.now());
        Install._deferred = null;
      });
    },
    dismiss() {
      const banner = id('installBanner');
      if (banner) { banner.dataset.open = 'false'; setTimeout(() => { banner.hidden = true; }, 400); }
      Store.set('install_dismissed', Date.now());
    },
  };

  /* ═══════════════ 16. EVENT DELEGATION (the safety net) ═══════════════ */
  function bindDelegation() {
    document.addEventListener('click', function (e) {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      const handler = Delegation[action];
      if (!handler) return;
      e.preventDefault();
      try { handler(target, e); }
      catch (err) { console.error('[خَيال] action "' + action + '" failed:', err); }
    }, false);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const target = e.target.closest('[data-action][role="button"], .composer-trigger');
      if (!target) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      const action = target.dataset.action || 'open-composer';
      const handler = Delegation[action];
      if (handler) handler(target, e);
    }, false);
  }

  const Delegation = {
    'open-auth': (t) => Auth.open(t.dataset.mode || 'login'),
    'close-auth': () => Auth.close(),
    'switch-tab': (t) => App.switchTab(t.dataset.tab),
    'open-composer': () => Composer.open(),
    'close-composer': () => Composer.close(),
    'choose-type': (t) => Composer.chooseType(t.dataset.type),
    'toggle-theme': () => App.toggleTheme(),
    'preview-feed': () => App.previewFeed(),
    'go-home': () => App.goHome(),
    'refresh': () => App.refreshAll(true),
    'like': (t) => Post.like(t, Number(t.dataset.post)),
    'save': (t) => Post.save(t, Number(t.dataset.post)),
    'copy': (t) => Post.copy(t.dataset.post, t),
    'open-post': (t) => Post.open(Number(t.dataset.post)),
    'open-comments': (t) => Drawers.openComments(Number(t.dataset.post)),
    'close-comments': () => Drawers.closeComments(),
    'delete-comment': (t) => Comments.delete(Number(t.dataset.comment)),
    'filter-tag': (t) => App.filterByTag(t.dataset.tag),
    'open-chat': (t) => Chat.open(Number(t.dataset.chat)),
    'chat-list': () => Chat.showList(),
    'chat-new': () => Chat.newChat(),
    'open-profile': (t) => App.openProfile(Number(t.dataset.user)),
    'edit-profile': () => Auth.openEditProfile(),
    'close-edit-profile': () => Auth.closeEditProfile(),
    'logout': () => Auth.logout(),
    'switch-mode': (t) => Auth.switchMode(t.dataset.mode),
    'open-collection': (t) => Explore.openCollection(t.dataset.kind),
    'install-prompt': () => Install.prompt(),
    'install-dismiss': () => Install.dismiss(),
  };

  /* ═══════════════ 17. FORM SUBMISSION DELEGATION ═══════════════ */
  function bindForms() {
    document.addEventListener('submit', function (e) {
      const f = e.target;
      if (!f || f.tagName !== 'FORM') return;
      const fid = f.id;
      const handlers = {
        loginForm: Auth.login,
        registerForm: Auth.register,
        composerForm: Composer.publish,
        commentForm: Comments.send,
        chatComposer: Chat.send,
      };
      // Chat composer has no id, so check class
      if (f.classList.contains('chat-composer')) {
        e.preventDefault();
        Chat.send();
        return;
      }
      if (handlers[fid]) {
        // These already call preventDefault themselves
        handlers[fid].call(null, e);
      }
    }, false);
  }

  /* ═══════════════ 18. EXPOSE TO WINDOW ═══════════════ */
  window.U = U;
  window.Store = Store;
  window.Auth = Auth;
  window.App = App;
  window.Post = Post;
  window.Composer = Composer;
  window.Chat = Chat;
  window.Drawers = Drawers;
  window.Comments = Comments;
  window.Explore = Explore;
  window.Install = Install;
  window.Layer = Layer;
  window.Render = Render;

  /* ═══════════════ 19. BOOT ═══════════════ */
  function boot() {
    try {
      bindDelegation();
      bindForms();
      App.init();
    } catch (err) {
      console.error('[خَيال] boot failed:', err);
      // Last-resort visible error
      try {
        U.toast('خطأ في التحميل — راجع الكونسول', 'ph-warning-circle', 'error', 5000);
      } catch (_) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();