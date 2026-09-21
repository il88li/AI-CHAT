/* ═══════════════════════════════════════════════════════════════
   خَيال — app.js MINIMAL SAFE v7.2
   ES5-only · No build step · Failure-proof
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  console.log('[خَيال] app.js v7.2 loading…');

  /* ─────────────── Helpers ─────────────── */
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var byId = function (x) { return document.getElementById(x); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c;
    });
  };

  /* ─────────────── State ─────────────── */
  var S = {
    me: (typeof window.__ME__ !== 'undefined' && window.__ME__) || null,
    tab: 'home',
    activePost: null,
    activeChat: null,
    chats: [],
  };

  /* ─────────────── Toast ─────────────── */
  function toast(msg, tone) {
    var wrap = byId('toastWrap');
    if (!wrap) { console.log('[toast]', msg); return; }
    var t = document.createElement('div');
    t.className = 'toast';
    if (tone) t.setAttribute('data-tone', tone);
    var icon = tone === 'success' ? 'ph-check-circle'
             : tone === 'error' ? 'ph-warning-circle'
             : tone === 'warning' ? 'ph-warning-circle'
             : 'ph-info';
    t.innerHTML = '<i class="ph ' + icon + '"></i><span>' + esc(msg) + '</span>';
    wrap.appendChild(t);
    setTimeout(function () {
      t.style.opacity = '0';
      t.style.transition = 'opacity .2s';
      setTimeout(function () { t.remove(); }, 220);
    }, 2400);
  }

  /* ─────────────── Layer (modals/sheets/drawers) ─────────────── */
  var Layer = {
    open: function (ref) {
      var n = typeof ref === 'string' ? byId(ref) : ref;
      if (!n) { console.warn('[Layer] not found:', ref); return; }
      n.setAttribute('data-open', 'true');
      n.removeAttribute('hidden');
      document.body.style.overflow = 'hidden';
    },
    close: function (ref) {
      var n = typeof ref === 'string' ? byId(ref) : ref;
      if (!n) return;
      n.setAttribute('data-open', 'false');
      document.body.style.overflow = '';
    }
  };

  /* ─────────────── AUTH ─────────────── */
  var Auth = {
    open: function (mode) {
      mode = mode || 'login';
      if (S.me) { toast('أنت مسجل دخول بالفعل'); return; }
      var m = byId('authModal');
      if (!m) { alert('نافذة الدخول غير موجودة'); return; }

      var tabs = $('.auth-tabs');
      if (tabs) tabs.setAttribute('data-mode', mode);
      $$('.auth-tab').forEach(function (t) {
        t.setAttribute('aria-selected', t.getAttribute('data-mode') === mode ? 'true' : 'false');
      });
      $$('.auth-form').forEach(function (f) {
        if (f.id === mode + 'Form') f.classList.add('is-active');
        else f.classList.remove('is-active');
      });
      var title = byId('authTitle');
      if (title) title.textContent = mode === 'login' ? 'تسجيل الدخول' : 'أنشئ حسابك';
      var sub = byId('authSub');
      if (sub) sub.textContent = mode === 'login' ? 'أهلاً بعودتك إلى خَيال' : 'دقيقة واحدة للانضمام';

      Layer.open(m);
      setTimeout(function () {
        var inp = byId(mode === 'register' ? 'regName' : 'loginIdentifier');
        if (inp) inp.focus();
      }, 200);
    },

    close: function (e) {
      if (e && e.target !== e.currentTarget) return;
      Layer.close('authModal');
    },

    switchMode: function (mode) { Auth.open(mode); },

    togglePassword: function (btn) {
      var wrap = btn.closest('.input-wrap');
      var inp = wrap ? wrap.querySelector('input') : null;
      if (!inp) return;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      var i = btn.querySelector('i');
      if (i) i.className = inp.type === 'password' ? 'ph ph-eye' : 'ph ph-eye-slash';
    },

    checkStrength: function () {},

    login: function (e) {
      if (e) e.preventDefault();
      var idn = (byId('loginIdentifier') || {}).value;
      var pw = (byId('loginPassword') || {}).value;
      if (!idn || !pw) { toast('أدخل البيانات', 'warning'); return; }
      var btn = byId('loginSubmit');
      if (btn) btn.setAttribute('aria-busy', 'true');

      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          identifier: idn.trim(),
          password: pw,
          remember: true
        })
      })
        .then(function (r) {
          return r.json().then(function (d) { return { ok: r.ok, d: d }; });
        })
        .then(function (res) {
          if (!res.ok) throw new Error((res.d && res.d.error) || 'فشل الدخول');
          toast('مرحباً ' + (res.d.name || '') + '!', 'success');
          setTimeout(function () { location.reload(); }, 500);
        })
        .catch(function (err) {
          toast(err.message || 'فشل الدخول', 'error');
          if (btn) btn.removeAttribute('aria-busy');
        });
    },

    register: function (e) {
      if (e) e.preventDefault();
      var name = (byId('regName') || {}).value;
      var username = (byId('regUsername') || {}).value;
      var email = (byId('regEmail') || {}).value;
      var password = (byId('regPassword') || {}).value;
      var agree = byId('agreeTerms');
      if (agree && !agree.checked) { toast('وافق على الشروط أولاً', 'warning'); return; }
      if (!name || !username || !email || !password) { toast('أكمل كل الحقول', 'warning'); return; }
      var btn = byId('registerSubmit');
      if (btn) btn.setAttribute('aria-busy', 'true');

      fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: name.trim(),
          username: username.trim(),
          email: email.trim(),
          password: password
        })
      })
        .then(function (r) {
          return r.json().then(function (d) { return { ok: r.ok, d: d }; });
        })
        .then(function (res) {
          if (!res.ok) throw new Error((res.d && res.d.error) || 'فشل التسجيل');
          toast('مرحباً بك في خَيال!', 'success');
          setTimeout(function () { location.reload(); }, 600);
        })
        .catch(function (err) {
          toast(err.message || 'فشل التسجيل', 'error');
          if (btn) btn.removeAttribute('aria-busy');
        });
    },

    logout: function () {
      if (!confirm('تسجيل الخروج؟')) return;
      fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
        .then(function () { location.reload(); })
        .catch(function () { location.reload(); });
    },

    openEditProfile: function () { toast('قريباً'); },
    closeEditProfile: function () {},
    saveProfile: function (e) { if (e) e.preventDefault(); }
  };

  /* ─────────────── APP ─────────────── */
  var App = {
    switchTab: function (tab) {
      if (!tab) return;
      S.tab = tab;
      $$('.tab-panel').forEach(function (p) {
        if (p.getAttribute('data-tab') === tab) p.classList.add('is-active');
        else p.classList.remove('is-active');
      });
      $$('.dock-item[data-tab]').forEach(function (b) {
        b.setAttribute('aria-current', b.getAttribute('data-tab') === tab ? 'page' : 'false');
      });
      try {
        var url = new URL(location.href);
        url.hash = tab === 'home' ? '' : tab;
        history.replaceState(null, '', url.toString());
      } catch (_) {}
      window.scrollTo(0, 0);
    },

    toggleTheme: function () {
      var cur = document.documentElement.getAttribute('data-theme') || 'dark';
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      var i = byId('themeIcon');
      if (i) i.className = next === 'dark' ? 'ph ph-moon' : 'ph ph-sun';
      try { localStorage.setItem('kh_theme', next); } catch (_) {}
    },

    previewFeed: function () {
      try { localStorage.setItem('kh_entered_app', 'true'); } catch (_) {}
      var landing = byId('view-landing');
      var app = byId('view-app');
      var dock = byId('dock');
      if (landing) landing.hidden = true;
      if (app) app.hidden = false;
      if (dock) dock.hidden = false;
      window.scrollTo(0, 0);
      App.switchTab('home');
    },

    goHome: function () {
      try { localStorage.removeItem('kh_entered_app'); } catch (_) {}
      var landing = byId('view-landing');
      var app = byId('view-app');
      var dock = byId('dock');
      if (landing) landing.hidden = false;
      if (app) app.hidden = true;
      if (dock) dock.hidden = true;
      window.scrollTo(0, 0);
    },

    setSort: function (sort) {
      $$('.sort-tab').forEach(function (t) {
        t.setAttribute('aria-selected', t.getAttribute('data-sort') === sort ? 'true' : 'false');
      });
      toast('ترتيب: ' + sort);
    },

    refreshAll: function () { location.reload(); },
    openProfile: function () { toast('صفحة المبدع قريباً'); },
    filterByTag: function () {},
    scrollTo: function () {},
    applyTheme: function () {},
    handleHashChange: function () {},
    init: function () {},
    updateUserUI: function () {},
    onAuthChange: function () {}
  };

  /* ─────────────── POST (like/save/copy) ─────────────── */
  var Post = {
    like: function (btn, postId) {
      if (!S.me) { Auth.open('login'); return; }
      if (!postId) return;
      var wasLiked = btn.getAttribute('aria-pressed') === 'true';
      var next = !wasLiked;

      $$('[data-post-id="' + postId + '"] [data-action="like"]').forEach(function (x) {
        x.setAttribute('aria-pressed', next ? 'true' : 'false');
      });

      fetch('/api/posts/' + postId + '/like', { method: 'POST', credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          $$('[data-post-id="' + postId + '"] [data-action="like"]').forEach(function (x) {
            x.setAttribute('aria-pressed', d.liked ? 'true' : 'false');
          });
          $$('[data-post-id="' + postId + '"] [data-likes-count]').forEach(function (x) {
            x.textContent = String(d.likes || 0);
          });
        })
        .catch(function () {
          $$('[data-post-id="' + postId + '"] [data-action="like"]').forEach(function (x) {
            x.setAttribute('aria-pressed', wasLiked ? 'true' : 'false');
          });
          toast('فشل الإعجاب', 'error');
        });
    },

    save: function (btn, postId) {
      if (!S.me) { Auth.open('login'); return; }
      if (!postId) return;
      var wasSaved = btn.getAttribute('aria-pressed') === 'true';
      var next = !wasSaved;

      $$('[data-post-id="' + postId + '"] [data-action="save"]').forEach(function (x) {
        x.setAttribute('aria-pressed', next ? 'true' : 'false');
      });

      fetch('/api/posts/' + postId + '/save', { method: 'POST', credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          toast(d.saved ? 'تم الحفظ' : 'أُزيل من المحفوظة', 'success');
        })
        .catch(function () {
          $$('[data-post-id="' + postId + '"] [data-action="save"]').forEach(function (x) {
            x.setAttribute('aria-pressed', wasSaved ? 'true' : 'false');
          });
          toast('فشل الحفظ', 'error');
        });
    },

    copy: function (postId, btn) {
      var card = btn ? btn.closest('.prompt-card') : null;
      var ex = card ? card.querySelector('.prompt-excerpt') : null;
      var text = ex ? ex.textContent.trim() : '';
      if (!text) { toast('لا يوجد نص', 'warning'); return; }

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text)
          .then(function () { toast('تم النسخ', 'success'); })
          .catch(function () { toast('فشل النسخ', 'error'); });
      } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); toast('تم النسخ', 'success'); }
        catch (_) { toast('فشل النسخ', 'error'); }
        ta.remove();
      }
    },

    open: function () { toast('قريباً'); }
  };

  /* ─────────────── COMPOSER ─────────────── */
  var Composer = {
    open: function () {
      if (!S.me) { Auth.open('login'); return; }
      var m = byId('composerModal');
      if (!m) return;
      Layer.open(m);
    },

    close: function (e) {
      if (e && e.target !== e.currentTarget) return;
      Layer.close('composerModal');
      Composer._reset();
    },

    _reset: function () {
      var types = byId('composerTypes');
      var form = byId('composerForm');
      var prev = byId('imgPreview');
      if (types) types.hidden = false;
      if (form) { form.reset(); form.classList.remove('is-active'); }
      if (prev) prev.hidden = true;
    },

    chooseType: function (type) {
      var types = byId('composerTypes');
      var form = byId('composerForm');
      var imgF = byId('imageField');
      var promptEl = byId('cPrompt');
      if (types) types.hidden = true;
      if (form) form.classList.add('is-active');
      if (imgF) imgF.hidden = type !== 'prompt';
      if (promptEl) {
        promptEl.placeholder = type === 'prompt' ? 'اكتب البرومبت…' : 'اكتب نص المنشور…';
      }
      setTimeout(function () { var t = byId('cTitle'); if (t) t.focus(); }, 100);
    },

    previewImage: function (url) {
      var p = byId('imgPreview');
      var i = byId('imgPreviewEl');
      if (!p || !i) return;
      if (url && /^https?:\/\//.test(url)) {
        i.src = url;
        p.hidden = false;
      } else {
        p.hidden = true;
      }
    },

    clearPreview: function () {
      var p = byId('imgPreview');
      var i = byId('imgPreviewEl');
      var inp = byId('cImage');
      if (p) p.hidden = true;
      if (i) i.src = '';
      if (inp) inp.value = '';
    },

    publish: function (e) {
      if (e) e.preventDefault();
      if (!S.me) { Auth.open('login'); return; }
      var title = (byId('cTitle') || {}).value || '';
      var prompt = (byId('cPrompt') || {}).value || '';
      if (!title.trim() || !prompt.trim()) {
        toast('أكمل العنوان والنص', 'warning');
        return;
      }
      var tagsRaw = (byId('cTags') || {}).value || '';
      var tags = tagsRaw.split(/[،,]/).map(function (s) { return s.trim(); }).filter(Boolean);
      var btn = byId('composerSubmit');
      if (btn) btn.setAttribute('aria-busy', 'true');

      var payload = {
        title: title.trim(),
        prompt: prompt.trim(),
        image: (byId('cImage') || {}).value || '',
        model: (byId('cModel') || {}).value || '',
        tags: tags
      };

      fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      })
        .then(function (r) {
          return r.json().then(function (d) { return { ok: r.ok, d: d }; });
        })
        .then(function (res) {
          if (!res.ok) throw new Error((res.d && res.d.error) || 'فشل النشر');
          toast('تم النشر!', 'success');
          Composer.close();
          setTimeout(function () { location.reload(); }, 700);
        })
        .catch(function (err) {
          toast(err.message || 'فشل النشر', 'error');
          if (btn) btn.removeAttribute('aria-busy');
        });
    }
  };

  /* ─────────────── CHAT ─────────────── */
  var Chat = {
    newChat: function () { toast('اختر مستخدماً للبدء'); },
    attach: function () { toast('قريباً'); },
    filterList: function () {},
    open: function () {},
    showList: function () {},
    send: function (e) { if (e) e.preventDefault(); }
  };

  /* ─────────────── DRAWERS ─────────────── */
  var Drawers = {
    openComments: function (postId) {
      var m = byId('commentsDrawer');
      var scrim = byId('commentsScrim');
      var body = byId('commentsBody');
      if (!m) return;

      Layer.open(m);
      if (scrim) scrim.setAttribute('data-open', 'true');
      if (body) {
        body.innerHTML = '<div class="empty-block"><i class="ph ph-circle-notch" style="animation:spin .8s linear infinite"></i></div>';
      }
      S.activePost = postId;

      fetch('/api/posts/' + postId + '/comments')
        .then(function (r) { return r.json(); })
        .then(function (list) {
          if (!body) return;
          if (!list.length) {
            body.innerHTML = '<div class="empty-block"><i class="ph ph-chat-circle"></i><h4>لا تعليقات بعد</h4></div>';
          } else {
            body.innerHTML = list.map(function (c) {
              var a = c.author_data || {};
              return '<div class="comment">'
                + '<img class="avatar avatar-sm" src="' + esc(a.avatar || '') + '" alt="">'
                + '<div class="comment-body">'
                + '<div class="comment-top"><span class="comment-name">' + esc(a.name || '') + '</span></div>'
                + '<div class="comment-text">' + esc(c.text || '') + '</div>'
                + '</div></div>';
            }).join('');
          }
        })
        .catch(function () {
          if (body) body.innerHTML = '<div class="empty-block"><i class="ph ph-warning-circle"></i><h4>تعذّر التحميل</h4></div>';
        });
    },

    closeComments: function () {
      Layer.close('commentsDrawer');
      var scrim = byId('commentsScrim');
      if (scrim) scrim.setAttribute('data-open', 'false');
      S.activePost = null;
    }
  };

  var Comments = {
    send: function (e) { if (e) e.preventDefault(); },
    delete: function () {}
  };

  /* ─────────────── EXPLORE ─────────────── */
  var Explore = {
    openCollection: function (kind) { toast('فتح: ' + kind); }
  };

  /* ─────────────── INSTALL (PWA) ─────────────── */
  var Install = {
    prompt: function () { toast('افتح القائمة واختر "إضافة للشاشة"'); },
    dismiss: function () {
      var b = byId('installBanner');
      if (b) b.hidden = true;
    }
  };

  /* ─────────────── U (utility stub — templates expect it) ─────────────── */
  var U = {
    toast: toast,
    formatNumber: function (n) { return String(n || 0); },
    formatTime: function () { return ''; },
    autoGrow: function (ta) {
      if (!ta) return;
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    },
    debounce: function (fn) { return fn; },
    copy: function () {},
    vibrate: function () {},
    focusTrap: function () { return function () {}; },
    lockScroll: function () {}
  };

  /* ─────────────── Expose to window (before anything else) ─────────────── */
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
  window.U = U;

  console.log('[خَيال] exposed:', {
    Auth: typeof window.Auth,
    App: typeof window.App,
    Post: typeof window.Post,
    Composer: typeof window.Composer,
    Chat: typeof window.Chat,
    Drawers: typeof window.Drawers
  });

  /* ─────────────── Global form submission (safety net) ─────────────── */
  document.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    var f = e.target;
    if (!f || f.tagName !== 'FORM') return;
    var fid = f.id;
    if (fid === 'loginForm') { e.preventDefault(); Auth.login(e); }
    else if (fid === 'registerForm') { e.preventDefault(); Auth.register(e); }
    else if (fid === 'composerForm') { e.preventDefault(); Composer.publish(e); }
    else if (fid === 'commentForm') { e.preventDefault(); Comments.send(e); }
    else if (f.classList && f.classList.contains('chat-composer')) { e.preventDefault(); Chat.send(e); }
  }, false);

  /* ─────────────── Theme from storage ─────────────── */
  try {
    var savedTheme = localStorage.getItem('kh_theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
      var ti = byId('themeIcon');
      if (ti) ti.className = savedTheme === 'dark' ? 'ph ph-moon' : 'ph ph-sun';
    }
  } catch (_) {}

  console.log('[خَيال] ✓ app.js v7.2 ready');
})();