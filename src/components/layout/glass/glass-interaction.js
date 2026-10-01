import { spring } from "./glass-spring";

/* Web implementation informed by Apple's public Liquid Glass design/API docs.
 * The optical profile and spring constants below are our own approximations.
 * No Apple private API or copied native implementation is used. */
/** @param {HTMLElement} root @param {number} initial */
export function attachGlassInteraction(root, initial) {
  const nav=root.querySelector('.nav-items');
  let selected=initial;
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
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
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
  const resize=new ResizeObserver(()=>{
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
      removers.forEach(remove=>remove());resize.disconnect();pending.disconnect();cancelAnimationFrame(frame);cancelAnimationFrame(releaseFrame);
      delete root.dataset.pressing;delete root.dataset.dragging;delete root.dataset.lensing;
      lens.removeAttribute('style');buttons.forEach(button=>delete button.dataset.preview);
    },
  };
}
