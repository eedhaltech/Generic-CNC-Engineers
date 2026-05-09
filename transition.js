/**
 * transition.js — Logo-zoom + falling tools page transition
 * Generic CNC Engineers
 *
 * EXIT:  dark backdrop fades in → tools fall → logo grows to stage → navigate at peak size
 * ENTRY: logo instantly at stage (large) → immediately shrinks to corner → backdrop out
 *
 * White-flash fix: <style id="pt-antiflash"> in every page <head> keeps
 *   background dark before JS runs. Nav logo hidden via body class set
 *   synchronously before first await.
 */
(function () {
  'use strict';

  let animating = false;
  let toolsRAF  = null;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  /* ── SVG logo ─────────────────────────────────────────────────────── */
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 64" aria-hidden="true" style="display:block;flex-shrink:0;width:34px;height:40px;overflow:visible"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="28" cy="21" r="15" stroke="#d4430a" stroke-width="2.2"/><ellipse cx="28" cy="21" rx="7.5" ry="15" stroke="#d4430a" stroke-width="1.6"/><path d="M13 15.5 Q28 19.5 43 15.5" stroke="#d4430a" stroke-width="1.3"/><path d="M12.5 21 Q28 25 43.5 21" stroke="#d4430a" stroke-width="1.3"/><path d="M13.5 26.5 Q28 30.5 42.5 26.5" stroke="#d4430a" stroke-width="1.3"/><line x1="28" y1="6" x2="28" y2="36" stroke="#d4430a" stroke-width="1.6"/><path d="M21 36 C19 38.5 18.5 43 19.5 47 L21.5 51 L34.5 51 L36.5 47 C37.5 43 37 38.5 35 36 Z" stroke="#c03a08" stroke-width="1.8" fill="rgba(212,67,10,0.1)"/><path d="M19.5 43 C16.5 42 15.5 45.5 17.5 47.5" stroke="#c03a08" stroke-width="1.5"/><line x1="17" y1="55" x2="39" y2="55" stroke="#d4430a" stroke-width="2.2"/></g></svg>';

  /* ── styles ───────────────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('pt-styles')) return;
    const s = document.createElement('style');
    s.id = 'pt-styles';
    s.textContent = `
      #pt-backdrop {
        position:fixed;inset:0;z-index:8970;
        background:#fdf6f0;
        opacity:0;pointer-events:none;will-change:opacity;
      }
      #pt-canvas {
        position:fixed;inset:0;z-index:8975;
        pointer-events:none;opacity:0;will-change:opacity;
      }
      #pt-clone {
        position:fixed;z-index:9000;
        display:flex;align-items:center;gap:10px;
        white-space:nowrap;pointer-events:none;
        transform-origin:left center;
        will-change:transform,opacity;opacity:0;
      }
      #pt-clone svg{display:block;flex-shrink:0;}
      #pt-clone .pt-name {
        font-family:"Bebas Neue",sans-serif;font-size:1.5rem;
        color:#1a1c1f;letter-spacing:0.04em;line-height:1;white-space:nowrap;
      }
      #pt-clone .pt-name .accent{color:#d4430a;}
      #pt-tagline {
        position:fixed;z-index:9001;
        font-family:"Barlow Condensed",sans-serif;
        font-size:0.68rem;letter-spacing:0.48em;
        text-transform:uppercase;color:#4a4a4a;
        white-space:nowrap;pointer-events:none;opacity:0;
        will-change:opacity,transform;
      }
      #pt-rule {
        position:fixed;z-index:9001;height:1px;background:#d4430a;
        pointer-events:none;transform-origin:left center;
        transform:scaleX(0);will-change:transform;
      }
      /* Blink fix: hides nav logo before first paint on new page */
      body.pt-entry .nav-logo { opacity:0 !important; transition:none !important; }
    `;
    document.head.appendChild(s);
  }

  /* ── build overlay DOM once ───────────────────────────────────────── */
  function buildOverlay() {
    if (document.getElementById('pt-overlay')) return;
    injectStyles();
    const mk = (t,id) => { const e=document.createElement(t); e.id=id; return e; };
    const backdrop = mk('div','pt-backdrop');
    const canvas   = mk('canvas','pt-canvas');
    const clone    = mk('div','pt-clone');
    const tagline  = mk('div','pt-tagline');
    const rule     = mk('div','pt-rule');
    clone.innerHTML = SVG +
      `<div class="pt-name">GENERIC CNC<span class="accent"> ENGINEERS</span></div>`;
    tagline.textContent = 'Precision Engineered \u00b7 Since 1978 \u00b7 Coimbatore, India';
    const wrap = mk('div','pt-overlay');
    [backdrop,canvas,clone,tagline,rule].forEach(n => wrap.appendChild(n));
    document.body.appendChild(wrap);
  }

  /* ── helpers ──────────────────────────────────────────────────────── */
  function getNavRect() {
    const logo = document.querySelector('.nav-logo');
    if (!logo) return {top:12,left:16,width:220,height:40};
    const r = logo.getBoundingClientRect();
    return {top:r.top,left:r.left,width:r.width,height:r.height};
  }

  function getStage(nr) {
    const vw=window.innerWidth, vh=window.innerHeight;
    const scale = Math.min((vw*0.46)/nr.width, 5.5);
    const tW=nr.width*scale, tH=nr.height*scale;
    const stageX = vw*0.33 - tW*0.5;
    const stageY = (vh-tH)*0.48;
    return {scale,tW,tH,stageX,stageY,tx:stageX-nr.left,ty:stageY-nr.top};
  }

  // Instant set — no transition
  function snap(el, props) {
    el.style.transition = 'none';
    Object.assign(el.style, props);
    void el.offsetWidth;
  }

  // Animated set — GPU properties only
  function anim(el, dur, ease, props) {
    el.style.transition = Object.keys(props).map(k =>
      `${k.replace(/([A-Z])/g,m=>'-'+m.toLowerCase())} ${dur}ms ${ease}`
    ).join(',');
    void el.offsetWidth;
    Object.assign(el.style, props);
  }

  const SNAP   = 'cubic-bezier(0.76,0,0.24,1)';
  const SPRING = 'cubic-bezier(0.34,1.28,0.64,1)';
  const EASE   = 'cubic-bezier(0.25,0.46,0.45,0.94)';

  /* ── TOOLS CANVAS ─────────────────────────────────────────────────── */
  function startTools() {
    const cv = document.getElementById('pt-canvas');
    if (!cv) return;
    cv.width = window.innerWidth;
    cv.height = window.innerHeight;
    const ctx = cv.getContext('2d');
    const TYPES  = ['bolt','screw','spanner','hexNut','washer','socket'];
    const COLORS = ['#3a3d42','#4a4f5a','#555a65','#888d96',
                    '#d4430a','#c03a08','#e8a820','#6a6f7a','#888d96'];
    let tools=[], frame=0;
    const rand=(a,b)=>a+Math.random()*(b-a);
    const pick=a=>a[Math.floor(Math.random()*a.length)];

    function spawn(){
      return {x:rand(0,cv.width),y:rand(-80,-10),
              vx:rand(-0.6,0.6),vy:rand(0.8,3.0),
              rot:rand(0,Math.PI*2),vrot:rand(-0.07,0.07),
              type:pick(TYPES),sz:rand(16,36),color:pick(COLORS),
              floor:rand(cv.height*0.4,cv.height*0.95),
              alpha:0,bounces:0,settled:false};
    }

    function dBolt(c,sz,col){
      const hR=sz*.35,sW=sz*.20,sH=sz*.70;
      c.fillStyle=col;c.beginPath();
      for(let i=0;i<6;i++){const a=(Math.PI/3)*i-Math.PI/6;
        i===0?c.moveTo(Math.cos(a)*hR,Math.sin(a)*hR-sz*.15):c.lineTo(Math.cos(a)*hR,Math.sin(a)*hR-sz*.15);}
      c.closePath();c.fill();c.fillRect(-sW/2,sz*.05,sW,sH);
      c.strokeStyle='rgba(255,255,255,0.1)';c.lineWidth=0.8;
      for(let i=0;i<4;i++){const ty=sz*.15+i*(sH/4.5);
        c.beginPath();c.moveTo(-sW/2,ty);c.lineTo(sW/2,ty);c.stroke();}
    }
    function dScrew(c,sz,col){
      c.fillStyle=col;c.beginPath();c.ellipse(0,-sz*.3,sz*.35,sz*.18,0,0,Math.PI*2);c.fill();
      c.strokeStyle='rgba(255,255,255,0.15)';c.lineWidth=sz*.06;
      c.beginPath();c.moveTo(-sz*.2,-sz*.3);c.lineTo(sz*.2,-sz*.3);c.stroke();
      c.fillStyle=col;c.beginPath();
      c.moveTo(-sz*.12,-sz*.12);c.lineTo(sz*.12,-sz*.12);
      c.lineTo(sz*.02,sz*.5);c.lineTo(-sz*.02,sz*.5);c.closePath();c.fill();
    }
    function dSpanner(c,sz,col){
      c.strokeStyle=col;c.lineWidth=sz*.18;c.lineCap='round';
      c.beginPath();c.moveTo(0,sz*.5);c.lineTo(0,-sz*.1);c.stroke();
      c.lineWidth=sz*.14;
      c.beginPath();c.arc(-sz*.12,-sz*.35,sz*.22,Math.PI*.1,Math.PI*.9);c.stroke();
      c.beginPath();c.arc(sz*.12,sz*.1,sz*.18,Math.PI*1.1,Math.PI*1.9);c.stroke();
    }
    function dHexNut(c,sz,col){
      const r=sz*.45;c.fillStyle=col;c.beginPath();
      for(let i=0;i<6;i++){const a=(Math.PI/3)*i-Math.PI/6;
        i===0?c.moveTo(Math.cos(a)*r,Math.sin(a)*r):c.lineTo(Math.cos(a)*r,Math.sin(a)*r);}
      c.closePath();c.fill();
      c.globalCompositeOperation='destination-out';
      c.beginPath();c.arc(0,0,r*.42,0,Math.PI*2);c.fill();
      c.globalCompositeOperation='source-over';
    }
    function dWasher(c,sz,col){
      c.fillStyle=col;c.beginPath();c.arc(0,0,sz*.45,0,Math.PI*2);c.fill();
      c.globalCompositeOperation='destination-out';
      c.beginPath();c.arc(0,0,sz*.22,0,Math.PI*2);c.fill();
      c.globalCompositeOperation='source-over';
    }
    function dSocket(c,sz,col){
      c.fillStyle=col;c.beginPath();
      for(let i=0;i<8;i++){const a=(Math.PI/4)*i-Math.PI/8;
        i===0?c.moveTo(Math.cos(a)*sz*.45,Math.sin(a)*sz*.45):c.lineTo(Math.cos(a)*sz*.45,Math.sin(a)*sz*.45);}
      c.closePath();c.fill();
      c.globalCompositeOperation='destination-out';c.beginPath();
      for(let i=0;i<6;i++){const a=(Math.PI/3)*i-Math.PI/6;
        i===0?c.moveTo(Math.cos(a)*sz*.28,Math.sin(a)*sz*.28):c.lineTo(Math.cos(a)*sz*.28,Math.sin(a)*sz*.28);}
      c.closePath();c.fill();c.globalCompositeOperation='source-over';
    }
    const FNS={bolt:dBolt,screw:dScrew,spanner:dSpanner,
               hexNut:dHexNut,washer:dWasher,socket:dSocket};

    for(let i=0;i<18;i++){
      const t=spawn();
      t.y=rand(cv.height*.05,cv.height*.55);
      t.alpha=rand(0.3,0.85);
      tools.push(t);
    }

    cv.style.transition='opacity 160ms ease';
    void cv.offsetWidth;
    cv.style.opacity='1';

    function loop(){
      ctx.clearRect(0,0,cv.width,cv.height);
      if(frame%14===0&&tools.length<55) tools.push(spawn());
      tools.forEach(t=>{
        if(!t.settled){
          t.alpha=Math.min(1,t.alpha+0.05);
          t.vy+=0.058;t.x+=t.vx;t.y+=t.vy;t.rot+=t.vrot;
          if(t.y>t.floor){
            t.y=t.floor;t.vy*=-0.38;t.vx*=0.82;t.vrot*=0.65;t.bounces++;
            if(t.bounces>=2&&Math.abs(t.vy)<0.5)t.settled=true;
          }
          if(t.x<-60)t.x=cv.width+60;
          if(t.x>cv.width+60)t.x=-60;
        }
        ctx.save();ctx.translate(t.x,t.y);ctx.rotate(t.rot);
        ctx.globalAlpha=t.settled?t.alpha*0.28:t.alpha*0.65;
        FNS[t.type](ctx,t.sz,t.color);
        ctx.restore();
      });
      frame++;
      toolsRAF=requestAnimationFrame(loop);
    }
    loop();
  }

  function stopTools(){
    if(toolsRAF){cancelAnimationFrame(toolsRAF);toolsRAF=null;}
    const cv=document.getElementById('pt-canvas');
    if(cv){cv.style.transition='opacity 100ms ease';cv.style.opacity='0';}
  }

  /* ═══════════════════════════════════════════════════════════════════
     EXIT — grows to stage, holds 0.5s, navigates
  ═══════════════════════════════════════════════════════════════════ */
  window.pageTransition = async function(target){
    if(animating) return;
    animating=true;
    buildOverlay();

    const backdrop=document.getElementById('pt-backdrop');
    const clone   =document.getElementById('pt-clone');
    const tagline =document.getElementById('pt-tagline');
    const rule    =document.getElementById('pt-rule');

    const nr=getNavRect();
    const {scale,tW,tH,stageX,stageY,tx,ty}=getStage(nr);

    // Position clone at nav logo, invisible
    snap(clone,{top:nr.top+'px',left:nr.left+'px',
                opacity:'0',transform:'translate(0,0) scale(1)'});

    // Position rule + tagline at stage, hidden
    const ruleY=stageY+tH+14;
    snap(rule,{top:ruleY+'px',left:stageX+'px',width:tW+'px',transform:'scaleX(0)'});
    snap(tagline,{top:(ruleY+18)+'px',left:stageX+'px',
                  opacity:'0',transform:'translateY(8px)'});

    // 1 — backdrop fades in + tools start simultaneously
    anim(backdrop,200,EASE,{opacity:'1'});
    startTools();
    await wait(200);

    // 2 — hide real logo, show clone at nav position
    const realLogo=document.querySelector('.nav-logo');
    if(realLogo) realLogo.style.opacity='0';
    snap(clone,{opacity:'1'});

    // 3 — GROW to stage (460ms)
    // Navigate IMMEDIATELY when logo reaches full size — no hold, no rule/tagline
    // New page loads while logo is still large; entryReveal() shrinks it
    anim(clone,460,SPRING,{transform:`translate(${tx}px,${ty}px) scale(${scale})`});
    await wait(460);

    // 4 — navigate at peak size
    sessionStorage.setItem('pt-in','1');
    window.location.href=target;
  };

  /* ═══════════════════════════════════════════════════════════════════
     ENTRY — logo already large, shrinks DIRECTLY to corner, no hold
  ═══════════════════════════════════════════════════════════════════ */
  async function entryReveal(){
    if(!sessionStorage.getItem('pt-in')) return;
    sessionStorage.removeItem('pt-in');

    // ── BLINK FIX ──────────────────────────────────────────────────
    // Add class synchronously — before any await — so nav logo is
    // hidden before the browser has a chance to paint it.
    document.body.classList.add('pt-entry');
    // ───────────────────────────────────────────────────────────────

    buildOverlay();

    const backdrop=document.getElementById('pt-backdrop');
    const clone   =document.getElementById('pt-clone');
    const tagline =document.getElementById('pt-tagline');
    const rule    =document.getElementById('pt-rule');

    const nr=getNavRect();
    const {scale,tW,tH,stageX,stageY,tx,ty}=getStage(nr);

    // Instantly show backdrop + logo at stage (large) — no transition
    snap(backdrop,{opacity:'1',pointerEvents:'all'});
    snap(clone,{top:nr.top+'px',left:nr.left+'px',opacity:'1',
                transform:`translate(${tx}px,${ty}px) scale(${scale})`});

    // Show rule + tagline at stage instantly
    const ruleY=stageY+tH+14;
    snap(rule,{top:ruleY+'px',left:stageX+'px',width:tW+'px',transform:'scaleX(1)'});
    snap(tagline,{top:(ruleY+18)+'px',left:stageX+'px',
                  opacity:'1',transform:'translateY(0)'});

    // Start tools on new page
    startTools();

    // ── NO HOLD — shrink immediately ──────────────────────────────
    const DUR = 420;

    // Hide rule + tagline instantly (no animation — they just vanish)
    snap(rule,   {transform:'scaleX(0)'});
    snap(tagline,{opacity:'0'});

    // SHRINK: logo flies straight from stage to corner in one move
    anim(clone, DUR, SNAP, {transform:'translate(0,0) scale(1)'});

    // Fade clone out in last 60ms
    setTimeout(()=>anim(clone,60,EASE,{opacity:'0'}), DUR-70);

    // Backdrop + tools fade out in parallel
    anim(backdrop, DUR, EASE, {opacity:'0'});
    setTimeout(()=>stopTools(), DUR-80);

    await wait(DUR+10);

    // Restore real nav logo + remove hide class
    document.body.classList.remove('pt-entry');
    const realLogo=document.querySelector('.nav-logo');
    if(realLogo) realLogo.style.opacity='';

    // Clean up overlay
    snap(backdrop,{opacity:'0',pointerEvents:'none'});
    snap(clone,   {opacity:'0',transform:'translate(0,0) scale(1)'});
    snap(rule,    {transform:'scaleX(0)'});
    snap(tagline, {opacity:'0'});

    animating=false;
  }

  /* ═══════════════════════════════════════════════════════════════════
     INTERCEPT — page.html and page.html#section
  ═══════════════════════════════════════════════════════════════════ */
  function interceptLinks(){
    document.querySelectorAll('a[href]').forEach(link=>{
      const href=link.getAttribute('href');
      if(!href) return;
      if(href.startsWith('http')||href.startsWith('mailto')||href.startsWith('tel')) return;
      link.addEventListener('click',function(e){
        const raw=this.getAttribute('href');
        const hi=raw.indexOf('#');
        const page=hi>=0?raw.slice(0,hi):raw;
        const cur=window.location.pathname.split('/').pop()||'index.html';
        if(!page||!page.endsWith('.html')||page===cur) return;
        e.preventDefault();
        pageTransition(raw);
      });
    });
  }

  /* ── init ─────────────────────────────────────────────────────────── */
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>{interceptLinks();entryReveal();});
  } else {
    interceptLinks();
    entryReveal();
  }

})();




