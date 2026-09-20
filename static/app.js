/* ═══════════════════════════════════════════════════════════
   خَيال — Aurora · الواجهة الأمامية
   لا توجد بيانات افتراضية. كل شيء يُقرأ ويُكتب عبر REST API.
   ═══════════════════════════════════════════════════════════ */

/* ═══ HELPERS ═══ */
const Utils = {
  $:(s,r=document)=>r.querySelector(s),
  $$:(s,r=document)=>[...r.querySelectorAll(s)],
  esc(s){return s==null?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')},
  storage:{
    get(k,f){try{const v=localStorage.getItem(k);return v?JSON.parse(v):f}catch{return f}},
    set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}},
    rm(k){try{localStorage.removeItem(k)}catch{}}
  },
  toast(msg,icon='ph-check-circle'){
    const w=Utils.$('#toastWrap');if(!w)return;
    const el=document.createElement('div');el.className='toast';
    el.innerHTML=`<i class="ph ${icon}"></i> ${Utils.esc(msg)}`;w.appendChild(el);
    setTimeout(()=>{
      el.style.transition='opacity .3s,transform .3s';
      el.style.opacity='0';el.style.transform='translateY(8px)';
      setTimeout(()=>el.remove(),320);
    },2400);
  },
  autoGrow(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,140)+'px'},
  copy(text,cb){
    if(navigator.clipboard&&window.isSecureContext){
      navigator.clipboard.writeText(text).then(cb).catch(()=>fallback());
    } else fallback();
    function fallback(){
      const ta=document.createElement('textarea');
      ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
      document.body.appendChild(ta);ta.select();
      try{document.execCommand('copy');cb()}catch{Utils.toast('فشل النسخ','ph-warning')}
      ta.remove();
    }
  },
  speak(text){
    if(!('speechSynthesis' in window)){Utils.toast('المتصفح لا يدعم النطق','ph-warning');return;}
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    u.lang='en-US';u.rate=.95;
    speechSynthesis.speak(u);
    Utils.toast('يُقرأ البرومبت...','ph-speaker-high');
  },
  fmtDate(s){
    if(!s)return '';
    const d=new Date(s);
    const now=new Date();
    const diff=(now-d)/1000;
    if(diff<60)return 'الآن';
    if(diff<3600)return `قبل ${Math.floor(diff/60)} د`;
    if(diff<86400)return `قبل ${Math.floor(diff/3600)} س`;
    if(diff<604800)return `قبل ${Math.floor(diff/86400)} ي`;
    return d.toLocaleDateString('ar-EG');
  },
  fmtNum(n){return (n||0).toLocaleString('ar-EG')}
};

/* ═══ API ═══ */
const API = {
  async req(method, path, body){
    const opt={method,headers:{'Content-Type':'application/json'},credentials:'same-origin'};
    if(body)opt.body=JSON.stringify(body);
    const r=await fetch(path,opt);
    if(!r.ok){
      const err=await r.json().catch(()=>({}));
      throw new Error(err.error||`HTTP ${r.status}`);
    }
    if(r.status===204)return null;
    return r.json();
  },
  get:(p)=>API.req('GET',p),
  post:(p,b)=>API.req('POST',p,b),
  patch:(p,b)=>API.req('PATCH',p,b),
  del:(p)=>API.req('DELETE',p),
};

/* ═══ GLOBAL STATE ═══ */
const K = {
  me: window.__ME__ || null,
  users: {},          // cache by id
  models: ['Midjourney v6','DALL·E 3','Stable Diffusion XL','Flux 1.1 Pro','Adobe Firefly'],
};

