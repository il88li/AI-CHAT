/* ═══════════════════════════════════════════════════════════
   خَيال — Aurora · Application logic
   ═══════════════════════════════════════════════════════════ */

const K = window.__KHAYAL__ || {};
const Utils = {
  $:(s,r=document)=>r.querySelector(s),
  $$:(s,r=document)=>[...r.querySelectorAll(s)],
  esc(s){return s==null?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')},
  storage:{get(k,f){try{const v=localStorage.getItem(k);return v?JSON.parse(v):f}catch{return f}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}},rm(k){try{localStorage.removeItem(k)}catch{}}},
  toast(msg,icon='ph-check-circle'){
    const w=Utils.$('#toastWrap');if(!w)return;
    const el=document.createElement('div');el.className='toast';
    el.innerHTML=`<i class="ph ${icon}"></i> ${Utils.esc(msg)}`;w.appendChild(el);
    setTimeout(()=>{el.style.transition='opacity .3s,transform .3s';el.style.opacity='0';el.style.transform='translateY(8px)';setTimeout(()=>el.remove(),320)},2400);
  },
  autoGrow(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,140)+'px'},
  copy(text,cb){
    if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(text).then(cb).catch(()=>fallback());
    else fallback();
    function fallback(){const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');cb()}catch{Utils.toast('فشل النسخ','ph-warning')}ta.remove();}
  },
  speak(text){
    if(!('speechSynthesis' in window)){Utils.toast('المتصفح لا يدعم النطق','ph-warning');return;}
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);u.lang='en-US';u.rate=.95;
    speechSynthesis.speak(u);Utils.toast('يُقرأ البرومبت...','ph-speaker-high');
  }
};

