const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
for (const form of $$('[data-captcha]')) {
  form.addEventListener('submit', e => { e.preventDefault(); const value=$('input',form).value.replaceAll(' ','').toUpperCase(); $('output',form).textContent=value==='REFUGE'?'Demande transmise.':'Le code ne correspond pas.'; });
  $('[data-bypass]',form)?.addEventListener('click',()=>{$('output',form).textContent='Demande transmise par la voie alternative.';});
}
for (const button of $$('[data-status-action]')) button.addEventListener('click',()=>{$('#result').textContent='Votre parrainage a été enregistré.';});
for (const form of $$('[data-validation]')) form.addEventListener('submit',e=>{
  e.preventDefault();const input=$('[name=code]',form),ok=/^AD-\d{4}$/.test(input.value),out=$('output',form);
  out.textContent=ok?'Votre demande a été enregistrée.':form.dataset.validation;
  if(out.hasAttribute('role')) {input.setAttribute('aria-invalid',String(!ok));input.setAttribute('aria-describedby',out.id);}
});
for (const form of $$('[data-simple-form]')) form.addEventListener('submit',e=>{e.preventDefault();$('output',form).textContent='Vos informations sont enregistrées pour cette démonstration.';});
for (const panel of $$('[data-notes]')) {
  const key='refuge-rgaa:note:'+location.pathname,field=$('textarea',panel),out=$('output',panel);field.value=localStorage.getItem(key)||'';let backup=null;
  $('[data-save]',panel).addEventListener('click',()=>{localStorage.setItem(key,field.value);out.textContent='Note enregistrée dans ce navigateur.';});
  $('form',panel).addEventListener('submit',e=>{e.preventDefault();backup=localStorage.getItem(key);localStorage.removeItem(key);field.value='';out.textContent='Note supprimée.';const undo=$('[data-undo]',panel);if(undo)undo.hidden=false;});
  $('[data-undo]',panel)?.addEventListener('click',()=>{if(backup!==null){localStorage.setItem(key,backup);field.value=backup;}out.textContent='Suppression annulée.';$('[data-undo]',panel).hidden=true;});
}
for(const trigger of $$('[data-reveal]')) {
  trigger.addEventListener('click',()=>{const target=document.getElementById(trigger.dataset.reveal);target.hidden=!target.hidden;trigger.setAttribute('aria-expanded',String(!target.hidden));
  if(trigger.hasAttribute('data-restore-semantics'))target.removeAttribute('aria-hidden');});
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const wrap of $$('.keyboard-panel'))wrap.classList.add('dismissed');});
for(const wrap of $$('.keyboard-panel')) {wrap.addEventListener('mouseleave',()=>wrap.classList.remove('dismissed'));wrap.addEventListener('focusout',()=>wrap.classList.remove('dismissed'));}
for(const panel of $$('[data-shortcut]')) {
  const action=()=>{$('output',panel).textContent='Animal suivant : Socke';};$('[data-next]',panel).addEventListener('click',action);
  document.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='n'&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&(!$('[data-shortcut-enabled]',panel)||$('[data-shortcut-enabled]',panel).checked))action();});
}
for(const panel of $$('[data-session]')) {
  const deadline=Date.now()+15000;let disabled=false;
  $('[data-disable-timer]',panel)?.addEventListener('click',()=>{disabled=true;$('[data-countdown]',panel).textContent='Limite de temps supprimée.';});
  const timer=setInterval(()=>{if(disabled){clearInterval(timer);return;}const left=Math.max(0,Math.ceil((deadline-Date.now())/1000));$('[data-countdown]',panel).textContent='Temps restant : '+left+' s';if(!left){clearInterval(timer);$('form',panel).innerHTML='<p class="expired">Session expirée. Votre demande a été effacée.</p>'; }},250);
}
for(const canvas of $$('[data-map]')) {
  const ctx=canvas.getContext('2d');const zones=['Chats : 12 places','Chiens : 8 places','Soins : 4 places'];ctx.font='20px sans-serif';
  zones.forEach((x,i)=>{ctx.fillStyle=['#c4e1f3','#e8d2aa','#c3e0c9'][i];ctx.fillRect(i*200,0,200,180);ctx.fillStyle='#172330';ctx.fillText(x,i*200+12,90);});
  canvas.addEventListener('click',e=>{const box=canvas.getBoundingClientRect(),i=Math.min(2,Math.floor((e.clientX-box.left)/box.width*3));$('#map-result').textContent='Zone choisie — '+zones[i];});
}
for(const button of $$('[data-zone]'))button.addEventListener('click',()=>{$('#map-result').textContent='Zone choisie — '+button.dataset.zone;});
for(const control of $$('[data-player-toggle]'))control.addEventListener('click',async()=>{const v=$('video');if(v.paused){try{await v.play();control.textContent='Pause';}catch(error){$('#player-status').textContent='Lecture indisponible : '+error.name;}}else{v.pause();control.textContent='Lire';}});
for(const canvas of $$('[data-player-canvas]')) {
  const c=canvas.getContext('2d');function draw(){c.fillStyle='#193d68';c.fillRect(0,0,360,65);c.font='22px sans-serif';c.fillStyle='white';c.fillText($('video').paused?'▶ Lire la vidéo':'❚❚ Pause',20,42);}draw();canvas.addEventListener('click',async()=>{const v=$('video');try{if(v.paused)await v.play();else v.pause();draw();}catch(error){$('#player-status').textContent=error.name;}});
}
for(const audio of $$('audio[data-auto]')) {
  const attempt=async()=>{try{await audio.play();audio.dataset.playback='playing';}catch(error){audio.dataset.playback='blocked';audio.dataset.error=error.name;}};attempt();
  $('[data-stop-audio]')?.addEventListener('click',()=>{audio.pause();audio.currentTime=0;});
}
for(const element of $$('[data-swipe]')) {
  const animals=[['Mina','cat.jpg'],['Socke','socke.jpg'],['Alpaga','alpaca.jpg']];let index=0,start=null;
  const update=delta=>{index=(index+delta+animals.length)%animals.length;$('h2',element).textContent=animals[index][0];$('img',element).src='/photos/'+animals[index][1];$('img',element).alt=animals[index][0];};
  element.addEventListener('pointerdown',e=>{start={x:e.clientX,y:e.clientY};element.setPointerCapture(e.pointerId);});
  element.addEventListener('pointerup',e=>{if(start&&Math.abs(e.clientX-start.x)>70&&Math.abs(e.clientY-start.y)<40)update(e.clientX<start.x?1:-1);start=null;});
  $('[data-swipe-next]')?.addEventListener('click',()=>update(1));$('[data-swipe-prev]')?.addEventListener('click',()=>update(-1));
}
for(const panel of $$('[data-motion]')) {
  let last=0;const choose=()=>{$('output',panel).textContent=$('output',panel).textContent.includes('Socke')?'Mina, le chat':'Socke, le chien';};
  window.addEventListener('devicemotion',event=>{const a=event.accelerationIncludingGravity;if(!a)return;const enabled=$('[data-motion-enabled]',panel);if(enabled&&!enabled.checked)return;if(Math.max(Math.abs(a.x||0),Math.abs(a.y||0),Math.abs(a.z||0))>18&&Date.now()-last>800){last=Date.now();choose();}});
  $('[data-choose]',panel)?.addEventListener('click',choose);
  $('[data-motion-permission]',panel)?.addEventListener('click',async()=>{try{if(typeof DeviceMotionEvent.requestPermission==='function')await DeviceMotionEvent.requestPermission();}catch(error){$('[data-motion-help]',panel).textContent='Capteur indisponible : '+error.name;}});
}
const search=$('[data-search-results]');
if(search){const query=new URLSearchParams(location.search).get('q')||'';$('#query').value=query;const data=await fetch('/search-index.json').then(r=>r.json());for(const row of data.filter(x=>(x.title+' '+x.group).toLowerCase().includes(query.toLowerCase()))){const li=document.createElement('li'),a=document.createElement('a');a.href=row.url;a.textContent=row.title;li.append(a);search.append(li);}if(!search.children.length)search.textContent='Aucun résultat.';}
for(const form of $$('[data-local-search]'))form.addEventListener('submit',e=>{e.preventDefault();const q=$('input',form).value.toLowerCase();const results=$('[data-local-results]');results.hidden=false;for(const li of $$('li',results))li.hidden=!li.textContent.toLowerCase().includes(q);});
for(const button of $$('[data-graph-toggle]'))button.addEventListener('click',()=>{const img=$('#status-image');img.src='/assets/horaires.png';if(button.hasAttribute('data-sync-alt'))img.alt='Ouvert samedi de 14 h à 18 h';});