/* ═══ APP ═══ */
const App = {
  state:{
    posts:[], chats:[], comments:{},
    filter:'all', model:'all', sort:'recent', tab:'home',
    activeChat:null, profileTab:'posts', search:'', theme:'dark',
    initialView: (new URLSearchParams(location.search).get('view')) || null,
  },

  async init(){
    // Theme
    this.state.theme = Utils.storage.get('khayal_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', this.state.theme);
    this.syncThemeIcon();

    // Nav scroll
    window.addEventListener('scroll',()=>{
      const n=Utils.$('#nav');if(n)n.classList.toggle('scrolled',window.scrollY>20);
    },{passive:true});

    // Bind UI
    this.bindSearch();
    this.bindProfileTabs();
    this.bindKeyboard();
    this.renderFilters('filters');
    this.renderFilters('exploreFilters');
    this.renderSortTabs();

    // Bento mouse glow
    document.addEventListener('mousemove',e=>{
      Utils.$$('.bento-card').forEach(c=>{
        const r=c.getBoundingClientRect();
        c.style.setProperty('--mx',(e.clientX-r.left)+'px');
        c.style.setProperty('--my',(e.clientY-r.top)+'px');
      });
    },{passive:true});

    // Load data
    await this.refreshAll();

    // Enter app if signed in
    if(K.me){
      this.applyUser();
      this.enterApp();
    }
  },

  async refreshAll(){
    try{
      // Try to fetch me first
      try{ K.me = await API.get('/api/me'); }catch{ K.me = null; }

      // Fetch public posts
      const posts = await API.get('/api/posts?limit=100');
      this.state.posts = posts || [];
      this.state.posts.forEach(p=>{ if(p.author_data) K.users[p.author_data.id]=p.author_data; });

      // Fetch chats if signed in
      if(K.me){
        try{ this.state.chats = await API.get('/api/chats'); }catch{ this.state.chats=[]; }
      } else {
        this.state.chats=[];
      }

      this.renderLandingPreview();
      this.renderAllFeeds();
      if(K.me)Chat.render();
    } catch(e){
      console.error('refreshAll:',e);
      Utils.toast('تعذّر تحميل البيانات','ph-warning');
    }
  },

  /* ═══ NAVIGATION ═══ */
  goHome(){this.showView('view-landing');window.scrollTo({top:0,behavior:'smooth'})},
  scrollTo(id){const el=document.getElementById(id);if(el)el.scrollIntoView({behavior:'smooth'})},

  showView(id){
    Utils.$$('.view').forEach(v=>v.classList.remove('active'));
    const v=document.getElementById(id);if(v)v.classList.add('active');
    const dock=Utils.$('#dock');if(dock)dock.style.display=id==='view-app'?'flex':'none';
  },

  previewFeed(){
    if(!K.me){Auth.open();return}
    this.enterApp();
  },

  enterApp(){
    this.showView('view-app');
    this.switchTab('home');
    this.renderAllFeeds();
    if(K.me)Chat.render();
    this.updateProfileStats();
  },

  switchTab(tab){
    this.state.tab=tab;
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
    this.state.theme = this.state.theme==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme',this.state.theme);
    Utils.storage.set('khayal_theme',this.state.theme);
    this.syncThemeIcon();
  },
  syncThemeIcon(){
    const i=Utils.$('#themeIcon');
    if(i)i.className=this.state.theme==='dark'?'ph ph-moon':'ph ph-sun';
  },

  /* ═══ FILTERS ═══ */
  renderFilters(containerId){
    const el=Utils.$('#'+containerId);if(!el)return;
    const tags=['all','بورتريه','مناظر','سايبربانك','ثلاثي الأبعاد','فيلم','معمار','تصوير','سينمائي'];
    const labels={all:'الكل'};
    let html = tags.map(t=>{
      const active = this.state.filter===t ? ' active' : '';
      return `<button class="filter${active}" data-filter="${t}" onclick="App.setFilter('${t}')">${labels[t]||'#'+t}</button>`;
    }).join('');

    html += `<span style="width:1px;background:var(--glass-border);margin:0 var(--s2);flex-shrink:0"></span>`;
    html += K.models.map(m=>{
      const active = this.state.model===m ? ' active' : '';
      return `<button class="filter${active}" onclick="App.setModel('${m}')"><i class="ph ph-cpu"></i> ${m}</button>`;
    }).join('');

    el.innerHTML = html;
  },
  setFilter(f){
    this.state.filter=f;
    this.renderFilters('filters');
    this.renderFilters('exploreFilters');
    this.renderHomeFeed();this.renderExploreFeed();
  },
  setModel(m){
    this.state.model = this.state.model===m?'all':m;
    this.renderFilters('filters');
    this.renderFilters('exploreFilters');
    this.renderHomeFeed();this.renderExploreFeed();
  },
  renderSortTabs(){
    Utils.$$('.sort-tab').forEach(b=>b.classList.toggle('active',b.dataset.sort===this.state.sort));
  },
  setSort(s){this.state.sort=s;this.renderSortTabs();this.renderHomeFeed()},

  /* ═══ FEEDS ═══ */
  filterPosts(){
    let posts = this.state.posts.slice();
    const {filter,model,search,sort}=this.state;

    if(filter==='following' && K.me){
      const followingIds = new Set();
      // We don't have the full following list client-side; skip for now
      posts = posts;
    } else if(filter!=='all' && filter!=='following'){
      posts = posts.filter(p=>(p.tags||[]).includes(filter));
    }
    if(model!=='all')posts=posts.filter(p=>p.model===model);
    if(search){
      const q=search.toLowerCase();
      posts=posts.filter(p=>
        p.title.toLowerCase().includes(q)||
        p.prompt.toLowerCase().includes(q)||
        (p.tags||[]).some(t=>t.includes(q))
      );
    }
    if(sort==='top')posts.sort((a,b)=>b.likes-a.likes);
    return posts;
  },

  renderHomeFeed(){Feed.render('homeFeed',this.filterPosts())},
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
    if(!K.me){return}
    const mine = this.state.posts.filter(p=>p.author===K.me.id);
    const s1=Utils.$('#statPosts');if(s1)s1.textContent=Utils.fmtNum(mine.length);
    const s2=Utils.$('#statLikes');if(s2)s2.textContent=Utils.fmtNum(mine.reduce((a,p)=>a+p.likes,0));
    const s3=Utils.$('#statFollowers');if(s3)s3.textContent=Utils.fmtNum(K.me.followers||0);
    const s4=Utils.$('#statFollowing');if(s4)s4.textContent=Utils.fmtNum(K.me.following||0);
  },
  updateBadges(){
    const unread = this.state.chats.reduce((a,c)=>a+(c.unread||0),0);
    const cb=Utils.$('#dockChatBadge');
    if(cb){cb.textContent=Utils.fmtNum(unread);cb.style.display=unread?'grid':'none'}
  },

  /* ═══ SEARCH ═══ */
  bindSearch(){
    const input=Utils.$('#searchInput');
    const results=Utils.$('#searchResults');
    if(!input||!results)return;

    let timer;
    input.addEventListener('input',e=>{
      clearTimeout(timer);
      const q=e.target.value.trim();
      this.state.search=q;
      timer=setTimeout(async()=>{
        if(!q){results.classList.remove('open');this.renderHomeFeed();return}
        try{
          const matches = await API.get(`/api/posts?q=${encodeURIComponent(q)}&limit=6`);
          if(!matches.length){
            results.innerHTML=`<div style="padding:20px;text-align:center;color:var(--fg-3);font-size:13px">لا نتائج</div>`;
          } else {
            results.innerHTML = matches.map(p=>`
              <div class="search-result" onclick="App.openPostFromSearch('${p.id}')">
                <img src="${p.image||''}" alt="" loading="lazy">
                <div class="search-result-info">
                  <strong>${Utils.esc(p.title)}</strong>
                  <span>${Utils.esc(p.prompt)}</span>
                </div>
              </div>`).join('');
          }
          results.classList.add('open');
        }catch{}
      },300);
    });
    input.addEventListener('blur',()=>setTimeout(()=>results.classList.remove('open'),200));
    input.addEventListener('focus',()=>{if(input.value.trim())results.classList.add('open')});
  },
  async openPostFromSearch(id){
    try{
      const p = await API.get(`/api/posts/${id}`);
      Utils.copyText(p.prompt,async()=>{
        Utils.toast('تم نسخ البرومبت','ph-copy');
        try{await API.post(`/api/posts/${id}/copy`)}catch{}
      });
      Utils.$('#searchResults')?.classList.remove('open');
      Utils.$('#searchInput').value='';
      this.state.search='';
    }catch{}
  },

  /* ═══ PROFILE ═══ */
  bindProfileTabs(){
    Utils.$$('#profileTabs .tab').forEach(t=>t.addEventListener('click',()=>{
      Utils.$$('#profileTabs .tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      this.state.profileTab=t.dataset.ptab;
      this.renderProfilePanel();
    }));
  },
  renderProfilePanel(){
    const panel=Utils.$('#profilePanel');if(!panel)return;
    const tab=this.state.profileTab;
    if(tab==='posts'){
      const mine = K.me ? this.state.posts.filter(p=>p.author===K.me.id) : [];
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
          <div class="meta">
            <strong style="color:var(--rose)">منطقة الخطر</strong>
            <span>حذف حسابك يزيل كل برومبتاتك ورسائلك</span>
          </div>
          <button class="btn btn-sm" style="background:rgba(251,113,133,.15);color:var(--rose)" onclick="Utils.toast('يتطلب تأكيداً بالبريد','ph-warning')">
            <i class="ph ph-trash"></i> حذف
          </button>
        </div>`;
      Utils.$$('.switch').forEach(s=>s.addEventListener('click',()=>{
        const on=s.getAttribute('aria-checked')==='true';
        s.setAttribute('aria-checked',String(!on));
      }));
    }
  },
  settingRow(title,desc,on){
    return `<div class="setting-row">
      <div class="meta"><strong>${title}</strong><span>${desc}</span></div>
      <button class="switch" role="switch" aria-checked="${on}" aria-label="${title}"></button>
    </div>`;
  },

  /* ═══ PUBLISHER DRAWER ═══ */
  async openPublisher(uid){
    try{
      const u = await API.get(`/api/users/${uid}`);
      const posts = await API.get(`/api/users/${uid}/posts`);
      const isMe = K.me && K.me.id===u.id;

      Utils.$('#commentsBody').innerHTML = `
        <div style="padding:var(--s6);text-align:center;position:relative">
          <div style="position:absolute;top:0;left:0;right:0;height:100px;background:linear-gradient(135deg,rgba(34,211,238,.3),rgba(139,92,246,.3))"></div>
          <img src="${u.avatar}" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:4px solid var(--bg-0);position:relative;margin:40px auto 0">
          <h3 style="margin-top:var(--s4);font-size:var(--t-2xl);font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px">
            ${Utils.esc(u.name)}
            ${u.verified?'<i class="ph ph-seal-check" style="color:var(--cyan);font-size:22px"></i>':''}
          </h3>
          <div style="color:var(--fg-3);font-size:var(--t-sm);margin-top:4px">${Utils.esc(u.handle)}</div>
          <p style="margin-top:var(--s4);color:var(--fg-2);line-height:1.7;max-width:44ch;margin-inline:auto">${Utils.esc(u.bio||'')}</p>
          <div class="profile-stats" style="justify-content:center;margin-top:var(--s5)">
            <div class="stat"><strong>${Utils.fmtNum(posts.length)}</strong><span>برومبت</span></div>
            <div class="stat"><strong>${Utils.fmtNum(u.followers)}</strong><span>متابِع</span></div>
            <div class="stat"><strong>${Utils.fmtNum(u.following)}</strong><span>يتابع</span></div>
          </div>
          ${!isMe ? `
          <div style="display:flex;gap:var(--s2);justify-content:center;margin-top:var(--s5);flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="App.followUser(${u.id},this)">
              <i class="ph ph-user-plus"></i> متابعة
            </button>
            <button class="btn btn-glass btn-sm" onclick="Chat.openWithUser(${u.id})">
              <i class="ph ph-chat-circle-dots"></i> راسل
            </button>
          </div>` : ''}
        </div>
        <div style="padding:var(--s4) var(--s5) var(--s2);border-top:1px solid var(--glass-border);margin-top:var(--s5)">
          <strong style="font-size:var(--t-sm)">أحدث البرومبتات</strong>
        </div>
        <div style="padding:0 var(--s4) var(--s4)">
          ${posts.length ? posts.slice(0,4).map(p=>`
            <div style="display:flex;gap:var(--s3);padding:var(--s3);border-radius:var(--r-3);cursor:pointer;transition:background .2s"
                 onmouseover="this.style.background='var(--glass)'"
                 onmouseout="this.style.background='transparent'"
                 onclick="Feed.copyPrompt('${p.id}')">
              <img src="${p.image||''}" style="width:60px;height:60px;border-radius:var(--r-2);object-fit:cover;flex-shrink:0">
              <div style="min-width:0">
                <div style="font-size:var(--t-sm);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${Utils.esc(p.title)}</div>
                <div style="font-size:var(--t-xs);color:var(--fg-3);margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;direction:ltr;text-align:left">${Utils.esc(p.prompt)}</div>
              </div>
            </div>`).join('')
            : '<div style="padding:var(--s4);color:var(--fg-3);font-size:var(--t-sm);text-align:center">لا توجد برومبتات بعد.</div>'}
        </div>`;

      Utils.$('#commentsDrawer').classList.add('open');
      document.body.style.overflow='hidden';
    }catch(e){
      Utils.toast('تعذّر تحميل الملف','ph-warning');
    }
  },

  async followUser(uid,btn){
    if(!K.me){Auth.open();return}
    try{
      const r = await API.post(`/api/users/${uid}/follow`);
      btn.innerHTML = r.following
        ? '<i class="ph ph-check"></i> تتابعه'
        : '<i class="ph ph-user-plus"></i> متابعة';
      btn.classList.toggle('btn-primary',!r.following);
      btn.classList.toggle('btn-glass',r.following);
      Utils.toast(r.following?'بدأت المتابعة':'أُلغيت المتابعة');
    }catch(e){
      Utils.toast(e.message,'ph-warning');
    }
  },

  /* ═══ KEYBOARD ═══ */
  bindKeyboard(){
    let lastG=0;
    document.addEventListener('keydown',e=>{
      const t=e.target;
      if(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable)return;

      if(e.key==='Escape'){
        Utils.$$('.scrim').forEach(s=>s.classList.remove('open'));
        Utils.$$('.drawer').forEach(d=>d.classList.remove('open'));
        document.body.style.overflow='';
        return;
      }
      if(e.key==='/'){e.preventDefault();Utils.$('#searchInput')?.focus();return}
      if(e.key==='n'){e.preventDefault();Composer.open();return}
      if(e.key==='g'){lastG=Date.now();return}
      if(Date.now()-lastG<800){
        const map={h:'home',e:'explore',c:'chat',p:'profile',l:'liked',s:'saved'};
        const k=e.key.toLowerCase();
        if(map[k]){this.switchTab(map[k]);lastG=0}
      }
    });
  },

  /* ═══ USER ═══ */
  applyUser(){
    const u=K.me;if(!u)return;
    Utils.$('#signInBtn').style.display='none';
    Utils.$('#avatarBtn').style.display='grid';
    const av=Utils.$('#avatarBtn img');if(av)av.src=u.avatar;
    const pn=Utils.$('#profileName');if(pn)pn.textContent=u.name;
    const ph=Utils.$('#profileHandle');if(ph)ph.textContent=u.handle;
    const pb=Utils.$('#profileBio');if(pb)pb.textContent=u.bio||'';
    const pa=Utils.$('#profileAvatar');if(pa)pa.src=u.avatar;
  }
};

/* ═══ FEED ═══ */
const Feed = {
  render(id,posts,emptyT,emptyB,compact){
    const el=Utils.$('#'+id);if(!el)return;
    if(!posts.length){
      el.innerHTML=`<div class="empty">
        <i class="ph ph-sparkle"></i>
        <h4>${emptyT||'لا توجد برومبتات'}</h4>
        <p>${emptyB||'جرّب فلتراً آخر أو مصطلح بحث مختلف.'}</p>
      </div>`;
      return;
    }
    el.innerHTML = posts.map(p=>this.card(p,compact)).join('');
  },

  card(p,compact){
    const a = p.author_data || (K.users[p.author]) || {name:'غير معروف',handle:'@?',avatar:''};
    if(a.id)K.users[a.id]=a;
    const tags = (p.tags||[]).slice(0,3).map(t=>
      `<span class="tag" onclick="event.stopPropagation();App.setFilter('${t}')">#${Utils.esc(t)}</span>`
    ).join('');
    const v = a.verified?'<i class="ph ph-seal-check verified"></i>':'';

    return `<article class="prompt-card" data-post="${p.id}">
      <div class="prompt-img" onclick="App.openPublisher(${a.id||p.author})">
        <img src="${p.image||''}" alt="${Utils.esc(p.title)}" loading="lazy"
             onerror="this.style.display='none';this.parentElement.style.background='linear-gradient(135deg,rgba(34,211,238,.2),rgba(139,92,246,.2))'">
        <span class="model-tag"><i class="ph ph-cpu"></i> ${Utils.esc(p.model||'')}</span>
        <div class="card-actions-top" onclick="event.stopPropagation()">
          <button class="glass-btn ${p.liked?'liked':''}" data-like="${p.id}" onclick="Feed.toggleLike(${p.id})" aria-label="إعجاب">
            <i class="ph${p.liked?'-fill':''} ph-heart"></i>
          </button>
          <button class="glass-btn ${p.saved?'saved':''}" data-save="${p.id}" onclick="Feed.toggleSave(${p.id})" aria-label="حفظ">
            <i class="ph${p.saved?'-fill':''} ph-bookmark-simple"></i>
          </button>
        </div>
      </div>
      <div class="prompt-body">
        <div class="author-row" onclick="App.openPublisher(${a.id||p.author})">
          <img class="author-avatar" src="${a.avatar||''}" alt="">
          <div class="author-info">
            <span class="author-name">${Utils.esc(a.name)}${v}</span>
            <span class="author-meta">${Utils.esc(a.handle)} · ${Utils.fmtDate(p.time)}</span>
          </div>
        </div>
        <h3 class="prompt-title">${Utils.esc(p.title)}</h3>
        <div class="prompt-excerpt" onclick="event.stopPropagation();Feed.copyPrompt(${p.id})" title="انقر للنسخ">${Utils.esc(p.prompt)}</div>
        <div class="prompt-tags">${tags}</div>
      </div>
      <div class="prompt-actions">
        <button class="action ${p.liked?'liked':''}" data-like-action="${p.id}" onclick="Feed.toggleLike(${p.id})">
          <i class="ph${p.liked?'-fill':''} ph-heart"></i>
          <span data-like-count="${p.id}">${Utils.fmtNum(p.likes)}</span>
        </button>
        <button class="action" onclick="Drawers.openComments(${p.id})" aria-label="تعليقات">
          <i class="ph ph-chat-circle"></i>
          <span data-comment-count="${p.id}">${Utils.fmtNum(p.comments||0)}</span>
        </button>
        <button class="action" onclick="Feed.share(${p.id})" aria-label="مشاركة">
          <i class="ph ph-share-network"></i>
        </button>
        <button class="action" onclick="Utils.speak(${JSON.stringify(p.prompt)})" aria-label="استماع">
          <i class="ph ph-speaker-high"></i>
        </button>
        ${!compact ? `
        <button class="action action-primary" data-copy="${p.id}" onclick="Feed.copyPrompt(${p.id})">
          <i class="ph ph-copy"></i><span>نسخ</span>
        </button>` : `
        <button class="action" data-copy="${p.id}" onclick="Feed.copyPrompt(${p.id})">
          <i class="ph ph-copy"></i><span data-copies="${p.id}">${Utils.fmtNum(p.copies)}</span>
        </button>`}
      </div>
    </article>`;
  },

  async toggleLike(id){
    if(!K.me){Auth.open();return}
    try{
      const r = await API.post(`/api/posts/${id}/like`);
      const p = App.state.posts.find(x=>x.id===id);
      if(p){p.liked=r.liked;p.likes=r.likes}
      Utils.$$(`[data-like="${id}"]`).forEach(b=>{
        b.classList.toggle('liked',r.liked);
        const i=b.querySelector('i');if(i)i.className=`ph${r.liked?'-fill':''} ph-heart`;
      });
      Utils.$$(`[data-like-action="${id}"]`).forEach(b=>{
        b.classList.toggle('liked',r.liked);
        const i=b.querySelector('i');if(i)i.className=`ph${r.liked?'-fill':''} ph-heart`;
      });
      Utils.$$(`[data-like-count="${id}"]`).forEach(el=>el.textContent=Utils.fmtNum(r.likes));
    }catch(e){
      Utils.toast(e.message,'ph-warning');
    }
  },

  async toggleSave(id){
    if(!K.me){Auth.open();return}
    try{
      const r = await API.post(`/api/posts/${id}/save`);
      const p = App.state.posts.find(x=>x.id===id);
      if(p){p.saved=r.saved;p.saves=r.saves}
      Utils.$$(`[data-save="${id}"]`).forEach(b=>{
        b.classList.toggle('saved',r.saved);
        const i=b.querySelector('i');if(i)i.className=`ph${r.saved?'-fill':''} ph-bookmark-simple`;
      });
      Utils.toast(r.saved?'حُفظ في مكتبتك':'أُزيل','ph-bookmark-simple');
    }catch(e){
      Utils.toast(e.message,'ph-warning');
    }
  },

  async copyPrompt(id){
    const p = App.state.posts.find(x=>x.id===id);
    if(!p)return;
    Utils.copyText(p.prompt,async()=>{
      Utils.$$(`[data-copy="${id}"]`).forEach(btn=>{
        btn.classList.add('copied');
        const lbl=btn.querySelector('span');
        const orig=lbl?lbl.textContent:'';
        if(lbl)lbl.textContent='تم النسخ';
        setTimeout(()=>{btn.classList.remove('copied');if(lbl)lbl.textContent=orig},1600);
      });
      Utils.toast('تم نسخ البرومبت','ph-copy');
      try{
        const r = await API.post(`/api/posts/${id}/copy`);
        Utils.$$(`[data-copies="${id}"]`).forEach(el=>el.textContent=Utils.fmtNum(r.copies));
      }catch{}
    });
  },

  share(id){
    const p = App.state.posts.find(x=>x.id===id);if(!p)return;
    const url = location.origin + '/#prompt-' + id;
    if(navigator.share){
      navigator.share({title:p.title,text:p.prompt.slice(0,100),url}).catch(()=>{});
    } else {
      Utils.copyText(url,()=>Utils.toast('تم نسخ الرابط','ph-link'));
    }
  }
};