/* ═══ APP STATE ═══ */
const App = {
  state:{
    user:null, posts:[], chats:[], comments:{}, notifications:[],
    filter:'all', model:'all', sort:'recent', tab:'home',
    activeChat:'c1', profileTab:'posts', search:'', theme:'dark'
  },

  init(){
    // Load persisted state
    const savedUser = Utils.storage.get('khayal_user');
    this.state.user = savedUser || null;
    this.state.posts = Utils.storage.get('khayal_posts') || JSON.parse(JSON.stringify(K.posts||[]));
    this.state.chats = Utils.storage.get('khayal_chats') || JSON.parse(JSON.stringify(K.chats||[]));
    this.state.comments = Utils.storage.get('khayal_comments') || JSON.parse(JSON.stringify(K.comments||{}));
    this.state.notifications = K.notifications||[];
    this.state.theme = Utils.storage.get('khayal_theme') || 'dark';

    // Apply theme
    document.documentElement.setAttribute('data-theme', this.state.theme);
    this.syncThemeIcon();

    // Render landing preview
    this.renderLandingPreview();

    // Bind scroll
    window.addEventListener('scroll',()=>{
      const n=Utils.$('#nav');if(n)n.classList.toggle('scrolled',window.scrollY>20);
    },{passive:true});

    // If already signed in, enter app
    if(this.state.user){
      this.applyUser();
      this.enterApp();
    }

    // Bind search
    this.bindSearch();

    // Bind filters
    this.renderFilters('filters');
    this.renderFilters('exploreFilters');
    this.renderSortTabs();
    this.bindProfileTabs();

    // Keyboard shortcuts
    this.bindKeyboard();

    // Track mouse for bento hover glow
    document.addEventListener('mousemove',(e)=>{
      Utils.$$('.bento-card').forEach(c=>{
        const r=c.getBoundingClientRect();
        c.style.setProperty('--mx',(e.clientX-r.left)+'px');
        c.style.setProperty('--my',(e.clientY-r.top)+'px');
      });
    },{passive:true});
  },

  /* ═══ NAVIGATION ═══ */
  goHome(){this.showView('view-landing');window.scrollTo({top:0,behavior:'smooth'})},
  scrollTo(id){const el=document.getElementById(id);if(el)el.scrollIntoView({behavior:'smooth'})},

  showView(id){
    Utils.$$('.view').forEach(v=>v.classList.remove('active'));
    const v=document.getElementById(id);if(v)v.classList.add('active');
    Utils.$('#dock').style.display = id==='view-app' ? 'flex' : 'none';
  },

  previewFeed(){
    if(!this.state.user){Auth.open();return}
    this.enterApp();
  },

  enterApp(){
    this.showView('view-app');
    this.switchTab('home');
    this.renderAllFeeds();
    Chat.render();
    this.updateProfileStats();
  },

  switchTab(tab){
    this.state.tab = tab;
    Utils.$$('.tab-panel').forEach(p=>p.classList.remove('active'));
    Utils.$('#tab-'+tab)?.classList.add('active');
    Utils.$$('.dock-item[data-tab]').forEach(i=>i.classList.toggle('active',i.dataset.tab===tab));

    if(tab==='chat'){Chat.render();Utils.$('#chatLayout')?.classList.remove('show-list')}
    if(tab==='profile')this.renderProfilePanel();
    if(tab==='home')this.renderHomeFeed();
    if(tab==='explore')this.renderExploreFeed();
    if(tab==='liked')this.renderLikedFeed();
    if(tab==='saved')this.renderSavedFeed();
    window.scrollTo({top:0,behavior:'smooth'});
  },

  /* ═══ THEME ═══ */
  toggleTheme(){
    this.state.theme = this.state.theme==='dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', this.state.theme);
    Utils.storage.set('khayal_theme', this.state.theme);
    this.syncThemeIcon();
    Utils.toast(this.state.theme==='dark'?'المظهر الداكن':'المظهر الفاتح','ph-moon');
  },
  syncThemeIcon(){
    const i=Utils.$('#themeIcon');
    if(i)i.className = this.state.theme==='dark' ? 'ph ph-moon' : 'ph ph-sun';
  },

  /* ═══ FILTERS ═══ */
  renderFilters(containerId){
    const el=Utils.$('#'+containerId);if(!el)return;
    const tags=['all','بورتريه','مناظر','سايبربانك','ثلاثي الأبعاد','فيلم','معمار','تصوير','سينمائي'];
    const tagLabels={all:'الكل'};
    let html = tags.map(t=>`<button class="filter${this.state.filter===t?' active':''}" data-filter="${t}" onclick="App.setFilter('${t}')">${tagLabels[t]||'#'+t}</button>`).join('');
    // Models filter
    html += `<span style="width:1px;background:var(--glass-border);margin:0 var(--s2);flex-shrink:0"></span>`;
    html += (K.models||[]).map(m=>`<button class="filter${this.state.model===m?' active':''}" data-model="${m}" onclick="App.setModel('${m}')"><i class="ph ph-cpu"></i> ${m}</button>`).join('');
    el.innerHTML = html;
  },
  setFilter(f){
    this.state.filter = f==='all' ? 'all' : f;
    this.renderFilters('filters');
    this.renderFilters('exploreFilters');
    this.renderHomeFeed();this.renderExploreFeed();
  },
  setModel(m){
    this.state.model = this.state.model===m ? 'all' : m;
    this.renderFilters('filters');
    this.renderFilters('exploreFilters');
    this.renderHomeFeed();this.renderExploreFeed();
  },
  renderSortTabs(){
    Utils.$$('.sort-tab').forEach(b=>b.classList.toggle('active',b.dataset.sort===this.state.sort));
  },
  setSort(s){this.state.sort=s;this.renderSortTabs();this.renderHomeFeed()},

  /* ═══ FEED RENDERING ═══ */
  getFilteredPosts(){
    let posts = this.state.posts.slice();
    const {filter,model,search}=this.state;
    if(filter==='following')posts=posts.filter(p=>['u1','u2','u3'].includes(p.author));
    else if(filter!=='all')posts=posts.filter(p=>(p.tags||[]).includes(filter));
    if(model!=='all')posts=posts.filter(p=>p.model===model);
    if(search){
      const q=search.toLowerCase();
      posts=posts.filter(p=>p.title.toLowerCase().includes(q)||p.prompt.toLowerCase().includes(q)||(p.tags||[]).some(t=>t.includes(q)));
    }
    if(this.state.sort==='top')posts.sort((a,b)=>b.likes-a.likes);
    return posts;
  },

  renderHomeFeed(){Feed.render('homeFeed',this.getFilteredPosts())},
  renderExploreFeed(){Feed.render('exploreFeed',this.state.posts.slice().sort((a,b)=>b.likes-a.likes))},
  renderLikedFeed(){Feed.render('likedFeed',this.state.posts.filter(p=>p.liked),'لم تعجبك أي برومبتات بعد','اضغط القلب في أي برومبت ليظهر هنا.')},
  renderSavedFeed(){Feed.render('savedFeed',this.state.posts.filter(p=>p.saved),'لا شيء محفوظ بعد','احفظ البرومبتات لتعود إليها لاحقاً.')},
  renderLandingPreview(){Feed.render('landingFeed',this.state.posts.slice(0,6),null,null,true)},

  renderAllFeeds(){
    this.renderHomeFeed();
    if(this.state.tab==='explore')this.renderExploreFeed();
    if(this.state.tab==='liked')this.renderLikedFeed();
    if(this.state.tab==='saved')this.renderSavedFeed();
    this.updateProfileStats();
    this.updateBadges();
  },

  updateProfileStats(){
    const mine = this.state.posts.filter(p=>p.author==='me');
    const s1=Utils.$('#statPosts');if(s1)s1.textContent = mine.length.toLocaleString('ar-EG');
    const s2=Utils.$('#statLikes');if(s2)s2.textContent = mine.reduce((a,p)=>a+p.likes,0).toLocaleString('ar-EG');
  },
  updateBadges(){
    const unread = this.state.chats.filter(c=>c.unread).length;
    const cb = Utils.$('#dockChatBadge');
    if(cb){cb.textContent=unread;cb.style.display=unread?'grid':'none'}
    const nb = Utils.$('#notifBadge');
    const n = this.state.notifications.filter(x=>x.unread).length;
    if(nb){nb.textContent=n;nb.style.display=n?'grid':'none'}
  },

  /* ═══ SEARCH ═══ */
  bindSearch(){
    const input = Utils.$('#searchInput');
    const results = Utils.$('#searchResults');
    if(!input||!results)return;
    input.addEventListener('input',e=>{
      const q = e.target.value.trim().toLowerCase();
      this.state.search = q;
      if(!q){results.classList.remove('open');this.renderHomeFeed();return}
      const matches = this.state.posts.filter(p=>
        p.title.toLowerCase().includes(q)||
        p.prompt.toLowerCase().includes(q)||
        (p.tags||[]).some(t=>t.includes(q))
      ).slice(0,6);
      if(!matches.length){
        results.innerHTML = `<div style="padding:20px;text-align:center;color:var(--fg-3);font-size:13px">لا نتائج</div>`;
      } else {
        results.innerHTML = matches.map(p=>`
          <div class="search-result" onclick="App.openPostFromSearch('${p.id}')">
            <img src="${p.image}" alt="" loading="lazy">
            <div class="search-result-info">
              <strong>${Utils.esc(p.title)}</strong>
              <span>${Utils.esc(p.prompt)}</span>
            </div>
          </div>`).join('');
      }
      results.classList.add('open');
      this.renderHomeFeed();
    });
    input.addEventListener('blur',()=>setTimeout(()=>results.classList.remove('open'),200));
    input.addEventListener('focus',()=>{if(input.value.trim())results.classList.add('open')});
  },
  openPostFromSearch(id){
    const p = this.state.posts.find(x=>x.id===id);
    if(!p)return;
    Utils.copyText(p.prompt,()=>{Utils.toast('تم نسخ البرومبت','ph-copy')});
    Utils.$('#searchResults')?.classList.remove('open');
    Utils.$('#searchInput').value='';
    this.state.search='';
  },

  /* ═══ PROFILE ═══ */
  bindProfileTabs(){
    Utils.$$('#profileTabs .tab').forEach(t=>t.addEventListener('click',()=>{
      Utils.$$('#profileTabs .tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      this.state.profileTab = t.dataset.ptab;
      this.renderProfilePanel();
    }));
  },
  renderProfilePanel(){
    const panel = Utils.$('#profilePanel');if(!panel)return;
    const tab = this.state.profileTab;
    if(tab==='posts'){
      const mine = this.state.posts.filter(p=>p.author==='me');
      panel.innerHTML='<div class="feed" id="profilePostsFeed"></div>';
      Feed.render('profilePostsFeed',mine,'لم تنشر برومبتاً بعد','شارِك أول واحد — البرومبت والصورة معاً.');
    } else if(tab==='liked'){
      const liked = this.state.posts.filter(p=>p.liked);
      panel.innerHTML='<div class="feed" id="profileLikedFeed"></div>';
      Feed.render('profileLikedFeed',liked,'لا إعجابات بعد','اضغط القلب في أي برومبت ليظهر هنا.');
    } else if(tab==='settings'){
      panel.innerHTML=`
        <div class="settings-list">
          ${this.settingRow('إشعارات البريد','احصل على إشعار عند الإعجاب أو النسخ',true)}
          ${this.settingRow('ملف عام','يمكن لأي شخص رؤية برومبتاتك',true)}
          ${this.settingRow('الظهور في البحث','دع الناس يجدونك بالاسم',true)}
          ${this.settingRow('المصادقة الثنائية','حماية إضافية لحسابك',false)}
          ${this.settingRow('تقليل الحركة','تقليل الرسوم المتحركة',false)}
        </div>
        <div class="setting-row" style="border-color:rgba(251,113,133,.3);margin-top:var(--s4)">
          <div class="meta"><strong style="color:var(--rose)">منطقة الخطر</strong><span>حذف حسابك يزيل كل برومبتاتك ورسائلك</span></div>
          <button class="btn btn-sm" style="background:rgba(251,113,133,.15);color:var(--rose)" onclick="Utils.toast('يتطلب تأكيداً بالبريد','ph-warning')">
            <i class="ph ph-trash"></i> حذف
          </button>
        </div>`;
      Utils.$$('.switch').forEach(s=>s.addEventListener('click',()=>{
        const on = s.getAttribute('aria-checked')==='true';
        s.setAttribute('aria-checked', String(!on));
      }));
    }
  },
  settingRow(title,desc,on){
    return `<div class="setting-row"><div class="meta"><strong>${title}</strong><span>${desc}</span></div><button class="switch" role="switch" aria-checked="${on}" aria-label="${title}"></button></div>`;
  },

  /* ═══ PUBLISHER DRAWER ═══ */
  openPublisher(uid){
    const u = (K.users||{})[uid];if(!u)return;
    const posts = this.state.posts.filter(p=>p.author===uid);
    // Use comments drawer as generic publisher drawer for now
    const drawer = Utils.$('#commentsDrawer');
    Utils.$('#commentsBody').innerHTML = `
      <div style="padding:var(--s6);text-align:center;position:relative">
        <div style="position:absolute;top:0;left:0;right:0;height:100px;background:linear-gradient(135deg,rgba(34,211,238,.3),rgba(139,92,246,.3));border-radius:0"></div>
        <img src="${u.avatar}" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:4px solid var(--bg-0);position:relative;margin:40px auto 0">
        <h3 style="margin-top:var(--s4);font-size:var(--t-2xl);font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px">
          ${Utils.esc(u.name)}
          ${u.verified?'<i class="ph ph-seal-check" style="color:var(--cyan);font-size:22px"></i>':''}
        </h3>
        <div style="color:var(--fg-3);font-size:var(--t-sm);margin-top:4px">${Utils.esc(u.handle)}</div>
        <p style="margin-top:var(--s4);color:var(--fg-2);line-height:1.7;max-width:44ch;margin-inline:auto">${Utils.esc(u.bio)}</p>
        <div class="profile-stats" style="justify-content:center;margin-top:var(--s5)">
          <div class="stat"><strong>${posts.length}</strong><span>برومبت</span></div>
          <div class="stat"><strong>${u.followers.toLocaleString('ar-EG')}</strong><span>متابِع</span></div>
          <div class="stat"><strong>${u.following}</strong><span>يتابع</span></div>
        </div>
        <div style="display:flex;gap:var(--s2);justify-content:center;margin-top:var(--s5);flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="App.followUser('${uid}',this)">
            <i class="ph ph-user-plus"></i> متابعة
          </button>
          <button class="btn btn-glass btn-sm" onclick="Chat.openWithUser('${uid}')">
            <i class="ph ph-chat-circle-dots"></i> راسل
          </button>
        </div>
      </div>
      <div style="padding:var(--s4) var(--s5) var(--s2);border-top:1px solid var(--glass-border);margin-top:var(--s5)">
        <strong style="font-size:var(--t-sm)">أحدث البرومبتات</strong>
      </div>
      <div style="padding:0 var(--s4) var(--s4)">
        ${posts.length ? posts.slice(0,4).map(p=>`
          <div style="display:flex;gap:var(--s3);padding:var(--s3);border-radius:var(--r-3);cursor:pointer;transition:background .2s" onmouseover="this.style.background='var(--glass)'" onmouseout="this.style.background='transparent'" onclick="Feed.copyPrompt('${p.id}')">
            <img src="${p.image}" style="width:60px;height:60px;border-radius:var(--r-2);object-fit:cover;flex-shrink:0">
            <div style="min-width:0">
              <div style="font-size:var(--t-sm);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${Utils.esc(p.title)}</div>
              <div style="font-size:var(--t-xs);color:var(--fg-3);margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;direction:ltr;text-align:left">${Utils.esc(p.prompt)}</div>
            </div>
          </div>`).join('') : '<div style="padding:var(--s4);color:var(--fg-3);font-size:var(--t-sm);text-align:center">لا توجد برومبتات بعد.</div>'}
      </div>`;
    drawer.classList.add('open');
    document.body.style.overflow='hidden';
  },
  followUser(uid,btn){
    if(!this.state.user){Auth.open();return}
    btn.innerHTML='<i class="ph ph-check"></i> تتابعه';
    btn.classList.remove('btn-primary');btn.classList.add('btn-glass');
    Utils.toast('تتابع الآن '+K.users[uid].name.split(' ')[0]);
  },

  /* ═══ KEYBOARD SHORTCUTS ═══ */
  bindKeyboard(){
    let lastG = 0;
    document.addEventListener('keydown',e=>{
      const t = e.target;
      if(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable)return;

      if(e.key==='Escape'){
        Utils.$$('.scrim').forEach(s=>s.classList.remove('open'));
        Utils.$$('.drawer').forEach(d=>d.classList.remove('open'));
        document.body.style.overflow='';
        return;
      }
      if(e.key==='/'){
        e.preventDefault();Utils.$('#searchInput')?.focus();return;
      }
      if(e.key==='n'){
        e.preventDefault();Composer.open();return;
      }
      if(e.key==='g'){lastG = Date.now();return}
      if(Date.now()-lastG<800){
        const map = {h:'home',e:'explore',c:'chat',p:'profile',l:'liked',s:'saved'};
        if(map[e.key.toLowerCase()]){
          this.switchTab(map[e.key.toLowerCase()]);
          lastG=0;
        }
      }
    });
  }
};

