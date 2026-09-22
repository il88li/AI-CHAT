/* ═══════════════════════════════════════════════════════════════════════
   خَيال — app.js v21.4
   CSRF · FollowersDrawer · NotificationsLoader · ConfirmModal · ReportModal
   · Post.edit · Post.delete modal · Post.report modal · ProfileView overlay
   · Settings 5-tab · Search page · Post Detail page
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const CFG = {
    PAGE_SIZE: 20,
    TOAST_MS: 3200,
    SEARCH_DEBOUNCE: 280,
    DRAFT_KEY: 'khayal.composer.draft',
    THEME_KEY: 'khayal.theme',
    NET_CHECK_MS: 8000,
    NET_PING_TIMEOUT: 3000,
    NOTIF_POLL_MS: 30000,
    BUILD: '21.4',
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
      S.feeds[key] = { items: [], before: null, busy: false, hasMore: true, loaded: false, controller: null };
    }
    return S.feeds[key];
  }

  /* ═══════════ UTILITIES ═══════════ */
  const U = {
    escapeHtml(s) {
      if (s == null) return '';
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    relativeTime(iso) {
      if (!iso) return '';
      const d = new Date(iso), now = Date.now();
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
    safeAvatar(imgEl, url) {
      if (!imgEl) return;
      const clean = url && String(url).trim();
      imgEl.onerror = function () { this.removeAttribute('src'); this.hidden = true; };
      if (clean) { imgEl.src = clean; imgEl.hidden = false; }
      else { imgEl.removeAttribute('src'); imgEl.hidden = true; }
    },
    isUrl(s) {
      return typeof s === 'string' && /^https?:\/\/[^\s<>"']+$/i.test(s.trim());
    },
    async copy(text) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch (e) {}
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta); return ok;
      } catch (e) { return false; }
    },
  };

  /* ═══════════ CSRF ═══════════ */
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.content) return meta.content;
    return window.__CSRF__ || null;
  }

  /* ═══════════ API ═══════════ */
  const API = {
    async call(method, path, body, opts) {
      const init = { method, credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
      const m = (method || 'GET').toUpperCase();
      if (m !== 'GET' && m !== 'HEAD') {
        const t = getCsrfToken();
        if (t) init.headers['X-CSRF-Token'] = t;
      }
      if (body !== undefined && body !== null) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      if (opts && opts.signal) init.signal = opts.signal;

      let res;
      try { res = await fetch(path, init); }
      catch (err) {
        if (err.name === 'AbortError') throw err;
        throw new Error('تعذّر الاتصال بالخادم');
      }

      const nt = res.headers.get('X-CSRF-Token');
      if (nt) {
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) meta.content = nt;
        window.__CSRF__ = nt;
      }

      let data = null;
      const ct = res.headers.get('Content-Type') || '';
      if (ct.includes('application/json')) {
        try { data = await res.json(); } catch (e) { data = null; }
      }

      if (!res.ok) {
        const msg = (data && (data.error || data.message)) || `خطأ ${res.status}`;
        const err = new Error(msg); err.status = res.status; err.data = data;
        throw err;
      }
      return data;
    },
    get(p, o) { return API.call('GET', p, null, o); },
    post(p, b) { return API.call('POST', p, b); },
    patch(p, b) { return API.call('PATCH', p, b); },
    del(p) { return API.call('DELETE', p); },
  };

  /* ═══════════ THEME ═══════════ */
  const Theme = {
    get() { return document.documentElement.dataset.theme || 'dark'; },
    set(mode) {
      document.documentElement.dataset.theme = mode;
      try { localStorage.setItem(CFG.THEME_KEY, mode); } catch (e) {}
      this.syncIcon();
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', mode === 'dark' ? '#08080C' : '#F7F7FA');
    },
    toggle() { this.set(this.get() === 'dark' ? 'light' : 'dark'); if (window.Sounds) Sounds.play('toggle'); },
    syncIcon() {
      const icon = document.getElementById('themeIcon');
      if (!icon) return;
      icon.className = this.get() === 'dark' ? 'ph ph-moon' : 'ph ph-sun';
    },
    init() {
      try {
        const saved = localStorage.getItem(CFG.THEME_KEY);
        if (saved === 'light' || saved === 'dark') this.set(saved);
        else this.set(window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
      } catch (e) { this.syncIcon(); }
    },
  };

  /* ═══════════ TOAST ═══════════ */
  const Toast = {
    wrap() { return document.getElementById('toastWrap'); },
    show(msg, tone, ms) {
      const wrap = this.wrap();
      if (!wrap) { console.log('[toast]', msg); return; }
      const icons = { success: 'ph-check-circle', error: 'ph-warning-circle', warning: 'ph-warning', info: 'ph-info' };
      const t = document.createElement('div');
      t.className = 'toast';
      t.setAttribute('data-tone', tone || 'info');
      t.innerHTML = `<i class="ph ${icons[tone] || icons.info}" aria-hidden="true"></i><span></span>`;
      t.querySelector('span').textContent = msg;
      wrap.appendChild(t);
      setTimeout(() => {
        t.style.opacity = '0'; t.style.transform = 'translateY(12px)';
        setTimeout(() => t.remove(), 260);
      }, ms || CFG.TOAST_MS);
    },
  };

  /* ═══════════ CONFIRM MODAL ═══════════ */
  const ConfirmModal = {
    _resolve: null,
    show(opts) {
      opts = opts || {};
      const title = opts.title || 'تأكيد';
      const message = opts.message || 'هل أنت متأكد؟';
      const confirmLabel = opts.confirmLabel || 'تأكيد';
      const cancelLabel = opts.cancelLabel || 'إلغاء';
      const danger = !!opts.danger;

      return new Promise((resolve) => {
        this._resolve = resolve;
        const scrim = document.createElement('div');
        scrim.className = 'scrim';
        scrim.setAttribute('data-open', 'false');
        scrim.setAttribute('role', 'dialog');
        scrim.setAttribute('aria-modal', 'true');
        scrim.innerHTML =
          '<div class="modal modal-sm" role="document">' +
            '<h3>' + U.escapeHtml(title) + '</h3>' +
            '<p>' + U.escapeHtml(message) + '</p>' +
            '<div class="modal-actions">' +
              '<button class="btn btn-ghost" type="button" data-choice="cancel">' + U.escapeHtml(cancelLabel) + '</button>' +
              '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" type="button" data-choice="confirm">' + U.escapeHtml(confirmLabel) + '</button>' +
            '</div>' +
          '</div>';

        const finish = (v) => {
          scrim.setAttribute('data-open', 'false');
          setTimeout(() => scrim.remove(), 280);
          const r = this._resolve; this._resolve = null;
          if (r) r(v);
        };
        scrim.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-choice]');
          if (btn) { finish(btn.dataset.choice === 'confirm'); return; }
          if (e.target === scrim) finish(false);
        });
        document.body.appendChild(scrim);
        requestAnimationFrame(() => scrim.setAttribute('data-open', 'true'));
        setTimeout(() => {
          const p = scrim.querySelector('[data-choice="confirm"]');
          if (p) p.focus({ preventScroll: true });
        }, 140);
      });
    },
  };

  /* ═══════════ REPORT MODAL ═══════════ */
  const ReportModal = {
    _resolve: null,
    show(postId) {
      const reasons = [
        ['spam', 'بريد مزعج أو محتوى متكرر'],
        ['harassment', 'تحرّش أو مضايقة'],
        ['hate', 'خطاب كراهية'],
        ['violence', 'عنف أو محتوى مؤذٍ'],
        ['nudity', 'محتوى غير لائق'],
        ['misinformation', 'معلومات مضلّلة'],
        ['copyright', 'انتهاك حقوق النشر'],
        ['other', 'سبب آخر'],
      ];
      return new Promise((resolve) => {
        this._resolve = resolve;
        const scrim = document.createElement('div');
        scrim.className = 'scrim';
        scrim.setAttribute('data-open', 'false');
        scrim.setAttribute('role', 'dialog');
        scrim.setAttribute('aria-modal', 'true');
        scrim.innerHTML =
          '<div class="modal" role="document">' +
            '<h3>الإبلاغ عن المنشور</h3>' +
            '<p>اختر سبباً — سنراجع المنشور في أقرب وقت.</p>' +
            '<form class="report-form">' +
              '<div class="report-reasons">' +
                reasons.map(([k, l], i) =>
                  '<label class="report-reason">' +
                    '<input type="radio" name="rr" value="' + k + '"' + (i === 0 ? ' checked' : '') + '>' +
                    '<span class="report-reason-dot" aria-hidden="true"></span>' +
                    '<span>' + U.escapeHtml(l) + '</span>' +
                  '</label>'
                ).join('') +
              '</div>' +
              '<label class="report-note-label" for="reportNote">ملاحظة إضافية <span class="field-opt">(اختياري)</span></label>' +
              '<textarea id="reportNote" class="textarea report-note" maxlength="500" rows="3" placeholder="تفاصيل تساعد الفريق على المراجعة…"></textarea>' +
              '<div class="modal-actions">' +
                '<button class="btn btn-ghost" type="button" data-choice="cancel">إلغاء</button>' +
                '<button class="btn btn-danger" type="submit" data-choice="submit">إرسال البلاغ</button>' +
              '</div>' +
            '</form>' +
          '</div>';

        const finish = (v) => {
          scrim.setAttribute('data-open', 'false');
          setTimeout(() => scrim.remove(), 280);
          const r = this._resolve; this._resolve = null;
          if (r) r(v);
        };
        scrim.addEventListener('click', (e) => {
          if (e.target.closest('[data-choice="cancel"]') || e.target === scrim) { finish(false); return; }
          const submit = e.target.closest('[data-choice="submit"]');
          if (submit) {
            e.preventDefault();
            const reason = (scrim.querySelector('input[name="rr"]:checked') || {}).value || 'other';
            const note = (scrim.querySelector('#reportNote') || {}).value || '';
            finish({ reason, note });
          }
        });
        document.body.appendChild(scrim);
        requestAnimationFrame(() => scrim.setAttribute('data-open', 'true'));
      });
    },
  };

  /* ═══════════ INSTALL ═══════════ */
  const Install = {
    deferred: null, dismissed: false,
    init() {
      const banner = document.getElementById('installBanner');
      if (!banner) return;
      try { this.dismissed = localStorage.getItem('khayal.install.dismissed') === '1'; } catch (e) {}
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); this.deferred = e;
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
      const c = await this.deferred.userChoice;
      if (c && c.outcome === 'accepted') this.dismiss();
      this.deferred = null;
    },
    dismiss() {
      this.dismissed = true;
      try { localStorage.setItem('khayal.install.dismissed', '1'); } catch (e) {}
      const b = document.getElementById('installBanner');
      if (b) { b.setAttribute('data-open', 'false'); setTimeout(() => { b.hidden = true; }, 400); }
    },
  };

  /* ═══════════ NETWORK ═══════════ */
  const Net = {
    _interval: null, _lastState: null, _checking: false,
    async _ping() {
      if (this._checking) return this._lastState;
      this._checking = true;
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), CFG.NET_PING_TIMEOUT);
        const res = await fetch('/api/health', { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
        clearTimeout(to); this._checking = false; return res.ok;
      } catch (e) { this._checking = false; return false; }
    },
    init() {
      const bar = document.getElementById('netBar');
      if (!bar) return;
      const self = this;
      const update = async () => {
        const browserOffline = !navigator.onLine;
        let offline = browserOffline;
        if (browserOffline) offline = !(await self._ping());
        if (self._lastState !== null && self._lastState !== offline && !offline) Toast.show('عدت متصلاً', 'success');
        self._lastState = offline;
        bar.setAttribute('data-open', offline ? 'true' : 'false');
      };
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      this._interval = setInterval(update, CFG.NET_CHECK_MS);
      update();
    },
  };

  /* ═══════════ AUTH ═══════════ */
  const Auth = {
    modal() { return document.getElementById('authModal'); },
    open(mode) {
      const m = this.modal();
      if (!m) return;
      S.lastFocused = document.activeElement;
      m.querySelectorAll('[aria-invalid="true"]').forEach(el => el.removeAttribute('aria-invalid'));
      this.switchMode(mode || 'login');
      m.setAttribute('data-open', 'true');
      document.documentElement.style.overflow = 'hidden';
      setTimeout(() => {
        const f = m.querySelector('.auth-form.is-active input');
        if (f) f.focus({ preventScroll: true });
      }, 200);
      if (window.Sounds) Sounds.play('open');
    },
    close(e) {
      if (e && e.target && e.target.closest('.auth-shell')) return;
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
      m.querySelectorAll('.auth-tab').forEach(t => t.setAttribute('aria-selected', t.dataset.mode === mode ? 'true' : 'false'));
      m.querySelectorAll('.auth-form').forEach(f => f.classList.toggle('is-active', f.id === mode + 'Form'));
      const title = m.querySelector('#authTitle');
      const sub = m.querySelector('#authSub');
      if (title) title.textContent = mode === 'register' ? 'حساب جديد' : 'تسجيل الدخول';
      if (sub) sub.textContent = mode === 'register' ? 'انضم إلى مبدعي خَيال' : 'أهلاً بعودتك إلى خَيال';
      m.querySelectorAll('[aria-invalid="true"]').forEach(el => el.removeAttribute('aria-invalid'));
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
      const idEl = form.querySelector('#loginIdentifier');
      const pwEl = form.querySelector('#loginPassword');
      const identifier = (idEl || {}).value || '';
      const password = (pwEl || {}).value || '';
      const remember = !!(form.querySelector('#rememberMe') || {}).checked;
      if (idEl) idEl.removeAttribute('aria-invalid');
      if (pwEl) pwEl.removeAttribute('aria-invalid');
      if (!identifier || !password) {
        if (idEl && !identifier) idEl.setAttribute('aria-invalid', 'true');
        if (pwEl && !password) pwEl.setAttribute('aria-invalid', 'true');
        if (window.Sounds) Sounds.play('error');
        return Toast.show('أدخل بيانات الدخول', 'warning');
      }
      btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
      try {
        const user = await API.post('/api/auth/login', { identifier, password, remember });
        S.me = user; window.__ME__ = user;
        this.afterLogin(user);
      } catch (err) {
        if (idEl) idEl.setAttribute('aria-invalid', 'true');
        if (pwEl) pwEl.setAttribute('aria-invalid', 'true');
        if (window.Sounds) Sounds.play('error');
        Toast.show(err.message, 'error');
      } finally { btn.removeAttribute('aria-busy'); btn.disabled = false; }
    },
    async register(ev) {
      ev.preventDefault();
      const form = ev.target;
      const btn = form.querySelector('#registerSubmit');
      const nameEl = form.querySelector('#regName');
      const userEl = form.querySelector('#regUsername');
      const emailEl = form.querySelector('#regEmail');
      const pwEl = form.querySelector('#regPassword');
      const agreeEl = form.querySelector('#agreeTerms');
      const payload = {
        name: (nameEl || {}).value || '',
        username: (userEl || {}).value || '',
        email: (emailEl || {}).value || '',
        password: (pwEl || {}).value || '',
      };
      [nameEl, userEl, emailEl, pwEl].forEach(el => { if (el) el.removeAttribute('aria-invalid'); });
      if (!payload.name || !payload.username || !payload.email || !payload.password) {
        if (nameEl && !payload.name) nameEl.setAttribute('aria-invalid', 'true');
        if (userEl && !payload.username) userEl.setAttribute('aria-invalid', 'true');
        if (emailEl && !payload.email) emailEl.setAttribute('aria-invalid', 'true');
        if (pwEl && !payload.password) pwEl.setAttribute('aria-invalid', 'true');
        if (window.Sounds) Sounds.play('error');
        return Toast.show('املأ جميع الحقول', 'warning');
      }
      if (agreeEl && !agreeEl.checked) {
        if (window.Sounds) Sounds.play('error');
        return Toast.show('وافق على الشروط أولاً', 'warning');
      }
      btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
      try {
        const user = await API.post('/api/auth/register', payload);
        S.me = user; window.__ME__ = user;
        this.afterLogin(user);
        Toast.show('أهلاً بك في خَيال', 'success');
      } catch (err) {
        if (userEl) userEl.setAttribute('aria-invalid', 'true');
        if (emailEl) emailEl.setAttribute('aria-invalid', 'true');
        if (window.Sounds) Sounds.play('error');
        Toast.show(err.message, 'error');
      } finally { btn.removeAttribute('aria-busy'); btn.disabled = false; }
    },
    afterLogin(user) {
      this.close();
      this.updateChrome(user);
      App.showApp();
      App.switchTab('home');
      if (window.Sounds) Sounds.play('success');
      if (window.NotificationsLoader) NotificationsLoader.start();
    },
    forgot(e) { e.preventDefault(); Toast.show('تواصل مع الدعم لاستعادة كلمة المرور', 'info'); },
    updateChrome(user) {
      const signIn = document.getElementById('signInBtn');
      const avatarBtn = document.getElementById('avatarBtn');
      const avatarImg = document.getElementById('avatarImg');
      if (signIn) signIn.hidden = !!user;
      if (avatarBtn) avatarBtn.hidden = !user;
      if (avatarImg && user) { U.safeAvatar(avatarImg, user.avatar); avatarImg.alt = user.name || ''; }
      const dock = document.getElementById('dock');
      if (dock) dock.hidden = !user;
      const ca = document.getElementById('composerAvatar');
      if (ca && user) U.safeAvatar(ca, user.avatar);
    },
    logout() {
      API.post('/api/auth/logout').then(() => {
        S.me = null; window.__ME__ = null;
        if (window.NotificationsLoader) NotificationsLoader.stop();
        this.updateChrome(null);
        App.showLanding();
        Toast.show('تم تسجيل الخروج', 'info');
      }).catch(() => Toast.show('تعذّر تسجيل الخروج', 'error'));
    },
  };

  /* ═══════════ POST ═══════════ */
  const Post = {
    _extractImages(p) {
      if (Array.isArray(p.images) && p.images.length) {
        const clean = p.images.filter(U.isUrl);
        if (clean.length) return clean;
      }
      if (p.image && U.isUrl(p.image)) return [p.image];
      return [];
    },

    renderCard(p) {
      const a = p.author_data || {};
      const liked = !!p.liked;
      const saved = !!p.saved;
      const images = this._extractImages(p);
      const image = images[0] || 'https://placehold.co/800x600/0E0E14/22D3EE?text=خَيال';
      const tags = Array.isArray(p.tags) ? p.tags : [];
      const model = p.model || '';
      const isOwner = !!p.is_owner;

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
               loading="lazy" data-state="loading"
               data-action="open-post-view">
          ${model ? `<span class="prompt-model"><i class="ph ph-sparkle" aria-hidden="true"></i>${U.escapeHtml(model)}</span>` : ''}
          <div class="prompt-floats">
            <button class="float-btn" data-action="like" aria-pressed="${liked}" aria-label="إعجاب" type="button">
              <i class="ph ph-heart" aria-hidden="true"></i>
            </button>
            <button class="float-btn" data-action="save" aria-pressed="${saved}" aria-label="حفظ" type="button">
              <i class="ph ph-bookmark-simple" aria-hidden="true"></i>
            </button>
            <div class="prompt-menu-wrap">
              <button class="float-btn prompt-menu-btn" data-action="menu" aria-label="المزيد" aria-haspopup="true" aria-expanded="false" type="button">
                <i class="ph ph-dots-three" aria-hidden="true"></i>
              </button>
              <div class="prompt-menu" role="menu" hidden>
                <button role="menuitem" type="button" data-action="share"><i class="ph ph-share-network"></i><span>مشاركة</span></button>
                <button role="menuitem" type="button" data-action="copy"><i class="ph ph-copy"></i><span>نسخ البرومبت</span></button>
                ${isOwner ? `
                <button role="menuitem" type="button" data-action="edit"><i class="ph ph-pencil-simple"></i><span>تعديل</span></button>
                <button role="menuitem" type="button" class="menu-danger" data-action="delete"><i class="ph ph-trash"></i><span>حذف</span></button>` : ''}
                <button role="menuitem" type="button" data-action="report"><i class="ph ph-flag"></i><span>إبلاغ</span></button>
              </div>
            </div>
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
            <button type="button" class="prompt-excerpt-copy" aria-label="نسخ"><i class="ph ph-copy"></i></button>
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
      if (img.complete) img.dataset.state = 'loaded';

      card.addEventListener('click', (e) => this.onCardClick(e, card, p));
      return card;
    },

    onCardClick(e, card, p) {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === 'like') { e.stopPropagation(); this.like(btn, p.id); return; }
      if (action === 'save') { e.stopPropagation(); this.save(btn, p.id); return; }
      if (action === 'copy' || action === 'copy-excerpt') { e.stopPropagation(); this.copy(p.id, btn); return; }
      if (action === 'comments') { e.stopPropagation(); Drawers.openComments(p.id); return; }
      if (action === 'open-author') {
        e.stopPropagation();
        const aid = btn.dataset.authorId || (p.author_data && p.author_data.id) || p.author;
        if (aid) ProfileView.open(parseInt(aid, 10));
        return;
      }
      if (action === 'open-post-view') {
        e.stopPropagation();
        PostView.open(p.id);
        return;
      }
      if (action === 'menu') { e.stopPropagation(); this.toggleMenu(btn, e); return; }
      if (action === 'share') { e.stopPropagation(); this.share(p.id); return; }
      if (action === 'edit') { e.stopPropagation(); this.edit(p.id); return; }
      if (action === 'delete') { e.stopPropagation(); this.delete(p.id); return; }
      if (action === 'report') { e.stopPropagation(); this.report(p.id); return; }
    },

    async like(btn, id) {
      if (!S.me) { Auth.open('login'); return; }
      const currently = btn.getAttribute('aria-pressed') === 'true';
      const next = !currently;
      document.querySelectorAll(`[data-post-id="${id}"] [data-action="like"]`).forEach(b => b.setAttribute('aria-pressed', String(next)));
      try {
        const res = await API.post(`/api/posts/${id}/like`);
        const liked = !!res.liked;
        document.querySelectorAll(`[data-post-id="${id}"] [data-action="like"]`).forEach(b => b.setAttribute('aria-pressed', String(liked)));
        document.querySelectorAll(`[data-post-id="${id}"] [data-count="likes"]`).forEach(el => el.textContent = U.formatNumber(res.likes));
        if (window.Sounds) Sounds.play('like');
      } catch (err) {
        document.querySelectorAll(`[data-post-id="${id}"] [data-action="like"]`).forEach(b => b.setAttribute('aria-pressed', String(currently)));
        Toast.show(err.message || 'تعذّر الإعجاب', 'error');
      }
    },

    async save(btn, id) {
      if (!S.me) { Auth.open('login'); return; }
      const currently = btn.getAttribute('aria-pressed') === 'true';
      const next = !currently;
      document.querySelectorAll(`[data-post-id="${id}"] [data-action="save"]`).forEach(b => b.setAttribute('aria-pressed', String(next)));
      try {
        const res = await API.post(`/api/posts/${id}/save`);
        const saved = !!res.saved;
        document.querySelectorAll(`[data-post-id="${id}"] [data-action="save"]`).forEach(b => b.setAttribute('aria-pressed', String(saved)));
        Toast.show(saved ? 'تم الحفظ' : 'أُزيل من المحفوظة', 'success', 1800);
        if (saved && S.feeds.saved) S.feeds.saved.loaded = false;
      } catch (err) {
        document.querySelectorAll(`[data-post-id="${id}"] [data-action="save"]`).forEach(b => b.setAttribute('aria-pressed', String(currently)));
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
        try { const p = await API.get(`/api/posts/${id}`); text = p.prompt || ''; } catch (e) {}
      }
      const ok = await U.copy(text);
      if (ok) {
        if (window.Sounds) Sounds.play('copy');
        Toast.show('تم النسخ', 'success', 1600);
        API.post(`/api/posts/${id}/copy`).catch(() => {});
      } else { Toast.show('تعذّر النسخ', 'error'); }
    },

    toggleMenu(btn, e) {
      if (e) e.stopPropagation();
      const wrap = btn.closest('.prompt-menu-wrap');
      if (!wrap) return;
      const menu = wrap.querySelector('.prompt-menu');
      if (!menu) return;
      const isOpen = !menu.hidden;
      document.querySelectorAll('.prompt-menu').forEach(m => {
        m.hidden = true;
        const b = m.closest('.prompt-menu-wrap')?.querySelector('.prompt-menu-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
      if (!isOpen) { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
    },

    closeAllMenus() {
      document.querySelectorAll('.prompt-menu').forEach(m => {
        m.hidden = true;
        const b = m.closest('.prompt-menu-wrap')?.querySelector('.prompt-menu-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
    },

    share(id) {
      const url = `${location.origin}/?p=${id}`;
      if (navigator.share) navigator.share({ title: 'برومبت من خَيال', url }).catch(() => {});
      else navigator.clipboard.writeText(url).then(() => Toast.show('تم نسخ الرابط', 'success')).catch(() => Toast.show('تعذّر النسخ', 'error'));
      this.closeAllMenus();
    },

    edit(id) { this.closeAllMenus(); Composer.openEdit(parseInt(id, 10)); },

    async delete(id) {
      this.closeAllMenus();
      if (!S.me) { Auth.open('login'); return; }
      const ok = await ConfirmModal.show({
        title: 'حذف المنشور',
        message: 'سيُحذف المنشور نهائياً. لا يمكن التراجع عن هذا الإجراء.',
        confirmLabel: 'حذف', cancelLabel: 'بقاء', danger: true,
      });
      if (!ok) return;
      try {
        await API.del(`/api/posts/${id}`);
        const card = document.querySelector(`[data-post-id="${id}"]`);
        if (card) {
          card.style.transition = 'opacity .3s, transform .3s';
          card.style.opacity = '0';
          card.style.transform = 'scale(.95)';
          setTimeout(() => card.remove(), 300);
        }
        Toast.show('تم الحذف', 'success');
        if (window.Sounds) Sounds.play('success');
        Object.keys(S.feeds || {}).forEach(k => { if (S.feeds[k]) S.feeds[k].loaded = false; });
      } catch (err) { Toast.show(err.message || 'تعذّر الحذف', 'error'); }
    },

    async report(id) {
      this.closeAllMenus();
      if (!S.me) { Auth.open('login'); return; }
      const result = await ReportModal.show(id);
      if (!result) return;
      try {
        await API.post(`/api/posts/${id}/report`, { reason: result.reason, note: result.note });
        Toast.show('تم إرسال البلاغ، شكراً لك', 'success', 2600);
        if (window.Sounds) Sounds.play('success');
      } catch (err) { Toast.show(err.message || 'تعذّر إرسال البلاغ', 'error'); }
    },
  };
/* ═══════════ FEED ═══════════ */
const Feed = {
  container(name) {
    const map = { home: 'homeFeed', explore: 'exploreFeed', liked: 'likedFeed', saved: 'savedFeed', profile: 'profilePanel' };
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
    if (opts.reset !== false) { fs.items = []; fs.before = null; fs.hasMore = true; fs.loaded = false; }
    if (fs.items.length === 0) { container.innerHTML = this.skeletonsHtml(); container.setAttribute('aria-busy', 'true'); }
    fs.busy = true;
    if (fs.controller) fs.controller.abort();
    fs.controller = new AbortController();
    const params = new URLSearchParams();
    if (name === 'home' || name === 'explore') {
      params.set('sort', S.sort);
      if (S.filterTag) params.set('tag', S.filterTag);
      if (S.filterModel) params.set('model', S.filterModel);
    }
    params.set('limit', String(CFG.PAGE_SIZE));
    if (fs.before) params.set('before_id', String(fs.before));
    try {
      const items = await API.get('/api/posts?' + params.toString(), { signal: fs.controller.signal });
      const list = Array.isArray(items) ? items : [];
      if (list.length === 0 && fs.items.length === 0) {
        this.showEmpty(name); fs.hasMore = false; fs.loaded = true; return;
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
        container.innerHTML = this.emptyHtml('ph-cloud-slash', 'تعذّر التحميل', err.message || 'حاول مرة أخرى');
      } else Toast.show(err.message || 'تعذّر تحميل المزيد', 'error');
    } finally {
      fs.busy = false;
      container.setAttribute('aria-busy', 'false');
    }
  },
  showEmpty(name) {
    const c = this.container(name);
    if (!c) return;
    const map = {
      home: ['ph-image-square', 'لا توجد برومبتات', 'كن أول من ينشر.'],
      explore: ['ph-compass', 'لا شيء هنا', 'جرّب تصفية أخرى.'],
      liked: ['ph-heart', 'لا توجد إعجابات بعد', 'ابدأ بتصفح المنصة وضع قلبك على ما يعجبك.'],
      saved: ['ph-bookmark-simple', 'المكتبة فارغة', 'احفظ البرومبتات المميزة للرجوع إليها لاحقاً.'],
      profile: ['ph-image-square', 'لا منشورات', 'لم ينشر هذا المستخدم بعد.'],
    };
    const [icon, title, msg] = map[name] || ['ph-info', 'لا يوجد شيء', ''];
    c.innerHTML = this.emptyHtml(icon, title, msg);
  },
  async loadMore(name) {
    const fs = feedState(name);
    if (fs.busy || !fs.hasMore) return;
    await this.load(name, { reset: false });
  },
  reset(name) {
    const fs = feedState(name);
    fs.items = []; fs.before = null; fs.hasMore = true; fs.loaded = false;
  },
};

/* ═══════════ COMMENTS ═══════════ */
const Comments = {
  currentPostId: null,
  async load(postId) {
    const body = document.getElementById('commentsBody');
    const form = document.getElementById('commentForm');
    const countEl = document.getElementById('commentCount');
    if (!body) return;
    body.innerHTML = '<div class="load-more"><div class="spinner"></div></div>';
    if (form) form.style.display = S.me ? 'flex' : 'none';
    try {
      const items = await API.get(`/api/posts/${postId}/comments`);
      if (!items || items.length === 0) {
        body.innerHTML = '<div class="empty-block"><i class="ph ph-chat-circle-dots"></i><h4>لا تعليقات بعد</h4><p>كن أول المعلّقين.</p></div>';
        if (countEl) countEl.textContent = '';
        return;
      }
      if (countEl) countEl.textContent = '(' + items.length + ')';
      body.innerHTML = items.map(c => this.rowHtml(c)).join('');
    } catch (err) {
      body.innerHTML = `<div class="empty-block"><i class="ph ph-warning-circle"></i><h4>تعذّر التحميل</h4><p>${U.escapeHtml(err.message)}</p></div>`;
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
        ${mine ? `<div class="comment-actions"><button type="button" data-action="delete-comment" data-comment-id="${c.id}"><i class="ph ph-trash"></i> حذف</button></div>` : ''}
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
      input.value = ''; U.autoGrow(input);
      if (window.Sounds) Sounds.play('send');
      const body = document.getElementById('commentsBody');
      if (body) {
        const empty = body.querySelector('.empty-block');
        if (empty) empty.remove();
        body.insertAdjacentHTML('afterbegin', this.rowHtml(c));
        const countEl = document.getElementById('commentCount');
        if (countEl) countEl.textContent = '(' + body.querySelectorAll('.comment').length + ')';
      }
    } catch (err) { Toast.show(err.message || 'تعذّر الإرسال', 'error'); }
    finally { input.disabled = false; input.focus(); }
  },
  async delete(id) {
    const ok = await ConfirmModal.show({
      title: 'حذف التعليق', message: 'سيُحذف التعليق نهائياً.',
      confirmLabel: 'حذف', danger: true,
    });
    if (!ok) return;
    try {
      await API.del(`/api/comments/${id}`);
      const row = document.querySelector(`.comment[data-comment-id="${id}"]`);
      if (row) row.remove();
      Toast.show('تم الحذف', 'success', 1500);
    } catch (err) { Toast.show(err.message || 'تعذّر الحذف', 'error'); }
  },
  init() {
    document.addEventListener('click', (e) => {
      const del = e.target.closest('[data-action="delete-comment"]');
      if (del) this.delete(parseInt(del.dataset.commentId, 10));
    });
  },
};

/* ═══════════ DRAWERS ═══════════ */
const Drawers = {
  openComments(postId) {
    this.closeNotifications(); this.closeFollowers();
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
    const s = document.getElementById('commentsScrim');
    const d = document.getElementById('commentsDrawer');
    if (s) s.setAttribute('data-open', 'false');
    if (d) d.setAttribute('data-open', 'false');
    document.documentElement.style.overflow = '';
  },
  openNotifications() {
    this.closeComments(); this.closeFollowers();
    const scrim = document.getElementById('notificationsScrim');
    const drawer = document.getElementById('notificationsDrawer');
    if (!scrim || !drawer) return;
    scrim.setAttribute('data-open', 'true');
    drawer.setAttribute('data-open', 'true');
    document.documentElement.style.overflow = 'hidden';
    NotificationsLoader.load();
    if (window.Sounds) Sounds.play('open');
  },
  closeNotifications() {
    const s = document.getElementById('notificationsScrim');
    const d = document.getElementById('notificationsDrawer');
    if (s) s.setAttribute('data-open', 'false');
    if (d) d.setAttribute('data-open', 'false');
    document.documentElement.style.overflow = '';
  },
  openFollowers(userId, type) {
    this.closeComments(); this.closeNotifications();
    FollowersDrawer.open(userId, type);
  },
  closeFollowers() { FollowersDrawer.close(); },
  closeAll() { this.closeComments(); this.closeNotifications(); this.closeFollowers(); },
};

/* ═══════════ FOLLOWERS DRAWER ═══════════ */
const FollowersDrawer = {
  userId: null, type: 'followers', before: null, hasMore: true, busy: false,
  open(userId, type) {
    if (!userId) return;
    this.userId = userId;
    this.type = type === 'following' ? 'following' : 'followers';
    this.before = null; this.hasMore = true; this.busy = false;
    const scrim = document.getElementById('followersScrim');
    const drawer = document.getElementById('followersDrawer');
    const title = document.getElementById('followersTitle');
    if (!scrim || !drawer) return;
    if (title) title.textContent = this.type === 'following' ? 'يتابع' : 'المتابعون';
    scrim.setAttribute('data-open', 'true');
    drawer.setAttribute('data-open', 'true');
    document.documentElement.style.overflow = 'hidden';
    if (window.Sounds) Sounds.play('open');
    this.load();
  },
  close() {
    const s = document.getElementById('followersScrim');
    const d = document.getElementById('followersDrawer');
    if (s) s.setAttribute('data-open', 'false');
    if (d) d.setAttribute('data-open', 'false');
    document.documentElement.style.overflow = '';
  },
  async load() {
    const body = document.getElementById('followersBody');
    if (!body || !this.userId || this.busy) return;
    this.busy = true;
    const isFirst = !this.before;
    if (isFirst) body.innerHTML = '<div class="load-more"><div class="spinner"></div></div>';
    const path = `/api/users/${this.userId}/${this.type}?limit=30${this.before ? '&before_id=' + this.before : ''}`;
    try {
      const data = await API.get(path);
      const items = (data && data.items) || [];
      this.hasMore = !!data.next_before;
      this.before = data.next_before;
      if (isFirst) {
        if (!items.length) {
          body.innerHTML = `<div class="empty-block">
            <i class="ph ph-users"></i>
            <h4>${this.type === 'following' ? 'لا يتابع أحداً' : 'لا متابعين بعد'}</h4>
            <p>${this.type === 'following' ? 'عندما يتابع هذا المستخدم شخصاً سيظهر هنا.' : 'كن أول من يتابع هذا المستخدم.'}</p>
          </div>`;
          return;
        }
        body.innerHTML = '';
      }
      const frag = document.createDocumentFragment();
      items.forEach(u => frag.appendChild(this.rowHtml(u)));
      body.appendChild(frag);
      if (this.hasMore) {
        const existing = body.querySelector('[data-load-more]');
        if (existing) existing.remove();
        const lm = document.createElement('button');
        lm.className = 'load-more-btn';
        lm.setAttribute('data-load-more', 'true');
        lm.type = 'button';
        lm.innerHTML = '<span>تحميل المزيد</span><i class="ph ph-arrow-down"></i>';
        lm.addEventListener('click', () => this.load());
        body.appendChild(lm);
      }
    } catch (err) {
      if (isFirst) {
        body.innerHTML = `<div class="empty-block"><i class="ph ph-warning-circle"></i><h4>تعذّر التحميل</h4><p>${U.escapeHtml(err.message)}</p></div>`;
      } else Toast.show(err.message || 'تعذّر التحميل', 'error');
    } finally { this.busy = false; }
  },
  rowHtml(u) {
    const isMe = S.me && S.me.id === u.id;
    return `<div class="follower-row" data-user-id="${u.id}">
      <img class="follower-row-avatar" src="${U.escapeHtml(u.avatar || '')}" alt="" loading="lazy">
      <div class="follower-row-info">
        <div class="follower-row-name">
          ${U.escapeHtml(u.name || '')}
          ${u.verified ? '<i class="ph ph-seal-check" aria-hidden="true"></i>' : ''}
        </div>
        <div class="follower-row-handle">${U.escapeHtml(u.handle || '')}</div>
      </div>
      ${!isMe ? `<button class="btn btn-sm follower-row-btn ${u.is_following ? 'btn-secondary' : 'btn-primary'}" data-follow-user="${u.id}" type="button">
        ${u.is_following ? 'أتابعه' : 'متابعة'}
      </button>` : ''}
    </div>`;
  },
  init() {
    document.addEventListener('click', async (e) => {
      const row = e.target.closest('.follower-row');
      const btn = e.target.closest('[data-follow-user]');
      if (btn) {
        e.stopPropagation();
        const uid = parseInt(btn.dataset.followUser, 10);
        if (!uid) return;
        btn.setAttribute('aria-busy', 'true');
        try {
          const res = await API.post(`/api/users/${uid}/follow`);
          const following = !!res.following;
          btn.classList.toggle('btn-primary', !following);
          btn.classList.toggle('btn-secondary', following);
          btn.textContent = following ? 'أتابعه' : 'متابعة';
          if (window.Sounds) Sounds.play(following ? 'success' : 'tab');
        } catch (err) { Toast.show(err.message || 'تعذّر', 'error'); }
        finally { btn.removeAttribute('aria-busy'); }
        return;
      }
      if (row) {
        const uid = parseInt(row.dataset.userId, 10);
        if (!uid) return;
        this.close();
        setTimeout(() => ProfileView.open(uid), 200);
      }
    });
  },
};

/* ═══════════ NOTIFICATIONS ═══════════ */
const NotificationsLoader = {
  _interval: null, unread: 0,
  start() {
    if (!S.me) return;
    this.refresh();
    this._interval = setInterval(() => this.refresh(), CFG.NOTIF_POLL_MS);
  },
  stop() {
    if (this._interval) clearInterval(this._interval);
    this._interval = null;
    this.setBadge(0);
  },
  async refresh() {
    if (!S.me) return;
    try {
      const data = await API.get('/api/notifications/unread-count');
      this.setBadge((data && data.count) || 0);
    } catch (e) {}
  },
  setBadge(n) {
    this.unread = n;
    [document.getElementById('dockNotifBadge'), document.getElementById('navNotifBadge')].forEach(b => {
      if (!b) return;
      if (n > 0) { b.textContent = n > 99 ? '99+' : String(n); b.hidden = false; }
      else b.hidden = true;
    });
  },
  async load() {
    const body = document.getElementById('notificationsBody');
    if (!body || !S.me) return;
    body.innerHTML = '<div class="load-more"><div class="spinner"></div></div>';
    try {
      const data = await API.get('/api/notifications?limit=30');
      const items = (data && data.items) || [];
      this.setBadge((data && data.unread) || 0);
      if (!items.length) {
        body.innerHTML = '<div class="empty-block"><i class="ph ph-bell"></i><h4>لا إشعارات بعد</h4><p>ستظهر هنا التفاعلات التي تهمّك.</p></div>';
        return;
      }
      body.innerHTML = items.map(n => this.rowHtml(n)).join('');
      setTimeout(() => { API.post('/api/notifications/read-all').then(() => this.setBadge(0)).catch(() => {}); }, 800);
    } catch (err) {
      body.innerHTML = `<div class="empty-block"><i class="ph ph-warning-circle"></i><h4>تعذّر التحميل</h4><p>${U.escapeHtml(err.message)}</p></div>`;
    }
  },
  rowHtml(n) {
    const a = n.actor || {};
    const icons = { like: 'ph-heart-fill', comment: 'ph-chat-circle-fill', follow: 'ph-user-plus-fill', message: 'ph-chat-teardrop-fill' };
    const icon = icons[n.kind] || 'ph-bell';
    const color = n.kind || 'info';
    return `<button class="notif-row ${n.read ? 'is-read' : 'is-unread'}" data-notif-id="${n.id}" data-kind="${n.kind}" data-target-id="${n.target_id || ''}" data-actor-id="${a.id || ''}" type="button">
      <span class="notif-avatar-wrap">
        <img class="notif-avatar" src="${U.escapeHtml(a.avatar || '')}" alt="" loading="lazy">
        <span class="notif-icon notif-icon--${color}"><i class="ph ${icon}" aria-hidden="true"></i></span>
      </span>
      <span class="notif-body">
        <span class="notif-text">${U.escapeHtml(a.name || 'مستخدم')} · ${U.escapeHtml(n.text || '')}</span>
        <span class="notif-time">${U.relativeTime(n.created_at)}</span>
      </span>
      ${!n.read ? '<span class="notif-dot" aria-hidden="true"></span>' : ''}
    </button>`;
  },
  init() {
    document.addEventListener('click', (e) => {
      const row = e.target.closest('.notif-row');
      if (!row) return;
      const kind = row.dataset.kind;
      const targetId = parseInt(row.dataset.targetId, 10);
      const actorId = parseInt(row.dataset.actorId, 10);
      Drawers.closeNotifications();
      if (kind === 'follow' && actorId) setTimeout(() => ProfileView.open(actorId), 220);
      else if ((kind === 'like' || kind === 'comment') && targetId) {
        setTimeout(() => PostView.open(targetId), 260);
      } else if (kind === 'message' && actorId) Chat.openWith(actorId);
    });
  },
};

/* ═══════════ COMPOSER ═══════════ */
const Composer = {
  type: 'text',
  editingId: null,

  open() {
    if (!S.me) { Auth.open('login'); return; }
    const view = document.getElementById('composerView');
    if (!view) { console.error('[خَيال] #composerView غير موجود'); Toast.show('صفحة النشر غير متوفرة', 'error'); return; }
    this.editingId = null;
    this._resetFormUI();
    const av = document.getElementById('composerFormAvatar');
    if (av) U.safeAvatar(av, S.me.avatar);
    const name = document.getElementById('composerUserName');
    if (name) name.textContent = S.me.name || '—';
    this.restoreDraft();
    view.hidden = false;
    document.body.classList.add('view-open');
    if (window.Sounds) Sounds.play('open');
  },

  async openEdit(postId) {
    if (!S.me) { Auth.open('login'); return; }
    if (!postId) return;
    const view = document.getElementById('composerView');
    if (!view) return;
    try {
      const post = await API.get(`/api/posts/${postId}`);
      if (!post.is_owner) { Toast.show('لا تملك صلاحية التعديل', 'error'); return; }
      this.editingId = postId;
      this._fillForm(post);
      this._setEditUI(true);
      const av = document.getElementById('composerFormAvatar');
      if (av) U.safeAvatar(av, S.me.avatar);
      const name = document.getElementById('composerUserName');
      if (name) name.textContent = S.me.name || '—';
      view.hidden = false;
      document.body.classList.add('view-open');
      document.body.classList.add('composer-editing');
      if (window.Sounds) Sounds.play('open');
    } catch (err) { Toast.show(err.message || 'تعذّر تحميل المنشور', 'error'); }
  },

  _fillForm(post) {
    const el = (id) => document.getElementById(id);
    if (el('cTitle')) el('cTitle').value = post.title || '';
    if (el('cPrompt')) el('cPrompt').value = post.prompt || '';
    if (el('cImage')) el('cImage').value = post.image || '';
    if (el('cModel') && post.model) el('cModel').value = post.model;
    if (el('cTags')) el('cTags').value = (post.tags || []).join('، ');
    if (post.image) this.previewImage(post.image);
    this.chooseType(post.image ? 'prompt' : 'text');
  },

  _setEditUI(isEdit) {
    const head = document.querySelector('#composerView .view-overlay-head h2');
    if (head) head.textContent = isEdit ? 'تعديل المنشور' : 'منشور جديد';
    const btn = document.getElementById('composerSubmit');
    if (btn) {
      btn.innerHTML = isEdit
        ? '<i class="ph ph-check" aria-hidden="true"></i><span>حفظ</span>'
        : '<i class="ph ph-paper-plane-tilt" aria-hidden="true"></i><span>نشر</span>';
    }
  },

  _resetFormUI() {
    const form = document.getElementById('composerForm');
    if (form) form.reset();
    this.clearPreview();
    this.chooseType('text');
    this._setEditUI(false);
    document.body.classList.remove('composer-editing');
  },

  close() {
    const view = document.getElementById('composerView');
    if (!view) return;
    if (!this.editingId) this.saveDraft();
    view.hidden = true;
    document.body.classList.remove('view-open');
    document.body.classList.remove('composer-editing');
    this.editingId = null;
    if (window.Sounds) Sounds.play('close');
  },

  saveDraft() {
    if (!S.me || this.editingId) return;
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

  clearDraft() { try { localStorage.removeItem(CFG.DRAFT_KEY); } catch (e) {} },

  chooseType(type) {
    this.type = type;
    const switchEl = document.querySelector('.type-switch');
    if (switchEl) {
      switchEl.querySelectorAll('.type-pill').forEach(b => b.setAttribute('aria-selected', b.dataset.type === type ? 'true' : 'false'));
    }
    const imageField = document.getElementById('imageField');
    if (imageField) imageField.hidden = type !== 'prompt';
    if (window.Sounds) Sounds.play('toggle');
  },

  previewImage(url) {
    const wrap = document.getElementById('imgPreview');
    const img = document.getElementById('imgPreviewEl');
    if (!wrap || !img) return;
    if (url && /^https?:\/\//i.test(url)) { img.src = url; wrap.hidden = false; }
    else { wrap.hidden = true; }
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

    const tags = tagsRaw ? tagsRaw.split(/[,،]/).map(t => t.trim()).filter(Boolean) : [];

    const btn = document.getElementById('composerSubmit');
    if (btn) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true; }

    const payload = { title, prompt, image: image || null, model: model || null, tags };

    try {
      if (this.editingId) {
        const updated = await API.patch(`/api/posts/${this.editingId}`, payload);
        const card = document.querySelector(`[data-post-id="${this.editingId}"]`);
        if (card && updated) card.replaceWith(Post.renderCard(updated));
        // إن كانت PostView مفتوحة على نفس المنشور، حدّثها
        if (PostView.current && PostView.current.id === this.editingId) {
          PostView.current = Object.assign(PostView.current, updated);
        }
        Toast.show('تم حفظ التعديلات', 'success');
      } else {
        const post = await API.post('/api/posts', payload);
        const homeEl = document.getElementById('homeFeed');
        if (homeEl && post) {
          const empty = homeEl.querySelector('.empty-block');
          if (empty) empty.remove();
          homeEl.insertBefore(Post.renderCard(post), homeEl.firstChild);
        }
        this.clearDraft();
        Toast.show('تم النشر', 'success');
      }
      this.close();
      if (window.Sounds) Sounds.play('success');
    } catch (err) {
      if (window.Sounds) Sounds.play('error');
      Toast.show(err.message || 'تعذّر', 'error');
    } finally {
      if (btn) { btn.removeAttribute('aria-busy'); btn.disabled = false; }
    }
  },

  init() {
    document.querySelectorAll('.type-pill').forEach(btn => btn.addEventListener('click', () => this.chooseType(btn.dataset.type)));
    ['cTitle', 'cPrompt', 'cImage', 'cTags'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', U.debounce(() => this.saveDraft(), 1500));
    });
  },
};

/* ═══════════ CHAT ═══════════ */
const Chat = {
  allChats: [],
  async loadList() {
    const list = document.getElementById('chatList');
    if (!list || !S.me) return;
    list.innerHTML = '<div class="load-more"><div class="spinner"></div></div>';
    try {
      const chats = await API.get('/api/chats');
      this.allChats = chats || [];
      if (!this.allChats.length) {
        list.innerHTML = '<div class="empty-block"><i class="ph ph-chat-circle-dots"></i><h4>لا محادثات</h4><p>ابدأ محادثة جديدة من ملف أي مستخدم.</p></div>';
        return;
      }
      list.innerHTML = this.allChats.map(c => this.rowHtml(c)).join('');
      this.bindRows();
    } catch (err) {
      list.innerHTML = `<div class="empty-block"><i class="ph ph-warning-circle"></i><h4>تعذّر التحميل</h4><p>${U.escapeHtml(err.message)}</p></div>`;
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
    document.querySelectorAll('.chat-item').forEach(row => row.addEventListener('click', () => this.openThread(parseInt(row.dataset.chatId, 10))));
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
    if (body) body.innerHTML = '<div class="load-more"><div class="spinner"></div></div>';
    if (composer) composer.style.display = 'flex';
    document.querySelectorAll('.chat-item').forEach(r => r.setAttribute('aria-current', r.dataset.chatId === String(chatId) ? 'true' : 'false'));
    try {
      const msgs = await API.get(`/api/chats/${chatId}/messages`);
      if (!msgs || !msgs.length) body.innerHTML = '<div class="empty-block"><i class="ph ph-chat-circle-dots"></i><h4>ابدأ المحادثة</h4><p>أرسل أول رسالة.</p></div>';
      else { body.innerHTML = msgs.map(m => this.msgHtml(m)).join(''); body.scrollTop = body.scrollHeight; }
    } catch (err) {
      body.innerHTML = `<div class="empty-block"><i class="ph ph-warning-circle"></i><h4>تعذّر التحميل</h4><p>${U.escapeHtml(err.message)}</p></div>`;
    }
  },
  msgHtml(m) {
    return `<div class="msg ${m.from === 'me' ? 'msg-me' : 'msg-them'}">${U.escapeHtml(m.text)}<span class="msg-time">${U.escapeHtml(m.time || '')}</span></div>`;
  },
  async send(ev) {
    ev.preventDefault();
    if (!S.me || !S.openChatId) return;
    const input = document.getElementById('chatInput');
    const body = document.getElementById('chatBody');
    if (!input || !body) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = ''; U.autoGrow(input);
    const empty = body.querySelector('.empty-block'); if (empty) empty.remove();
    body.insertAdjacentHTML('beforeend', this.msgHtml({ from: 'me', text, time: 'الآن' }));
    body.scrollTop = body.scrollHeight;
    if (window.Sounds) Sounds.play('send');
    try { await API.post(`/api/chats/${this.openChatId}/messages`, { text }); }
    catch (err) { Toast.show(err.message || 'تعذّر الإرسال', 'error'); }
  },
  filterList(q) {
    const query = (q || '').trim().toLowerCase();
    document.querySelectorAll('.chat-item').forEach(row => {
      const name = (row.querySelector('.chat-item-name') || {}).textContent || '';
      row.style.display = !query || name.toLowerCase().includes(query) ? '' : 'none';
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
    } catch (err) { Toast.show(err.message || 'تعذّر فتح المحادثة', 'error'); }
  },
};

/* ═══════════ POST VIEW (Overlay) ═══════════ */
const PostView = {
  current: null,
  _scrollBound: false,

  async open(postId) {
    if (!postId) return;
    const view = document.getElementById('postView');
    if (!view) { console.error('[PostView] #postView مفقود'); return; }

    const skeleton = document.getElementById('postViewSkeleton');
    const content = document.getElementById('postViewContent');
    if (skeleton) skeleton.hidden = false;
    if (content) content.hidden = true;

    view.hidden = false;
    document.body.classList.add('view-open');
    document.documentElement.style.overflow = 'hidden';
    if (window.Sounds) Sounds.play('open');

    try {
      const post = await API.get('/api/posts/' + postId);
      this.current = post;
      this._render(post);
      if (skeleton) skeleton.hidden = true;
      if (content) content.hidden = false;
      const body = document.querySelector('.pv2-body');
      if (body) body.scrollTop = 0;
    } catch (err) {
      Toast.show(err.message || 'تعذّر تحميل المنشور', 'error');
      this.close();
    }
  },

  close() {
    const view = document.getElementById('postView');
    if (!view) return;
    view.hidden = true;
    document.body.classList.remove('view-open');
    document.documentElement.style.overflow = '';
    this.current = null;
    if (window.Sounds) Sounds.play('close');

    // إزالة ?p= من الرابط
    if (location.search.includes('p=')) {
      const params = new URLSearchParams(location.search);
      params.delete('p');
      const qs = params.toString();
      const url = location.pathname + (qs ? '?' + qs : '');
      history.replaceState({}, '', url || location.pathname);
    }
  },

  _render(p) {
    const isMe = S.me && S.me.id === p.author;
    const a = p.author_data || {};

    /* Image */
    const images = Post._extractImages(p);
    const media = document.getElementById('pv2Media');
    const img = document.getElementById('pv2Image');
    if (img) {
      if (images.length) {
        img.src = images[0];
        img.alt = p.title || '';
        img.onerror = function () { if (media) media.hidden = true; };
        img.onload = function () { if (media) media.hidden = false; };
        if (media) media.hidden = false;
      } else {
        if (media) media.hidden = true;
      }
    }

    /* Meta */
    const modelEl = document.getElementById('pv2Model');
    if (modelEl) {
      if (p.model) {
        modelEl.innerHTML = '<i class="ph ph-sparkle" aria-hidden="true"></i>' + U.escapeHtml(p.model);
        modelEl.hidden = false;
      } else modelEl.hidden = true;
    }
    const timeEl = document.getElementById('pv2Time');
    if (timeEl) timeEl.textContent = U.relativeTime(p.time);

    /* Title */
    const title = document.getElementById('pv2Title');
    if (title) title.textContent = p.title || '—';

    /* Author */
    const avatar = document.getElementById('pv2AuthorAvatar');
    if (avatar) U.safeAvatar(avatar, a.avatar || '');
    const nameEl = document.getElementById('pv2AuthorName');
    if (nameEl) nameEl.textContent = a.name || 'مستخدم';
    const verified = document.getElementById('pv2AuthorVerified');
    if (verified) verified.hidden = !a.verified;
    const handle = document.getElementById('pv2AuthorHandle');
    if (handle) handle.textContent = a.handle || '—';
    const authorBtn = document.getElementById('pv2AuthorBtn');
    if (authorBtn) authorBtn.dataset.userId = String(a.id || '');

    const followBtn = document.getElementById('pv2AuthorFollow');
    if (followBtn) {
      if (isMe) {
        followBtn.dataset.state = 'owner';
        followBtn.hidden = true;
      } else {
        followBtn.hidden = false;
        followBtn.dataset.state = a.is_following ? 'following' : 'idle';
        followBtn.dataset.userId = String(a.id || '');
        followBtn.innerHTML = a.is_following
          ? '<i class="ph ph-check" aria-hidden="true"></i><span>أتابعه</span>'
          : '<i class="ph ph-plus" aria-hidden="true"></i><span>متابعة</span>';
      }
    }

    /* Prompt */
    const promptEl = document.getElementById('pv2Prompt');
    if (promptEl) promptEl.textContent = p.prompt || '—';

    /* Tags */
    const tagsEl = document.getElementById('pv2Tags');
    if (tagsEl) {
      const tags = Array.isArray(p.tags) ? p.tags : [];
      if (tags.length) {
        tagsEl.innerHTML = tags.map(t =>
          '<button class="tag" type="button" data-tag="' + U.escapeHtml(t) + '">' + U.escapeHtml(t) + '</button>'
        ).join('');
        tagsEl.hidden = false;
      } else tagsEl.hidden = true;
    }

    /* Actions / Stats */
    const likeBtn = document.getElementById('pv2LikeBtn');
    if (likeBtn) likeBtn.setAttribute('aria-pressed', String(!!p.liked));
    const saveBtn = document.getElementById('pv2SaveBtn');
    if (saveBtn) saveBtn.setAttribute('aria-pressed', String(!!p.saved));
    const setStat = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = U.formatNumber(v); };
    setStat('pv2StatLikes', p.likes || 0);
    setStat('pv2StatSaves', p.saves || 0);
    setStat('pv2StatCopies', p.copies || 0);

    /* Menu buttons */
    const editBtn = document.getElementById('pv2EditBtn');
    const deleteBtn = document.getElementById('pv2DeleteBtn');
    const reportBtn = document.getElementById('pv2ReportBtn');
    if (editBtn) editBtn.hidden = !isMe;
    if (deleteBtn) deleteBtn.hidden = !isMe;
    if (reportBtn) reportBtn.hidden = isMe;

    /* Comment composer visibility */
    const commentForm = document.getElementById('pv2CommentForm');
    if (commentForm) commentForm.dataset.hidden = S.me ? 'false' : 'true';
    const commentAvatar = document.getElementById('pv2CommentAvatar');
    if (commentAvatar && S.me) U.safeAvatar(commentAvatar, S.me.avatar);

    /* Load comments + related */
    this._loadComments(p.id);
    this._loadRelated(p.id);
  },

  async _loadComments(postId) {
    const list = document.getElementById('pv2CommentsList');
    const countEl = document.getElementById('pv2CommentsCount');
    if (!list) return;
    list.innerHTML = '<div class="load-more"><div class="spinner"></div></div>';
    try {
      const items = await API.get('/api/posts/' + postId + '/comments');
      if (!items || !items.length) {
        list.innerHTML = '<div class="empty-block">' +
          '<i class="ph ph-chat-circle-dots" aria-hidden="true"></i>' +
          '<h4>لا تعليقات بعد</h4>' +
          '<p>كن أول المعلّقين.</p>' +
          '</div>';
        if (countEl) countEl.textContent = '';
        return;
      }
      if (countEl) countEl.textContent = '(' + items.length + ')';
      list.innerHTML = items.map(c => Comments.rowHtml(c)).join('');
    } catch (err) {
      list.innerHTML = '<div class="empty-block">' +
        '<i class="ph ph-warning-circle" aria-hidden="true"></i>' +
        '<h4>تعذّر التحميل</h4>' +
        '<p>' + U.escapeHtml(err.message) + '</p>' +
        '</div>';
    }
  },

  async _loadRelated(postId) {
    const section = document.getElementById('pv2Related');
    const grid = document.getElementById('pv2RelatedGrid');
    if (!section || !grid) return;
    grid.innerHTML = '<div class="load-more"><div class="spinner"></div></div>';
    section.hidden = false;
    try {
      const items = await API.get('/api/posts/' + postId + '/related?limit=4');
      if (!items || !items.length) { section.hidden = true; return; }
      grid.innerHTML = '';
      const frag = document.createDocumentFragment();
      items.forEach(p => frag.appendChild(Post.renderCard(p)));
      grid.appendChild(frag);
    } catch (err) { section.hidden = true; }
  },

  async submitComment(ev) {
    ev.preventDefault();
    if (!S.me) { Auth.open('login'); return; }
    if (!this.current) return;
    const input = document.getElementById('pv2CommentInput');
    const submitBtn = document.getElementById('pv2CommentSubmit');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    if (submitBtn) submitBtn.setAttribute('aria-busy', 'true');
    try {
      const c = await API.post('/api/posts/' + this.current.id + '/comments', { text });
      input.value = '';
      U.autoGrow(input);
      if (window.Sounds) Sounds.play('send');
      const list = document.getElementById('pv2CommentsList');
      if (list) {
        const empty = list.querySelector('.empty-block');
        if (empty) empty.remove();
        list.insertAdjacentHTML('afterbegin', Comments.rowHtml(c));
        const countEl = document.getElementById('pv2CommentsCount');
        if (countEl) countEl.textContent = '(' + list.querySelectorAll('.comment').length + ')';
      }
    } catch (err) {
      Toast.show(err.message || 'تعذّر الإرسال', 'error');
    } finally {
      input.disabled = false;
      if (submitBtn) submitBtn.removeAttribute('aria-busy');
      input.focus();
    }
  },

  async toggleLike(btn) {
    if (!S.me) { Auth.open('login'); return; }
    if (!this.current) return;
    const postId = this.current.id;
    const currently = btn.getAttribute('aria-pressed') === 'true';
    const next = !currently;
    btn.setAttribute('aria-pressed', String(next));
    this.current.liked = next;
    try {
      const res = await API.post('/api/posts/' + postId + '/like');
      const liked = !!res.liked;
      btn.setAttribute('aria-pressed', String(liked));
      this.current.liked = liked;
      this.current.likes = res.likes;
      const stat = document.getElementById('pv2StatLikes');
      if (stat) stat.textContent = U.formatNumber(res.likes);
      document.querySelectorAll('[data-post-id="' + postId + '"] [data-action="like"]').forEach(b => {
        b.setAttribute('aria-pressed', String(liked));
      });
      document.querySelectorAll('[data-post-id="' + postId + '"] [data-count="likes"]').forEach(el => {
        el.textContent = U.formatNumber(res.likes);
      });
      if (window.Sounds) Sounds.play('like');
    } catch (err) {
      btn.setAttribute('aria-pressed', String(currently));
      this.current.liked = currently;
      Toast.show(err.message || 'تعذّر الإعجاب', 'error');
    }
  },

  async toggleSave(btn) {
    if (!S.me) { Auth.open('login'); return; }
    if (!this.current) return;
    const postId = this.current.id;
    const currently = btn.getAttribute('aria-pressed') === 'true';
    const next = !currently;
    btn.setAttribute('aria-pressed', String(next));
    this.current.saved = next;
    try {
      const res = await API.post('/api/posts/' + postId + '/save');
      const saved = !!res.saved;
      btn.setAttribute('aria-pressed', String(saved));
      this.current.saved = saved;
      this.current.saves = res.saves;
      const stat = document.getElementById('pv2StatSaves');
      if (stat) stat.textContent = U.formatNumber(res.saves);
      document.querySelectorAll('[data-post-id="' + postId + '"] [data-action="save"]').forEach(b => {
        b.setAttribute('aria-pressed', String(saved));
      });
      Toast.show(saved ? 'تم الحفظ' : 'أُزيل من المحفوظة', 'success', 1800);
      if (saved && S.feeds.saved) S.feeds.saved.loaded = false;
    } catch (err) {
      btn.setAttribute('aria-pressed', String(currently));
      this.current.saved = currently;
      Toast.show(err.message || 'تعذّر الحفظ', 'error');
    }
  },

  async copyPrompt(btn) {
    if (!this.current) return;
    const ok = await U.copy(this.current.prompt || '');
    if (ok) {
      if (window.Sounds) Sounds.play('copy');
      Toast.show('تم النسخ', 'success', 1600);
      API.post('/api/posts/' + this.current.id + '/copy').then(res => {
        const stat = document.getElementById('pv2StatCopies');
        if (stat) stat.textContent = U.formatNumber(res.copies);
        this.current.copies = res.copies;
      }).catch(() => {});
      if (btn) {
        btn.dataset.state = 'copied';
        setTimeout(() => { if (btn) btn.removeAttribute('data-state'); }, 1400);
      }
    } else {
      Toast.show('تعذّر النسخ', 'error');
    }
  },

  share() {
    if (!this.current) return;
    const url = location.origin + '/?p=' + this.current.id;
    if (navigator.share) {
      navigator.share({ title: this.current.title || 'خَيال', url }).catch(() => {});
    } else {
      U.copy(url).then(ok => Toast.show(ok ? 'تم نسخ الرابط' : 'تعذّر النسخ', ok ? 'success' : 'error', 1600));
    }
    this.closeMenu();
  },

  edit() {
    this.closeMenu();
    if (!this.current) return;
    const id = this.current.id;
    this.close();
    setTimeout(() => Composer.openEdit(id), 220);
  },

  async remove() {
    this.closeMenu();
    if (!this.current) return;
    const id = this.current.id;
    const ok = await ConfirmModal.show({
      title: 'حذف المنشور',
      message: 'سيُحذف المنشور نهائياً. لا يمكن التراجع عن هذا الإجراء.',
      confirmLabel: 'حذف',
      cancelLabel: 'بقاء',
      danger: true,
    });
    if (!ok) return;
    try {
      await API.del('/api/posts/' + id);
      Toast.show('تم الحذف', 'success');
      if (window.Sounds) Sounds.play('success');
      Object.keys(S.feeds || {}).forEach(k => { if (S.feeds[k]) S.feeds[k].loaded = false; });
      const card = document.querySelector('[data-post-id="' + id + '"]');
      if (card) {
        card.style.transition = 'opacity .3s, transform .3s';
        card.style.opacity = '0';
        card.style.transform = 'scale(.95)';
        setTimeout(() => card.remove(), 300);
      }
      this.close();
    } catch (err) {
      Toast.show(err.message || 'تعذّر الحذف', 'error');
    }
  },

  async report() {
    this.closeMenu();
    if (!this.current) return;
    const id = this.current.id;
    const result = await ReportModal.show(id);
    if (!result) return;
    try {
      await API.post('/api/posts/' + id + '/report', { reason: result.reason, note: result.note });
      Toast.show('تم إرسال البلاغ، شكراً لك', 'success', 2600);
      if (window.Sounds) Sounds.play('success');
    } catch (err) {
      Toast.show(err.message || 'تعذّر إرسال البلاغ', 'error');
    }
  },

  async followAuthor(btn) {
    if (!S.me) { Auth.open('login'); return; }
    if (!this.current) return;
    const a = this.current.author_data || {};
    if (!a.id) return;
    if (btn.dataset.state === 'owner') return;
    btn.setAttribute('aria-busy', 'true');
    try {
      const res = await API.post('/api/users/' + a.id + '/follow');
      const following = !!res.following;
      btn.dataset.state = following ? 'following' : 'idle';
      btn.innerHTML = following
        ? '<i class="ph ph-check" aria-hidden="true"></i><span>أتابعه</span>'
        : '<i class="ph ph-plus" aria-hidden="true"></i><span>متابعة</span>';
      this.current.author_data.is_following = following;
      if (window.Sounds) Sounds.play(following ? 'success' : 'tab');
      Toast.show(following ? 'تتابعه الآن' : 'أُلغي المتابعة', 'success', 1600);
    } catch (err) {
      Toast.show(err.message || 'تعذّر', 'error');
    } finally {
      btn.removeAttribute('aria-busy');
    }
  },

  openAuthor() {
    if (!this.current) return;
    const a = this.current.author_data || {};
    if (!a.id) return;
    const id = a.id;
    this.close();
    setTimeout(() => ProfileView.open(id), 220);
  },

  toggleMenu(btn) {
    const menu = document.getElementById('pv2Menu');
    if (!menu) return;
    const isOpen = !menu.hidden;
    document.querySelectorAll('.prompt-menu').forEach(m => {
      if (m === menu) return;
      m.hidden = true;
      const b = m.closest('.prompt-menu-wrap')?.querySelector('.prompt-menu-btn');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
    if (!isOpen) {
      menu.hidden = false;
      if (btn) btn.setAttribute('aria-expanded', 'true');
    } else {
      this.closeMenu();
    }
  },

  closeMenu() {
    const menu = document.getElementById('pv2Menu');
    if (!menu) return;
    menu.hidden = true;
    const btn = document.querySelector('[data-action="post-view-menu"]');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  },
};
  /* ═══════════ PROFILE VIEW (Overlay) ═══════════ */
  const ProfileView = {
    current: null,
    _before: null, _hasMore: true, _busy: false, _scrollBound: false,

    async open(userId) {
      if (!userId) return;
      const view = document.getElementById('profileView');
      if (!view) { console.error('[ProfileView] #profileView مفقود'); return; }
      const skeleton = document.getElementById('pvSkeleton');
      const scroll = document.getElementById('pvScroll');
      if (skeleton) skeleton.hidden = false;
      if (scroll) scroll.hidden = true;
      view.hidden = false;
      document.body.classList.add('view-open');
      document.documentElement.style.overflow = 'hidden';
      if (window.Sounds) Sounds.play('open');
      try {
        const u = await API.get('/api/users/' + userId);
        this.current = u;
        this._render(u);
        if (skeleton) skeleton.hidden = true;
        if (scroll) { scroll.hidden = false; scroll.scrollTop = 0; }
        this._bindScrollPagination();
      } catch (err) {
        Toast.show(err.message || 'تعذّر التحميل', 'error');
        this.close();
      }
    },

    close() {
      const view = document.getElementById('profileView');
      if (!view) return;
      view.hidden = true;
      document.body.classList.remove('view-open');
      document.documentElement.style.overflow = '';
      this.current = null;
      if (window.Sounds) Sounds.play('close');
    },

    _render(u) {
      const isMe = S.me && S.me.id === u.id;
      const hero = document.getElementById('pvHero');
      if (hero) hero.dataset.cover = u.cover || 'aurora';
      const nameText = document.getElementById('pvNameText');
      if (nameText) nameText.textContent = u.name || '—';
      const verified = document.getElementById('pvVerified');
      if (verified) verified.hidden = !u.verified;
      const handle = document.getElementById('pvHandle');
      if (handle) handle.textContent = u.handle || '@—';
      const pronouns = document.getElementById('pvPronouns');
      if (pronouns) { if (u.pronouns) { pronouns.textContent = u.pronouns; pronouns.hidden = false; } else pronouns.hidden = true; }

      const followBtn = document.getElementById('pvFollowBtn');
      if (followBtn) {
        if (isMe) {
          followBtn.dataset.state = 'owner';
          followBtn.dataset.userId = '';
          followBtn.innerHTML = '<i class="ph ph-pencil-simple" aria-hidden="true"></i><span>تعديل الملف</span>';
        } else {
          followBtn.dataset.state = u.is_following ? 'following' : 'idle';
          followBtn.dataset.userId = String(u.id);
          followBtn.innerHTML = u.is_following
            ? '<i class="ph ph-check" aria-hidden="true"></i><span>أتابعه</span>'
            : '<i class="ph ph-plus" aria-hidden="true"></i><span>متابعة</span>';
        }
      }

      const setNum = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = U.formatNumber(v); };
      setNum('pvStatFollowing', u.following || 0);
      setNum('pvStatFollowers', u.followers || 0);
      setNum('pvStatPosts', u.posts_count || 0);

      const bio = document.getElementById('pvBio');
      if (bio) { if (u.bio && u.bio.trim()) { bio.textContent = u.bio.trim(); bio.hidden = false; } else bio.hidden = true; }

      const meta = document.getElementById('pvMeta');
      const webWrap = document.getElementById('pvMetaWebsite');
      const webLink = document.getElementById('pvMetaWebsiteLink');
      const joinedWrap = document.getElementById('pvMetaJoined');
      const joinedText = document.getElementById('pvMetaJoinedText');
      let hasMeta = false;
      if (u.website && webWrap && webLink) {
        webLink.href = u.website;
        webLink.textContent = u.website.replace(/^https?:\/\//, '').replace(/\/$/, '');
        webWrap.hidden = false; hasMeta = true;
      } else if (webWrap) webWrap.hidden = true;
      if (u.created_at && joinedWrap && joinedText) {
        const d = new Date(u.created_at);
        joinedText.textContent = 'انضم ' + d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' });
        joinedWrap.hidden = false; hasMeta = true;
      } else if (joinedWrap) joinedWrap.hidden = true;
      if (meta) meta.hidden = !hasMeta;

      this._before = null; this._hasMore = true; this._busy = false;
      this._loadPosts(u.id);
    },

    _bindScrollPagination() {
      if (this._scrollBound) return;
      this._scrollBound = true;
      const scroll = document.getElementById('pvScroll');
      if (!scroll) return;
      scroll.addEventListener('scroll', () => {
        if (!this.current || this._busy || !this._hasMore) return;
        if (scroll.scrollTop + scroll.clientHeight > scroll.scrollHeight - 400) {
          this._loadPosts(this.current.id, true);
        }
      }, { passive: true });
    },

    async _loadPosts(userId, isLoadMore) {
      const grid = document.getElementById('pvPostsGrid');
      if (!grid || this._busy) return;
      if (isLoadMore && !this._hasMore) return;
      this._busy = true;
      if (!isLoadMore) grid.innerHTML = '<div class="pv-empty"><i class="ph ph-circle-notch" style="animation:spin .8s linear infinite"></i><h4>جارٍ التحميل…</h4></div>';
      const params = new URLSearchParams();
      params.set('limit', '20');
      if (isLoadMore && this._before) params.set('before_id', String(this._before));
      try {
        const items = await API.get(`/api/users/${userId}/posts?${params.toString()}`);
        const list = Array.isArray(items) ? items : [];
        this._hasMore = list.length === 20;
        if (list.length) this._before = list[list.length - 1].id;
        if (!isLoadMore) {
          if (!list.length) {
            grid.innerHTML = '<div class="pv-empty"><i class="ph ph-image-square"></i><h4>لا منشورات بعد</h4><p>لم ينشر هذا المستخدم بعد.</p></div>';
            return;
          }
          grid.innerHTML = '';
        } else {
          const lm = grid.querySelector('.pv-load-more');
          if (lm) lm.remove();
        }
        const frag = document.createDocumentFragment();
        list.forEach(p => frag.appendChild(this._postCardHtml(p)));
        grid.appendChild(frag);
        if (this._hasMore) {
          const lm = document.createElement('div');
          lm.className = 'pv-load-more';
          lm.innerHTML = '<div class="spinner"></div>';
          grid.appendChild(lm);
        }
      } catch (err) {
        if (!isLoadMore) grid.innerHTML = `<div class="pv-empty"><i class="ph ph-warning-circle"></i><h4>تعذّر التحميل</h4><p>${U.escapeHtml(err.message || 'حاول مرة أخرى')}</p></div>`;
      } finally { this._busy = false; }
    },

    _postCardHtml(p) {
      const images = Post._extractImages(p);
      const first = images[0] || 'https://placehold.co/400x400/0E0E14/22D3EE?text=خَيال';
      const likes = U.formatNumber(p.likes || 0);
      const btn = document.createElement('button');
      btn.className = 'pv-post';
      btn.type = 'button';
      btn.dataset.postId = p.id;
      btn.innerHTML =
        '<img src="' + U.escapeHtml(first) + '" alt="" loading="lazy">' +
        '<span class="pv-post-badge"><i class="ph ph-heart-fill"></i>' + likes + '</span>';
      btn.addEventListener('click', () => {
        const pid = btn.dataset.postId;
        // v21.4 — بدلاً من الإغلاق والقفز للـ feed، افتح PostView فوق
        PostView.open(parseInt(pid, 10));
      });
      return btn;
    },

    async _handleFollow(btn) {
      if (!S.me) { Auth.open('login'); return; }
      if (btn.dataset.state === 'owner') { this.close(); if (window.Settings) Settings.open(); return; }
      const uid = parseInt(btn.dataset.userId, 10);
      if (!uid) return;
      btn.setAttribute('aria-busy', 'true');
      try {
        const res = await API.post('/api/users/' + uid + '/follow');
        const following = !!res.following;
        btn.dataset.state = following ? 'following' : 'idle';
        btn.innerHTML = following
          ? '<i class="ph ph-check" aria-hidden="true"></i><span>أتابعه</span>'
          : '<i class="ph ph-plus" aria-hidden="true"></i><span>متابعة</span>';
        const sf = document.getElementById('pvStatFollowers');
        if (sf && typeof res.followers === 'number') sf.textContent = U.formatNumber(res.followers);
        if (window.Sounds) Sounds.play(following ? 'success' : 'tab');
        Toast.show(following ? 'تتابعه الآن' : 'أُلغي المتابعة', 'success', 1600);
      } catch (err) { Toast.show(err.message || 'تعذّر', 'error'); }
      finally { btn.removeAttribute('aria-busy'); }
    },

    _handleShare() {
      const u = this.current; if (!u) return;
      const url = window.location.origin + '/u/' + (u.username || '');
      if (navigator.share) navigator.share({ title: u.name || 'خَيال', url }).catch(() => {});
      else U.copy(url).then(ok => Toast.show(ok ? 'تم نسخ الرابط' : 'تعذّر النسخ', ok ? 'success' : 'error', 1600));
    },

    _handleMenu() { Toast.show('قريباً', 'info'); },
    _openFollowers(type) { if (this.current) Drawers.openFollowers(this.current.id, type); },
  };

  /* ═══════════ PROFILE (tab-based) ═══════════ */
  const Profile = {
    current: null, _tabsBound: false,
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
      const tw = tabs ? tabs.closest('.tabs-sticky') : null;
      if (tw) tw.hidden = true;
      if (panel) panel.innerHTML = '';
      try {
        const u = await API.get(`/api/users/${id}`);
        this.current = u;
        this.render(u);
      } catch (err) { Toast.show(err.message || 'تعذّر تحميل الملف', 'error'); }
      finally { if (skeleton) skeleton.hidden = true; }
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
      if (avatar) { U.safeAvatar(avatar, u.avatar); avatar.alt = u.name || ''; avatar.dataset.frame = u.avatar_shape || 'ring'; }
      const name = document.getElementById('profileName');
      if (name) name.textContent = u.name || '—';
      const verified = document.getElementById('profileVerified');
      if (verified) verified.hidden = !u.verified;
      const handle = document.getElementById('profileHandle');
      if (handle) handle.textContent = u.handle || '@—';
      const pronouns = document.getElementById('profilePronouns');
      if (pronouns) { if (u.pronouns) { pronouns.textContent = u.pronouns; pronouns.hidden = false; } else pronouns.hidden = true; }
      const bio = document.getElementById('profileBio');
      if (bio) bio.textContent = u.bio || '';
      const setStat = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = U.formatNumber(v); };
      setStat('statFollowers', u.followers || 0);
      setStat('statFollowing', u.following || 0);
      setStat('statPosts', u.posts_count || 0);
      setStat('statLikes', u.total_likes || 0);
      const actions = document.getElementById('profileActions');
      if (actions) {
        if (isMe) {
          actions.innerHTML = '<button class="btn btn-secondary" data-action="open-settings" type="button"><i class="ph ph-pencil-simple"></i><span>تعديل الملف</span></button>';
        } else {
          actions.innerHTML = '<button class="btn btn-secondary" data-action="message" data-user-id="' + u.id + '" type="button"><i class="ph ph-chat-circle"></i><span>رسالة</span></button>';
        }
      }
      if (tabs) {
        tabs.hidden = false;
        const tw = tabs.closest('.tabs-sticky'); if (tw) tw.hidden = false;
        const st = document.getElementById('profileSavedTab');
        const sett = document.getElementById('profileSettingsTab');
        if (st) st.hidden = !isMe;
        if (sett) sett.hidden = !isMe;
        tabs.querySelectorAll('.tab[data-ptab]').forEach(t => t.setAttribute('aria-selected', t.dataset.ptab === 'posts' ? 'true' : 'false'));
      }
      Feed.reset('profile');
      Feed.load('profile');
      this.bindActions();
      this.bindTabs();
    },
    bindTabs() {
      if (this._tabsBound) return;
      this._tabsBound = true;
      const self = this;
      document.querySelectorAll('#profileTabs .tab[data-ptab]').forEach(tab => {
        tab.addEventListener('click', () => self.switchTab(tab.dataset.ptab));
      });
    },
    switchTab(name) {
      document.querySelectorAll('#profileTabs .tab[data-ptab]').forEach(t => t.setAttribute('aria-selected', t.dataset.ptab === name ? 'true' : 'false'));
      if (name === 'settings') {
        if (window.Settings) Settings.open();
        document.querySelectorAll('#profileTabs .tab[data-ptab]').forEach(t => t.setAttribute('aria-selected', t.dataset.ptab === 'posts' ? 'true' : 'false'));
        return;
      }
      if (name === 'posts') { Feed.reset('profile'); Feed.load('profile'); return; }
      const panel = document.getElementById('profilePanel');
      if (!panel) return;
      panel.innerHTML = '<div class="empty-block"><i class="ph ph-hourglass"></i><h4>قريباً</h4><p>هذا القسم قيد التطوير.</p></div>';
    },
    bindActions() {
      const card = document.getElementById('profileCard');
      if (!card) return;
      card.querySelectorAll('[data-action="message"]').forEach(btn => {
        btn.addEventListener('click', () => Chat.openWith(parseInt(btn.dataset.userId, 10)));
      });
      card.querySelectorAll('[data-action="open-settings"]').forEach(btn => {
        btn.addEventListener('click', () => Settings.open());
      });
    },
    save(ev) { if (ev) ev.preventDefault(); if (window.Settings) Settings.save(); },
  };

  /* ═══════════ EXPLORE ═══════════ */
  const Explore = {
    openCollection(name) {
      App.switchTab('explore');
      S.filterTag = ''; S.filterModel = '';
      if (name === 'trending' || name === 'editor') { S.sort = 'top'; App.setSort('top'); }
      else { S.sort = 'recent'; App.setSort('recent'); }
      Feed.reset('explore');
      Feed.load('explore', { force: true });
    },
  };

  /* ═══════════ SEARCH ═══════════ */
  const Search = {
    query: '',
    tab: 'all',
    postsBefore: null,
    postsHasMore: true,
    usersBefore: null,
    usersHasMore: true,
    posts: [],
    users: [],
    _searchTimer: null,
    _scrollBound: false,
    _busy: false,

    open(initialQuery) {
      const view = document.getElementById('searchView');
      if (!view) { console.error('[Search] #searchView مفقود'); return; }

      const input = document.getElementById('searchViewInput');
      if (input) {
        input.value = initialQuery || '';
        setTimeout(() => input.focus({ preventScroll: true }), 200);
      }

      view.hidden = false;
      document.body.classList.add('view-open');
      document.documentElement.style.overflow = 'hidden';
      if (window.Sounds) Sounds.play('open');

      this.bindScroll();
      this.updateClearButton();

      if (initialQuery && initialQuery.trim().length >= 2) {
        this.query = initialQuery;
        this.runQuery(initialQuery);
      } else {
        this.showLanding();
      }
    },

    close() {
      const view = document.getElementById('searchView');
      if (!view) return;
      view.hidden = true;
      document.body.classList.remove('view-open');
      document.documentElement.style.overflow = '';
      if (window.Sounds) Sounds.play('close');
    },

    showLanding() {
      const box = document.getElementById('svResults');
      if (!box) return;
      box.innerHTML =
        '<div class="sv-landing-hint">' +
          '<i class="ph ph-magnifying-glass" aria-hidden="true"></i>' +
          '<p>اكتب كلمتين على الأقل لتبدأ البحث في البرومبتات والمبدعين.</p>' +
        '</div>';
    },

    updateClearButton() {
      const input = document.getElementById('searchViewInput');
      const btn = document.querySelector('[data-action="search-clear"]');
      if (!input || !btn) return;
      btn.hidden = !input.value;
    },

    clearInput() {
      const input = document.getElementById('searchViewInput');
      if (!input) return;
      input.value = '';
      this.query = '';
      this.updateClearButton();
      this.showLanding();
      input.focus({ preventScroll: true });
    },

    setTab(name) {
      if (!name) return;
      this.tab = name;
      document.querySelectorAll('.sv-tab').forEach(t => {
        t.setAttribute('aria-selected', t.dataset.stab === name ? 'true' : 'false');
      });
      if (this.query && this.query.trim().length >= 2) this.runQuery(this.query);
    },

    onInput(value) {
      this.query = value;
      this.updateClearButton();
      if (this._searchTimer) clearTimeout(this._searchTimer);
      if (!value || value.trim().length < 2) {
        this.showLanding();
        return;
      }
      this._searchTimer = setTimeout(() => this.runQuery(value), 300);
    },

    async runQuery(q) {
      const query = (q || '').trim();
      if (query.length < 2) { this.showLanding(); return; }

      const box = document.getElementById('svResults');
      if (!box) return;

      box.innerHTML = '<div class="sv-loading"><div class="spinner"></div><span>جارٍ البحث…</span></div>';

      this.postsBefore = null; this.postsHasMore = true;
      this.usersBefore = null; this.usersHasMore = true;
      this.posts = []; this.users = [];

      try {
        if (this.tab === 'posts') {
          await this._loadPosts(query, false);
          this.renderPosts();
        } else if (this.tab === 'users') {
          await this._loadUsers(query, false);
          this.renderUsers();
        } else if (this.tab === 'tags') {
          await this._loadPosts(query, false);
          this.renderTags();
        } else {
          await Promise.all([
            this._loadPosts(query, false),
            this._loadUsers(query, false),
          ]);
          this.renderAll();
        }
      } catch (err) {
        box.innerHTML =
          '<div class="sv-empty">' +
            '<i class="ph ph-warning-circle" aria-hidden="true"></i>' +
            '<h3>تعذّر التحميل</h3>' +
            '<p>' + U.escapeHtml(err.message || 'حاول مرة أخرى') + '</p>' +
          '</div>';
      }
    },

    async _loadPosts(query, isLoadMore) {
      const params = new URLSearchParams();
      params.set('q', query);
      params.set('limit', '20');
      if (isLoadMore && this.postsBefore) params.set('before_id', String(this.postsBefore));

      const items = await API.get('/api/posts?' + params.toString());
      const list = Array.isArray(items) ? items : [];

      if (isLoadMore) this.posts = this.posts.concat(list);
      else this.posts = list;

      this.postsHasMore = list.length === 20;
      if (list.length) this.postsBefore = list[list.length - 1].id;
      return list;
    },

    async _loadUsers(query, isLoadMore) {
      const params = new URLSearchParams();
      params.set('q', query);
      params.set('limit', '20');
      if (isLoadMore && this.usersBefore) params.set('before_id', String(this.usersBefore));

      const data = await API.get('/api/users/search?' + params.toString());
      const list = (data && data.items) || [];

      if (isLoadMore) this.users = this.users.concat(list);
      else this.users = list;

      this.usersHasMore = !!(data && data.next_before);
      if (data && data.next_before) this.usersBefore = data.next_before;
      return list;
    },

    renderAll() {
      const box = document.getElementById('svResults');
      if (!box) return;

      const hasPosts = this.posts.length > 0;
      const hasUsers = this.users.length > 0;

      if (!hasPosts && !hasUsers) { this.renderEmpty(); return; }

      let html = '';

      if (hasUsers) {
        const top = this.users.slice(0, 3);
        html +=
          '<section class="sv-section">' +
            '<h3 class="sv-section-title">المبدعون <span class="sv-count">' + this.users.length + '</span></h3>' +
            '<div class="sv-user-list">' +
              top.map(u => this._userRowHtml(u)).join('') +
            '</div>' +
          '</section>';
      }

      if (hasPosts) {
        const top = this.posts.slice(0, 6);
        html +=
          '<section class="sv-section">' +
            '<h3 class="sv-section-title">البرومبتات <span class="sv-count">' + this.posts.length + '</span></h3>' +
            '<div class="feed">' +
              top.map(p => Post.renderCard(p).outerHTML).join('') +
            '</div>' +
          '</section>';
      }

      box.innerHTML = html;
      this._bindFeedCards(box);
      this._bindUserRows(box);
    },

    renderPosts() {
      const box = document.getElementById('svResults');
      if (!box) return;

      if (!this.posts.length) { this.renderEmpty(); return; }

      box.innerHTML =
        '<section class="sv-section">' +
          '<h3 class="sv-section-title">البرومبتات <span class="sv-count">' + this.posts.length + '</span></h3>' +
          '<div class="feed">' +
            this.posts.map(p => Post.renderCard(p).outerHTML).join('') +
          '</div>' +
          (this.postsHasMore ? '<div class="load-more"><div class="spinner"></div></div>' : '') +
        '</section>';

      this._bindFeedCards(box);
    },

    renderUsers() {
      const box = document.getElementById('svResults');
      if (!box) return;

      if (!this.users.length) { this.renderEmpty(); return; }

      box.innerHTML =
        '<section class="sv-section">' +
          '<h3 class="sv-section-title">المبدعون <span class="sv-count">' + this.users.length + '</span></h3>' +
          '<div class="sv-user-list">' +
            this.users.map(u => this._userRowHtml(u)).join('') +
          '</div>' +
          (this.usersHasMore ? '<button class="load-more-btn" type="button" data-sv-load-more-users><span>تحميل المزيد</span><i class="ph ph-arrow-down"></i></button>' : '') +
        '</section>';

      this._bindUserRows(box);
    },

    renderTags() {
      const box = document.getElementById('svResults');
      if (!box) return;

      const counts = {};
      this.posts.forEach(p => {
        (p.tags || []).forEach(t => {
          const k = String(t).trim();
          if (!k) return;
          counts[k] = (counts[k] || 0) + 1;
        });
      });

      const tags = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 40);

      if (!tags.length) { this.renderEmpty(); return; }

      box.innerHTML =
        '<section class="sv-section">' +
          '<h3 class="sv-section-title">الوسوم <span class="sv-count">' + tags.length + '</span></h3>' +
          '<div class="sv-tag-cloud">' +
            tags.map(([tag, n]) =>
              '<button class="sv-tag-chip" type="button" data-sv-tag="' + U.escapeHtml(tag) + '">' +
                '<span>' + U.escapeHtml(tag) + '</span>' +
                '<span class="sv-tag-count">' + n + '</span>' +
              '</button>'
            ).join('') +
          '</div>' +
        '</section>';

      box.querySelectorAll('[data-sv-tag]').forEach(btn => {
        btn.addEventListener('click', () => {
          const tag = btn.dataset.svTag;
          this.close();
          setTimeout(() => App.filterByTag(tag), 220);
        });
      });
    },

    renderEmpty() {
      const box = document.getElementById('svResults');
      if (!box) return;
      box.innerHTML =
        '<div class="sv-empty">' +
          '<i class="ph ph-magnifying-glass" aria-hidden="true"></i>' +
          '<h3>لا نتائج</h3>' +
          '<p>لم نجد شيئاً يطابق «' + U.escapeHtml(this.query) + '». جرّب كلمة أخرى.</p>' +
        '</div>';
    },

    _userRowHtml(u) {
      return '<button class="sv-user-row" type="button" data-sv-user="' + u.id + '">' +
        '<img class="sv-user-avatar" src="' + U.escapeHtml(u.avatar || '') + '" alt="" loading="lazy">' +
        '<span class="sv-user-info">' +
          '<span class="sv-user-name">' +
            U.escapeHtml(u.name || '') +
            (u.verified ? '<i class="ph ph-seal-check" aria-hidden="true"></i>' : '') +
          '</span>' +
          '<span class="sv-user-meta sv-user-handle">' + U.escapeHtml(u.handle || '') + '</span>' +
          '<span class="sv-user-meta">' +
            U.formatNumber(u.followers || 0) + ' متابِع' +
            ' · ' + U.formatNumber(u.posts_count || 0) + ' برومبت' +
          '</span>' +
        '</span>' +
      '</button>';
    },

    _bindUserRows(root) {
      root.querySelectorAll('[data-sv-user]').forEach(row => {
        row.addEventListener('click', () => {
          const uid = parseInt(row.dataset.svUser, 10);
          if (!uid) return;
          this.close();
          setTimeout(() => ProfileView.open(uid), 220);
        });
      });
      const loadMore = root.querySelector('[data-sv-load-more-users]');
      if (loadMore) {
        loadMore.addEventListener('click', async () => {
          if (this._busy || !this.usersHasMore) return;
          this._busy = true;
          loadMore.innerHTML = '<div class="spinner"></div>';
          try {
            await this._loadUsers(this.query, true);
            this.renderUsers();
          } catch (err) { Toast.show(err.message || 'تعذّر التحميل', 'error'); }
          finally { this._busy = false; }
        });
      }
    },

    _bindFeedCards(root) {
      root.querySelectorAll('.prompt-card').forEach(card => {
        if (card._svBound) return;
        card._svBound = true;
        const pid = parseInt(card.dataset.postId, 10);
        const sourcePost = this.posts.find(p => p.id === pid);
        if (!sourcePost) return;
        const img = card.querySelector('.prompt-media > img');
        if (img) {
          img.addEventListener('load', () => { img.dataset.state = 'loaded'; });
          img.addEventListener('error', () => { img.dataset.state = 'error'; });
          if (img.complete) img.dataset.state = 'loaded';
        }
        card.addEventListener('click', (e) => Post.onCardClick(e, card, sourcePost));
      });
    },

    bindScroll() {
      if (this._scrollBound) return;
      this._scrollBound = true;
      const body = document.querySelector('.sv-body');
      if (!body) return;
      body.addEventListener('scroll', U.debounce(() => {
        if (!this.query || this.query.trim().length < 2) return;
        if (this._busy) return;
        const nearBottom = body.scrollTop + body.clientHeight > body.scrollHeight - 400;
        if (!nearBottom) return;
        if (this.tab === 'posts' && this.postsHasMore) {
          this._busy = true;
          this._loadPosts(this.query, true)
            .then(() => this.renderPosts())
            .catch(err => Toast.show(err.message || 'تعذّر التحميل', 'error'))
            .finally(() => { this._busy = false; });
        }
      }, 220), { passive: true });
    },

    init() {
      const input = document.getElementById('searchViewInput');
      if (input) {
        input.addEventListener('input', () => this.onInput(input.value));
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (input.value.trim().length >= 2) this.runQuery(input.value);
          }
        });
      }

      document.querySelectorAll('.sv-tab').forEach(btn => {
        btn.addEventListener('click', () => this.setTab(btn.dataset.stab));
      });
    },
  };

  /* ═══════════ SETTINGS ═══════════ */
  function _defaultPreferences() {
    return {
      notif: { likes: true, comments: true, follows: true, messages: true },
      priv: { public_profile: true, allow_messages: true, show_website: true },
    };
  }

  const Settings = {
    view: null, section: 'profile', postsLoaded: false, dirty: false,
    _closingPromise: null, _flashHero: null, _flashTimer: null,
    state: { cover: 'aurora', avatar_frame: 'ring', accent_color: '#22D3EE', card_style: 'glass', name: '', handle: '', avatar: '', bio: '', website: '', pronouns: '', preferences: null },

    init() {
      this.view = document.getElementById('settingsView');
      if (!this.view) { console.error('[خَيال] #settingsView غير موجود.'); return; }
      const self = this;

      this._flashHero = U.debounce(function () {
        const hero = document.getElementById('settingsHeroProfile');
        if (!hero) return;
        hero.classList.remove('is-updating');
        requestAnimationFrame(() => {
          hero.classList.add('is-updating');
          clearTimeout(self._flashTimer);
          self._flashTimer = setTimeout(() => hero.classList.remove('is-updating'), 600);
        });
      }, 120);

      window.addEventListener('beforeunload', (e) => { if (self.dirty) { e.preventDefault(); e.returnValue = ''; } });

      this.view.querySelector('[data-action="close-settings"]')?.addEventListener('click', () => self.close());
      this.view.querySelector('[data-action="save-settings"]')?.addEventListener('click', () => self.save());

      const resetBtn = document.getElementById('settingsResetBtn');
      if (resetBtn) resetBtn.addEventListener('click', () => self.resetToSaved());

      this.view.querySelectorAll('.settings-tab').forEach(btn => btn.addEventListener('click', () => self.switchSection(btn.dataset.section)));

      const coverPicker = document.getElementById('settingsCoverPresets');
      if (coverPicker) coverPicker.addEventListener('click', (e) => {
        const b = e.target.closest('.cover-preset'); if (!b) return;
        coverPicker.querySelectorAll('.cover-preset').forEach(x => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        self.state.cover = b.dataset.cover;
        self.markDirty(); self.updatePreview();
        if (window.Sounds) Sounds.play('toggle');
      });

      const framePicker = document.getElementById('settingsFramePicker');
      if (framePicker) framePicker.addEventListener('click', (e) => {
        const b = e.target.closest('.frame-option'); if (!b) return;
        framePicker.querySelectorAll('.frame-option').forEach(x => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        self.state.avatar_frame = b.dataset.frame;
        self.markDirty(); self.updatePreview();
        if (window.Sounds) Sounds.play('toggle');
      });

      const accentPicker = document.getElementById('settingsAccentPicker');
      if (accentPicker) accentPicker.addEventListener('click', (e) => {
        const b = e.target.closest('.accent-swatch'); if (!b) return;
        accentPicker.querySelectorAll('.accent-swatch').forEach(x => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        self.state.accent_color = b.dataset.color;
        const hint = document.getElementById('accentHint');
        if (hint) hint.textContent = b.dataset.color;
        self.markDirty(); self.updatePreview();
        if (window.Sounds) Sounds.play('toggle');
      });

      const stylePicker = document.getElementById('settingsCardStylePicker');
      if (stylePicker) stylePicker.addEventListener('click', (e) => {
        const b = e.target.closest('.style-option'); if (!b) return;
        stylePicker.querySelectorAll('.style-option').forEach(x => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        self.state.card_style = b.dataset.style;
        self.markDirty(); self.updatePreview();
        if (window.Sounds) Sounds.play('toggle');
      });

      const pronounPicker = document.getElementById('settingsPronounPicker');
      const pronounHidden = document.getElementById('setPronouns');
      if (pronounPicker && pronounHidden) pronounPicker.addEventListener('click', (e) => {
        const b = e.target.closest('.pronoun-option'); if (!b) return;
        pronounPicker.querySelectorAll('.pronoun-option').forEach(x => x.setAttribute('aria-checked', 'false'));
        b.setAttribute('aria-checked', 'true');
        pronounHidden.value = b.dataset.pronoun || '';
        self.state.pronouns = pronounHidden.value;
        self.markDirty(); self.updatePreview();
        if (window.Sounds) Sounds.play('toggle');
      });

      const nameEl = document.getElementById('setName');
      if (nameEl) nameEl.addEventListener('input', () => { self.state.name = nameEl.value; self.markDirty(); self.updatePreview({ flash: false }); });
      const bioEl = document.getElementById('setBio');
      if (bioEl) bioEl.addEventListener('input', () => {
        const c = document.getElementById('setBioCount');
        if (c) c.textContent = bioEl.value.length;
        self.markDirty(); self.updatePreview({ flash: false });
      });
      const webEl = document.getElementById('setWebsite');
      if (webEl) webEl.addEventListener('input', () => { self.state.website = webEl.value; self.markDirty(); });

      const soundToggle = document.getElementById('soundsToggle');
      if (soundToggle) soundToggle.addEventListener('click', () => {
        const next = soundToggle.getAttribute('aria-checked') !== 'true';
        soundToggle.setAttribute('aria-checked', next ? 'true' : 'false');
        if (window.Sounds) Sounds.setEnabled(next);
      });

      const vol = document.getElementById('volumeSlider');
      const volHint = document.getElementById('volumeHint');
      if (vol) vol.addEventListener('input', () => {
        const v = parseInt(vol.value, 10) / 100;
        if (window.Sounds) Sounds.setVolume(v);
        if (volHint) volHint.textContent = vol.value + '%';
      });

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
          if (!self.state.preferences) self.state.preferences = _defaultPreferences();
          const notifKey = sw.dataset.notif;
          const privKey = sw.dataset.priv;
          if (notifKey) self.state.preferences.notif[notifKey] = next;
          else if (privKey) self.state.preferences.priv[privKey] = next;
          self.markDirty();
          if (window.Sounds) Sounds.play('toggle');
        });
      });

      // v21.2 — stat "posts" leads to Content tab
      this.view.querySelectorAll('[data-stat="posts"]').forEach(btn => {
        btn.addEventListener('click', () => self.switchSection('content'));
      });

      const chg = document.getElementById('changePasswordBtn');
      if (chg) chg.addEventListener('click', () => {
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

      const logout = document.getElementById('logoutBtn');
      if (logout) logout.addEventListener('click', async () => {
        const ok = await ConfirmModal.show({
          title: 'تسجيل الخروج',
          message: 'سيتم الخروج من هذا الجهاز فقط.',
          confirmLabel: 'خروج', danger: true,
        });
        if (!ok) return;
        self.dirty = false;
        Auth.logout();
        self.view.hidden = true;
        document.body.classList.remove('view-open');
      });
    },

    open() {
      if (!this.view) this.view = document.getElementById('settingsView');
      if (!this.view) { console.error('[خَيال] #settingsView مفقود'); return; }
      try { this.hydrate(); }
      catch (err) { console.error('[Settings] hydrate failed:', err); Toast.show('تعذّر تحميل الإعدادات', 'error'); return; }
      this.view.hidden = false;
      document.body.classList.add('view-open');
      if (window.Sounds) Sounds.play('open');
      if (!this.postsLoaded) this.loadUserPosts();
    },

    async close() {
      if (!this.view || this.view.hidden) return;
      if (this._closingPromise) return;
      if (this.dirty) {
        this._closingPromise = this._confirmClose();
        const choice = await this._closingPromise;
        this._closingPromise = null;
        if (choice === 'cancel') return;
        if (choice === 'save') { const ok = await this.save(); if (!ok) return; }
      }
      this.clearDirty();
      this.view.hidden = true;
      document.body.classList.remove('view-open');
      if (window.Sounds) Sounds.play('close');
    },

    _confirmClose() {
      return new Promise(function (resolve) {
        var scrim = document.createElement('div');
        scrim.className = 'scrim';
        scrim.setAttribute('data-open', 'false');
        scrim.setAttribute('role', 'dialog');
        scrim.setAttribute('aria-modal', 'true');
        scrim.innerHTML =
          '<div class="modal" role="document">' +
            '<h3>تغييرات غير محفوظة</h3>' +
            '<p>لديك تغييرات لم تُحفظ بعد. ماذا تريد أن تفعل؟</p>' +
            '<div class="modal-actions">' +
              '<button class="btn btn-ghost" type="button" data-choice="cancel">بقاء</button>' +
              '<button class="btn btn-secondary" type="button" data-choice="discard">تجاهل</button>' +
              '<button class="btn btn-primary" type="button" data-choice="save">حفظ</button>' +
            '</div>' +
          '</div>';
        function finish(c) { scrim.setAttribute('data-open', 'false'); setTimeout(() => scrim.remove(), 300); resolve(c); }
        scrim.addEventListener('click', function (e) {
          var btn = e.target.closest('[data-choice]');
          if (btn) { finish(btn.dataset.choice); return; }
          if (e.target === scrim) finish('cancel');
        });
        document.body.appendChild(scrim);
        requestAnimationFrame(() => scrim.setAttribute('data-open', 'true'));
        setTimeout(() => { const p = scrim.querySelector('[data-choice="save"]'); if (p) p.focus({ preventScroll: true }); }, 150);
      });
    },

    markDirty() { if (this.dirty) return; this.dirty = true; const b = document.getElementById('settingsSave'); if (b) b.hidden = false; },
    clearDirty() { this.dirty = false; const b = document.getElementById('settingsSave'); if (b) b.hidden = true; },

    resetToSaved() {
      this.hydrate(); this.clearDirty();
      Toast.show('تمت استعادة القيم المحفوظة', 'info', 1600);
      if (window.Sounds) Sounds.play('tab');
    },

    switchSection(name) {
      if (!name || !this.view) return;
      this.section = name;
      this.view.querySelectorAll('.settings-tab').forEach(b => {
        const on = b.dataset.section === name;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      this.view.querySelectorAll('.settings-panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === name));
      const t = this.view.querySelector('.settings-tab.is-active');
      if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      if (window.Sounds) Sounds.play('tab');
    },

    hydrate() {
      const u = (S.me && S.me.id && S.me) || window.__ME__ || {};
      this.state = {
        cover: u.cover || 'aurora', avatar_frame: u.avatar_shape || 'ring',
        accent_color: u.accent_color || '#22D3EE', card_style: u.card_style || 'glass',
        name: u.name || '', handle: u.handle || '', avatar: u.avatar || '',
        bio: u.bio || '', website: u.website || '', pronouns: u.pronouns || '',
        preferences: u.preferences ? JSON.parse(JSON.stringify(u.preferences)) : _defaultPreferences(),
      };
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      set('setName', this.state.name); set('setWebsite', this.state.website); set('setBio', this.state.bio);
      const bc = document.getElementById('setBioCount');
      if (bc) bc.textContent = (this.state.bio || '').length;

      const pp = document.getElementById('settingsPronounPicker');
      const ph = document.getElementById('setPronouns');
      if (pp && ph) {
        const match = pp.querySelector('.pronoun-option[data-pronoun="' + this.state.pronouns.replace(/"/g, '') + '"]')
          || pp.querySelector('.pronoun-option[data-pronoun=""]');
        pp.querySelectorAll('.pronoun-option').forEach(b => b.setAttribute('aria-checked', b === match ? 'true' : 'false'));
        ph.value = match ? (match.dataset.pronoun || '') : '';
      }

      const cp = document.getElementById('settingsCoverPresets');
      if (cp) cp.querySelectorAll('.cover-preset').forEach(b => b.setAttribute('aria-pressed', b.dataset.cover === this.state.cover ? 'true' : 'false'));
      const fp = document.getElementById('settingsFramePicker');
      if (fp) fp.querySelectorAll('.frame-option').forEach(b => b.setAttribute('aria-pressed', b.dataset.frame === this.state.avatar_frame ? 'true' : 'false'));
      const ap = document.getElementById('settingsAccentPicker');
      if (ap) ap.querySelectorAll('.accent-swatch').forEach(b => b.setAttribute('aria-pressed', b.dataset.color === this.state.accent_color ? 'true' : 'false'));
      const ah = document.getElementById('accentHint');
      if (ah) ah.textContent = this.state.accent_color;
      const sp = document.getElementById('settingsCardStylePicker');
      if (sp) sp.querySelectorAll('.style-option').forEach(b => b.setAttribute('aria-pressed', b.dataset.style === this.state.card_style ? 'true' : 'false'));

      const st = document.getElementById('soundsToggle');
      if (st && window.Sounds) st.setAttribute('aria-checked', Sounds.isEnabled() ? 'true' : 'false');
      const vs = document.getElementById('volumeSlider');
      if (vs && window.Sounds) vs.value = Math.round(Sounds.getVolume() * 100);
      const vh = document.getElementById('volumeHint');
      if (vh && window.Sounds) vh.textContent = Math.round(Sounds.getVolume() * 100) + '%';

      const prefs = this.state.preferences;
      this.view.querySelectorAll('.switch[data-notif]').forEach(sw => {
        const val = prefs.notif && prefs.notif[sw.dataset.notif];
        sw.setAttribute('aria-checked', val !== false ? 'true' : 'false');
      });
      this.view.querySelectorAll('.switch[data-priv]').forEach(sw => {
        const val = prefs.priv && prefs.priv[sw.dataset.priv];
        sw.setAttribute('aria-checked', val !== false ? 'true' : 'false');
      });

      this.renderHero(u); this.renderAbout(u); this.renderAccount(u);
      this.clearDirty();
    },

    renderHero(u) {
      const cover = document.getElementById('settingsHeroCover');
      if (cover) cover.dataset.cover = u.cover || 'aurora';
      const avatar = document.getElementById('settingsHeroAvatar');
      if (avatar) { U.safeAvatar(avatar, u.avatar); avatar.alt = u.name || ''; avatar.dataset.frame = u.avatar_shape || 'ring'; }
      const name = document.getElementById('settingsHeroName');
      if (name) name.textContent = u.name || '—';
      const verified = document.getElementById('settingsHeroVerified');
      if (verified) verified.hidden = !u.verified;
      const handle = document.getElementById('settingsHeroHandle');
      if (handle) handle.textContent = u.handle || '@—';
      const pronouns = document.getElementById('settingsHeroPronouns');
      if (pronouns) { if (u.pronouns) { pronouns.textContent = u.pronouns; pronouns.hidden = false; } else pronouns.hidden = true; }
      const bio = document.getElementById('settingsHeroBio');
      if (bio) { if (u.bio && u.bio.trim()) { bio.textContent = u.bio.trim(); bio.hidden = false; } else bio.hidden = true; }
      const hero = document.getElementById('settingsHeroProfile');
      if (hero) hero.dataset.style = u.card_style || 'glass';
      const setStat = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = U.formatNumber(v); };
      setStat('settingsStatPosts', u.posts_count || 0);
      setStat('settingsStatFollowers', u.followers || 0);
      setStat('settingsStatFollowing', u.following || 0);
      setStat('settingsStatLikes', u.total_likes || 0);
    },

    renderAbout(u) {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      const show = (id, on) => { const el = document.getElementById(id); if (el) el.hidden = !on; };
      set('aboutName', u.name || '—'); set('aboutHandle', u.handle || '@—');
      if (u.pronouns) { set('aboutPronouns', u.pronouns); show('aboutPronounsRow', true); } else show('aboutPronounsRow', false);
      if (u.bio && u.bio.trim()) { set('aboutBio', u.bio.trim()); show('aboutBioRow', true); } else show('aboutBioRow', false);
      const siteEl = document.getElementById('aboutWebsite');
      if (u.website && siteEl) {
        siteEl.href = u.website;
        siteEl.textContent = u.website.replace(/^https?:\/\//, '').replace(/\/$/, '');
        show('aboutWebsiteRow', true);
      } else show('aboutWebsiteRow', false);
      if (u.created_at) {
        const d = new Date(u.created_at);
        set('aboutJoined', d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' }));
      } else set('aboutJoined', '—');
    },

    renderAccount(u) {
      const av = document.getElementById('accountIdentityAvatar');
      if (av) U.safeAvatar(av, u.avatar);
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('accountIdentityName', u.name || '—');
      set('accountIdentityHandle', u.handle || '@—');
      set('accountIdentityEmail', u.email || '—');
      const badge = document.getElementById('accountIdentityBadge');
      if (badge) badge.hidden = !u.verified;
      set('accountInfoName', u.name || '—');
      set('accountInfoHandle', u.handle || '—');
      set('accountInfoEmail', u.email || '—');
      if (u.created_at) {
        const d = new Date(u.created_at);
        set('accountInfoJoined', d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' }));
      } else {
        set('accountInfoJoined', '—');
      }
    },

    async loadUserPosts() {
      const feed = document.getElementById('settingsUserPosts');
      if (!feed || !S.me) return;
      feed.innerHTML = Feed.skeletonsHtml();
      feed.setAttribute('aria-busy', 'true');
      try {
        const items = await API.get('/api/users/' + S.me.id + '/posts?limit=20');
        if (!items || !items.length) {
          feed.innerHTML = Feed.emptyHtml('ph-image-square', 'لا منشورات بعد', 'ابدأ بنشر أول برومبت لك.');
        } else {
          feed.innerHTML = '';
          const frag = document.createDocumentFragment();
          items.forEach(p => frag.appendChild(Post.renderCard(p)));
          feed.appendChild(frag);
        }
        this.postsLoaded = true;
      } catch (err) {
        feed.innerHTML = Feed.emptyHtml('ph-cloud-slash', 'تعذّر التحميل', err.message || 'حاول مرة أخرى');
      } finally { feed.setAttribute('aria-busy', 'false'); }
    },

    updatePreview(opts) {
      opts = opts || {};
      const heroCover = document.getElementById('settingsHeroCover');
      if (heroCover) heroCover.dataset.cover = this.state.cover;
      const heroAvatar = document.getElementById('settingsHeroAvatar');
      if (heroAvatar) {
        heroAvatar.dataset.frame = this.state.avatar_frame;
        if (this.state.avatar && !heroAvatar.src) U.safeAvatar(heroAvatar, this.state.avatar);
      }
      const hero = document.getElementById('settingsHeroProfile');
      if (hero) hero.dataset.style = this.state.card_style;
      const name = document.getElementById('settingsHeroName');
      if (name) name.textContent = this.state.name || '—';
      const pronouns = document.getElementById('settingsHeroPronouns');
      if (pronouns) { if (this.state.pronouns) { pronouns.textContent = this.state.pronouns; pronouns.hidden = false; } else pronouns.hidden = true; }
      const bio = document.getElementById('settingsHeroBio');
      if (bio) {
        const bioVal = (document.getElementById('setBio') || {}).value || '';
        if (bioVal.trim()) { bio.textContent = bioVal.trim(); bio.hidden = false; } else bio.hidden = true;
      }
      if (opts.flash !== false && this._flashHero) this._flashHero();
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
        preferences: this.state.preferences || _defaultPreferences(),
      };
      try {
        const user = await API.patch('/api/me', payload);
        S.me = user; window.__ME__ = user;
        if (window.Sounds) Sounds.play('success');
        Toast.show('تم الحفظ', 'success');
        Auth.updateChrome(user);
        this.hydrate();
        if (S.tab === 'profile' && S.viewingUser && S.viewingUser.id === user.id) Profile.load(user.id);
        return true;
      } catch (err) {
        if (window.Sounds) Sounds.play('error');
        Toast.show(err.message || 'تعذّر الحفظ', 'error');
        return false;
      } finally {
        if (btn) { btn.removeAttribute('aria-busy'); btn.disabled = false; }
      }
    },
  };

  /* ═══════════ PTR ═══════════ */
  const PTR = {
    init() {
      const main = document.querySelector('.app-main');
      if (!main) return;
      let startY = 0, pulling = false, indicator = null;
      const THRESHOLD = 70;
      const createIndicator = () => {
        const el = document.createElement('div');
        el.className = 'ptr';
        el.innerHTML = '<i class="ph ph-arrow-down"></i>';
        main.appendChild(el); return el;
      };
      main.addEventListener('touchstart', (e) => {
        if (window.scrollY > 5) return;
        startY = e.touches[0].clientY; pulling = true;
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

  /* ═══════════ APP ═══════════ */
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
      FollowersDrawer.init();
      NotificationsLoader.init();
      Search.init();
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
        const ca = document.getElementById('composerAvatar');
        if (ca && S.me.avatar) U.safeAvatar(ca, S.me.avatar);
        NotificationsLoader.start();
      } else {
        this.showLanding();
        this.bindLanding();
      }

      this.updateHeroStats();
      this.handleDeepLink();
      console.log('[خَيال] booted. v' + CFG.BUILD);
    },

    handleDeepLink() {
      try {
        const params = new URLSearchParams(location.search);
        const pid = params.get('p');
        if (!pid) return;
        const id = parseInt(pid, 10);
        if (!id || isNaN(id)) return;
        setTimeout(() => PostView.open(id), 400);
      } catch (e) {}
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
        if (action === 'open-settings') { e.preventDefault(); Settings.open(); return; }
        if (action === 'edit-profile') { e.preventDefault(); Settings.open(); return; }
        if (action === 'pick-avatar-file') { e.preventDefault(); const i = document.getElementById('avatarFileInput'); if (i) i.click(); return; }
        if (action === 'pick-cover-file') { e.preventDefault(); const i = document.getElementById('coverFileInput'); if (i) i.click(); return; }
        if (action === 'toggle-notifications') { e.preventDefault(); Drawers.openNotifications(); return; }
        if (action === 'close-profile-view') { e.preventDefault(); ProfileView.close(); return; }
        if (action === 'profile-view-follow') { e.preventDefault(); ProfileView._handleFollow(btn); return; }
        if (action === 'profile-view-share') { e.preventDefault(); ProfileView._handleShare(); return; }
        if (action === 'profile-view-menu') { e.preventDefault(); ProfileView._handleMenu(); return; }
        if (action === 'profile-view-followers') { e.preventDefault(); ProfileView._openFollowers('followers'); return; }
        if (action === 'profile-view-following') { e.preventDefault(); ProfileView._openFollowers('following'); return; }
        if (action === 'close-followers') { e.preventDefault(); FollowersDrawer.close(); return; }
        if (action === 'close-notifications') { e.preventDefault(); Drawers.closeNotifications(); return; }
        if (action === 'close-comments') { e.preventDefault(); Drawers.closeComments(); return; }
        if (action === 'close-search') { e.preventDefault(); Search.close(); return; }
        if (action === 'search-clear') { e.preventDefault(); Search.clearInput(); return; }
        if (action === 'close-post-view') { e.preventDefault(); PostView.close(); return; }
        if (action === 'post-view-menu') { e.preventDefault(); PostView.toggleMenu(btn); return; }
        if (action === 'post-view-like') { e.preventDefault(); PostView.toggleLike(btn); return; }
        if (action === 'post-view-save') { e.preventDefault(); PostView.toggleSave(btn); return; }
        if (action === 'post-view-share') { e.preventDefault(); PostView.share(); return; }
        if (action === 'post-view-copy-prompt') { e.preventDefault(); PostView.copyPrompt(btn); return; }
        if (action === 'post-view-edit') { e.preventDefault(); PostView.edit(); return; }
        if (action === 'post-view-delete') { e.preventDefault(); PostView.remove(); return; }
        if (action === 'post-view-report') { e.preventDefault(); PostView.report(); return; }
        if (action === 'post-view-follow') { e.preventDefault(); PostView.followAuthor(btn); return; }
        if (action === 'post-view-open-author') { e.preventDefault(); PostView.openAuthor(); return; }
        if (action === 'copy-handle') {
          e.preventDefault();
          const el = document.getElementById('profileHandle');
          const handle = el ? el.textContent.trim() : '';
          if (!handle) return;
          U.copy(handle).then(ok => Toast.show(ok ? 'تم نسخ المعرّف' : 'تعذّر النسخ', ok ? 'success' : 'error', 1600));
          return;
        }
      });

      document.addEventListener('click', (e) => {
        const tag = e.target.closest('.tag[data-tag]');
        if (tag) App.filterByTag(tag.dataset.tag);
      });

      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // أغلق قائمة PostView أولاً إن كانت مفتوحة
        const pvm = document.getElementById('pv2Menu');
        if (pvm && !pvm.hidden) { PostView.closeMenu(); return; }
        const pov = document.getElementById('postView');
        if (pov && !pov.hidden) { PostView.close(); return; }
        const sv = document.getElementById('searchView');
        if (sv && !sv.hidden) { Search.close(); return; }
        const pv = document.getElementById('profileView');
        if (pv && !pv.hidden) { ProfileView.close(); return; }
        const fd = document.getElementById('followersDrawer');
        if (fd && fd.getAttribute('data-open') === 'true') { FollowersDrawer.close(); return; }
        const cv = document.getElementById('composerView');
        const sv2 = document.getElementById('settingsView');
        const am = document.getElementById('authModal');
        if (cv && !cv.hidden) { Composer.close(); return; }
        if (sv2 && !sv2.hidden) { Settings.close(); return; }
        if (am && am.getAttribute('data-open') === 'true') { Auth.close(); return; }
        Drawers.closeAll();
      });

      document.querySelectorAll('.composer-trigger').forEach(trigger => {
        trigger.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            if (window.Composer) Composer.open();
          }
        });
      });
    },

    bindNav() {
      const themeBtn = document.querySelector('button[aria-label="تبديل المظهر"]');
      if (themeBtn) { themeBtn.removeAttribute('onclick'); themeBtn.addEventListener('click', () => Theme.toggle()); }
      const signIn = document.getElementById('signInBtn');
      if (signIn) { signIn.removeAttribute('onclick'); signIn.addEventListener('click', () => Auth.open('login')); }
      const avatarBtn = document.getElementById('avatarBtn');
      if (avatarBtn) {
        avatarBtn.removeAttribute('onclick');
        avatarBtn.addEventListener('click', () => { if (S.me) this.switchTab('profile'); else Auth.open('login'); });
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
            if (window.Settings) Settings.open();
            else Toast.show('تعذّر فتح الإعدادات', 'error');
          } else { this.switchTab(tab); }
        });
      });
      const create = document.querySelector('.dock-create');
      if (create) {
        create.removeAttribute('onclick');
        create.addEventListener('click', () => { if (window.Composer) Composer.open(); });
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
            results.innerHTML = '<div style="padding:var(--sp-4);text-align:center;color:var(--fg-3);font-size:var(--fs-2)">لا نتائج</div>';
          } else {
            results.innerHTML = items.map(p =>
              '<div class="search-result" data-post-id="' + p.id + '">' +
                '<img src="' + U.escapeHtml(p.image || '') + '" alt="" loading="lazy">' +
                '<div class="search-result-info"><strong>' + U.escapeHtml(p.title || '') + '</strong>' +
                '<span>' + U.escapeHtml((p.prompt || '').slice(0, 80)) + '</span></div>' +
              '</div>'
            ).join('');
            results.querySelectorAll('.search-result').forEach(r => {
              r.addEventListener('click', () => {
                const pid = parseInt(r.dataset.postId, 10);
                results.setAttribute('data-open', 'false');
                input.value = '';
                if (pid) PostView.open(pid);
              });
            });
          }
          results.setAttribute('data-open', 'true');
        } catch (err) {}
      }, CFG.SEARCH_DEBOUNCE);

      input.addEventListener('input', run);
      input.addEventListener('focus', () => { if (input.value.trim()) results.setAttribute('data-open', 'true'); });

      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const q = input.value.trim();
        results.setAttribute('data-open', 'false');
        input.blur();
        Search.open(q);
      });

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
          if (window.Search) Search.open('');
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
      document.querySelectorAll('[data-action="landing-cta-register"]').forEach(b => {
        b.addEventListener('click', () => Auth.open('register'));
      });
      document.querySelectorAll('[data-action="landing-cta-preview"]').forEach(b => {
        b.addEventListener('click', () => this.previewFeed());
      });
    },

    showLanding() {
      const landing = document.getElementById('view-landing');
      const appView = document.getElementById('view-app');
      if (landing) { landing.hidden = false; landing.classList.add('is-active'); }
      if (appView) appView.hidden = true;
      const dock = document.getElementById('dock');
      if (dock) dock.hidden = true;
      document.querySelectorAll('.nav-links').forEach(n => n.style.display = '');
    },

    showApp() {
      const landing = document.getElementById('view-landing');
      const appView = document.getElementById('view-app');
      if (landing) { landing.hidden = true; landing.classList.remove('is-active'); }
      if (appView) { appView.hidden = false; appView.classList.add('is-active'); }
      const dock = document.getElementById('dock');
      if (dock) dock.hidden = !S.me;
      document.querySelectorAll('.nav-links').forEach(n => n.style.display = 'none');
    },

    previewFeed() { if (!S.me) { Auth.open('register'); return; } this.showApp(); this.switchTab('home'); },

    activateTab(name) {
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('is-active', p.dataset.tab === name));
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
      if (name === 'home' || name === 'explore') Feed.load(name);
      else if (name === 'chat') Chat.loadList();
      else if (name === 'profile') { if (S.viewingUser) Profile.load(S.viewingUser.id); else Profile.load(); }
      else if (name === 'liked' || name === 'saved') Feed.load(name);
      if (!opts.noScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    setSort(sort) {
      S.sort = sort;
      document.querySelectorAll('.sort-tab').forEach(b => b.setAttribute('aria-selected', b.dataset.sort === sort ? 'true' : 'false'));
      Feed.reset('home'); Feed.reset('explore');
      Feed.load(S.tab === 'explore' ? 'explore' : 'home', { force: true });
    },

    filterByTag(tag) {
      if (!tag) return;
      S.filterTag = tag; S.sort = 'recent';
      this.switchTab('explore');
      Feed.reset('explore');
      Feed.load('explore', { force: true });
    },

    openProfile(userId) { if (!userId) return; ProfileView.open(userId); },

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
        const p = document.getElementById('heroStatPosts');
        const u = document.getElementById('heroStatUsers');
        if (p) p.textContent = U.formatNumber(health.posts || 0);
        if (u) u.textContent = U.formatNumber(health.users || 0);
      } catch (e) {}
    },
  };

  /* ═══════════ AUDIO UNLOCK ═══════════ */
  function unlockAudioOnce() {
    if (window.Sounds) Sounds.unlock();
    ['click', 'touchstart', 'keydown'].forEach(evt => document.removeEventListener(evt, unlockAudioOnce));
  }
  ['click', 'touchstart', 'keydown'].forEach(evt => {
    document.addEventListener(evt, unlockAudioOnce, { once: true, passive: true });
  });

  /* ═══════════ EXPORT + BOOT ═══════════ */
  window.App = App;
  window.Auth = Auth;
  window.Post = Post;
  window.Chat = Chat;
  window.Comments = Comments;
  window.Drawers = Drawers;
  window.Composer = Composer;
  window.Profile = Profile;
  window.ProfileView = ProfileView;
  window.PostView = PostView;
  window.FollowersDrawer = FollowersDrawer;
  window.NotificationsLoader = NotificationsLoader;
  window.ConfirmModal = ConfirmModal;
  window.ReportModal = ReportModal;
  window.Search = Search;
  window.Explore = Explore;
  window.Settings = Settings;
  window.Toast = Toast;
  window.Install = Install;
  window.U = U;
  window.Theme = Theme;

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.prompt-menu-wrap')) {
      if (window.Post && Post.closeAllMenus) Post.closeAllMenus();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.boot());
  } else {
    App.boot();
  }
})();