/* ═══ COMPOSER ═══ */
const Composer = {
  open(){
    if(!K.me){Auth.open();return}
    Utils.$('#composerModal').classList.add('open');
    document.body.style.overflow='hidden';
    setTimeout(()=>Utils.$('#cTitle')?.focus(),120);
  },
  close(e){
    if(e&&e.target!==e.currentTarget)return;
    Utils.$('#composerModal').classList.remove('open');
    document.body.style.overflow='';
  },
  async publish(e){
    e.preventDefault();
    if(!K.me){Auth.open();return}
    const body = {
      title:  Utils.$('#cTitle').value.trim(),
      prompt: Utils.$('#cPrompt').value.trim(),
      image:  Utils.$('#cImage').value.trim(),
      model:  Utils.$('#cModel').value,
      tags:   Utils.$('#cTags').value.split(/[,،]/).map(t=>t.trim()).filter(Boolean),
    };
    try{
      const post = await API.post('/api/posts', body);
      App.state.posts.unshift(post);
      if(post.author_data)K.users[post.author_data.id]=post.author_data;
      this.close();
      Utils.$('#composerForm')?.reset();
      App.renderAllFeeds();
      Utils.toast('نُشر البرومبت بنجاح','ph-sparkle');
      App.switchTab('profile');
      App.state.profileTab='posts';
      Utils.$$('#profileTabs .tab').forEach(x=>x.classList.toggle('active',x.dataset.ptab==='posts'));
      App.renderProfilePanel();
    }catch(err){
      Utils.toast(err.message,'ph-warning');
    }
  }
};