/* ═══════════════════════════════════════════
   FEED
   ═══════════════════════════════════════════ */
const Feed = {
  render(id,posts,emptyT,emptyB,compact){
    const el = Utils.$('#'+id);if(!el)return;
    if(!posts.length){
      el.innerHTML=`<div class="empty"><i class="ph ph-sparkle"></i><h4>${emptyT||'لا توجد برومبتات'}</h4><p>${emptyB||'جرّب فلتراً آخر أو مصطلح بحث مختلف.'}</p></div>`;
      return;
    }
    el.innerHTML = posts.map(p=>this.card(p,compact)).join('');
  },

  card(p,compact){
    const a = (K.users||{})[p.author] || {name:'غير معروف',handle:'@?',avatar:'https://picsum.photos/seed/x/80/80'};
    const tags = (p.tags||[]).slice(0,3).map(t=>`<span class="tag" onclick="event.stopPropagation();App.setFilter('${t}')">#${Utils.esc(t)}</span>`).join('');
    const verified = a.verified?'<i class="ph ph-seal-check verified"></i>':'';
    return `<article class="prompt-card" data-post="${p.id}">
      <div class="prompt-img" onclick="App.openPublisher('${p.author}')">
        <img src="${p.image}" alt="${Utils.esc(p.title)}" loading="lazy" onerror="this.style.display='none';this.parentElement.style.background='linear-gradient(135deg,rgba(34,211,238,.2),rgba(139,92,246,.2))'">
        <span class="model-tag"><i class="ph ph-cpu"></i> ${Utils.esc(p.model)}</span>
        <div class="card-actions-top" onclick="event.stopPropagation()">
          <button class="glass-btn ${p.liked?'liked':''}" data-like="${p.id}" onclick="Feed.toggleLike('${p.id}')" aria-label="إعجاب">
            <i class="ph${p.liked?'-fill':''} ph-heart"></i>
          </button>
          <button class="glass-btn ${p.saved?'saved':''}" data-save="${p.id}" onclick="Feed.toggleSave('${p.id}')" aria-label="حفظ">
            <i class="ph${p.saved?'-fill':''} ph-bookmark-simple"></i>
          </button>
        </div>
      </div>
      <div class="prompt-body">
        <div class="author-row" onclick="App.openPublisher('${p.author}')">
          <img class="author-avatar" src="${a.avatar}" alt="">
          <div class="author-info">
            <span class="author-name">${Utils.esc(a.name)}${verified}</span>
            <span class="author-meta">${Utils.esc(a.handle)} · ${p.time}</span>
          </div>
        </div>
        <h3 class="prompt-title">${Utils.esc(p.title)}</h3>
        <div class="prompt-excerpt" onclick="event.stopPropagation();Feed.copyPrompt('${p.id}')" title="انقر للنسخ">${Utils.esc(p.prompt)}</div>
        <div class="prompt-tags">${tags}</div>
      </div>
      <div class="prompt-actions">
        <button class="action ${p.liked?'liked':''}" data-like-action="${p.id}" onclick="Feed.toggleLike('${p.id}')">
          <i class="ph${p.liked?'-fill':''} ph-heart"></i>
          <span data-like-count="${p.id}">${p.likes}</span>
        </button>
        <button class="action" onclick="Drawers.openComments('${p.id}')" aria-label="تعليقات">
          <i class="ph ph-chat-circle"></i>
          <span data-comment-count="${p.id}">${(App.state.comments[p.id]||[]).length || p.comments || 0}</span>
        </button>
        <button class="action" onclick="Feed.share('${p.id}')" aria-label="مشاركة">
          <i class="ph ph-share-network"></i>
        </button>
        <button class="action" onclick="Utils.speak(${JSON.stringify(p.prompt).replace(/"/g,'&quot;')})" aria-label="استماع">
          <i class="ph ph-speaker-high"></i>
        </button>
        ${!compact ? `
        <button class="action action-primary" data-copy="${p.id}" onclick="Feed.copyPrompt('${p.id}')">
          <i class="ph ph-copy"></i><span>نسخ</span>
        </button>` : `
        <button class="action" data-copy="${p.id}" onclick="Feed.copyPrompt('${p.id}')">
          <i class="ph ph-copy"></i><span data-copies="${p.id}">${p.copies}</span>
        </button>`}
      </div>
    </article>`;
  },

  toggleLike(id){
    const p = App.state.posts.find(x=>x.id===id);if(!p)return;
    p.liked = !p.liked;
    p.likes += p.liked ? 1 : -1;
    // Push notification to author (simulated)
    if(p.liked && p.author!=='me'){
      App.state.notifications.unshift({
        id:'n'+Date.now(),type:'like',user:'me',
        text:`أعجب ببرومبت «${p.title}»`,time:'الآن',unread:true,post:p.id
      });
      App.updateBadges();
    }
    Utils.storage.set('khayal_posts',App.state.posts);
    this.syncCard(p);
    Utils.toast(p.liked?'أُضيف إلى المُعجَبة':'أُزيل','ph-heart');
  },

  toggleSave(id){
    const p = App.state.posts.find(x=>x.id===id);if(!p)return;
    p.saved = !p.saved;
    p.saves = (p.saves||0) + (p.saved?1:-1);
    Utils.storage.set('khayal_posts',App.state.posts);
    this.syncCard(p);
    Utils.toast(p.saved?'حُفظ':'أُزيل من المحفوظة','ph-bookmark-simple');
  },

  syncCard(p){
    Utils.$$(`[data-like="${p.id}"]`).forEach(b=>{b.classList.toggle('liked',p.liked);const i=b.querySelector('i');if(i)i.className=`ph${p.liked?'-fill':''} ph-heart`});
    Utils.$$(`[data-save="${p.id}"]`).forEach(b=>{b.classList.toggle('saved',p.saved);const i=b.querySelector('i');if(i)i.className=`ph${p.saved?'-fill':''} ph-bookmark-simple`});
    Utils.$$(`[data-like-action="${p.id}"]`).forEach(b=>{b.classList.toggle('liked',p.liked);const i=b.querySelector('i');if(i)i.className=`ph${p.liked?'-fill':''} ph-heart`});
    Utils.$$(`[data-like-count="${p.id}"]`).forEach(el=>el.textContent=p.likes);
  },

  copyPrompt(id){
    const p = App.state.posts.find(x=>x.id===id);if(!p)return;
    Utils.copyText(p.prompt,()=>{
      p.copies++;
      Utils.storage.set('khayal_posts',App.state.posts);
      Utils.$$(`[data-copy="${id}"]`).forEach(btn=>{
        btn.classList.add('copied');
        const lbl = btn.querySelector('span');
        const orig = lbl ? lbl.textContent : '';
        if(lbl)lbl.textContent='تم النسخ';
        setTimeout(()=>{btn.classList.remove('copied');if(lbl)lbl.textContent=orig},1600);
      });
      Utils.$$(`[data-copies="${id}"]`).forEach(el=>el.textContent=p.copies);
      Utils.toast('تم نسخ البرومبت','ph-copy');
    });
  },

  share(id){
    const p = App.state.posts.find(x=>x.id===id);if(!p)return;
    const url = location.origin + '/#prompt-' + id;
    if(navigator.share)navigator.share({title:p.title,text:p.prompt.slice(0,100),url}).catch(()=>{});
    else Utils.copyText(url,()=>Utils.toast('تم نسخ الرابط','ph-link'));
  }
};

