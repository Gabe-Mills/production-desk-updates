// On-device counterpart of film.py. Kept dependency-free for the bundled iPad UI.
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const categories = [[0,'Set'],[1,'INT/EXT'],[2,'Day/Night'],[3,'Script Day'],[4,'Unit'],[5,'Sequence'],[6,'Location'],[100,'Cast Members'],[101,'Background Actors'],[102,'Stunts'],[103,'Vehicles'],[104,'Props'],[105,'Special Effects'],[106,'Wardrobe'],[107,'Makeup/Hair'],[108,'Animals'],[109,'Animal Wranglers'],[110,'Camera'],[111,'Grip'],[112,'Electric'],[113,'Sound'],[114,'Music'],[115,'Art Department'],[116,'Set Dressing'],[117,'Greenery'],[118,'Security'],[119,'Special Equipment'],[120,'Additional Labor'],[121,'Visual Effects'],[122,'Mechanical Effects'],[123,'Notes'],[124,'Comments'],[125,'Miscellaneous'],[126,'Other']];
export function emptyProject(title = 'Untitled production') {
  const stamp = now();
  const calendar = {id:uid(),daysOff:[0,6],events:[{id:uid(),type:'start',date:stamp.slice(0,10)+'T12:00:00.000Z',name:null}],name:'Production calendar'};
  return {id:uid(),author:null,company:null,created:stamp,description:null,episode:null,episodeName:null,name:'Shooting schedule',project:title,schedColor:null,schedDate:stamp,scriptColor:null,scriptDate:stamp,season:null,source:'Production Desk — Local Film Scheduler',ussVersion:'1.0.0',breakdowns:[],elements:[],categories:categories.map(([ucid,name])=>({id:uid(),created:stamp,name,ucid})),stripboards:[{id:uid(),name:'Main schedule',calendar:calendar.id,boards:[{id:uid(),name:'stripboard',breakdownIds:[]},{id:uid(),name:'boneyard',breakdownIds:[]}]}],calendars:[calendar]};
}
function element(p, ucid, name) {
  name = name.trim();
  const category=p.categories.find(c=>c.ucid===ucid), old=p.elements.find(e=>e.category===category.id && e.name.toLowerCase()===name.toLowerCase());
  if(old)return old.id;
  const e={id:uid(),category:category.id,created:now(),name,daysOff:[],dropDayCount:0,elementId:ucid===100?String(1+p.elements.filter(e=>e.category===category.id).length):null,events:[],isDood:ucid===100,isDrop:true,isHold:true,isIdLock:false,linkedElements:[]};
  p.elements.push(e);return e.id;
}
export function parseHeading(line) {
  const m=line.match(/^\s*(?:(\d+[A-Za-z]?)\s+)?\.?(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\/E\.?|INT\.?|EXT\.?)\s+(.+?)\s*$/i);
  if(!m)return null;
  let [,number,ie,remainder]=m;
  const fountain=remainder.match(/\s+#([^#]+)#\s*$/);
  if(fountain){number=fountain[1];remainder=remainder.slice(0,fountain.index);}
  const trailing=remainder.match(/\s+(\d+[A-Za-z]?)\s*$/);
  if(trailing&&(number||/\b(DAY|NIGHT|DAWN|DUSK)\b/i.test(remainder))){number ||= trailing[1];remainder=remainder.slice(0,trailing.index);}
  const parts=remainder.split(/\s+[-–—]\s+/),tod=parts.length>1?parts.pop().trim().toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()):'Day';
  return [number,ie.includes('/')?'I/E':ie.replaceAll('.','').toUpperCase(),parts.join(' - ').trim(),tod];
}
export function parseScript(text, fdx=false) {
  let records=[];
  if(fdx){
    if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('Final Draft files containing XML entities are not supported.');
    const xml=new DOMParser().parseFromString(text,'application/xml');
    if(xml.querySelector('parsererror'))throw Error('This Final Draft file is not valid XML.');
    const content=xml.documentElement.querySelector(':scope > Content');
    if(!content)throw Error('No script Content found in this Final Draft file.');
    records=[...content.children].filter(p=>p.tagName==='Paragraph').map(p=>[[...p.children].filter(t=>t.tagName==='Text').map(t=>t.textContent).join('').trim(),p.getAttribute('Type')||'Action',p.getAttribute('Number'),null]);
  } else {
    let page=1;
    records=text.replaceAll('\r','').split('\n').map(line=>{page+=(line.match(/\f/g)||[]).length;return [line.replaceAll('\f','').trimEnd(),null,null,page];});
  }
  const scenes=[];let current;
  for(const [line,kind,explicit,page] of records){
    const heading=(kind===null||kind==='Scene Heading')&&parseHeading(line);
    if(heading){const [number,ie,set,tod]=heading;current={number:explicit||number||String(scenes.length+1),ie,set,tod,lines:[line.trim()],cast:[],startPage:String(page||1),lineCount:1};scenes.push(current);}
    else if(current){
      if(/^\s*\d+\.?\s*$/.test(line)||/^\s*(CONTINUED|CONT'D):?\s*$/.test(line))continue;
      current.lines.push(line);current.lineCount+=Math.max(1,Math.ceil(line.length/60));
      let cue=line.trim();
      if(kind==='Character'||(kind===null&&cue.length<40&&/^[A-Z][A-Z0-9 .()'’\-/]+$/.test(cue)&&!/[.:]$/.test(cue)&&!/^(FADE |CUT |DISSOLVE )/.test(cue))){cue=cue.replace(/\s*\([^)]*\)/g,'').trim();if(cue&&!current.cast.includes(cue))current.cast.push(cue);}
    }
  }
  if(!scenes.length)throw Error('No scene headings found. Use headings such as INT. KITCHEN - DAY, or create scenes manually.');
  return scenes;
}
// Python's round() uses ties-to-even for estimated eighths.
function rounded(value){const floor=Math.floor(value);return value-floor===0.5?(floor%2?floor+1:floor):Math.round(value);}
export function importScript(text, filename) {
  const p=emptyProject(filename.replace(/\.[^.]+$/,'').replaceAll('_',' '));
  p._scriptFilename=filename;p._importNotes='Page eighths are estimated from extracted text. Review lengths and cast before scheduling.';
  for(const scene of parseScript(text,filename.toLowerCase().endsWith('.fdx'))){
    const elements=[[0,'set'],[1,'ie'],[2,'tod']].map(([n,k])=>element(p,n,scene[k])).concat(scene.cast.map(name=>element(p,100,name)));
    const b={id:uid(),bannerText:null,comments:null,created:now(),description:'',elements,pages:Math.max(.125,rounded(scene.lineCount/55*8)/8),scene:scene.number,scriptPage:scene.startPage,duration:3600000,type:'scene',_scriptText:scene.lines.join('\n').trim(),_needsReview:true,_completed:false};
    p.breakdowns.push(b);p.stripboards[0].boards[1].breakdownIds.push(b.id);
  }
  return p;
}
export function validateUSS(p) {
  const fail=message=>{throw Error(message);},object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  if(!object(p))fail('USS must contain a universalScheduleStandard object.');
  for(const key of ['id','created','name','source','ussVersion'])if(typeof p[key]!=='string'||!p[key])fail('Missing USS string: '+key);
  for(const key of ['project','author','company','description','episode','episodeName','season','_scriptFilename','_importNotes'])if(p[key]!=null&&typeof p[key]!=='string')fail('Production '+key+' must be text or null.');
  if(p.ussVersion!=='1.0.0')fail('This app supports USS 1.0.0. This file uses '+p.ussVersion);
  const collections=['breakdowns','categories','elements','stripboards','calendars'];
  for(const key of collections){if(!(key in p)&&['stripboards','calendars'].includes(key))p[key]=[];if(!Array.isArray(p[key]))fail('USS '+key+' must be an array.');}
  const all=new Set();
  function checkID(o){if(!object(o)||typeof o.id!=='string'||!o.id)fail('Every USS object requires a string id.');if(all.has(o.id))fail('Duplicate USS id: '+o.id);all.add(o.id);}
  checkID(p);collections.forEach(key=>p[key].forEach(checkID));
  const cats=new Set(p.categories.map(c=>c.id)),elements=new Set(p.elements.map(e=>e.id)),breakdowns=new Set(p.breakdowns.map(b=>b.id)),calendars=new Set(p.calendars.map(c=>c.id));
  for(const c of p.categories)if(!Number.isInteger(c.ucid)||typeof c.name!=='string')fail('Categories require a name and integer ucid.');
  for(const e of p.elements)if(!cats.has(e.category)||typeof e.name!=='string')fail('Element has an invalid category or name.');
  for(const e of p.elements)if(e.linkedElements!=null&&(!Array.isArray(e.linkedElements)||e.linkedElements.some(id=>typeof id!=='string')))fail('Linked elements must be an array of IDs.');
  for(const b of p.breakdowns){
    if(!['scene','banner'].includes(b.type)||!Array.isArray(b.elements))fail('Invalid breakdown type or elements.');
    if(b.elements.some(e=>!elements.has(e)))fail('Breakdown references an unknown element.');
    for(const key of ['description','comments','bannerText','_scriptText'])if(b[key]!=null&&typeof b[key]!=='string')fail('Breakdown '+key+' must be text or null.');
    if(b._stripColor!=null&&(typeof b._stripColor!=='string'||!/^#[0-9a-fA-F]{6}$/.test(b._stripColor)))fail('Strip color must be a six-digit hex color or null.');
    for(const key of ['pages','duration'])if(b[key]!=null&&(typeof b[key]!=='number'||!Number.isFinite(b[key])||b[key]<0))fail('Breakdown '+key+' must be a nonnegative number or null.');
  }
  for(const c of [...p.calendars,...p.elements]){
    const days=c.daysOff??[];
    if(!Array.isArray(days)||days.some(d=>!Number.isInteger(d)||d<0||d>6)||new Set(days).size!==days.length)fail('daysOff must contain distinct weekdays from 0 through 6.');
    const events=c.events??[];if(!Array.isArray(events))fail('Events must be an array.');
    for(const event of events){checkID(event);if(!['start','dayOff','event'].includes(event.type))fail('Unknown calendar event type.');if(typeof event.date!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(event.date)||!Number.isFinite(Date.parse(event.date)))fail('Invalid event date.');const day=event.date.slice(0,10);if(new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day)fail('Invalid event date.');}
  }
  for(const s of p.stripboards){
    if(s.calendar!=null&&!calendars.has(s.calendar))fail('Stripboard references an unknown calendar.');
    if(typeof s.name!=='string')fail('Stripboard name must be text.');
    if(!Array.isArray(s.boards)||s.boards.length<1)fail('Stripboard requires a shooting board.');
    const seen=[];
    for(const b of s.boards){checkID(b);if(typeof b.name!=='string')fail('Board name must be text.');if(!Array.isArray(b.breakdownIds))fail('Board breakdownIds must be an array.');for(const group of b.breakdownIds){const ids=Array.isArray(group)?group:[group];if(ids.some(x=>typeof x!=='string'||!breakdowns.has(x)))fail('Board references an unknown breakdown.');seen.push(...ids);}}
    if(seen.length!==new Set(seen).size||seen.length!==breakdowns.size||[...breakdowns].some(id=>!seen.includes(id)))fail('Each scenario must contain every breakdown exactly once across its boards.');
  }
  const shots=p._shots??[],sceneIDs=new Set(p.breakdowns.filter(b=>b.type==='scene').map(b=>b.id)),numbers=new Set();
  if(!Array.isArray(shots))fail('Shot list must be an array.');
  for(const shot of shots){
    checkID(shot);if(!sceneIDs.has(shot.sceneId))fail('Shot references an unknown scene.');
    for(const key of ['number','description','size','movement','camera','lens','equipment','notes','circleTake'])if(typeof shot[key]!=='string')fail('Shot '+key+' must be text.');
    const number=shot.number.trim();if(!number||number.length>24)fail('Shot number must contain 1 through 24 characters.');
    const pair=JSON.stringify([shot.sceneId,number.toLowerCase()]);if(numbers.has(pair))fail('Duplicate shot number in the same scene.');numbers.add(pair);
    if(!['Planned','Ready','Rolling','Done','Omitted'].includes(shot.status))fail('Unknown shot status.');
    if(!['Essential','Preferred','Optional'].includes(shot.priority))fail('Unknown shot priority.');
    for(const [key,max] of [['setupMinutes',1440],['shootMinutes',1440],['actualMinutes',10080],['takes',10000]]){if(key==='actualMinutes'&&shot[key]===null)continue;if(!Number.isInteger(shot[key])||shot[key]<0||shot[key]>max)fail('Shot '+key+' must be a whole number from 0 through '+max+'.');}
  }
  const settings=p._shotSettings??{startTime:'07:00'};if(!object(settings)||typeof settings.startTime!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(settings.startTime))fail('Shot start time must use HH:MM.');
  return p;
}
export function validateWorkspace(value){
  if(!value||value.version!==1||!Array.isArray(value.projects)||!value.projects.length)throw Error('Invalid workspace.');
  value.projects.forEach(validateUSS);
  if(value.projects.some(p=>!p.stripboards.length||!p.calendars.length))throw Error('Each production requires a schedule and calendar.');
  const ids=value.projects.map(p=>p.id);
  if(new Set(ids).size!==ids.length||!ids.includes(value.activeProject))throw Error('Invalid active project or duplicate project IDs.');
  return value;
}
export function importBackup(text){
  const value=JSON.parse(text);
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Select a USS file or a Production Desk workspace backup.');
  if(value.universalScheduleStandard){const p=validateUSS(value.universalScheduleStandard);if(!p.stripboards.length){const defaults=emptyProject();p.stripboards=defaults.stripboards;p.calendars.push(...defaults.calendars);p.stripboards[0].boards[1].breakdownIds=p.breakdowns.map(b=>b.id);}return {project:p};}
  if(value.version===1&&Array.isArray(value.projects)){validateWorkspace(value);return {workspace:value};}
  throw Error('Select a USS file or a Production Desk workspace backup.');
}