/* ═══ AUTH ═══ */
const Auth = {
  open(){Utils.$('#authModal').classList.add('open');document.body.style.overflow='hidden'},
  close(e){if(e&&e.target!==e.currentTarget)return;Utils.$('#authModal').classList.remove('open');document.body.style.overflow=''},
  async signIn(){
    // للتطوير: نطلب البيانات. للإنتاج: استبدل بـ Google Identity Services.
    const email = prompt('البريد الإلكتروني للتجربة:','');
    if(!email)return;
    const name  = prompt('الاسم الظاهر:','');
    if(!name)return;

    try{
      const user = await API.post('/api/auth/google',{email,name});
      K.me = user;
      this.close();
      App.applyUser();
      await App.refreshAll();
      App.enterApp();
      Utils.toast('أهلاً '+user.name+'!','ph-hand-waving');
    }catch(e){
      Utils.toast(e.message,'ph-warning');
    }
  },
  async logout(){
    try{await API.post('/api/auth/logout')}catch{}
    K.me = null;
    App.state.posts=[];
    App.state.chats=[];
    Utils.$('#signInBtn').style.display='';
    Utils.$('#avatarBtn').style.display='none';
    App.showView('view-landing');
    Utils.toast('تم تسجيل الخروج','ph-sign-out');
  },
  openEditProfile(){
    if(!K.me)return;
    Utils.$('#epName').value=K.me.name;
    Utils.$('#epHandle').value=K.me.handle;
    Utils.$('#epBio').value=K.me.bio||'';
    Utils.$('#epAvatar').value=K.me.avatar||'';
    Utils.$('#editProfileModal').classList.add('open');
    document.body.style.overflow='hidden';
  },
  closeEditProfile(e){
    if(e&&e.target!==e.currentTarget)return;
    Utils.$('#editProfileModal').classList.remove('open');
    document.body.style.overflow='';
  },
  async saveProfile(e){
    e.preventDefault();
    try{
      const updated = await API.patch('/api/me',{
        name:   Utils.$('#epName').value.trim(),
        bio:    Utils.$('#epBio').value.trim(),
        avatar: Utils.$('#epAvatar').value.trim(),
      });
      K.me = {...K.me, ...updated};
      this.closeEditProfile();
      App.applyUser();
      Utils.toast('تم حفظ التغييرات','ph-check-circle');
    }catch(e){
      Utils.toast(e.message,'ph-warning');
    }
  }
};