/* ═══════════════════════════════════════════
   COMPOSER
   ═══════════════════════════════════════════ */
const Composer = {
  open(){if(!App.state.user){Auth.open();return}Utils.$('#composerModal').classList.add('open');setTimeout(()=>Utils.$('#cTitle')?.focus(),120);document.body.style.overflow='hidden'},
  close(e){if(e&&e.target!==e.currentTarget)return;Utils.$('#composerModal').classList.remove('open');document.body.style.overflow=''},
  publish(e){
    e.preventDefault();
    const p = {
      id:'p'+Date.now(),author:'me',
      title:Utils.$('#cTitle').value.trim(),
      prompt:Utils.$('#cPrompt').value.trim(),
      image:Utils.$('#cImage').value.trim(),
      model:Utils.$('#cModel').value,
      tags:Utils.$('#cTags').value.split(/[,،]/).map(t=>t.trim()).filter(Boolean),
      likes:0,copies:0,saves:0,liked:false,saved:false,comments:0,time:'الآن'
    };
    App.state.posts.unshift(p);
    Utils.storage.set('khayal_posts',App.state.posts);
    this.close();
    App.renderAllFeeds();
    Utils.toast('نُشر البرومبت بنجاح','ph-sparkle');
    App.switchTab('profile');
    App.state.profileTab='posts';
    Utils.$$('#profileTabs .tab').forEach(x=>x.classList.toggle('active',x.dataset.ptab==='posts'));
    App.renderProfilePanel();
  }
};

