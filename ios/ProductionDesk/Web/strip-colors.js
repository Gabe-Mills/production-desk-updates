// Stored as a local scene extension, shared by that scene across schedule scenarios.
export const STRIP_PALETTE = [
  ['White','#FFFFFF'],['Spanish Red','#E60026'],['Rose','#F7CAD7'],['Orange','#F8B878'],
  ['Yellow','#F5E28B'],['Green','#BFE0BE'],['Teal','#92D6CF'],['Blue','#AFCDF0'],
  ['Lavender','#CDBFE8'],['Violet','#7953AD'],['Slate gray','#9AA5B1'],['Charcoal','#30343B']
];
export const validStripColor = value => typeof value==='string' && /^#[0-9A-F]{6}$/i.test(value);
export function stripTextColor(hex) {
  if(!validStripColor(hex))return '#241D21';
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  const luminance=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
  return (luminance+.05)/.05 >= 1.05/(luminance+.05) ? '#000000' : '#FFFFFF';
}
export function applyStripColors(root=document) {
  for(const node of root.querySelectorAll('[data-strip-color]')) {
    const color=node.dataset.stripColor;
    if(!validStripColor(color))continue;
    // Assign CSS properties directly; no inline HTML styles or remote stylesheets.
    node.style.backgroundColor=color;
    node.style.color=stripTextColor(color);
  }
}