/* ═══ CHAT ═══ */
const Chat = {
  render(){
    const list=Utils.$('#chatList');if(!list)return;
    if(!App.state.chats.length){
      list.innerHTML=`<div style="padding:40px 20px;text-align:center;color:var(--fg-3);font-size:13px">
        لا محادثات بعد.<br><br>
        ابدأ محادثة من ملف أي مبدع.
      </div>`;
      this.renderThread();
      return;
    }
    list.innerHTML = App.state.chats.map(c=>{
      const u = c.with_user || {name:'?',avatar:''};
      const active = c.id===App.state.activeChat;
      return `<div class="chat-item ${active?'active':''} ${c.unread?'unread':''}" onclick="Chat.open(${c.id})">
        <img class="author-avatar" src="${u.avatar||''}" alt="">
        <div class="chat-item-info">
          <div class="chat-item-top">
            <span class="chat-name">${Utils.esc(u.name)}</span>
            <span class="chat-time">${c.time||''}</span>
          </div>
          <div class="chat-preview">${Utils.esc(c.last||'')}</div>
        </div>
        ${c.unread?'<span class="unread-dot"></span>':''}
      </div>`;
    }).join('');

    if(!App.state.activeChat && App.state.chats[0]){
      App.state.activeChat = App.state.chats[0].id;
    }
    this.renderThread();
    App.updateBadges();
  },

  async open(id){
    App.state.activeChat = id;
    this.render();
    const layout=Utils.$('#chatLayout');
    if(layout && window.innerWidth>820)layout.classList.add('show-list');
    if(layout && window.innerWidth<=820)layout.classList.remove('show-list');
  },

  async openWithUser(uid){
    if(!K.me){Auth.open();return}
    Utils.$$('.drawer').forEach(d=>d.classList.remove('open'));
    document.body.style.overflow='';
    try{
      const r = await API.post(`/api/chats/with/${uid}`);
      App.state.chats = await API.get('/api/chats');
      App.state.activeChat = r.id;
      App.switchTab('chat');
      setTimeout(()=>Utils.$('#chatInput')?.focus(),200);
    }catch(e){
      Utils.toast(e.message,'ph-warning');
    }
  },

  async renderThread(){
    const cid = App.state.activeChat;
    const head = Utils.$('#chatHead');
    const body = Utils.$('#chatBody');
    if(!head||!body)return;

    if(!cid){head.innerHTML='';body.innerHTML='';return}

    const chat = App.state.chats.find(x=>x.id===cid);
    if(!chat){head.innerHTML='';body.innerHTML='';return}
    const u = chat.with_user || {name:'?',avatar:'',id:0};

    head.innerHTML = `
      <button class="icon-btn" onclick="Chat.backToList()" style="display:${window.innerWidth<=820?'grid':'none'}"><i class="ph ph-arrow-right"></i></button>
      <img class="author-avatar" src="${u.avatar||''}" alt="">
      <div class="chat-head-info">
        <strong>${Utils.esc(u.name)}</strong>
        <span>متصل الآن</span>
      </div>
      <button class="icon-btn" onclick="App.openPublisher(${u.id||0})" aria-label="الملف"><i class="ph ph-user-circle"></i></button>
    `;

    try{
      const msgs = await API.get(`/api/chats/${cid}/messages`);
      body.innerHTML = msgs.map(m=>`
        <div class="msg ${m.from==='me'?'me':'them'}">
          ${Utils.esc(m.text).replace(/\n/g,'<br>')}
          <span class="msg-time">${m.time}</span>
        </div>
      `).join('');
      body.scrollTop=body.scrollHeight;
    }catch(e){
      body.innerHTML = '';
    }
  },

  backToList(){Utils.$('#chatLayout')?.classList.add('show-list')},

  async send(e){
    e.preventDefault();
    const input = Utils.$('#chatInput');
    const text = input.value.trim();
    if(!text)return;
    const cid = App.state.activeChat;
    if(!cid)return;
    try{
      await API.post(`/api/chats/${cid}/messages`,{text});
      input.value='';input.style.height='auto';
      this.renderThread();
      const chats = await API.get('/api/chats');
      App.state.chats = chats;
      this.render();
    }catch(err){
      Utils.toast(err.message,'ph-warning');
    }
  }
};