/* ═══════════════════════════════════════════
   AUTH
   ═══════════════════════════════════════════ */
const Auth = {
  open(){Utils.$('#authModal').classList.add('open');document.body.style.overflow='hidden'},
  close(e){if(e&&e.target!==e.currentTarget)return;Utils.$('#authModal').classList.remove('open');document.body.style.overflow=''},
  signIn(){
    App.state.user = JSON.parse(JSON.stringify(K.current_user||{name:'أنت',handle:'@you',avatar:'https://picsum.photos/seed/user_me/160/160',bio:'مبدع على خَيال.'}));
    Utils.storage.set('khayal_user',App.state.user);
    this.close();
    App.applyUser();
    App.enterApp();
    Utils.toast('أهلاً '+App.state.user.name+'!','ph-hand-waving');
  },
  logout(){
    Utils.storage.rm('khayal_user');
    App.state.user = null;
    Utils.$('#signInBtn').style.display = '';
    Utils.$('#avatarBtn').style.display = 'none';
    Utils.$('#notifBtn').style.display = 'none';
    App.showView('view-landing');
    Utils.toast('تم تسجيل الخروج','ph-sign-out');
  },
  openEditProfile(){
    if(!App.state.user)return;
    Utils.$('#epName').value = App.state.user.name;
    Utils.$('#epHandle').value = App.state.user.handle;
    Utils.$('#epBio').value = App.state.user.bio;
    Utils.$('#epAvatar').value = App.state.user.avatar;
    Utils.$('#editProfileModal').classList.add('open');
    document.body.style.overflow='hidden';
  },
  closeEditProfile(e){
    if(e&&e.target!==e.currentTarget)return;
    Utils.$('#editProfileModal').classList.remove('open');
    document.body.style.overflow='';
  },
  saveProfile(e){
    e.preventDefault();
    App.state.user.name = Utils.$('#epName').value.trim();
    App.state.user.handle = Utils.$('#epHandle').value.trim();
    App.state.user.bio = Utils.$('#epBio').value.trim();
    App.state.user.avatar = Utils.$('#epAvatar').value.trim() || App.state.user.avatar;
    Utils.storage.set('khayal_user',App.state.user);
    this.closeEditProfile();
    App.applyUser();
    Utils.toast('تم حفظ التغييرات','ph-check-circle');
  }
};

