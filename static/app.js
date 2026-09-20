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
  renderExploreFeed(){Feed.render