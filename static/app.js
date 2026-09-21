/* ═══════════════════════════════════════════════════════════
   خَيال — Aurora · App 3.0
   تحسينات: طلبات متوازية، cache ذكي، معالجة أخطاء،
   optimistic UI، offline support، PWA، إيماءات لمس.
   ═══════════════════════════════════════════════════════════ */

(() => {
'use strict';

const K = { me: window.__ME__ || null, users: {}, models: ['Midjourney v6','DALL·E 3','Stable Diffusion XL','Flux 1.1 Pro','Adobe Firefly'] };

/* ═══ UTILS ═══ */
const U = {
  $:(s,r=document)=>r.querySelector(s),
  $$:(s,r=document)=>[...r.querySelectorAll(s)],
  esc(s){return s==null?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')},
  debounce(fn,ms=300){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}},
  throttle(fn,ms=100){let l=0;return(...a)=>{const n=Date.now();if(n-l>=ms){l=n;fn(...a)}}},
  fmtNum(n){return (n||0).toLocaleString('ar-EG')},
  fmtDate(s){
    if(!s)return '';
    const d=new Date(s); if(isNaN(d))return s;
    const diff=(Date.now()-d)/1000;
    if(diff<60)return 'الآن';
    if(diff<3600)return `قبل ${Math.floor(diff/60)} د`;
    if(diff<86400)return `قبل ${Math.floor(diff/3600)} س`;
    if(diff<604800)return `قبل ${Math.floor(diff/86400)} ي`;
    return d.toLocaleDateString('ar-EG');
  },
  storage:{
    get(k,f){try{const v=localStorage.getItem(k);return v?JSON.parse(v):f}catch{return f}},
    set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}},
    rm(k){try{localStorage.removeItem(k)}catch{}}
  },
  toast(msg,icon='ph-check-circle',type='default'){
    const w=U.$('#toastWrap');if(!w)return;
    const el=document.createElement('div');
    el.className='toast';
    el.innerHTML=`<i class="ph ${icon}"></i><span>${U.esc(msg)}</span>`;
    w.appendChild(el);
    setTimeout(()=>{
      el.style.transition='opacity .3s, transform .3s';
      el.style.opacity='0';el.style.transform='translateY(8px)';
      setTimeout(()=>el.remove(),320);
    },2400);
  },
  autoGrow(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px'},
  copy(text,cb){
    const fallback=()=>{
      const ta=document.createElement('textarea');
      ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
      document.body.appendChild(ta);ta.select();
      try{document.execCommand('copy');cb()}catch{U.toast('فشل النسخ','ph-warning')}
      ta.remove();
    };
    if(navigator.clipboard&&window.isSecureContext)
      navigator.clipboard.writeText(text).then(cb).catch(fallback);
    else fallback();
  },
  speak(text){
    if(!('speechSynthesis' in window)){U.toast('غير مدعوم','ph-warning');return;}
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    u.lang='en-US';u.rate=.95;
    speechSynthesis.speak(u);
    U.toast('يُقرأ البرومبت…','ph-speaker-high');
  },
  haptic(){try{navigator.vibrate&&navigator.vibrate(8)}catch{}}
};

/* ═══ API — مع إعادة محاولة ═══ */
const API = {
  timeout:10000,
  async req(method,path,body,retries=1){
    const ctrl=new AbortController();
    const tid=setTimeout(()=>ctrl.abort(),this.timeout);
    const opt={method,headers:{'Content-Type':'application/json'},credentials:'same-origin',signal:ctrl.signal};
    if(body)opt.body=JSON.stringify(body);
    try{
      const r=await fetch(path,opt);
      clearTimeout(tid);
      if(!r.ok){
        const err=await r.json().catch(()=>({}));
        throw Object.assign(new Error(err.error||`HTTP ${r.status}`),{status:r.status});
      }
      if(r.status===204)return null;
      return await r.json();
    }catch(e){
      clearTimeout(tid);
      if(e.name==='AbortError')throw new Error('انتهت المهلة');
      if(retries>0 && (e.message.includes('fetch')||e.status>=500)){
        await new Promise(r=>setTimeout(r,500));
        return this.req(method,path,body,retries-1);
      }
      throw e;
    }
  },
  get:(p)=>API.req('GET',p),
  post:(p,b)=>API.req('POST',p,b),
  patch:(p,b)=>API.req('PATCH',p,b),
  del:(p)=>API.req('DELETE',p),
};

/* ═══ APP STATE ═══ */
const App = {
  state:{
    posts:[], chats:[], filter:'all', model:'all', sort:'recent',
    tab:'home', activeChat:null, profileTab:'posts', search:'', theme:'dark',
    loading:false
  },

  async init(){
    // Theme
    this.state.theme = U.storage.get('khayal_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', this.state.theme);
    this.syncThemeIcon();

    // Nav scroll (throttled)
    window.addEventListener('scroll', U.throttle(()=>{
      const n=U.$('#nav');if(n)n.classList.toggle('scrolled',window.scrollY>20);
    },100),{passive:true});

    // Network monitoring
    window.addEventListener('online',()=>{U.$('#netBar')?.classList.remove('show');this.refreshAll()});
    window.addEventListener('offline',()=>U.$('#netBar')?.classList.add('show'));
    if(!navigator.onLine)U.$('#netBar')?.classList.add('show');

    // UI bindings
    this.bindSearch();
    this.bindProfileTabs();
    this.bindKeyboard();
    this.bindGestures();
    this.renderFilters('filters');
    this.renderFilters('exploreFilters');
    this.renderSortTabs();

    // Bento mouse glow
    document.addEventListener('mousemove', U.throttle(e=>{
      U.$$('.bento-card').forEach(c=>{
        const r=c.getBoundingClientRect();
        c.style.setProperty('--mx',(e.clientX-r.left)+'px');
        c.style.setProperty('--my',(e.clientY-r.top)+'px');
      });
    },80),{passive:true});

    // PWA Service Worker
    if('serviceWorker' in navigator){
      try{ await navigator.serviceWorker.register('/sw.js',{scope:'/'}); }catch{}
    }

    // Load data
    await this.refreshAll();

    // Enter app if signed in
    if(K.me){ this.applyUser(); this.enterApp(); }

    // Handle URL actions (shortcuts)
    const params=new URLSearchParams(location.search);
    if(params.get('action')==='new' && K.me) Composer.open();
    if(params.get('tab')) this.switchTab(params.get('tab'));
  },

  async refreshAll(){
    if(this.state.loading)return;
    this.state.loading=true;
    try{
      // Parallel fetch
      const [meResult, postsResult] = await Promise.allSettled([
        API.get('/api/me'),
        API.get('/api/posts?limit=100')
      ]);

      K.me = meResult.status==='fulfilled' ? meResult.value : K.me;
      const posts = postsResult.status==='fulfilled' ? postsResult.value : [];
      this.state.posts = posts || [];
      this.state.posts.forEach(p=>{ if(p.author_data)K.users[p.author_data.id]=p.author_data; });

      // Update hero stats
      const hp=U.$('#heroStatPosts');if(hp)hp.textContent=U.fmtNum(this.state.posts.length);
      const hu=U.$('#heroStatUsers');if(hu)hu.textContent=U.fmtNum(Object.keys(K.users).length);

      // Chats if signed in
      if(K.me){
        try{ this.state.chats = await API.get('/api/chats'); }catch{ this.state.chats=[]; }
      } else this.state.chats=[];

      // Render
      this.renderLandingPreview();
      this.renderAllFeeds();
      if(K.me)Chat.render();
    }catch(e){
      console.error('refreshAll',e);
      U.toast('تعذّر التحميل','ph-warning');
    }finally{
      this.state.loading=false;
    }
  },

  /* NAVIGATION */
  goHome(){this.showView('view-landing');window.scrollTo({top:0,behavior:'smooth'})},
  scrollTo(id){U.$('#'+id)?.scrollIntoView({behavior:'smooth'})},

  showView(id){
    U.$$('.view').forEach(v=>v.classList.remove('active'));
    U.$('#'+id)?.classList.add('active');
    const d=U.$('#dock');if(d)d.style.display=id==='view-app'?'flex':'none';
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
    U.$$('.tab-panel').forEach(p=>p.classList.remove('active'));
    U.$('#tab-'+tab)?.classList.add('active');
    U.$$('.dock-item[data-tab]').forEach(i=>i.classList.toggle('active',i.dataset.tab===tab));

    if(tab==='chat'){Chat.render();U.$('#chatLayout')?.classList.remove('show-list')}
    if(tab==='profile')this.renderProfilePanel();
    if(tab==='home')this.renderHomeFeed();
    if(tab==='explore')this.renderExploreFeed();
    if(tab==='liked')this.renderLikedFeed();
    if(tab==='saved')this.renderSavedFeed();
    window.scrollTo({top:0,behavior:'smooth'});
    U.haptic();
  },

  /* THEME */
  toggleTheme(){
    this.state.theme = this.state.theme==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme', this.state.theme);
    U.storage.set('khayal_theme', this.state.theme);
    this.syncThemeIcon();
    U.haptic();
  },
  syncThemeIcon(){
    const i=U.$('#themeIcon');
    if(i)i.className=this.state.theme==='dark'?'ph ph-moon':'ph ph-sun';
  },

  /* FILTERS */
  renderFilters(id){
    const el=U.$('#'+id);if(!el)return;
    const tags=['all','بورتريه','مناظر','سايبربانك','ثلاثي الأبعاد','فيلم','معمار','تصوير','سينمائي'];
    const labels={all:'الكل'};
    let html = tags.map(t=>{
      const a=this.state.filter===t?' active':'';
      return `<button class="filter${a}" data-f="${t}" onclick="App.setFilter('${t}')">${labels