App.applyUser = function(){
  const u = this.state.user;if(!u)return;
  Utils.$('#signInBtn').style.display = 'none';
  Utils.$('#avatarBtn').style.display = 'grid';
  Utils.$('#notifBtn').style.display = 'grid';
  const av = Utils.$('#avatarBtn img');if(av)av.src = u.avatar;
  const pn = Utils.$('#profileName');if(pn)pn.textContent = u.name;
  const ph = Utils.$('#profileHandle');if(ph)ph.textContent = u.handle;
  const pb = Utils.$('#profileBio');if(pb)pb.textContent = u.bio;
  const pa = Utils.$('#profileAvatar');if(pa)pa.src = u.avatar;
};

/* ═══════════════════════════════════════════
   CHAT
   ═══════════════════════════════════════════ */
const Chat = {
  render(){
    const list = Utils.$('#chatList');if(!list)return;
    const s = App.state;
    list.innerHTML = s.chats.map(c=>{
      const u = (K.users||{})[c.with_user]||{name:'?',avatar:''};
      const last = c.messages[c.messages.length-1];
      const active = c.id===s.activeChat;
      return `<div class="chat-item ${active?'active':''} ${c.unread?'unread':''}" onclick="Chat.open('${c.id}')">
        <img class="author-avatar" src="${u.avatar}" alt="">
        <div class="chat-item-info">
          <div class="chat-item-top">
            <span class="chat-name">${Utils.esc(u.name)}</span>
            <span class="chat-time">${last.time}</span>
          </div>
          <div class="chat-preview">${last.from==='me'?'أنت: ':''}${Utils.esc(last.text)}</div>
        </div>
        ${c.unread?'<span class="unread-dot"></span>':''}
      </div>`;
    }).join('');
    this.renderThread();
    App.updateBadges();
  },

  open(id){
    App.state.activeChat = id;
    const c = App.state.chats.find(x=>x.id===id);
    if(c)c.unread = false;
    Utils.storage.set('khayal_chats', App.state.chats);
    this.render();
    const layout = Utils.$('#chatLayout');
    if(layout && window.innerWidth>820) layout.classList.add('show-list');
    if(layout && window.innerWidth<=820) layout.classList.remove('show-list');
  },

  openWithUser(uid){
    if(!App.state.user){Auth.open();return}
    // Close publisher drawer
    Utils.$$('.drawer').forEach(d=>d.classList.remove('open'));
    document.body.style.overflow='';
    let c = App.state.chats.find(x=>x.with_user===uid);
    if(!c){
      c = {id:'c'+Date.now(),with_user:uid,unread:false,messages:[]};
      App.state.chats.push(c);
      Utils.storage.set('khayal_chats',App.state.chats);
    }
    App.state.activeChat = c.id;
    App.switchTab('chat');
    setTimeout(()=>Utils.$('#chatInput')?.focus(),200);
  },

  renderThread(){
    const c = App.state.chats.find(x=>x.id===App.state.activeChat);
    const head = Utils.$('#chatHead');
    const body = Utils.$('#chatBody');
    if(!head||!body)return;
    if(!c){head.innerHTML='';body.innerHTML='';return}
    const u = (K.users||{})[c.with_user]||{name:'?',avatar:'',id:''};

    head.innerHTML = `
      <button class="icon-btn" onclick="Chat.backToList()" style="display:${window.innerWidth<=820?'grid':'none'}"><i class="ph ph-arrow-right"></i></button>
      <img class="author-avatar" src="${u.avatar}" alt="">
      <div class="chat-head-info">
        <strong>${Utils.esc(u.name)}</strong>
        <span>متصل الآن</span>
      </div>
      <button class="icon-btn" onclick="App.openPublisher('${u.id}')" aria-label="الملف"><i class="ph ph-user-circle"></i></button>
    `;

    body.innerHTML = c.messages.map(m=>{
      let share='';
      if(m.share){
        const sp = App.state.posts.find(x=>x.id===m.share);
        if(sp) share = `<div class="msg-share" onclick="Feed.copyPrompt('${sp.id}')">
          <img src="${sp.image}" alt="">
          <div style="min-width:0">
            <div style="font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${Utils.esc(sp.title)}</div>
            <div style="font-size:11px;color:var(--fg-3)">انقر لنسخ البرومبت</div>
          </div>
        </div>`;
      }
      return `<div class="msg ${m.from==='me'?'me':'them'}">
        ${Utils.esc(m.text).replace(/\n/g,'<br>')}${share}
        <span class="msg-time">${m.time}</span>
      </div>`;
    }).join('');
    body.scrollTop = body.scrollHeight;
  },

  backToList(){Utils.$('#chatLayout')?.classList.add('show-list')},

  send(e){
    e.preventDefault();
    const input = Utils.$('#chatInput');
    const text = input.value.trim();if(!text)return;
    const c = App.state.chats.find(x=>x.id===App.state.activeChat);
    if(!c)return;
    const t = new Date().toTimeString().slice(0,5);
    c.messages.push({from:'me',text,time:t});
    input.value='';input.style.height='auto';
    Utils.storage.set('khayal_chats',App.state.chats);
    this.renderThread();this.render();
    setTimeout(()=>{
      const replies = ['تمام 👍','جميل.','سأجربه.','شكراً للمشاركة!','منطقي.'];
      const r = replies[Math.floor(Math.random()*replies.length)];
      c.messages.push({from:'them',text:r,time:t});
      Utils.storage.set('khayal_chats',App.state.chats);
      if(App.state.activeChat===c.id)this.renderThread();
      this.render();
    },1400);
  }
};

