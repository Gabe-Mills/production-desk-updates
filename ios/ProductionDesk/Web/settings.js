export function createAppSettings({api,modal,esc,toast,current,isIPad}) {
  let status, preferences={theme:'light',gcasperLinks:{},calendarId:'primary'}, epoch=0;
  const $=s=>document.querySelector(s);
  const applyTheme=theme=>{document.documentElement.dataset.theme=theme;};
  function external(url) {
    const parsed=new URL(url);
    if(parsed.protocol!=='https:'||!['accounts.google.com','docs.google.com','calendar.google.com'].includes(parsed.hostname))throw Error('Unsupported Google link.');
    if(window.webkit?.messageHandlers?.slateExternal)window.webkit.messageHandlers.slateExternal.postMessage(url);
    else window.open(url,'_blank','noopener,noreferrer');
  }
  async function init(){
    if(isIPad){
      try{preferences.theme=localStorage.getItem('productionDeskTheme')==='dark'?'dark':'light';}catch{}
      applyTheme(preferences.theme);return;
    }
    try{status=await api('/api/settings');preferences=status.preferences;applyTheme(preferences.theme);}catch(e){toast(e.message);}
  }
  function alive(generation){return epoch===generation&&$('#modal').open&&!!$('#app-settings');}
  function message(text,error=false){const el=$('#integration-status');if(el){el.textContent=text;el.classList.toggle('modal-error',error);}}
  async function persist(value){
    if(isIPad){try{localStorage.setItem('productionDeskTheme',value.theme);}catch{}preferences={...preferences,...value};return;}
    status=await api('/api/settings',value);preferences=status.preferences;
  }
  async function open(){
    const generation=++epoch;
    const {project,scenario}=current();
    modal('Settings',`<div id="app-settings"><section class="settings-section"><h3>Appearance</h3><p>Choose how Production Desk looks on this device.</p><div class="theme-options" role="group" aria-label="Appearance"><button data-theme-choice="light" aria-pressed="${preferences.theme==='light'}"><span>☀</span>Light</button><button data-theme-choice="dark" aria-pressed="${preferences.theme==='dark'}"><span>☾</span>Dark</button></div></section><section class="settings-section"><h3>Google account</h3><div id="google-account"><p>Checking connection…</p></div></section><section class="settings-section"><h3>G-Casper call sheet</h3><p>Send scene breakdowns and shooting days to your G-Casper sheet. Cast role IDs are linked automatically. Contact details and call-sheet formulas are preserved.</p><label class="field">Google Sheets link<input id="gcasper-link" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(preferences.gcasperLinks?.[project.id]||'')}"></label><button class="integration-action" id="gcasper-preview" disabled>Preview G-Casper transfer</button></section><section class="settings-section"><h3>Google Calendar</h3><p>Add an all-day event for each shooting day, including scenes and locations. Sending again updates this scenario’s events.</p><label class="field">Destination calendar<select id="google-calendar"><option value="primary">My primary calendar</option></select></label><button class="integration-action" id="calendar-preview" disabled>Preview Calendar transfer</button></section><p class="integration-context">Production: ${esc(project.project||project.name)}<br>Scenario: ${esc(scenario.name)}</p><div id="integration-preview"></div><div id="integration-status" role="status"></div></div>`);
    for(const button of document.querySelectorAll('[data-theme-choice]'))button.onclick=async()=>{
      const previous=preferences.theme,theme=button.dataset.themeChoice;
      applyTheme(theme);for(const b of document.querySelectorAll('[data-theme-choice]'))b.setAttribute('aria-pressed',String(b===button));
      try{await persist({theme});}catch(e){applyTheme(previous);for(const b of document.querySelectorAll('[data-theme-choice]'))b.setAttribute('aria-pressed',String(b.dataset.themeChoice===previous));message('Appearance could not be saved: '+e.message,true);}
    };
    $('#gcasper-link').oninput=()=>{$('#integration-preview').replaceChildren();};
    $('#gcasper-link').onchange=async()=>{if(isIPad)return;try{await persist({gcasperLinks:{...preferences.gcasperLinks,[project.id]:$('#gcasper-link').value.trim()}});}catch(e){if(alive(generation))message(e.message,true);}};
    $('#google-calendar').onchange=()=>{$('#integration-preview').replaceChildren();};
    $('#gcasper-preview').onclick=()=>preview('sheet',generation);
    $('#calendar-preview').onclick=()=>preview('calendar',generation);
    if(isIPad){$('#google-account').innerHTML='<p>Google account linking is unavailable in this offline iOS edition. Export CSV or USS files to share your schedule.</p>';$('#gcasper-preview').closest('.settings-section').hidden=true;$('#calendar-preview').closest('.settings-section').hidden=true;return;}
    try{status=await api('/api/settings');if(alive(generation))await renderAccount(generation);}catch(e){if(alive(generation))message(e.message,true);}
  }
  async function renderAccount(generation){
    const area=$('#google-account');
    if(status.connected){area.innerHTML=`<p class="connected-account">Connected as <strong>${esc(status.email)}</strong></p><button id="google-disconnect">Disconnect account</button>`;$('#google-disconnect').onclick=async()=>{
      const button=$('#google-disconnect');button.disabled=true;message('Disconnecting Google…');
      try{status=await api('/api/google/disconnect',{});if(alive(generation)){await renderAccount(generation);$('#integration-preview').replaceChildren();message('Google account disconnected.');}}catch(e){if(alive(generation)){button.disabled=false;message(e.message,true);}}
    };}
    else if(!status.configured){area.innerHTML='<p>Google sign-in is awaiting app setup. Once enabled, you can connect your account here to send breakdowns and schedules.</p><button disabled>Connect Google account</button>';}
    else{area.innerHTML=`<p>${status.pending?'Finish signing in in your browser.':'Connect your Google account to use G-Casper and Calendar.'}</p><button id="google-connect">${status.pending?'Restart Google sign-in':'Connect Google account'}</button>`;$('#google-connect').onclick=async()=>{
      const button=$('#google-connect');button.disabled=true;
      try{const result=await api('/api/google/connect',{});if(!alive(generation))return;external(result.url);message('Finish signing in in your browser, then return here.');poll(generation);}catch(e){if(alive(generation))message(e.message,true);}finally{if(alive(generation))button.disabled=false;}
    };}
    $('#gcasper-preview').disabled=$('#calendar-preview').disabled=!status.connected;
    if(status.error)message(status.error,true);
    if(status.connected){
      try{const value=await api('/api/google/calendars');if(!alive(generation))return;
        $('#google-calendar').innerHTML='<option value="primary">My primary calendar</option>'+value.calendars.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
        if([...$('#google-calendar').options].some(o=>o.value===preferences.calendarId))$('#google-calendar').value=preferences.calendarId;
      }catch(e){if(alive(generation))message(e.message,true);}
    }else if(status.pending)poll(generation);
  }
  async function poll(generation){
    await new Promise(resolve=>setTimeout(resolve,2000));if(!alive(generation))return;
    try{status=await api('/api/settings');if(!alive(generation))return;if(status.connected){await renderAccount(generation);message('Google account connected.');}else if(status.pending)poll(generation);else{await renderAccount(generation);if(status.error)message(status.error,true);}}catch(e){if(alive(generation))message(e.message,true);}
  }
  async function preview(kind,generation){
    const {project,scenario}=current(),buttons=[$('#gcasper-preview'),$('#calendar-preview')];
    buttons.forEach(b=>b.disabled=true);$('#integration-preview').replaceChildren();message('Preparing transfer preview…');
    try{
      const link=$('#gcasper-link').value.trim(),calendarId=$('#google-calendar').value;
      if(kind==='sheet'&&!link)throw Error('Paste the Google Sheets link for your G-Casper call sheet.');
      const snapshot=JSON.stringify({project,scenarioId:scenario.id});
      const result=await api('/api/google/preview',{kind,project,scenarioId:scenario.id,link,calendarId});if(!alive(generation))return;
      await persist(kind==='sheet'?{gcasperLinks:{...preferences.gcasperLinks,[project.id]:link}}:{calendarId});
      if(!alive(generation))return;
      $('#integration-preview').innerHTML=`<div class="transfer-preview"><h3>${esc(result.title)}</h3><p>${kind==='sheet'?`${result.scenes} scenes: ${result.added} new, ${result.updated} matched.<br>${result.castAdded} cast roles added · ${result.days} shooting dates.<br>Shooting order goes into Production Desk Schedule. Other existing scenes remain in Breakdown.`:`${result.days} shooting-day events.<br>${result.removed?result.removed+' obsolete events from this scenario will be removed.':'Existing events from this scenario will be updated.'}`}</p><button id="google-sync" class="primary">${kind==='sheet'?'Send to G-Casper':'Send to Google Calendar'}</button></div>`;
      message('Review the destination and transfer details above.');
      $('#google-sync').onclick=async()=>{
        const button=$('#google-sync');button.disabled=true;
        try{
          const now=current();if(snapshot!==JSON.stringify({project:now.project,scenarioId:now.scenario.id}))throw Error('Your schedule changed. Preview the transfer again.');
          message('Sending to Google…');const synced=await api('/api/google/sync',{planId:result.planId});if(!alive(generation))return;
          $('#integration-preview').innerHTML='<button id="google-result">Open '+(kind==='sheet'?'G-Casper sheet':'Google Calendar')+' ↗</button>';
          $('#google-result').onclick=()=>external(synced.url);message(kind==='sheet'?'Breakdown and schedule sent to G-Casper.':'Shooting days sent to Google Calendar.');
        }catch(e){if(alive(generation)){message(e.message,true);$('#integration-preview').replaceChildren();}}
      };
    }catch(e){if(alive(generation))message(e.message,true);}finally{if(alive(generation))buttons.forEach(b=>b.disabled=!status?.connected);}
  }
  return {init,open};
}
