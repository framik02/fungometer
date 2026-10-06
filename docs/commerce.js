'use strict';
window.FungoCommerce = (() => {
  let state=null,challengeId=null,widget=null,pollTimer=null;
  const $=id=>document.getElementById(id);
  async function api(path,data) {
    const response=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error||'Operazione non riuscita.'); return result;
  }
  function status(text,error=false) {const box=$('commerce-status');if(box){box.textContent=text;box.classList.toggle('error',error);}}
  const date=value=>new Date(value).toLocaleString('it-IT',{dateStyle:'medium',timeStyle:'short'});
  async function event(name){if(state?.user?.analytics) try{await api('event',{event:name});}catch{/* optional metrics never block the app */}}
  async function refresh(){state=await api('me');render();return state;}
  function render(){
    const notice=$('mode-notice');
    if(notice){notice.hidden=state.authEnabled&&!state.authRestricted&&state.paymentsMode==='live'&&state.paymentsReady;notice.textContent=!state.authEnabled?'Anteprima in preparazione: registrazioni e acquisti non ancora aperti.':state.authRestricted?'Collaudo riservato al gestore. Le registrazioni pubbliche e gli acquisti non sono ancora aperti.':state.paymentsMode==='test'?'Versione di prova: gli acquisti reali non sono attivi. Eventuali pagamenti Stripe sono soltanto simulazioni.':'Gli acquisti non sono ancora disponibili.';}
    if(notice&&state.authRestricted&&state.paymentsReady&&state.paymentsMode==='test')notice.textContent='Collaudo riservato al gestore. I pagamenti sono simulati: nessun addebito reale. Le registrazioni pubbliche sono chiuse.';
    if($('login-form')){
      const google=state.authProvider==='google';
      $('google-panel').hidden=!google||Boolean(state.user);$('google-login').disabled=!state.authEnabled||!state.googleReady;
      $('login-form').hidden=google||Boolean(state.user)||Boolean(challengeId);$('verify-form').hidden=google||Boolean(state.user)||!challengeId;$('account-panel').hidden=!state.user;
      if(state.authRestricted&&!state.user){$('account-title').textContent='Accesso di collaudo';$('account-intro').textContent='In questa fase può accedere soltanto l’account Google del gestore. La prova pubblica aprirà dopo le verifiche.';}
      if(state.user){
        $('account-title').textContent='Il tuo FungoMeter';$('account-intro').textContent='Accesso, scadenza e preferenze in un unico posto.';
        $('account-email').textContent=state.user.email;
        $('access-title').textContent=state.access.kind==='paid'?'Il tuo pass è attivo':state.access.kind==='trial'?'La tua prova è attiva':state.access.kind==='expired'?'La prova è terminata':'Pronto a provare tutta Italia?';
        $('access-detail').textContent=state.access.active?`Accesso fino al ${date(state.access.until)}. Nessun rinnovo automatico.`:state.access.kind==='expired'?'Nessun addebito è stato effettuato. Scegli un pass per continuare a consultare la mappa di tutta Italia.':'Attiva la prova quando sei pronto a esplorare. Parte da questo momento e dura 7 giorni.';
        $('trial-consent').hidden=!state.user.canTrial||state.access.kind==='paid';$('analytics-consent').checked=state.user.analytics;
        $('open-map').textContent=state.access.active?'Esplora la tua zona':'Apri la mappa';
      }else if(!state.authEnabled){$('login-form').querySelector('button').disabled=true;status(google?'Stiamo completando il collegamento con Google. L’accesso sarà disponibile qui.':'Stiamo preparando l’accesso via email. Riprova quando la configurazione sarà completata.');}
    }
    document.querySelectorAll('.buy').forEach(button=>{button.disabled=!state.paymentsReady;if(state.paymentsMode==='test')button.textContent=button.dataset.plan==='season'?'Simula 90 giorni':'Simula 12 mesi';});
    if(state.paymentsMode==='test'&&state.paymentsReady&&$('purchase-terms')){
      $('purchase-terms').nextElementSibling.textContent='Confermo che questo è un pagamento simulato per il collaudo: nessun acquisto reale e nessun addebito. Userò soltanto una carta di test Stripe.';
    }
    if($('purchase-consent')) $('purchase-consent').hidden=!state.user||!state.paymentsReady;
    if($('commerce-banner')){
      $('commerce-banner').replaceChildren();
      const text=document.createElement('span');text.textContent=state.access.active?`${state.access.kind==='trial'?'Prova gratuita':'Pass attivo'} fino al ${date(state.access.until)}`:'Attiva la prova per consultare la mappa';
      const link=document.createElement('a');link.href=state.access.active?'account.html':'account.html?prova=1';link.textContent=state.access.active?'Il tuo accesso':'Prova tutta Italia gratis';$('commerce-banner').append(text,link);
    }
  }
  async function busy(button,action){button.disabled=true;status('');try{await action();}catch(e){status(e.message,true);}finally{button.disabled=false;}}
  const ready=(async()=>{
    try{await refresh();}catch{status('Servizio di accesso non disponibile. Riprova tra poco.',true);state={access:{active:false,kind:'locked'},user:null};return state;}
    if($('login-form')){
      $('google-login').addEventListener('click',e=>busy(e.target,async()=>{
        const result=await api('auth/google/start',{plan:new URLSearchParams(location.search).get('piano')});
        const url=new URL(result.url);if(url.origin!=='https://accounts.google.com')throw new Error('Indirizzo di accesso non valido.');location.assign(url.href);
      }));
      const googleError=new URLSearchParams(location.search).get('google');
      if(googleError)status(googleError==='cancelled'?'Accesso annullato. Puoi riprovare quando vuoi.':googleError==='restricted'?'L’accesso è riservato all’account Google del gestore durante il collaudo. Le registrazioni pubbliche non sono ancora aperte.':googleError==='account_conflict'?'Questo indirizzo è associato a un accesso diverso. Contatta l’assistenza per collegare gli account.':'Accesso non completato o collegamento scaduto. Premi di nuovo Accedi con Google.',googleError!=='cancelled');
      if(state.authProvider!=='google'&&!state.local&&state.authEnabled&&state.turnstileSiteKey&&!state.user){
        const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.onload=()=>{widget=window.turnstile.render('#turnstile',{sitekey:state.turnstileSiteKey,action:'login'});};document.head.append(script);
      }
      $('login-form').addEventListener('submit',e=>{e.preventDefault();busy(e.submitter,async()=>{
        const result=await api('auth/request',{email:e.target.email.value,turnstileToken:widget!==null?window.turnstile.getResponse(widget):''});challengeId=result.id;render();
        status(result.localCode?`Solo sul tuo computer — codice di test: ${result.localCode}`:'Codice inviato. Controlla la tua email.');$('verify-form').elements.code.focus();
      }).finally(()=>{if(widget!==null)window.turnstile.reset(widget);});});
      $('verify-form').addEventListener('submit',e=>{e.preventDefault();busy(e.submitter,async()=>{await api('auth/verify',{id:challengeId,code:e.target.code.value});challengeId=null;await refresh();if(new URLSearchParams(location.search).has('piano'))location.href='prezzi.html';});});
      $('new-code').addEventListener('click',()=>{challengeId=null;render();status('');});
      $('start-trial').addEventListener('click',e=>busy(e.target,async()=>{if(!$('trial-terms').checked)throw new Error('Leggi e accetta le condizioni per iniziare.');await api('trial',{termsVersion:state.termsVersion});location.href='index.html';}));
      $('logout').addEventListener('click',e=>busy(e.target,async()=>{await api('logout',{});location.href='account.html';}));
      $('analytics-consent').addEventListener('change',async e=>{try{await api('preferences',{analytics:e.target.checked});await refresh();status('Preferenza salvata.');}catch(err){e.target.checked=!e.target.checked;status(err.message,true);}});
      if(new URLSearchParams(location.search).get('checkout')==='success'&&state.user){
        let attempts=0;status('Verifichiamo il pagamento. L’accesso si aggiorna dopo la conferma di Stripe.');
        pollTimer=setInterval(async()=>{try{await refresh();if(state.access.kind==='paid'){clearInterval(pollTimer);status('Pagamento confermato. Il pass è attivo.');}else if(++attempts>=15){clearInterval(pollTimer);status('La conferma richiede più tempo. Ricarica fra poco; non ripetere il pagamento.');}}catch{clearInterval(pollTimer);status('Connessione interrotta. Ricarica questa pagina per verificare il pagamento.',true);}},2000);
      }
    }
    document.querySelectorAll('.buy').forEach(button=>button.addEventListener('click',()=>busy(button,async()=>{
      if(!state.user){location.href='account.html?piano='+encodeURIComponent(button.dataset.plan);return;}
      if(!$('purchase-terms').checked)throw new Error('Leggi e conferma le condizioni di acquisto prima di continuare.');
      const result=await api('checkout',{plan:button.dataset.plan,termsVersion:state.termsVersion,immediateAccess:true});
      const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw new Error('Indirizzo di pagamento non valido.');location.href=url.href;
    })));
    if($('commerce-banner')){
      const checkAccess=async()=>{try{await refresh();if(!state.access.active)location.replace('account.html');}catch{if(state?.access?.until<=Date.now())location.replace('account.html');}};
      setInterval(checkAccess,60000);
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkAccess();});
    }
    if(document.body.dataset.page==='pricing'){event('pricing_view');if(new URLSearchParams(location.search).get('checkout')==='cancelled')status('Acquisto interrotto. Puoi tornare alla mappa o riprovare quando vuoi.');}
    return state;
  })();
  return {ready,event,refresh,get active(){return Boolean(state?.access.active);}};
})();