/* ═══════════════════════════════════════════
   COMMENTS + NOTIFICATIONS DRAWERS
   ═══════════════════════════════════════════ */
const Drawers = {
  currentPost: null,

  openComments(pid){
    this.currentPost = pid;
    const list = App.state.comments[pid]||[];
    Utils.$('#commentCount').textContent = `(${list.length.toLocaleString('ar-EG')})`;
    this.renderComments();
    Utils.$('#commentsDrawer').classList.add('open');
    document.body.style.overflow='hidden';
  },
  closeComments(){
    Utils.$('#commentsDrawer').classList.remove('open');
    document.body.style.overflow='';
  },
  renderComments(){
    const pid = this.currentPost;
    const list = App.state.comments[pid]||[];
    const body = Utils.$('#commentsBody');
    if(!list.length){
      body.innerHTML=`<div class="empty"><i class="ph ph-chat-circle"></i><h4>لا تعليقات بعد</h4><p>كن أول من يعلّق.</p></div>`;
      return;
    }
    body.innerHTML = list.map(c=>{
      const u = (K.users||{})[c.author]||{name:'?',avatar:''};
      return `<div class="comment">
        <img class="author-avatar" src="${u.avatar}" alt="">
        <div class="comment-body">
          <div class="comment-top">
            <span class="comment-name">${Utils.esc(u.name)}</span>
            <span class="comment-time">${c.time}</span>
          </div>
          <div class="comment-text">${Utils.esc(c.text)}</div>
          <div class="comment-actions">
            <button onclick="Utils.toast('أعجب بالتعليق')">إعجاب · ${c.likes||0}</button>
            <button onclick="Utils.toast('رد قريباً')">ردّ</button>
          </div>
        </div>
      </div>`;
    }).join('');
  },

  openNotifications(){
    this.renderNotifications();
    Utils.$('#notificationsDrawer').classList.add('open');
    document.body.style.overflow='hidden';
  },
  closeNotifications(){
    Utils.$('#notificationsDrawer').classList.remove('open');
    document.body.style.overflow='';
  },
  renderNotifications(){
    const body = Utils.$('#notificationsBody');
    const list = App.state.notifications;
    if(!list.length){
      body.innerHTML=`<div class="empty"><i class="ph ph-bell-slash"></i><h4>لا إشعارات</h4><p>ستظهر هنا تفاعلات الآخرين معك.</p></div>`;
      return;
    }
    const iconMap = {like:'ph-heart',follow:'ph-user-plus',comment:'ph-chat-circle',copy:'ph-copy'};
    body.innerHTML = list.map(n=>{
      const u = (K.users||{})[n.user]||{name:'?',avatar:''};
      return `<div class="notif ${n.unread?'unread':''}" onclick="Drawers.onNotifClick('${n.id}')">
        <div class="notif-wrap">
          <img class="author-avatar" src="${u.avatar}" alt="" style="width:44px;height:44px">
          <span class="notif-icon ${n.type}"><i class="ph ${iconMap[n.type]||'ph-bell'}"></i></span>
        </div>
        <div class="notif-body">
          <p><strong>${Utils.esc(u.name)}</strong> ${Utils.esc(n.text)}</p>
          <span class="notif-time">${n.time}</span>
        </div>
      </div>`;
    }).join('');
  },
  onNotifClick(id){
    const n = App.state.notifications.find(x=>x.id===id);if(!n)return;
    n.unread = false;
    App.updateBadges();
    this.renderNotifications();
    if(n.post){
      const p = App.state.posts.find(x=>x.id===n.post);
      if(p)Feed.copyPrompt(p.id);
    }
  },
  markAllRead(){
    App.state.notifications.forEach(n=>n.unread=false);
    App.updateBadges();
    this.renderNotifications();
    Utils.toast('كل الإشعارات مقروءة','ph-checks');
  }
};

const Comments = {
  send(e){
    e.preventDefault();
    const input = Utils.$('#commentInput');
    const text = input.value.trim();if(!text)return;
    const pid = Drawers.currentPost;if(!pid)return;
    const c = {id:'c'+Date.now(),author:'me',text,time:'الآن',likes:0};
    if(!App.state.comments[pid])App.state.comments[pid]=[];
    App.state.comments[pid].push(c);
    Utils.storage.set('khayal_comments',App.state.comments);
    input.value='';input.style.height='auto';
    Drawers.renderComments();
    Utils.$$(`[data-comment-count="${pid}"]`).forEach(el=>el.textContent=App.state.comments[pid].length);
    Utils.toast('أُضيف تعليقك','ph-chat-circle');
  }
};

/* ═══════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded',()=>App.init());

// Resize handler
let rt;window.addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(()=>{
  if(App.state.tab==='chat')Chat.render();
},200)},{passive:true});