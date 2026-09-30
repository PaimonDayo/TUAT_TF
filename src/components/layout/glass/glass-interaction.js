/* Web implementation informed by Apple's public Liquid Glass design/API docs.
 * The optical profile and spring constants below are our own approximations.
 * No Apple private API or copied native implementation is used. */
/** @param {HTMLElement} root @param {number} initial */
export function attachGlassInteraction(root, initial) {
  const nav=root.querySelector('.nav-items');
  let selected=initial;
  const labels=[...nav.querySelectorAll('a')].map(a=>a.querySelector('span span:not(.sr-only)').textContent.trim());
  const icons=[...nav.querySelectorAll('a svg')].map(svg=>svg.innerHTML);
  const removers=[];
  const listen=(element,type,handler,options)=>{
    element.addEventListener(type,handler,options);
    removers.push(()=>element.removeEventListener(type,handler,options));
  };
  // Dispatch the existing Link so prefetch, navigation and any guards stay intact.
  let releaseFrame=0;
  const selectTab=index=>{
    // Keep the released lens on the tapped tab while Next starts its transition.
    // Returning to the old page immediately made every tap visibly bounce back.
    animate(index);buttons[index].click();
    cancelAnimationFrame(releaseFrame);
    releaseFrame=requestAnimationFrame(()=>{
      releaseFrame=requestAnimationFrame(()=>{
        releaseFrame=0;
        const pending=buttons.findIndex(button=>button.querySelector('[aria-busy=true]'));
        if(!contact)animate(pending<0?Math.max(0,selected):pending);
      });
    });
  };

  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const lens=nav.querySelector('.selection'),buttons=[...nav.querySelectorAll('a')];
  const state={x:Math.max(0,selected),v:0},pressure={x:0,v:0},shape={x:0,v:0},vertical={x:0,v:0};
  let target=Math.max(0,selected),shapeTarget=0,liftTarget=0,contact=null,frame=0,last=0,lastInput=0,suppressClick=false;
  let width=nav.getBoundingClientRect().width;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  // Closed-form spring integration avoids Euler instability and frame-rate drift.
  function spring(s,to,dt,omega=32,zeta=1){
    const x=s.x-to,v=s.v,decay=Math.exp(-zeta*omega*dt);
    if(zeta===1){const c=v+omega*x;s.x=to+(x+c*dt)*decay;s.v=(v-omega*c*dt)*decay;return}
    const wd=omega*Math.sqrt(1-zeta*zeta),c=(v+zeta*omega*x)/wd;
    const cos=Math.cos(wd*dt),sin=Math.sin(wd*dt);
    s.x=to+decay*(x*cos+c*sin);
    s.v=decay*((-zeta*omega*x+c*wd)*cos+(-zeta*omega*c-x*wd)*sin);
  }
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.classList.add('tab-optics');svg.setAttribute('aria-hidden','true');
  svg.innerHTML=`<defs>
    <mask id="tab-outside" maskUnits="userSpaceOnUse" x="-100" y="-100" width="800" height="300"><rect x="-100" y="-100" width="800" height="300" fill="white"/><path class="lens-hole" fill="black"/></mask>
    <clipPath id="tab-inside"><path class="lens-clip"/></clipPath>
    <filter id="tab-refraction" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feImage class="lens-normal" preserveAspectRatio="none" result="normal"/>
      <feDisplacementMap in="SourceGraphic" in2="normal" scale="0" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
  <g class="optics-base" mask="url(#tab-outside)"></g>
  <g clip-path="url(#tab-inside)"><g class="optics-filter" filter="url(#tab-refraction)"><g class="optics-refracted"></g></g></g>`;
  nav.append(svg);
  const base=svg.querySelector('.optics-base'),source=svg.querySelector('.optics-refracted');
  const hole=svg.querySelector('.lens-hole'),clip=svg.querySelector('.lens-clip');
  const filter=svg.querySelector('filter'),normal=svg.querySelector('feImage'),displacement=svg.querySelector('feDisplacementMap');
  // A tiny static vector field is generated on resize only. It bends pixels at
  // the meniscus instead of independently stretching entire icons/labels.
  function buildNormal(){
    const map=document.createElement('canvas');map.width=192;map.height=128;
    const ctx=map.getContext('2d'),pixels=ctx.createImageData(map.width,map.height);
    const halfX=48,halfY=32,r=29,edge=11;
    for(let y=0;y<128;y++)for(let x=0;x<192;x++){
      const px=(x+.5)/2-48,py=(y+.5)/2-32;
      const qx=Math.abs(px)-halfX+r,qy=Math.abs(py)-halfY+r;
      const ax=Math.max(qx,0),ay=Math.max(qy,0),len=Math.hypot(ax,ay);
      const distance=len+Math.min(Math.max(qx,qy),0)-r;
      let nx,ny;
      if(len>.001){nx=Math.sign(px)*ax/len;ny=Math.sign(py)*ay/len}
      else{nx=qx>qy?Math.sign(px):0;ny=qy>=qx?Math.sign(py):0}
      const depth=clamp(-distance/edge,0,1);
      // Finite convex edge profile: strong inward sampling at the rim,
      // a smooth plateau toward the center, and neutral outside the surface.
      const amount=distance<=0?Math.pow(1-depth,1.65)*.46:0;
      const i=(y*192+x)*4;
      pixels.data[i]=Math.round(255*(.5-nx*amount));
      pixels.data[i+1]=Math.round(255*(.5-ny*amount));
      pixels.data[i+2]=128;pixels.data[i+3]=255;
    }
    ctx.putImageData(pixels,0,0);normal.setAttribute('href',map.toDataURL());
  }
  function layout(){
    svg.setAttribute('viewBox',`0 0 ${width} 58`);
    const markup=labels.map((label,i)=>`<g class="optics-item"><svg x="${width/5*(i+.5)-11.5}" y="7.75" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[i]}</svg><text x="${width/5*(i+.5)}" y="46.75" text-anchor="middle">${label}</text></g>`).join('');
    base.innerHTML=markup;source.innerHTML=markup;
  }
  buildNormal();layout();
  function outline(x,y,w,h,left,right){
    const a=w*left/100,b=w*right/100,r=h/2;
    return `M ${x+a} ${y} H ${x+w-b} A ${b} ${r} 0 0 1 ${x+w} ${y+r} A ${b} ${r} 0 0 1 ${x+w-b} ${y+h} H ${x+a} A ${a} ${r} 0 0 1 ${x} ${y+r} A ${a} ${r} 0 0 1 ${x+a} ${y} Z`;
  }
  function paint(){
    const p=reduced.matches?0:clamp(pressure.x,0,1.025);
    const stretch=reduced.matches?0:Math.abs(shape.x);
    const sx=1+p*.22+stretch,sy=1+p*.24-stretch*.42;
    const y=reduced.matches?0:vertical.x-p*1.2;
    const bend=reduced.matches?0:shape.x*30;
    const radius=50-p*13;
    lens.style.visibility=selected<0&&!contact?'hidden':'';
    lens.style.transform=`translateX(${state.x*100}%) translateY(${y}px) scale(${sx},${sy})`;
    lens.style.borderRadius=p<.001&&stretch<.001?'':`${radius-bend}% ${radius+bend}% ${radius+bend}% ${radius-bend}% / 50%`;
    lens.style.setProperty('--lens-pressure',p.toFixed(4));
    lens.style.setProperty('--lens-light-x',`${50+shape.x*160}%`);
    const active=root.dataset.glass==='true'&&p>.002;
    if(root.dataset.lensing!==String(active))root.dataset.lensing=String(active);
    if(!active)return;
    const cell=width/5,cx=(state.x+.5)*cell,w=cell*sx,h=58*sy,cy=29+y;
    const path=outline(cx-w/2,cy-h/2,w,h,radius-bend,radius+bend);
    hole.setAttribute('d',path);clip.setAttribute('d',path);
    for(const [name,value] of Object.entries({x:cx-w/2,y:cy-h/2,width:w,height:h}))normal.setAttribute(name,value);
    for(const [name,value] of Object.entries({x:cx-w/2-20,y:cy-h/2-20,width:w+40,height:h+40}))filter.setAttribute(name,value);
    displacement.setAttribute('scale',22*p);
    // One continuous optical field, not a separate enlargement per item.
    source.setAttribute('transform',`translate(${cx} ${29+y*.25}) scale(${1+p*.16}) translate(${-cx} -29)`);
  }
  const settled=(s,t,eps=.001)=>Math.abs(s.x-t)<eps&&Math.abs(s.v)<.01;
  function tick(time){
    const dt=Math.min((time-last)/1000||1/60,.04);last=time;
    if(!contact?.drag)spring(state,target,dt);
    spring(pressure,contact?1:0,dt,30,.82);
    if(time-lastInput>45)shapeTarget=0;
    spring(shape,shapeTarget,dt,42,.85);
    spring(vertical,contact?liftTarget:0,dt,36,1);
    if(settled(state,target)&&settled(pressure,contact?1:0)&&settled(shape,0)&&shapeTarget===0&&settled(vertical,contact?liftTarget:0)){
      state.x=target;state.v=0;pressure.x=contact?1:0;pressure.v=0;shape.x=shape.v=0;
      vertical.x=contact?liftTarget:0;vertical.v=0;frame=0;paint();return;
    }
    paint();frame=requestAnimationFrame(tick);
  }
  function animate(next=target){
    target=next;
    if(reduced.matches||root.dataset.glass!=='true'){
      cancelAnimationFrame(frame);frame=0;state.x=target;state.v=0;
      for(const s of [pressure,shape,vertical])s.x=s.v=0;
      paint();return;
    }
    if(!frame){last=performance.now();frame=requestAnimationFrame(tick)}
  }
  function preview(index){buttons.forEach((b,i)=>b.dataset.preview=String(i===index))}
  function coordinate(x){
    if(contact)return clamp(contact.index+(x-contact.x)/(contact.box.width/5),0,4);
    const box=nav.getBoundingClientRect();return clamp((x-box.left)/(box.width/5)-.5,0,4);
  }
  function cancel(){
    const id=contact?.kind==='pointer'?contact.id:undefined;contact=null;shapeTarget=liftTarget=0;
    if(id!==undefined&&nav.hasPointerCapture(id))nav.releasePointerCapture(id);
    root.dataset.pressing=root.dataset.dragging='false';preview(selected);animate(Math.max(0,selected));
  }
  function begin(kind,id,x,y,time,element){
    if(contact||root.dataset.glass!=='true')return false;
    const button=element.closest?.('a');if(!button||!nav.contains(button))return false;
    const index=buttons.indexOf(button);suppressClick=false;
    contact={kind,id,index,x,y,lastX:x,lastY:y,lastTime:time,drag:false,box:nav.getBoundingClientRect()};
    root.dataset.pressing='true';preview(index);animate(index);
    return true;
  }
  function move(x,y,time){
    const dx=x-contact.x,dy=y-contact.y;
    if(!contact.drag&&Math.hypot(dx,dy)>5){contact.drag=true;root.dataset.dragging='true'}
    if(!contact.drag)return;
    const next=coordinate(x),dt=Math.max(8,time-contact.lastTime);
    const speed=(x-contact.lastX)/(contact.box.width/5)*1000/dt;
    shapeTarget=reduced.matches?0:Math.tanh(speed/7)*.20;
    liftTarget=reduced.matches?0:Math.tanh(dy/34)*12;
    contact.lastX=x;contact.lastY=y;contact.lastTime=time;lastInput=performance.now();
    state.x=target=next;state.v=0;preview(Math.round(next));paint();animate();
  }
  function finish(x,y){
    const next=Math.round(coordinate(x)),id=contact.kind==='pointer'?contact.id:undefined;
    const box=contact.box,inside=y>box.top-70&&y<box.bottom+70&&x>box.left-45&&x<box.right+45;
    contact=null;shapeTarget=liftTarget=0;root.dataset.pressing=root.dataset.dragging='false';
    if(id!==undefined&&nav.hasPointerCapture(id))nav.releasePointerCapture(id);
    suppressClick=true;
    if(inside)selectTab(next);else animate(Math.max(0,selected));
  }
  // Touch owns its complete gesture by Touch.identifier. Safari may revoke
  // pointer capture while the physical touch is still active. That must not
  // end a touch-owned press or cause a second pointer/click path to select.
  const touchEvents='ontouchstart' in window;
  listen(nav,'touchstart',e=>{
    if(root.dataset.glass!=='true')return;
    if(contact){if(contact.kind==='touch'&&e.cancelable)e.preventDefault();return}
    const touch=e.changedTouches[0];if(!touch)return;
    if(begin('touch',touch.identifier,touch.clientX,touch.clientY,e.timeStamp,touch.target)&&e.cancelable)e.preventDefault();
  },{passive:false});
  listen(window,'touchmove',e=>{
    if(contact?.kind!=='touch')return;
    const touch=[...e.changedTouches].find(t=>t.identifier===contact.id);
    if(!touch)return;
    if(e.cancelable)e.preventDefault();
    move(touch.clientX,touch.clientY,e.timeStamp);
  },{passive:false});
  listen(window,'touchend',e=>{
    if(contact?.kind!=='touch')return;
    const touch=[...e.changedTouches].find(t=>t.identifier===contact.id);
    if(!touch)return;
    if(e.cancelable)e.preventDefault();
    finish(touch.clientX,touch.clientY);
  },{passive:false});
  listen(window,'touchcancel',e=>{
    if(contact?.kind==='touch'&&[...e.changedTouches].some(t=>t.identifier===contact.id))cancel();
  });
  listen(nav,'pointerdown',e=>{
    if((e.pointerType==='touch'&&touchEvents)||!e.isPrimary||e.button!==0)return;
    if(begin('pointer',e.pointerId,e.clientX,e.clientY,e.timeStamp,e.target))nav.setPointerCapture(e.pointerId);
  });
  // Window-level tracking continues even if the pointer capture is lost.
  listen(window,'pointermove',e=>{
    if(contact?.kind!=='pointer'||e.pointerId!==contact.id)return;
    move(e.clientX,e.clientY,e.timeStamp);
  });
  listen(window,'pointerup',e=>{
    if(contact?.kind==='pointer'&&e.pointerId===contact.id)finish(e.clientX,e.clientY);
  });
  listen(nav,'click',e=>{if(suppressClick&&e.detail!==0){e.preventDefault();e.stopImmediatePropagation();suppressClick=false}},{capture:true});
  listen(window,'pointercancel',e=>{if(contact?.kind==='pointer'&&e.pointerId===contact.id)cancel()});
  listen(nav,'contextmenu',e=>{if(root.dataset.glass==='true')e.preventDefault()});
  listen(nav,'dragstart',e=>{if(root.dataset.glass==='true')e.preventDefault()});
  listen(window,'blur',cancel);
  listen(document,'visibilitychange',()=>{if(document.hidden)cancel()});
  listen(reduced,'change',cancel);
  const resize=new ResizeObserver(entries=>{
    const next=entries[0].contentRect.width;
    if(Math.abs(next-width)<.5)return;
    width=next;layout();
    if(contact){
      // Rebase the active finger without jumping or ending the gesture.
      contact.box=nav.getBoundingClientRect();contact.index=state.x;contact.x=contact.lastX;
    }
    paint();
  });
  resize.observe(nav);
  // Next Link owns pending navigation. Follow it without optimistic route state,
  // so canceled/blocked navigation returns to the actual current page.
  const pending=new MutationObserver(()=>{
    if(contact)return;
    const index=buttons.findIndex(button=>button.querySelector('[aria-busy=true]'));
    animate(index<0?Math.max(0,selected):index);
  });
  pending.observe(nav,{subtree:true,attributes:true,attributeFilter:['aria-busy']});
  paint();
  return {
    update(index) { selected=index; if(!contact){preview(index);animate(Math.max(0,index))} },
    destroy() {
      const id=contact?.kind==='pointer'?contact.id:undefined;
      contact=null;
      if(id!==undefined&&nav.hasPointerCapture(id))nav.releasePointerCapture(id);
      removers.forEach(remove=>remove());resize.disconnect();pending.disconnect();cancelAnimationFrame(frame);cancelAnimationFrame(releaseFrame);svg.remove();
      delete root.dataset.pressing;delete root.dataset.dragging;delete root.dataset.lensing;
      lens.removeAttribute('style');buttons.forEach(button=>delete button.dataset.preview);
    },
  };
}
