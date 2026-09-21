/* ═══════════════════════════════════════════════════════════════
   خَيال — app.js v9.0
   Instagram-style feed · Profile complete · All modules
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  console.log('[خَيال] app.js v9.0');

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var byId = function (x) { return document.getElementById(x); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c;
    });
  };

  var S = {
    me: (typeof window.__ME__ !== 'undefined' && window.__ME__) || null,
    tab: 'home',
    sort: 'recent',
    filter: null,
    posts: { home: [], explore: [], liked: [], saved: [], profile: [], landing: [] },
    activePost: null,
    activeChat: null,
    chats: [],
    reducedMotion: false,
    pendingLikes: {},
    pendingSaves: {}
  };
  window.__State = S;
  try { S.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}

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

  var Layer = {
    open: function (ref) {
      var n = typeof ref === 'string' ? byId(ref) : ref;
      if (!n) return;
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

  var Render = {
    prompt: function (p) {
      var a = p.author_data || {};
      var tags = Array.isArray(p.tags) ? p.tags : [];
      var img = p.image || 'https://placehold.co/800x600/0E0E14/22D3EE?text=خَيال';
      var liked = p.liked ? 'true' : 'false';
      var saved = p.saved ? 'true' : 'false';
      return '<article class="prompt-card" data-post-id="' + p.id + '">' +
        '<div class="prompt-media">' +
          '<img src="' + esc(img) + '" alt="' + esc(p.title) + '" loading="lazy" decoding="async" data-state="loading" onload="this.dataset.state=\'loaded\'" onerror="this.dataset.state=\'error\'">' +
          (p.model ? '<span class="prompt-model"><i class="ph ph-sparkle"></i> ' + esc(p.model) + '</span>' : '') +
          '<div class="prompt-floats">' +
            '<button class="float-btn" data-action="like" data-post="' + p.id + '" aria-pressed="' + liked + '" aria-label="إعجاب" type="button"><i class="ph ph-heart"></i></button>' +
            '<button class="float-btn" data-action="save" data-post="' + p.id + '" aria-pressed="' + saved + '" aria-label="حفظ" type="button"><i class="ph ph-bookmark-simple"></i></button>' +
          '</div>' +
        '</div>' +
        '<div class="prompt-body">' +
          (a.id ? '<div class="prompt-author" data-action="open-user-profile" data-user="' + a.id + '"><img class="avatar avatar-sm" src="' + esc(a.avatar || '') + '" alt="" loading="lazy"><div class="prompt-author-info"><span class="prompt-author-name">' + esc(a.name || '') + (a.verified ? ' <i class="ph ph-seal-check"></i>' : '') + '</span><span class="prompt-author-meta">' + esc(a.handle || '') + '</span></div></div>' : '') +
          '<h3 class="prompt-title">' + esc(p.title) + '</h3>' +
          '<div class="prompt-excerpt" data-action="copy" data-post="' + p.id + '">' + esc(p.prompt) + '<button type="button" class="prompt-excerpt-copy" aria-label="نسخ"><i class="ph ph-copy"></i></button></div>' +
          (tags.length ? '<div class="prompt-tags">' + tags.slice(0, 4).map(function (t) { return '<button class="tag" type="button" data-action="filter-tag" data-tag="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div>' : '') +
        '</div>' +
        '<div class="prompt-actions">' +
          '<button class="action" data-action="like" data-post="' + p.id + '" aria-pressed="' + liked + '" type="button"><i class="ph ph-heart"></i><span data-likes-count>' + U.num(p.likes) + '</span></button>' +
          '<button class="action" data-action="open-comments" data-post="' + p.id + '" type="button"><i class="ph ph-chat-circle"></i><span>' + U.num(p.comments) + '</span></button>' +
          '<button class="action action-primary" data-action="copy" data-post="' + p.id + '" type="button"><i class="ph ph-copy"></i><span>نسخ</span></button>' +
        '</div>' +
      '</article>';
    },

    skeleton: function () {
      return '<article class="prompt-card skeleton-card" aria-hidden="true"><div class="prompt-media skeleton skeleton-media"></div><div class="prompt-body"><div class="skeleton skeleton-line" style="width:55%"></div><div class="skeleton skeleton-line" style="width:85%;height:18px"></div><div class="skeleton skeleton-line" style="width:100%"></div><div class="skeleton skeleton-line" style="width:75%"></div></div></article>';
    },

    empty: function (title, icon, text) {
      return '<div class="empty-block"><i class="ph ' + (icon || 'ph-sparkle') + '"></i><h4>' + esc(title) + '</h4>' + (text ? '<p>' + esc(text) + '</p>' : '') + '</div>';
    },

    emptyFor: function (which) {
      var m = {
        home: ['لا توجد برومبتات بعد', 'ph-sparkle', 'كن أول من ينشر!'],
        explore: ['لا يوجد استكشاف بعد', 'ph-compass', 'عُد لاحقاً'],
        liked: ['لا توجد إعجابات بعد', 'ph-heart', 'ابدأ بوضع قلبك'],
        saved: ['المكتبة فارغة', 'ph-bookmark-simple', 'احفظ البرومبتات'],
        profile: ['لم تنشر بعد', 'ph-image-square', 'شارك أول برومبت']
      };
      var c = m[which] || m.home;
      return Render.empty(c[0], c[1], c[2]);
    },

    comment: function (c) {
      var a = c.author_data || {};
      var canDel = S.me && a.id === S.me.id;
      return '<div class="comment" data-comment-id="' + c.id + '">' +
        '<img class="avatar avatar-sm" src="' + esc(a.avatar || '') + '" alt="" loading="lazy">' +
        '<div class="comment-body">' +
          '<div class="comment-top"><span class="comment-name">' + esc(a.name || '') + '</span><span class="comment-time">' + U.time(c.time) + '</span></div>' +
          '<div class="comment-text">' + esc(c.text || '') + '</div>' +
          (canDel ? '<div class="comment-actions"><button type="button" data-action="delete-comment" data-comment="' + c.id + '"><i class="ph ph-trash"></i> حذف</button></div>' : '') +
        '</div>' +
      '</div>';
    },

    chatItem: function (c) {
      var o = c.with_user || {};
      return '<button class="chat-item" data-action="open-chat" data-chat="' + c.id + '" data-name="' + esc(o.name || '') + '" aria-current="' + (S.activeChat === c.id ? 'true' : 'false') + '" type="button">' +
        '<img class="avatar" src="' + esc(o.avatar || '') + '" alt="" loading="lazy">' +
        '<div class="chat-item-info">' +
          '<div class="chat-item-top"><span class="chat-item-name">' + esc(o.name || 'محادثة') + '</span><span class="chat-item-time">' + esc(c.time || '') + '</span></div>' +
          '<div class="chat-item-preview">' + esc(c.last || '') + '</div>' +
        '</div>' +
        (c.unread ? '<span class="badge badge-dot"></span>' : '') +
      '</button>';
    },

    message: function (m) {
      return '<div class="msg msg-' + (m.from === 'me' ? 'me' : 'them') + '">' + esc(m.text) + '<span class="msg-time">' + esc(m.time || '') + '</span></div>';
    }
  };

  var U = {
    toast: toast,
    num: function (n) {
      if (n == null) return '0';
      n = Number(n) || 0;
      if (n < 1000) return String(n);
      if (n < 1e6) return (n / 1000).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'K';
      return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    },
    time: function (iso) {
      if (!iso) return '';
      var d = new Date(iso);
      var sec = (Date.now() - d.getTime()) / 1000;
      if (sec < 60) return 'الآن';
      if (sec < 3600) return 'قبل ' + Math.floor(sec / 60) + ' د';
      if (sec < 86400) return 'قبل ' + Math.floor(sec / 3600) + ' س';
      if (sec < 604800) return 'قبل ' + Math.floor(sec / 86400) + ' ي';
      return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
    },
    autoGrow: function (ta) {
      if (!ta) return;
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    },
    debounce: function (fn, wait) {
      var t;
      return function () {
        var a = arguments, c = this;
        clearTimeout(t);
        t = setTimeout(function () { fn.apply(c, a); }, wait || 250);
      };
    },
    copy: function (text) {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
      }
      return new Promise(function (resolve, reject) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (_) {}
        ta.remove();
        ok ? resolve() : reject();
      });
    },
    buzz: function (ms) {
      if (S.reducedMotion) return;
      try { navigator.vibrate && navigator.vibrate(ms || 10); } catch (_) {}
    },
    lockScroll: function (lock) {
      document.body.style.overflow = lock ? 'hidden' : '';
    },
    focusTrap: function (container) {
      if (!container) return function () {};
      var sel = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
      var focusables = $$(sel).filter(function (x) { return container.contains(x) && x.offsetParent !== null; });
      var prev = document.activeElement;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      function onKey(e) {
        if (e.key !== 'Tab' || focusables.length === 0) return;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      container.addEventListener('keydown', onKey);
      if (first) setTimeout(function () { try { first.focus(); } catch (_) {} }, 60);
      return function () {
        container.removeEventListener('keydown', onKey);
        if (prev && prev.focus) { try { prev.focus(); } catch (_) {} }
      };
    }
  };

  /* ═══════ INFINITE SCROLL ═══════ */
  var Infinite = {
    _observers: {},
    _loading: {},
    _hasMore: { home: true, explore: true, liked: true, saved: true },

    attach: function (which) {
      var feedId = { home: 'homeFeed', explore: 'exploreFeed', liked: 'likedFeed', saved: 'savedFeed' }[which];
      var feed = byId(feedId);
      if (!feed) return;
      Infinite.detach(which);
      Infinite._hasMore[which] = true;

      var sentinelId = 'sentinel-' + which;
      var sentinel = byId(sentinelId);
      if (!sentinel) {
        sentinel = document.createElement('div');
        sentinel.id = sentinelId;
        sentinel.style.cssText = 'height:1px;width:100%;grid-column:1/-1;pointer-events:none;';
        feed.parentNode.insertBefore(sentinel, feed.nextSibling);
      }

      Infinite._observers[which] = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        if (Infinite._loading[which] || !Infinite._hasMore[which]) return;
        Infinite.loadMore(which);
      }, { rootMargin: '600px 0px' });

      Infinite._observers[which].observe(sentinel);
    },

    detach: function (which) {
      if (Infinite._observers[which]) {
        Infinite._observers[which].disconnect();
        delete Infinite._observers[which];
      }
      var sentinel = byId('sentinel-' + which);
      if (sentinel) sentinel.remove();
    },

    loadMore: function (which) {
      if (Infinite._loading[which] || !Infinite._hasMore[which]) return;
      Infinite._loading[which] = true;

      var posts = S.posts[which] || [];
      var lastId = posts.length ? posts[posts.length - 1].id : null;
      if (!lastId) { Infinite._loading[which] = false; return; }

      var feedId = { home: 'homeFeed', explore: 'exploreFeed', liked: 'likedFeed', saved: 'savedFeed' }[which];
      var feed = byId(feedId);
      if (!feed) { Infinite._loading[which] = false; return; }

      var loader = document.createElement('div');
      loader.className = 'load-more';
      loader.id = 'loader-' + which;
      loader.innerHTML = '<span class="spinner"></span><span>جارٍ التحميل…</span>';
      var sentinel = byId('sentinel-' + which);
      feed.parentNode.insertBefore(loader, sentinel);

      var url = '/api/posts?limit=20&before_id=' + lastId;
      if (which === 'home') {
        url += '&sort=' + (S.sort || 'recent');
        if (S.filter) url += '&tag=' + encodeURIComponent(S.filter);
      } else if (which === 'explore') {
        url += '&sort=top';
      }

      fetch(url, { credentials: 'same-origin' })
        .then(function (r) {
          Infinite._hasMore[which] = r.headers.get('X-Has-More') === 'true';
          return r.json();
        })
        .then(function (newPosts) {
          loader.remove();
          if (!newPosts.length) { Infinite._hasMore[which] = false; return; }
          var filtered = newPosts;
          if (which === 'liked') filtered = newPosts.filter(function (p) { return p.liked; });
          if (which === 'saved') filtered = newPosts.filter(function (p) { return p.saved; });

          var frag = document.createDocumentFragment();
          filtered.forEach(function (p, i) {
            var wrap = document.createElement('div');
            wrap.innerHTML = Render.prompt(p);
            var card = wrap.firstElementChild;
            card.style.opacity = '0';
            card.style.transform = 'translateY(12px)';
            card.style.transition = 'opacity .35s var(--ease-out) ' + Math.min(i * 30, 300) + 'ms, transform .35s var(--ease-out) ' + Math.min(i * 30, 300) + 'ms';
            frag.appendChild(card);
            S.posts[which].push(p);
          });
          feed.appendChild(frag);
          requestAnimationFrame(function () {
            var newCards = feed.querySelectorAll('.prompt-card[style*="opacity: 0"]');
            newCards.forEach(function (c) { c.style.opacity = '1'; c.style.transform = 'translateY(0)'; });
          });
        })
        .catch(function () {
          var l = byId('loader-' + which);
          if (l) l.remove();
          toast('تعذّر تحميل المزيد', 'error');
        })
        .finally(function () { Infinite._loading[which] = false; });
    }
  };

  /* ═══════ PTR ═══════ */
  var PTR = {
    _startY: 0, _currentY: 0, _pulling: false, _threshold: 80, _ptr: null,
    init: function () {
      PTR._ptr = byId('ptr');
      if (!PTR._ptr) return;
      document.addEventListener('touchstart', PTR.onStart, { passive: true });
      document.addEventListener('touchmove', PTR.onMove, { passive: false });
      document.addEventListener('touchend', PTR.onEnd, { passive: true });
    },
    onStart: function (e) {
      if (window.scrollY > 5) return;
      if (document.querySelector('.scrim[data-open="true"]')) return;
      if (S.tab !== 'home') return;
      PTR._startY = e.touches[0].clientY;
      PTR._pulling = true;
    },
    onMove: function (e) {
      if (!PTR._pulling) return;
      PTR._currentY = e.touches[0].clientY;
      var diff = PTR._currentY - PTR._startY;
      if (diff <= 0) { PTR.reset(); return; }
      var pull = Math.min(diff * 0.5, 120);
      PTR._ptr.classList.add('pulling');
      PTR._ptr.style.transform = 'translateY(' + pull + 'px)';
      PTR._ptr.style.marginTop = '0';
      if (pull > PTR._threshold) PTR._ptr.classList.add('ready');
      else PTR._ptr.classList.remove('ready');
    },
    onEnd: function () {
      if (!PTR._pulling) return;
      PTR._pulling = false;
      var diff = PTR._currentY - PTR._startY;
      var pull = Math.min(diff * 0.5, 120);
      if (pull > PTR._threshold) {
        PTR._ptr.classList.add('refreshing');
        PTR._ptr.style.transform = 'translateY(60px)';
        App.refreshAll().finally(function () { setTimeout(PTR.reset, 500); });
      } else { PTR.reset(); }
    },
    reset: function () {
      if (!PTR._ptr) return;
      PTR._ptr.classList.remove('pulling', 'ready', 'refreshing');
      PTR._ptr.style.transform = '';
      PTR._ptr.style.marginTop = '';
      PTR._startY = 0;
      PTR._currentY = 0;
    }
  };

  /* ═══════ NEW POSTS PILL ═══════ */
  var NewPostsPill = {
    _pill: null,
    ensure: function () {
      if (NewPostsPill._pill) return NewPostsPill._pill;
      var p = document.createElement('button');
      p.className = 'new-posts-pill';
      p.type = 'button';
      p.innerHTML = '<i class="ph ph-arrow-up"></i><span>منشورات جديدة</span>';
      p.addEventListener('click', function () {
        App.refreshAll();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        NewPostsPill.hide();
      });
      document.body.appendChild(p);
      NewPostsPill._pill = p;
      return p;
    },
    show: function () {
      var p = NewPostsPill.ensure();
      requestAnimationFrame(function () { p.classList.add('show'); });
    },
    hide: function () {
      if (NewPostsPill._pill) NewPostsPill._pill.classList.remove('show');
    }
  };

  /* ═══════ SCROLL MEMORY ═══════ */
  var ScrollMemory = {
    positions: {},
    save: function (tab) { ScrollMemory.positions[tab] = window.scrollY; },
    restore: function (tab) {
      var y = ScrollMemory.positions[tab] || 0;
      requestAnimationFrame(function () { window.scrollTo(0, y); });
    }
  };

  /* ═══════ AUTH ═══════ */
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
        f.classList.toggle('is-active', f.id === mode + 'Form');
      });
      var title = byId('authTitle');
      if (title) title.textContent = mode === 'login' ? 'تسجيل الدخول' : 'أنشئ حسابك';
      var sub = byId('authSub');
      if (sub) sub.textContent = mode === 'login' ? 'أهلاً بعودتك إلى خَيال' : 'دقيقة واحدة للانضمام';
      Layer.open(m);
      setTimeout(function () {
        var inp = byId(mode === 'register' ? 'regName' : 'loginIdentifier');
        if (inp) { try { inp.focus(); } catch (_) {} }
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
        body: JSON.stringify({ identifier: idn.trim(), password: pw, remember: true })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
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
        body: JSON.stringify({ name: name.trim(), username: username.trim(), email: email.trim(), password: password })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
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
    openEditProfile: function () { Profile.openEdit(); },
    closeEditProfile: function (e) { Profile.closeEdit(e); },
    saveProfile: function (e) { Profile.save(e); }
  };

  /* ═══════ APP ═══════ */
  var App = {
    switchTab: function (tab, opts) {
      opts = opts || {};
      if (!tab) return;
      if (['liked', 'saved', 'profile', 'chat'].indexOf(tab) >= 0 && !S.me) {
        Auth.open('login');
        return;
      }
      var prevTab = S.tab;
      if (prevTab !== tab) ScrollMemory.save(prevTab);
      S.tab = tab;

      $$('.tab-panel').forEach(function (p) {
        p.classList.toggle('is-active', p.getAttribute('data-tab') === tab);
      });
      $$('.dock-item[data-tab]').forEach(function (b) {
        b.setAttribute('aria-current', b.getAttribute('data-tab') === tab ? 'page' : 'false');
      });

      if (!opts.silent) {
        try {
          var url = new URL(location.href);
          url.hash = tab === 'home' ? '' : tab;
          history.replaceState(null, '', url.toString());
        } catch (_) {}
      }

      var loaders = {
        home: function () { App.loadFeed('home'); },
        explore: function () { App.loadFeed('explore'); },
        liked: function () { App.loadFeed('liked'); },
        saved: function () { App.loadFeed('saved'); },
        profile: function () { Profile.openMine(); },
        chat: function () { App.loadChats(); }
      };
      if (loaders[tab]) {
        try { loaders[tab](); } catch (e) { console.error(e); }
      }

      if (ScrollMemory.positions[tab]) ScrollMemory.restore(tab);
      else window.scrollTo(0, 0);
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
      App.switchTab('home', { silent: true });
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
      S.sort = sort;
      $$('.sort-tab').forEach(function (t) {
        t.setAttribute('aria-selected', t.getAttribute('data-sort') === sort ? 'true' : 'false');
      });
      S.posts.home = [];
      App.loadFeed('home');
    },

    filterByTag: function (tag) {
      S.filter = tag || null;
      S.posts.home = [];
      App.loadFeed('home');
    },

    refreshAll: function () {
      var btn = $('.refresh-btn');
      if (btn) btn.setAttribute('aria-busy', 'true');
      var promises = [];
      if (S.tab === 'home') {
        S.posts.home = [];
        promises.push(App.loadFeed('home'));
      }
      promises.push(App.loadChats());
      return Promise.all(promises).finally(function () {
        if (btn) btn.removeAttribute('aria-busy');
      });
    },

    loadLandingFeed: function () {
      var feed = byId('landingFeed');
      if (!feed) return;
      fetch('/api/posts?limit=6', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (posts) {
          S.posts.landing = posts;
          feed.innerHTML = posts.length ? posts.map(Render.prompt).join('') : Render.empty('لا توجد برومبتات بعد', 'ph-sparkle');
        })
        .catch(function () {});
    },

    loadFeed: function (which) {
      var feedId = { home: 'homeFeed', explore: 'exploreFeed', liked: 'likedFeed', saved: 'savedFeed' }[which];
      var feed = byId(feedId);
      if (!feed) return Promise.resolve();

      var isEmpty = !S.posts[which] || S.posts[which].length === 0;
      if (isEmpty) {
        feed.setAttribute('aria-busy', 'true');
        feed.innerHTML = Array(6).fill(Render.skeleton()).join('');
      }

      var url;
      if (which === 'liked' || which === 'saved') {
        url = '/api/posts?limit=50';
      } else if (which === 'home') {
        url = '/api/posts?limit=20&sort=' + S.sort;
        if (S.filter) url += '&tag=' + encodeURIComponent(S.filter);
      } else if (which === 'explore') {
        url = '/api/posts?limit=20&sort=top';
      }

      return fetch(url, { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (posts) {
          if (which === 'liked') posts = posts.filter(function (p) { return p.liked; });
          if (which === 'saved') posts = posts.filter(function (p) { return p.saved; });
          S.posts[which] = posts;

          if (which === 'liked' || which === 'saved') {
            App.updateCountPill(which, posts.length);
          }

          if (!posts.length) {
            feed.innerHTML = Render.emptyFor(which);
          } else {
            feed.innerHTML = posts.map(Render.prompt).join('');
            var cards = feed.querySelectorAll('.prompt-card:not(.skeleton-card)');
            cards.forEach(function (c, i) {
              c.style.opacity = '0';
              c.style.transform = 'translateY(8px)';
              c.style.transition = 'opacity .35s var(--ease-out) ' + Math.min(i * 30, 300) + 'ms, transform .35s var(--ease-out) ' + Math.min(i * 30, 300) + 'ms';
            });
            requestAnimationFrame(function () {
              cards.forEach(function (c) { c.style.opacity = '1'; c.style.transform = 'translateY(0)'; });
            });

            if (['home', 'explore', 'liked', 'saved'].indexOf(which) >= 0) {
              Infinite.attach(which);
            }
          }

          if (which === 'home') App.loadFilters(posts);
          if (which === 'explore') App.loadExploreFilters(posts);

          feed.setAttribute('aria-busy', 'false');
        })
        .catch(function (e) {
          console.error(e);
          feed.innerHTML = Render.empty('تعذّر التحميل', 'ph-warning-circle');
          feed.setAttribute('aria-busy', 'false');
        });
    },

    updateCountPill: function (which, n) {
      var pill = byId(which === 'liked' ? 'likedCount' : 'savedCount');
      if (!pill) return;
      pill.dataset.count = String(n);
      var lbl = pill.querySelector('[data-count-label]');
      if (lbl) lbl.textContent = U.num(n);
    },

    loadFilters: function (posts) {
      var wrap = byId('filters');
      if (!wrap) return;
      var tags = {};
      posts.forEach(function (p) { (p.tags || []).forEach(function (t) { tags[t] = true; }); });
      var keys = Object.keys(tags);
      if (keys.length === 0) { wrap.innerHTML = ''; return; }
      var top = keys.slice(0, 12);
      var html = '<button class="filter" data-tag="" aria-pressed="' + (!S.filter ? 'true' : 'false') + '" type="button"><i class="ph ph-squares-four"></i> الكل</button>';
      top.forEach(function (t) {
        html += '<button class="filter" data-tag="' + esc(t) + '" aria-pressed="' + (S.filter === t ? 'true' : 'false') + '" type="button">' + esc(t) + '</button>';
      });
      wrap.innerHTML = html;
    },

    loadExploreFilters: function (posts) {
      var wrap = byId('exploreFilters');
      if (!wrap) return;
      var models = {};
      posts.forEach(function (p) { if (p.model) models[p.model] = true; });
      var keys = Object.keys(models);
      if (keys.length === 0) { wrap.innerHTML = ''; return; }
      var html = '<button class="filter" aria-pressed="true" type="button"><i class="ph ph-squares-four"></i> الكل</button>';
      keys.slice(0, 8).forEach(function (m) {
        html += '<button class="filter" aria-pressed="false" type="button">' + esc(m) + '</button>';
      });
      wrap.innerHTML = html;
    },

    updateUserUI: function () {
      var signIn = byId('signInBtn');
      var avatarBtn = byId('avatarBtn');
      var avatarImg = byId('avatarImg');
      var cAvatar = byId('composerAvatar');
      var cFormAvatar = byId('composerFormAvatar');
      var cName = byId('composerUserName');
      if (S.me) {
        if (signIn) signIn.hidden = true;
        if (avatarBtn) avatarBtn.hidden = false;
        if (avatarImg) avatarImg.src = S.me.avatar || '';
        if (cAvatar) cAvatar.src = S.me.avatar || '';
        if (cFormAvatar) cFormAvatar.src = S.me.avatar || '';
        if (cName) cName.textContent = S.me.name || '—';
      } else {
        if (signIn) signIn.hidden = false;
        if (avatarBtn) avatarBtn.hidden = true;
      }
    },

    loadChats: function () {
      var list = byId('chatList');
      if (!list) return Promise.resolve();
      if (!S.me) {
        list.innerHTML = Render.empty('سجّل دخولك', 'ph-lock');
        return Promise.resolve();
      }
      return fetch('/api/chats', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (chats) {
          S.chats = chats;
          list.innerHTML = chats.length ? chats.map(Render.chatItem).join('') : Render.empty('لا محادثات', 'ph-chat-circle-dots');
          App.refreshChatsBadge();
        })
        .catch(function () {});
    },

    refreshChatsBadge: function () {
      if (!S.me) return;
      fetch('/api/chats', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (chats) {
          var unread = chats.reduce(function (s, c) { return s + (c.unread || 0); }, 0);
          var badge = byId('dockChatBadge');
          if (badge) {
            badge.hidden = unread === 0;
            badge.textContent = unread > 99 ? '99+' : String(unread);
          }
        })
        .catch(function () {});
    },

    doSearch: function (q) {
      var results = byId('searchResults');
      if (!results) return;
      if (!q || q.length < 2) { results.dataset.open = 'false'; return; }
      fetch('/api/posts?q=' + encodeURIComponent(q) + '&limit=8', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (posts) {
          if (!posts.length) {
            results.innerHTML = '<div style="padding:20px;text-align:center;color:var(--fg-3);font-size:14px">لا نتائج</div>';
          } else {
            results.innerHTML = posts.map(function (p) {
              return '<div class="search-result" data-action="open-post" data-post="' + p.id + '">' +
                '<img src="' + esc(p.image || '') + '" alt="">' +
                '<div class="search-result-info"><strong>' + esc(p.title) + '</strong><span>' + esc((p.prompt || '').slice(0, 60)) + '…</span></div>' +
                '</div>';
            }).join('');
          }
          results.dataset.open = 'true';
        })
        .catch(function () { results.dataset.open = 'false'; });
    },

    handleHash: function () {
      var h = (location.hash || '').replace('#', '') || 'home';
      var valid = ['home', 'explore', 'liked', 'saved', 'chat', 'profile'];
      if (valid.indexOf(h) >= 0) App.switchTab(h, { silent: true });
    },

    init: function () {
      var nav = byId('nav');
      if (nav) {
        window.addEventListener('scroll', function () {
          nav.classList.toggle('is-scrolled', window.scrollY > 12);
        }, { passive: true });
      }

      var search = byId('searchInput');
      if (search) {
        search.addEventListener('input', U.debounce(function (e) { App.doSearch(e.target.value); }, 260));
      }

      window.addEventListener('online', function () {
        var nb = byId('netBar');
        if (nb) nb.dataset.open = 'false';
        toast('عاد الاتصال', 'success');
      });
      window.addEventListener('offline', function () {
        var nb = byId('netBar');
        if (nb) nb.dataset.open = 'true';
      });

      document.addEventListener('click', function (e) {
        if (!e.target.closest('.search')) {
          var r = byId('searchResults');
          if (r) r.dataset.open = 'false';
        }
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          var r = byId('searchResults');
          if (r && r.dataset.open === 'true') {
            r.dataset.open = 'false';
            var si = byId('searchInput');
            if (si) si.blur();
          }
        }
      });

      var ci = byId('chatInput');
      if (ci) {
        ci.addEventListener('input', function () { U.autoGrow(ci); });
        ci.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); Chat.send(e); }
        });
      }
      var cmi = byId('commentInput');
      if (cmi) cmi.addEventListener('input', function () { U.autoGrow(cmi); });

      PTR.init();

      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && S.me && S.tab === 'home') {
          fetch('/api/posts?limit=1', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (posts) {
              if (posts.length && S.posts.home.length) {
                if (posts[0].id !== S.posts.home[0].id) NewPostsPill.show();
              }
            })
            .catch(function () {});
        }
      });

      if ('serviceWorker' in navigator && location.protocol === 'https:') {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {});
      }

      App.updateUserUI();
      App.handleHash();

      if (S.me) {
        App.loadFeed('home');
        App.loadChats();
      } else {
        App.loadLandingFeed();
      }
    }
  };

  /* ═══════ POST ═══════ */
  var Post = {
    like: function (btn, postId) {
      if (!S.me) { Auth.open('login'); return; }
      if (!postId || S.pendingLikes[postId]) return;
      S.pendingLikes[postId] = true;
      var wasLiked = btn.getAttribute('aria-pressed') === 'true';
      var next = !wasLiked;
      $$('[data-post-id="' + postId + '"] [data-action="like"]').forEach(function (x) {
        x.setAttribute('aria-pressed', next ? 'true' : 'false');
      });
      U.buzz(12);
      fetch('/api/posts/' + postId + '/like', { method: 'POST', credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          $$('[data-post-id="' + postId + '"] [data-action="like"]').forEach(function (x) {
            x.setAttribute('aria-pressed', d.liked ? 'true' : 'false');
          });
          $$('[data-post-id="' + postId + '"] [data-likes-count]').forEach(function (x) {
            x.textContent = U.num(d.likes);
          });
          Object.keys(S.posts).forEach(function (k) {
            var p = S.posts[k].find(function (x) { return x.id === postId; });
            if (p) { p.liked = d.liked; p.likes = d.likes; }
          });
        })
        .catch(function () {
          $$('[data-post-id="' + postId + '"] [data-action="like"]').forEach(function (x) {
            x.setAttribute('aria-pressed', wasLiked ? 'true' : 'false');
          });
          toast('فشل الإعجاب', 'error');
        })
        .finally(function () { delete S.pendingLikes[postId]; });
    },
    save: function (btn, postId) {
      if (!S.me) { Auth.open('login'); return; }
      if (!postId || S.pendingSaves[postId]) return;
      S.pendingSaves[postId] = true;
      var wasSaved = btn.getAttribute('aria-pressed') === 'true';
      var next = !wasSaved;
      $$('[data-post-id="' + postId + '"] [data-action="save"]').forEach(function (x) {
        x.setAttribute('aria-pressed', next ? 'true' : 'false');
      });
      U.buzz(8);
      fetch('/api/posts/' + postId + '/save', { method: 'POST', credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          $$('[data-post-id="' + postId + '"] [data-action="save"]').forEach(function (x) {
            x.setAttribute('aria-pressed', d.saved ? 'true' : 'false');
          });
          toast(d.saved ? 'تم الحفظ' : 'أُزيل من المحفوظة', 'success');
          Object.keys(S.posts).forEach(function (k) {
            var p = S.posts[k].find(function (x) { return x.id === postId; });
            if (p) { p.saved = d.saved; p.saves = d.saves; }
          });
        })
        .catch(function () {
          $$('[data-post-id="' + postId + '"] [data-action="save"]').forEach(function (x) {
            x.setAttribute('aria-pressed', wasSaved ? 'true' : 'false');
          });
          toast('فشل الحفظ', 'error');
        })
        .finally(function () { delete S.pendingSaves[postId]; });
    },
    copy: function (postId, btn) {
      var text = '';
      Object.keys(S.posts).forEach(function (k) {
        var p = S.posts[k].find(function (x) { return x.id === Number(postId); });
        if (p && p.prompt) text = p.prompt;
      });
      if (!text && btn) {
        var card = btn.closest('.prompt-card');
        var ex = card ? card.querySelector('.prompt-excerpt') : null;
        if (ex) text = ex.textContent.trim();
      }
      if (!text) { toast('لا يوجد نص', 'warning'); return; }
      U.copy(text)
        .then(function () {
          toast('تم النسخ', 'success');
          U.buzz([10, 30, 10]);
          fetch('/api/posts/' + postId + '/copy', { method: 'POST', credentials: 'same-origin' }).catch(function () {});
        })
        .catch(function () { toast('فشل النسخ', 'error'); });
    },
    open: function () { toast('قريباً', 'ph-eye'); }
  };

  /* ═══════ COMPOSER ═══════ */
  var Composer = {
    _type: null,
    open: function () {
      if (!S.me) { Auth.open('login'); return; }
      Composer._type = null;
      Composer.reset();
      Layer.open('composerModal');
    },
    close: function (e) {
      if (e && e.target !== e.currentTarget) return;
      Layer.close('composerModal');
      Composer.reset();
    },
    reset: function () {
      var form = byId('composerForm');
      var types = byId('composerTypes');
      var prev = byId('imgPreview');
      if (form) { form.reset(); form.classList.remove('is-active'); }
      if (types) types.hidden = false;
      if (prev) prev.hidden = true;
    },
    chooseType: function (type) {
      Composer._type = type;
      var types = byId('composerTypes');
      var form = byId('composerForm');
      var imgF = byId('imageField');
      var promptEl = byId('cPrompt');
      if (types) types.hidden = true;
      if (form) form.classList.add('is-active');
      if (imgF) imgF.hidden = type !== 'prompt';
      if (promptEl) promptEl.placeholder = type === 'prompt' ? 'اكتب البرومبت…' : 'اكتب نص المنشور…';
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
      if (!title.trim() || !prompt.trim()) { toast('أكمل العنوان والنص', 'warning'); return; }
      var tags = ((byId('cTags') || {}).value || '').split(/[،,]/).map(function (s) { return s.trim(); }).filter(Boolean);
      var btn = byId('composerSubmit');
      if (btn) btn.setAttribute('aria-busy', 'true');
      fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          title: title.trim(),
          prompt: prompt.trim(),
          image: (byId('cImage') || {}).value || '',
          model: (byId('cModel') || {}).value || '',
          tags: tags
        })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error((res.d && res.d.error) || 'فشل النشر');
          toast('تم النشر!', 'success');
          Composer.close();
          if (S.posts.home) S.posts.home.unshift(res.d);
          setTimeout(function () { location.reload(); }, 600);
        })
        .catch(function (err) {
          toast(err.message || 'فشل النشر', 'error');
          if (btn) btn.removeAttribute('aria-busy');
        });
    }
  };

  /* ═══════ CHAT ═══════ */
  var Chat = {
    open: function (chatId) {
      S.activeChat = chatId;
      var layout = byId('chatLayout');
      var head = byId('chatHead');
      var body = byId('chatBody');
      if (!layout || !head || !body) return;
      layout.dataset.view = 'thread';
      var chat = null;
      for (var i = 0; i < S.chats.length; i++) {
        if (S.chats[i].id === chatId) { chat = S.chats[i]; break; }
      }
      var other = (chat && chat.with_user) || {};
      head.innerHTML = '<button class="btn btn-icon btn-ghost btn-sm" data-action="chat-list" aria-label="رجوع" type="button"><i class="ph ph-arrow-right"></i></button>' +
        '<img class="avatar avatar-sm" src="' + esc(other.avatar || '') + '" alt="">' +
        '<div class="chat-thread-info"><strong>' + esc(other.name || 'محادثة') + '</strong><span>متصل</span></div>';
      body.innerHTML = '<div style="text-align:center;padding:var(--sp-6)"><i class="ph ph-circle-notch" style="animation:spin .8s linear infinite;font-size:24px;color:var(--c-brand)"></i></div>';
      fetch('/api/chats/' + chatId + '/messages', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (msgs) {
          body.innerHTML = msgs.length ? msgs.map(Render.message).join('') : Render.empty('ابدأ المحادثة', 'ph-chat-circle');
          Chat.scrollBottom();
        })
        .catch(function () { body.innerHTML = Render.empty('تعذّر التحميل', 'ph-warning-circle'); });
    },
    showList: function () {
      var layout = byId('chatLayout');
      if (layout) layout.dataset.view = 'list';
      S.activeChat = null;
    },
    send: function (e) {
      if (e) e.preventDefault();
      var input = byId('chatInput');
      var text = (input && input.value || '').trim();
      if (!text || !S.activeChat) return;
      var body = byId('chatBody');
      var empty = body.querySelector('.empty-block');
      if (empty) empty.remove();
      body.insertAdjacentHTML('beforeend', '<div class="msg msg-me" data-temp>' + esc(text) + '<span class="msg-time">الآن</span></div>');
      input.value = '';
      U.autoGrow(input);
      Chat.scrollBottom();
      fetch('/api/chats/' + S.activeChat + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ text: text })
      })
        .then(function (r) { return r.json(); })
        .then(function (m) {
          var t = body.querySelector('[data-temp]');
          if (t) t.remove();
          body.insertAdjacentHTML('beforeend', Render.message(m));
          Chat.scrollBottom();
        })
        .catch(function () {
          var t = body.querySelector('[data-temp]');
          if (t) t.remove();
          toast('تعذّر الإرسال', 'error');
        });
    },
    scrollBottom: function () {
      var body = byId('chatBody');
      if (body) body.scrollTop = body.scrollHeight;
    },
    filterList: function (q) {
      var list = byId('chatList');
      if (!list) return;
      var query = (q || '').trim().toLowerCase();
      $$('.chat-item', list).forEach(function (item) {
        var name = (item.dataset.name || '').toLowerCase();
        item.hidden = !!(query && name.indexOf(query) < 0);
      });
    },
    newChat: function () { toast('اختر مستخدماً للبدء', 'ph-note-pencil'); },
    attach: function () { toast('قريباً', 'ph-paperclip'); }
  };

  /* ═══════ DRAWERS + COMMENTS ═══════ */
  var Drawers = {
    openComments: function (postId) {
      S.activePost = postId;
      var m = byId('commentsDrawer');
      var scrim = byId('commentsScrim');
      var body = byId('commentsBody');
      var form = byId('commentForm');
      if (!m) return;
      body.innerHTML = '<div class="empty-block"><i class="ph ph-circle-notch" style="animation:spin .8s linear infinite"></i></div>';
      Layer.open(m);
      if (scrim) scrim.dataset.open = 'true';
      if (form) form.style.display = S.me ? 'flex' : 'none';
      fetch('/api/posts/' + postId + '/comments', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (list) {
          var count = byId('commentCount');
          if (count) count.textContent = list.length ? '(' + list.length + ')' : '';
          body.innerHTML = list.length ? list.map(Render.comment).join('') : Render.empty('لا تعليقات بعد', 'ph-chat-circle', 'كن أول من يعلّق');
        })
        .catch(function () { body.innerHTML = Render.empty('تعذّر التحميل', 'ph-warning-circle'); });
    },
    closeComments: function () {
      Layer.close('commentsDrawer');
      var scrim = byId('commentsScrim');
      if (scrim) scrim.dataset.open = 'false';
      S.activePost = null;
    }
  };

  var Comments = {
    send: function (e) {
      if (e) e.preventDefault();
      if (!S.activePost || !S.me) return;
      var input = byId('commentInput');
      var text = (input && input.value || '').trim();
      if (!text) return;
      var body = byId('commentsBody');
      var tmp = 'tmp-' + Date.now();
      var empty = body.querySelector('.empty-block');
      if (empty) empty.remove();
      body.insertAdjacentHTML('afterbegin', '<div class="comment" data-temp="' + tmp + '"><img class="avatar avatar-sm" src="' + esc(S.me.avatar) + '" alt=""><div class="comment-body"><div class="comment-top"><span class="comment-name">' + esc(S.me.name) + '</span><span class="comment-time">الآن</span></div><div class="comment-text">' + esc(text) + '</div></div></div>');
      input.value = '';
      U.autoGrow(input);
      fetch('/api/posts/' + S.activePost + '/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ text: text })
      })
        .then(function (r) { return r.json(); })
        .then(function (c) {
          var t = body.querySelector('[data-temp="' + tmp + '"]');
          if (t) t.remove();
          body.insertAdjacentHTML('afterbegin', Render.comment(Object.assign({}, c, { author_data: S.me })));
          var count = byId('commentCount');
          if (count) {
            var n = body.querySelectorAll('.comment').length;
            count.textContent = '(' + n + ')';
          }
        })
        .catch(function () {
          var t = body.querySelector('[data-temp="' + tmp + '"]');
          if (t) t.remove();
          toast('تعذّر الإرسال', 'error');
        });
    },
    delete: function (cid) {
      var node = document.querySelector('[data-comment-id="' + cid + '"]');
      if (node) node.style.opacity = '0.5';
      fetch('/api/comments/' + cid, { method: 'DELETE', credentials: 'same-origin' })
        .then(function () {
          if (node) node.remove();
          var count = byId('commentCount');
          var body = byId('commentsBody');
          if (count && body) {
            var n = body.querySelectorAll('.comment').length;
            count.textContent = n ? '(' + n + ')' : '';
          }
        })
        .catch(function () {
          if (node) node.style.opacity = '1';
          toast('تعذّر الحذف', 'error');
        });
    }
  };

  /* ═══════ PROFILE ═══════ */
  var Profile = {
    _viewing: null,
    _isOwn: true,
    _currentTab: 'posts',
    _data: null,
    _pickedCover: null,

    open: function (userId) {
      if (!userId) return;
      S.tab = 'profile';
      $$('.tab-panel').forEach(function (p) {
        p.classList.toggle('is-active', p.getAttribute('data-tab') === 'profile');
      });
      $$('.dock-item[data-tab]').forEach(function (b) {
        b.setAttribute('aria-current', b.getAttribute('data-tab') === 'profile' ? 'page' : 'false');
      });
      Profile._viewing = userId;
      Profile._isOwn = !!(S.me && S.me.id === userId);
      Profile._currentTab = 'posts';
      Profile.load();
    },

    openMine: function () {
      if (!S.me) { Auth.open('login'); return; }
      S.tab = 'profile';
      $$('.tab-panel').forEach(function (p) {
        p.classList.toggle('is-active', p.getAttribute('data-tab') === 'profile');
      });
      $$('.dock-item[data-tab]').forEach(function (b) {
        b.setAttribute('aria-current', b.getAttribute('data-tab') === 'profile' ? 'page' : 'false');
      });
      Profile._viewing = S.me.id;
      Profile._isOwn = true;
      Profile._currentTab = 'posts';
      Profile.load();
    },

    load: function () {
      var skeleton = byId('profileSkeleton');
      var card = byId('profileCard');
      var tabs = byId('profileTabs');
      if (skeleton) skeleton.hidden = false;
      if (card) card.hidden = true;
      if (tabs) tabs.hidden = true;

      fetch('/api/users/' + Profile._viewing, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
        .then(function (user) {
          Profile._data = user;
          var av = byId('profileAvatar');
          if (av) av.src = user.avatar || '';
          var editAv = byId('editAvatarImg');
          if (editAv) editAv.src = user.avatar || '';
          var name = byId('profileName');
          if (name) name.textContent = user.name || '—';
          var verified = byId('profileVerified');
          if (verified) verified.hidden = !user.verified;
          var handle = byId('profileHandle');
          if (handle) handle.textContent = user.handle || '@—';
          var bio = byId('profileBio');
          if (bio) {
            bio.textContent = user.bio || '';
            bio.hidden = !user.bio;
          }
          Profile._renderMeta(user);
          Profile._renderStats(user);
          var cover = byId('profileCover');
          if (cover) cover.dataset.cover = user.cover || 'aurora';
          var editCover = byId('editCoverPreview');
          if (editCover) editCover.dataset.cover = user.cover || 'aurora';
          Profile._renderActions(user);
          Profile._renderTabsVisibility();
          if (skeleton) skeleton.hidden = true;
          if (card) card.hidden = false;
          if (tabs) tabs.hidden = false;
          Profile.loadPanel(Profile._currentTab);
        })
        .catch(function (err) {
          console.error('[Profile] load failed:', err);
          if (skeleton) skeleton.hidden = true;
          var panel = byId('profilePanel');
          if (panel) panel.innerHTML = Render.empty('تعذّر تحميل الملف', 'ph-warning-circle', 'حاول مرة أخرى');
        });
    },

    _renderMeta: function (user) {
      var meta = byId('profileMeta');
      if (!meta) return;
      var hasLocation = !!user.location;
      var hasWebsite = !!user.website;
      var hasJoined = !!user.created_at;
      var anyVisible = hasLocation || hasWebsite || hasJoined;
      meta.hidden = !anyVisible;
      if (!anyVisible) return;
      var locEl = byId('profileLocation');
      if (locEl) {
        locEl.hidden = !hasLocation;
        if (hasLocation) locEl.querySelector('span').textContent = user.location;
      }
      var webEl = byId('profileWebsite');
      if (webEl) {
        webEl.hidden = !hasWebsite;
        if (hasWebsite) {
          var a = webEl.querySelector('a');
          a.href = user.website;
          a.textContent = user.website.replace(/^https?:\/\//, '').replace(/\/$/, '');
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
      }
      var joinedEl = byId('profileJoined');
      if (joinedEl) {
        joinedEl.hidden = !hasJoined;
        if (hasJoined) {
          var d = new Date(user.created_at);
          var months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
          joinedEl.querySelector('span').textContent = 'انضم ' + months[d.getMonth()] + ' ' + d.getFullYear();
        }
      }
    },

    _renderStats: function (user) {
      var set = function (id, v) { var n = byId(id); if (n) n.textContent = U.num(v || 0); };
      set('statFollowers', user.followers);
      set('statFollowing', user.following);
      set('statPosts', user.posts_count);
      set('statLikes', user.total_likes || 0);
    },

    _renderActions: function (user) {
      var box = byId('profileActions');
      if (!box) return;
      if (Profile._isOwn) {
        box.innerHTML =
          '<button class="btn btn-primary btn-sm" data-action="edit-profile" type="button">' +
            '<i class="ph ph-pencil-simple"></i><span>تعديل الملف</span>' +
          '</button>' +
          '<button class="btn btn-secondary btn-sm" data-action="share-profile" type="button">' +
            '<i class="ph ph-share-network"></i><span>مشاركة</span>' +
          '</button>';
      } else {
        var isFollowing = !!user.is_following;
        box.innerHTML =
          '<button class="btn ' + (isFollowing ? 'btn-secondary' : 'btn-primary') + ' btn-sm" ' +
                  'data-action="toggle-follow" data-user="' + user.id + '" ' +
                  'aria-pressed="' + (isFollowing ? 'true' : 'false') + '" type="button">' +
            '<i class="ph ' + (isFollowing ? 'ph-user-check' : 'ph-user-plus') + '"></i>' +
            '<span>' + (isFollowing ? 'متابَع' : 'متابعة') + '</span>' +
          '</button>' +
          '<button class="btn btn-secondary btn-sm" data-action="message-user" data-user="' + user.id + '" type="button">' +
            '<i class="ph ph-chat-circle"></i><span>رسالة</span>' +
          '</button>' +
          '<button class="btn btn-ghost btn-sm" data-action="share-profile" type="button" aria-label="مشاركة">' +
            '<i class="ph ph-share-network"></i>' +
          '</button>';
      }
    },

    _renderTabsVisibility: function () {
      var savedTab = byId('profileSavedTab');
      var settingsTab = byId('profileSettingsTab');
      if (savedTab) savedTab.hidden = !Profile._isOwn;
      if (settingsTab) settingsTab.hidden = !Profile._isOwn;
    },

    loadPanel: function (tab) {
      Profile._currentTab = tab;
      $$('#profileTabs .tab').forEach(function (t) {
        t.setAttribute('aria-selected', t.getAttribute('data-ptab') === tab ? 'true' : 'false');
      });
      var panel = byId('profilePanel');
      if (!panel) return;
      panel.className = 'profile-panel';
      panel.innerHTML = '<div class="empty-block"><i class="ph ph-circle-notch" style="animation:spin .8s linear infinite"></i></div>';

      if (tab === 'settings') { Profile._renderSettings(panel); return; }
      if (tab === 'about')    { Profile._renderAbout(panel); return; }

      panel.className = 'profile-panel feed';

      var url;
      if (tab === 'posts') {
        url = '/api/users/' + Profile._viewing + '/posts';
      } else if (tab === 'liked') {
        url = '/api/posts?limit=100';
      } else if (tab === 'saved') {
        url = '/api/posts?limit=100';
      }

      fetch(url, { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (posts) {
          if (tab === 'liked') posts = posts.filter(function (p) { return p.liked; });
          if (tab === 'saved') posts = posts.filter(function (p) { return p.saved; });

          if (!posts || !posts.length) {
            var emptyMsg = Profile._isOwn
              ? { posts: ['لم تنشر بعد', 'ph-image-square', 'شارك أول برومبت لك'],
                  liked: ['لا إعجابات بعد', 'ph-heart', 'اضغط القلب على ما يعجبك'],
                  saved: ['المكتبة فارغة', 'ph-bookmark-simple', 'احفظ ما تريد الرجوع إليه'] }[tab]
              : { posts: ['لا برومبتات', 'ph-image-square', 'لم يشارك هذا المستخدم شيئاً بعد'],
                  liked: ['لا إعجابات', 'ph-heart', ''],
                  saved: ['مخفي', 'ph-lock', ''] }[tab];
            panel.innerHTML = Render.empty(emptyMsg[0], emptyMsg[1], emptyMsg[2]);
            return;
          }

          panel.innerHTML = posts.map(Render.prompt).join('');
          var cards = panel.querySelectorAll('.prompt-card');
          cards.forEach(function (c, i) {
            c.style.opacity = '0';
            c.style.transform = 'translateY(8px)';
            c.style.transition = 'opacity .3s var(--ease-out) ' + Math.min(i * 30, 250) + 'ms, transform .3s var(--ease-out) ' + Math.min(i * 30, 250) + 'ms';
          });
          requestAnimationFrame(function () {
            cards.forEach(function (c) { c.style.opacity = '1'; c.style.transform = 'translateY(0)'; });
          });
        })
        .catch(function () {
          panel.innerHTML = Render.empty('تعذّر التحميل', 'ph-warning-circle', 'حاول مرة أخرى');
        });
    },

    _renderAbout: function (panel) {
      var u = Profile._data || {};
      var joined = u.created_at ? new Date(u.created_at) : null;
      var months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
      panel.innerHTML =
        '<div class="profile-about">' +
          '<div class="about-section">' +
            '<h4><i class="ph ph-user"></i> نبذة</h4>' +
            '<p>' + (u.bio ? esc(u.bio) : (Profile._isOwn ? 'لم تضف نبذة بعد.' : 'لا توجد نبذة.')) + '</p>' +
          '</div>' +
          '<div class="about-section">' +
            '<h4><i class="ph ph-info"></i> معلومات</h4>' +
            (u.location ? '<div class="about-row"><span class="label">الموقع</span><span class="value">' + esc(u.location) + '</span></div>' : '') +
            (u.website ? '<div class="about-row"><span class="label">الموقع الإلكتروني</span><span class="value"><a href="' + esc(u.website) + '" target="_blank" rel="noopener noreferrer" style="color:var(--c-brand)">' + esc(u.website.replace(/^https?:\/\//, '')) + '</a></span></div>' : '') +
            '<div class="about-row"><span class="label">المعرّف</span><span class="value" style="font-family:var(--font-mono)">' + esc(u.handle || '') + '</span></div>' +
            (joined ? '<div class="about-row"><span class="label">تاريخ الانضمام</span><span class="value">' + months[joined.getMonth()] + ' ' + joined.getFullYear() + '</span></div>' : '') +
            '<div class="about-row"><span class="label">عدد البرومبتات</span><span class="value">' + U.num(u.posts_count || 0) + '</span></div>' +
          '</div>' +
          '<div class="about-section">' +
            '<h4><i class="ph ph-chart-line"></i> الإحصائيات</h4>' +
            '<div class="about-row"><span class="label">إجمالي الإعجابات</span><span class="value">' + U.num(u.total_likes || 0) + '</span></div>' +
            '<div class="about-row"><span class="label">إجمالي النسخ</span><span class="value">' + U.num(u.total_copies || 0) + '</span></div>' +
            '<div class="about-row"><span class="label">المتابعون</span><span class="value">' + U.num(u.followers || 0) + '</span></div>' +
            '<div class="about-row"><span class="label">يتابع</span><span class="value">' + U.num(u.following || 0) + '</span></div>' +
          '</div>' +
        '</div>';
    },

    _renderSettings: function (panel) {
      var theme = document.documentElement.getAttribute('data-theme') || 'dark';
      panel.innerHTML =
        '<div class="settings-list">' +
          '<div class="settings-group">' +
            '<div class="settings-group-title">المظهر</div>' +
            '<div class="setting-row">' +
              '<div class="setting-row-info">' +
                '<strong>الوضع الليلي</strong>' +
                '<span>تبديل بين المظهر الفاتح والداكن</span>' +
              '</div>' +
              '<button class="switch" data-action="toggle-theme" role="switch" ' +
                     'aria-checked="' + (theme === 'dark' ? 'true' : 'false') + '" ' +
                     'aria-label="الوضع الليلي" type="button"></button>' +
            '</div>' +
          '</div>' +
          '<div class="settings-group">' +
            '<div class="settings-group-title">الحساب</div>' +
            '<div class="setting-row" data-action="edit-profile" style="cursor:pointer">' +
              '<div class="setting-row-info">' +
                '<strong>تعديل الملف الشخصي</strong>' +
                '<span>الاسم، النبذة، الصورة، الغلاف</span>' +
              '</div>' +
              '<i class="ph ph-caret-left" style="color:var(--fg-3)"></i>' +
            '</div>' +
            '<div class="setting-row" data-action="open-change-password" style="cursor:pointer">' +
              '<div class="setting-row-info">' +
                '<strong>تغيير كلمة المرور</strong>' +
                '<span>حدّث كلمة المرور الخاصة بحسابك</span>' +
              '</div>' +
              '<i class="ph ph-caret-left" style="color:var(--fg-3)"></i>' +
            '</div>' +
          '</div>' +
          '<div class="settings-group">' +
            '<div class="settings-group-title">الخصوصية والأمان</div>' +
            '<div class="setting-row" data-action="open-privacy" style="cursor:pointer">' +
              '<div class="setting-row-info">' +
                '<strong>سياسة الخصوصية</strong>' +
                '<span>اقرأ كيف نحفظ بياناتك ونحميها</span>' +
              '</div>' +
              '<i class="ph ph-caret-left" style="color:var(--fg-3)"></i>' +
            '</div>' +
          '</div>' +
          '<div class="settings-group">' +
            '<div class="settings-group-title">الجلسة</div>' +
            '<div class="setting-row" data-action="logout" style="cursor:pointer">' +
              '<div class="setting-row-info">' +
                '<strong>تسجيل الخروج</strong>' +
                '<span>إنهاء الجلسة على هذا الجهاز</span>' +
              '</div>' +
              '<i class="ph ph-sign-out" style="color:var(--fg-2)"></i>' +
            '</div>' +
          '</div>' +
        '</div>';
    },

    toggleFollow: function (btn, userId) {
      if (!S.me) { Auth.open('login'); return; }
      if (!userId || userId === S.me.id) return;
      var wasFollowing = btn.getAttribute('aria-pressed') === 'true';
      var next = !wasFollowing;
      btn.setAttribute('aria-pressed', next ? 'true' : 'false');
      btn.classList.toggle('btn-primary', !next);
      btn.classList.toggle('btn-secondary', next);
      var icon = btn.querySelector('i');
      var label = btn.querySelector('span');
      if (icon) icon.className = 'ph ' + (next ? 'ph-user-check' : 'ph-user-plus');
      if (label) label.textContent = next ? 'متابَع' : 'متابعة';
      var folEl = byId('statFollowers');
      if (folEl) {
        var cur = parseInt(folEl.textContent.replace(/[^0-9]/g, '')) || 0;
        folEl.textContent = U.num(Math.max(0, cur + (next ? 1 : -1)));
      }
      fetch('/api/users/' + userId + '/follow', { method: 'POST', credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          btn.setAttribute('aria-pressed', res.following ? 'true' : 'false');
          if (folEl) folEl.textContent = U.num(res.followers);
          toast(res.following ? 'بدأت المتابعة' : 'ألغيت المتابعة', 'success');
        })
        .catch(function () {
          btn.setAttribute('aria-pressed', wasFollowing ? 'true' : 'false');
          btn.classList.toggle('btn-primary', wasFollowing);
          btn.classList.toggle('btn-secondary', !wasFollowing);
          if (icon) icon.className = 'ph ' + (wasFollowing ? 'ph-user-check' : 'ph-user-plus');
          if (label) label.textContent = wasFollowing ? 'متابَع' : 'متابعة';
          toast('تعذّر تحديث المتابعة', 'error');
        });
    },

    shareProfile: function () {
      var url = location.origin + '/u/' + (Profile._data && Profile._data.handle ? Profile._data.handle.replace('@', '') : '');
      var title = (Profile._data && Profile._data.name) ? Profile._data.name + ' على خَيال' : 'خَيال';
      if (navigator.share) {
        navigator.share({ title: title, url: url })
          .then(function () { toast('تمت المشاركة', 'success'); })
          .catch(function (e) {
            if (e.name !== 'AbortError') {
              U.copy(url).then(function () { toast('تم نسخ الرابط', 'success'); }).catch(function () {});
            }
          });
      } else {
        U.copy(url).then(function () { toast('تم نسخ الرابط', 'success'); }).catch(function () { toast('تعذّرت المشاركة', 'error'); });
      }
    },

    copyHandle: function () {
      var handle = (Profile._data && Profile._data.handle) || '';
      if (!handle) return;
      U.copy(handle)
        .then(function () { toast('تم نسخ ' + handle, 'success'); })
        .catch(function () { toast('تعذّر النسخ', 'error'); });
    },

    messageUser: function (userId) {
      if (!S.me) { Auth.open('login'); return; }
      fetch('/api/chats/with/' + userId, { method: 'POST', credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          toast('فتح المحادثة…');
          App.switchTab('chat');
          setTimeout(function () { Chat.open(res.id); }, 300);
        })
        .catch(function () { toast('تعذّر فتح المحادثة', 'error'); });
    },

    openEdit: function () {
      if (!S.me) { Auth.open('login'); return; }
      var u = Profile._data && Profile._viewing === S.me.id ? Profile._data : S.me;
      var name = byId('epName'); if (name) name.value = u.name || '';
      var bio = byId('epBio'); if (bio) { bio.value = u.bio || ''; Profile._updateBioCount(); }
      var loc = byId('epLocation'); if (loc) loc.value = u.location || '';
      var web = byId('epWebsite'); if (web) web.value = u.website || '';
      var av = byId('epAvatarUrl'); if (av) av.value = '';
      var editAv = byId('editAvatarImg'); if (editAv) editAv.src = u.avatar || '';
      var cover = byId('editCoverPreview');
      if (cover) { cover.dataset.cover = u.cover || 'aurora'; cover.style.backgroundImage = ''; }
      $$('.cover-preset').forEach(function (p) {
        p.setAttribute('aria-pressed', p.dataset.cover === (u.cover || 'aurora') ? 'true' : 'false');
      });
      Layer.open('editProfileModal');
      setTimeout(function () { if (name) name.focus(); }, 200);
    },

    closeEdit: function (e) {
      if (e && e.target !== e.currentTarget) return;
      Layer.close('editProfileModal');
    },

    _updateBioCount: function () {
      var bio = byId('epBio');
      var counter = byId('epBioCount');
      if (bio && counter) counter.textContent = String(bio.value.length);
    },

    pickCover: function () {
      var presets = byId('coverPresetsField');
      if (presets) presets.hidden = !presets.hidden;
    },

    pickAvatar: function () {
      var input = byId('avatarFileInput');
      if (!input) return;
      input.value = '';
      input.click();
    },

    _handleAvatarFile: function (file) {
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { toast('الصورة كبيرة (الحد 2MB)', 'warning'); return; }
      var reader = new FileReader();
      reader.onload = function (e) {
        var editAv = byId('editAvatarImg');
        if (editAv) editAv.src = e.target.result;
        var urlInput = byId('epAvatarUrl');
        if (urlInput) urlInput.value = e.target.result;
      };
      reader.readAsDataURL(file);
    },

    _handleCoverFile: function (file) {
      if (!file) return;
      if (file.size > 3 * 1024 * 1024) { toast('الصورة كبيرة (الحد 3MB)', 'warning'); return; }
      var reader = new FileReader();
      reader.onload = function (e) {
        var cover = byId('editCoverPreview');
        if (cover) {
          cover.style.backgroundImage = 'url(' + e.target.result + ')';
          cover.style.backgroundSize = 'cover';
          cover.style.backgroundPosition = 'center';
        }
        Profile._pickedCover = e.target.result;
      };
      reader.readAsDataURL(file);
    },

    save: function (e) {
      if (e) e.preventDefault();
      if (!S.me) return;
      var btn = byId('editProfileSubmit');
      var name = (byId('epName') || {}).value || '';
      var bio = (byId('epBio') || {}).value || '';
      var location = (byId('epLocation') || {}).value || '';
      var website = (byId('epWebsite') || {}).value || '';
      var avatar = (byId('epAvatarUrl') || {}).value || '';
      var coverEl = byId('editCoverPreview');
      var cover = coverEl && coverEl.dataset ? coverEl.dataset.cover : 'aurora';
      if (!name.trim()) { toast('الاسم مطلوب', 'warning'); return; }
      if (btn) btn.setAttribute('aria-busy', 'true');
      var payload = {
        name: name.trim(),
        bio: bio.trim(),
        location: location.trim(),
        website: website.trim(),
        cover: cover
      };
      if (avatar) payload.avatar = avatar;
      if (Profile._pickedCover) payload.cover_image = Profile._pickedCover;

      fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
        .then(function (updated) {
          S.me = Object.assign({}, S.me, updated);
          Profile._pickedCover = null;
          Profile.closeEdit();
          App.updateUserUI();
          toast('تم حفظ التعديلات', 'success');
          if (Profile._viewing === S.me.id) Profile.load();
        })
        .catch(function () { toast('تعذّر الحفظ', 'error'); })
        .finally(function () { if (btn) btn.removeAttribute('aria-busy'); });
    },

    openFollowers: function (kind) {
      if (!Profile._viewing) return;
      var title = byId('followersTitle');
      if (title) title.textContent = kind === 'followers' ? 'المتابعون' : 'يتابع';
      var body = byId('followersBody');
      if (body) body.innerHTML = '<div class="empty-block"><i class="ph ph-circle-notch" style="animation:spin .8s linear infinite"></i></div>';
      Layer.open('followersDrawer');
      var scrim = byId('followersScrim');
      if (scrim) scrim.dataset.open = 'true';
      fetch('/api/users/' + Profile._viewing + '/' + kind, { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (users) {
          if (!users.length) {
            body.innerHTML = Render.empty(kind === 'followers' ? 'لا متابعين بعد' : 'لا يتابع أحداً', 'ph-users');
            return;
          }
          body.innerHTML = users.map(function (u) {
            return '<div class="follower-item" data-action="open-user-profile" data-user="' + u.id + '">' +
              '<img class="avatar" src="' + esc(u.avatar || '') + '" alt="" loading="lazy">' +
              '<div class="follower-item-info">' +
                '<div class="follower-item-name">' + esc(u.name) + '</div>' +
                '<div class="follower-item-handle">' + esc(u.handle) + '</div>' +
              '</div>' +
              '<i class="ph ph-caret-left" style="color:var(--fg-3)"></i>' +
            '</div>';
          }).join('');
        })
        .catch(function () { body.innerHTML = Render.empty('تعذّر التحميل', 'ph-warning-circle'); });
    },

    closeFollowers: function () {
      Layer.close('followersDrawer');
      var scrim = byId('followersScrim');
      if (scrim) scrim.dataset.open = 'false';
    },

    openChangePassword: function () {
      var oldPw = prompt('كلمة المرور الحالية:');
      if (!oldPw) return;
      var newPw = prompt('كلمة المرور الجديدة (6 أحرف على الأقل):');
      if (!newPw || newPw.length < 6) { toast('كلمة المرور قصيرة', 'warning'); return; }
      fetch('/api/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ old_password: oldPw, new_password: newPw })
      })
        .then(function (r) { if (!r.ok) throw new Error(); toast('تم تغيير كلمة المرور', 'success'); })
        .catch(function () { toast('فشل التغيير', 'error'); });
    }
  };

  /* ═══════ EXPLORE ═══════ */
  var Explore = {
    openCollection: function (kind) { toast('فتح: ' + kind, 'ph-compass'); App.loadFeed('explore'); }
  };

  /* ═══════ INSTALL ═══════ */
  var Install = {
    _deferred: null,
    prompt: function () {
      if (!Install._deferred) { toast('افتح القائمة واختر "إضافة للشاشة"'); return; }
      Install._deferred.prompt();
      Install._deferred.userChoice.then(function (r) {
        if (r.outcome === 'dismissed') Install._deferred = null;
      });
    },
    dismiss: function () { var b = byId('installBanner'); if (b) b.hidden = true; }
  };

  /* ═══════ DELEGATION ═══════ */
  var Delegation = {
    'open-auth': function (t) { Auth.open(t.dataset.mode || 'login'); },
    'close-auth': function () { Auth.close(); },
    'switch-tab': function (t) { App.switchTab(t.dataset.tab); },
    'open-composer': function () { Composer.open(); },
    'close-composer': function () { Composer.close(); },
    'choose-type': function (t) { Composer.chooseType(t.dataset.type); },
    'toggle-theme': function () { App.toggleTheme(); },
    'preview-feed': function () { App.previewFeed(); },
    'go-home': function () { App.goHome(); },
    'refresh': function () { App.refreshAll(); },
    'like': function (t) { Post.like(t, Number(t.dataset.post)); },
    'save': function (t) { Post.save(t, Number(t.dataset.post)); },
    'copy': function (t) { Post.copy(t.dataset.post, t); },
    'open-post': function (t) { Post.open(Number(t.dataset.post)); },
    'open-comments': function (t) { Drawers.openComments(Number(t.dataset.post)); },
    'close-comments': function () { Drawers.closeComments(); },
    'delete-comment': function (t) { Comments.delete(Number(t.dataset.comment)); },
    'filter-tag': function (t) { App.filterByTag(t.dataset.tag); },
    'open-chat': function (t) { Chat.open(Number(t.dataset.chat)); },
    'chat-list': function () { Chat.showList(); },
    'chat-new': function () { Chat.newChat(); },
    'open-profile': function (t) { Profile.open(Number(t.dataset.user)); },
    'open-user-profile': function (t) { Profile.open(Number(t.dataset.user)); },
    'edit-profile': function () { Profile.openEdit(); },
    'close-edit-profile': function () { Profile.closeEdit(); },
    'share-profile': function () { Profile.shareProfile(); },
    'copy-handle': function () { Profile.copyHandle(); },
    'edit-avatar': function () { Profile.pickAvatar(); },
    'edit-cover': function () { Profile.pickCover(); },
    'toggle-follow': function (t) { Profile.toggleFollow(t, Number(t.dataset.user)); },
    'message-user': function (t) { Profile.messageUser(Number(t.dataset.user)); },
    'open-followers': function () { Profile.openFollowers('followers'); },
    'open-following': function () { Profile.openFollowers('following'); },
    'open-change-password': function () { Profile.openChangePassword(); },
    'open-privacy': function () { window.open('/privacy', '_blank'); },
    'logout': function () { Auth.logout(); },
    'switch-mode': function (t) { Auth.switchMode(t.dataset.mode); },
    'open-collection': function (t) { Explore.openCollection(t.dataset.kind); },
    'install-prompt': function () { Install.prompt(); },
    'install-dismiss': function () { Install.dismiss(); }
  };

  document.addEventListener('click', function (e) {
    var target = e.target.closest('[data-action]');
    if (!target) return;
    var action = target.dataset.action;
    var handler = Delegation[action];
    if (!handler) return;
    e.preventDefault();
    try { handler(target, e); }
    catch (err) { console.error('[action "' + action + '"]', err); }
  }, false);

  document.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    var f = e.target;
    if (!f || f.tagName !== 'FORM') return;
    var fid = f.id;
    if (fid === 'loginForm') { e.preventDefault(); Auth.login(e); }
    else if (fid === 'registerForm') { e.preventDefault(); Auth.register(e); }
    else if (fid === 'composerForm') { e.preventDefault(); Composer.publish(e); }
    else if (fid === 'commentForm') { e.preventDefault(); Comments.send(e); }
    else if (fid === 'editProfileForm') { e.preventDefault(); Profile.save(e); }
    else if (f.classList && f.classList.contains('chat-composer')) { e.preventDefault(); Chat.send(e); }
  }, false);

  /* Profile tabs */
  document.addEventListener('click', function (e) {
    var tab = e.target.closest('#profileTabs .tab');
    if (!tab) return;
    e.preventDefault();
    Profile.loadPanel(tab.dataset.ptab);
  }, false);

  /* Cover presets + file inputs */
  document.addEventListener('DOMContentLoaded', function () {
    var avInput = byId('avatarFileInput');
    if (avInput) avInput.addEventListener('change', function (e) { Profile._handleAvatarFile(e.target.files[0]); });
    var covInput = byId('coverFileInput');
    if (covInput) covInput.addEventListener('change', function (e) { Profile._handleCoverFile(e.target.files[0]); });
    var bio = byId('epBio');
    if (bio) bio.addEventListener('input', Profile._updateBioCount);
    var coverPresets = byId('coverPresets');
    if (coverPresets) coverPresets.addEventListener('click', function (e) {
      var btn = e.target.closest('.cover-preset');
      if (!btn) return;
      $$('.cover-preset').forEach(function (p) { p.setAttribute('aria-pressed', 'false'); });
      btn.setAttribute('aria-pressed', 'true');
      var cover = byId('editCoverPreview');
      if (cover) { cover.dataset.cover = btn.dataset.cover; cover.style.backgroundImage = ''; }
      Profile._pickedCover = null;
    });
  });

  /* Theme from storage */
  try {
    var savedTheme = localStorage.getItem('kh_theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
      var ti = byId('themeIcon');
      if (ti) ti.className = savedTheme === 'dark' ? 'ph ph-moon' : 'ph ph-sun';
    }
  } catch (_) {}

  /* Expose */
  window.U = U;
  window.Store = { get: function (k, d) { try { return JSON.parse(localStorage.getItem('kh_' + k)) || d; } catch (_) { return d; } }, set: function (k, v) { try { localStorage.setItem('kh_' + k, JSON.stringify(v)); } catch (_) {} } };
  window.Auth = Auth;
  window.App = App;
  window.Post = Post;
  window.Composer = Composer;
  window.Chat = Chat;
  window.Drawers = Drawers;
  window.Comments = Comments;
  window.Profile = Profile;
  window.Explore = Explore;
  window.Install = Install;
  window.Layer = Layer;
  window.Render = Render;
  window.Infinite = Infinite;
  window.PTR = PTR;
  window.ScrollMemory = ScrollMemory;
  window.NewPostsPill = NewPostsPill;

  function boot() {
    try {
      App.init();
      console.log('[خَيال] ✓ ready');
    } catch (err) {
      console.error('[خَيال] boot failed:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();