/* ═══ DRAWERS ═══ */
const Drawers = {
  currentPost:null,

  async openComments(pid){
    this.currentPost = pid;
    Utils.$('#commentsDrawer').classList.add('open');
    document.body.style.overflow='hidden';
    try{
      const comments = await API.get(`/api/posts/${pid}/comments`);
      Utils.$('#commentCount').textContent = `(${Utils.fmtNum(comments.length)})`;
      this.renderComments(comments);
    }catch(e){
      Utils.$('#commentsBody').innerHTML = '<div class="empty"><p>تعذّر تحميل التعليقات</p></div>';
    }
  },

  closeComments(){
    Utils.$('#commentsDrawer').classList.remove('open');
    document.body.style.overflow='';
  },

  renderComments(comments){
    const body = Utils.$('#commentsBody');
    if(!comments.length){
      body.innerHTML=`<div class="empty">
        <i class="ph ph-chat-circle"></i>
        <h4>لا تعليقات بعد</h4>
        <p>كن أول من يعلّق.</p>
      </div>`;
      return;
    }
    body.innerHTML = comments.map(c=>{
      const a = c.author_data || K.users[c.author] || {name:'?',avatar:''};
      return `<div class="comment">
        <img class="author-avatar" src="${a.avatar||''}" alt="">
        <div class="comment-body">
          <div class="comment-top">
            <span class="comment-name">${Utils.esc(a.name)}</span>
            <span class="comment-time">${Utils.fmtDate(c.time)}</span>
          </div>
          <div class="comment-text">${Utils.esc(c.text)}</div>
          <div class="comment-actions">
            <button onclick="Utils.toast('قريباً')">إعجاب · ${Utils.fmtNum(c.likes)}</button>
            <button onclick="Utils.toast('قريباً')">ردّ</button>
          </div>
        </div>
      </div>`;
    }).join('');
  }
};

const Comments = {
  async send(e){
    e.preventDefault();
    const input = Utils.$('#commentInput');
    const text = input.value.trim();
    if(!text)return;
    const pid = Drawers.currentPost;
    if(!pid)return;
    try{
      const c = await API.post(`/api/posts/${pid}/comments`,{text});
      input.value='';input.style.height='auto';
      // Reload comments
      const comments = await API.get(`/api/posts/${pid}/comments`);
      Drawers.renderComments(comments);
      Utils.$$(`[data-comment-count="${pid}"]`).forEach(el=>el.textContent=Utils.fmtNum(comments.length));
      const p = App.state.posts.find(x=>x.id===pid);
      if(p)p.comments=comments.length;
      Utils.toast('أُضيف تعليقك','ph-chat-circle');
    }catch(err){
      Utils.toast(err.message,'ph-warning');
    }
  }
};

/* ═══ BOOT ═══ */
document.addEventListener('DOMContentLoaded',()=>App.init());

// Re-render chat thread on viewport change
let rt;
window.addEventListener('resize',()=>{
  clearTimeout(rt);
  rt=setTimeout(()=>{if(App.state.tab==='chat')Chat.render()},200);
},{passive:true});