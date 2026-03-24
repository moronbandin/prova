// js/buscador.js (filtros contextuais por vista)
const cache = {};
const CESTA_KEY = 'fol-ear-cesta';
let currentScope = ''; // prov:xx | com:xx | con:xx | par:xx

/* ------------------- UTILS ------------------- */
function getCesta(){ try { return JSON.parse(localStorage.getItem(CESTA_KEY)||'[]'); } catch { return []; } }
function setCesta(arr){ localStorage.setItem(CESTA_KEY, JSON.stringify(arr)); }

async function fetchJSON(path){
  if (cache[path]) return cache[path];
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Erro cargando ${path}`);
  const json = await res.json();
  cache[path] = json;
  return json;
}
function esc(s){ return String(s||''); }
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function renderList(ul, rows, toHTML){ ul.innerHTML = rows.map(toHTML).join('') || '<li style="opacity:.7">Sen resultados</li>'; }

/* ------------------- AUTOCOMPLETE (lugares) ------------------- */
async function buildIndexLugares(){
  const [provincias, comarcas, concellos] = await Promise.all([
    fetchJSON('assets/provincias.geojson'),
    fetchJSON('assets/comarcas.geojson'),
    fetchJSON('assets/concellos.geojson'),
  ]);

  let parroquiasGeo = null;
  try {
    const topo = await fetchJSON('assets/parroquias.topo.json');
    const name = (topo.objects && Object.keys(topo.objects)[0]) || 'parroquias';
    if (window.topojson) parroquiasGeo = window.topojson.feature(topo, topo.objects[name]);
  } catch(e){}

  const idx = [];
  for (const f of (provincias.features||[])) { const p=f.properties||{}; idx.push({ label: `${p.PROVINCIA}`, type:'prov', scope:`prov:${p.CODPROV}`}); }
  for (const f of (comarcas.features||[]))   { const p=f.properties||{}; idx.push({ label: `${p.COMARCA}`,  type:'com',  scope:`com:${p.CODCOM}`}); }
  for (const f of (concellos.features||[]))  { const p=f.properties||{}; idx.push({ label: `${p.CONCELLO}`, type:'con',  scope:`con:${p.CODCONC}`}); }
  if (parroquiasGeo){
    for (const f of (parroquiasGeo.features||[])){ const p=f.properties||{}; idx.push({ label:`${p.PARROQUIA} — ${p.CONCELLO}`, type:'par', scope:`par:${p.CODPARRO}`}); }
  }
  idx.sort((a,b)=>a.label.localeCompare(b.label,'gl'));
  return idx;
}
function renderSuxest(ul, rows){
  ul.innerHTML = rows.map(r => `
    <li data-scope="${r.scope}">
      <div><strong>${escapeHtml(r.label)}</strong> <span class="tag" style="margin-left:6px">${r.type.toUpperCase()}</span></div>
    </li>`).join('') || '<li style="opacity:.7">Sen resultados</li>';
}
function showScopeChip(scopeChipId){
  const el = document.getElementById(scopeChipId);
  if (!el) return;
  if (!currentScope){ el.innerHTML = '<span class="hint">Sen ámbito</span>'; return; }
  el.innerHTML = `<span class="scope-pill">Ámbito: ${escapeHtml(currentScope)} <button id="clear-scope" title="Borrar ámbito">×</button></span>`;
  el.querySelector('#clear-scope')?.addEventListener('click', () => {
    currentScope = '';
    showScopeChip(scopeChipId);
    document.dispatchEvent(new CustomEvent('filters:change', { detail: { scope:'', view:'pezas' }}));
  });
}
function attachAutocomplete({ inputId='lugar', listId='lugar-suxest', scopeChipId }){
  const inp = document.getElementById(inputId);
  const ul  = document.getElementById(listId);
  if (!inp || !ul) return;
  let index = [];
  let ready = false;
  (async () => { index = await buildIndexLugares(); ready = true; })();

  let lastQ = '';
  inp.addEventListener('input', () => {
    const q = (inp.value || '').trim().toLowerCase();
    if (!ready || q === lastQ) return;
    lastQ = q;
    if (!q) { ul.innerHTML=''; return; }
    const out = index.filter(i => i.label.toLowerCase().includes(q)).slice(0, 15);
    renderSuxest(ul, out);
    // avisar ao mapa para resaltar candidatos
    const scopes = out.map(o=>o.scope);
    document.dispatchEvent(new CustomEvent('map:highlight-candidates', { detail:{ scopes } }));
  });
  ul.addEventListener('click', (ev) => {
    const li = ev.target.closest('li[data-scope]');
    if (!li) return;
    currentScope = li.getAttribute('data-scope') || '';
    ul.innerHTML = ''; inp.value = '';
    showScopeChip(scopeChipId);
    // zoom no mapa, pero non obrigo a cambiar de vista
    document.dispatchEvent(new CustomEvent('map:zoom-to-scope', { detail: { scope: currentScope } }));
  });
}

/* ------------------- MAPEO (jerarquía para filtro) ------------------- */
function pertenceAoScopeFactory(mapeo){
  return function pertenceAoScope(location, scope){
    if (!scope) return true;
    const [tipo, codigo] = String(scope).split(':');
    let par = mapeo.byParroquia.get(String(location));
    if (!par) {
      const cand = mapeo.byConcelloFirstParroquia.get(String(location));
      if (cand) par = cand;
    }
    if (!par) return false;
    if (tipo === 'par')  return String(par.id) === codigo;
    if (tipo === 'con')  return String(par.codigo_concello) === codigo;
    if (tipo === 'com')  return String(par.codigo_comarca)  === codigo;
    if (tipo === 'prov') return String(par.codigo_provincia)=== codigo;
    return false;
  };
}
async function buildMapeoFromParroquias(){
  let geo;
  try {
    const topo = await fetchJSON('assets/parroquias.topo.json');
    const name = (topo.objects && Object.keys(topo.objects)[0]) || 'parroquias';
    geo = (window.topojson) ? window.topojson.feature(topo, topo.objects[name]) : null;
  } catch {}
  if (!geo) geo = await fetchJSON('assets/parroquias.geojson');

  const byParroquia = new Map();
  const byConcelloFirstParroquia = new Map();
  for (const f of (geo.features||[])){
    const p = f.properties || {};
    const item = {
      id: String(p.CODPARRO),
      codigo_concello: String(p.CODCONC),
      codigo_comarca:  String(p.CODCOM),
      codigo_provincia:String(p.CODPROV),
      name: p.PARROQUIA,
      concello: p.CONCELLO,
      comarca: p.COMARCA,
      provincia: p.PROVINCIA
    };
    if (item.id) byParroquia.set(item.id, item);
    if (item.codigo_concello && !byConcelloFirstParroquia.has(item.codigo_concello)){
      byConcelloFirstParroquia.set(item.codigo_concello, item);
    }
  }
  return { byParroquia, byConcelloFirstParroquia };
}

/* ------------------- RENDER LISTAS ------------------- */
function sortPezas(rows, mode){
  if (mode === 'titulo_desc') return rows.slice().sort((a,b)=>esc(b.title).localeCompare(esc(a.title),'gl'));
  if (mode === 'ritmo_asc')  return rows.slice().sort((a,b)=>esc(a.ritmo).localeCompare(esc(b.ritmo),'gl'));
  // por defecto título asc
  return rows.slice().sort((a,b)=>esc(a.title).localeCompare(esc(b.title),'gl'));
}
function sortCoplas(rows, mode){
  const textOf = r => esc(r.texto||'').replace(/\s+/g,' ').trim();
  if (mode === 'alf_desc') return rows.slice().sort((a,b)=>textOf(b).localeCompare(textOf(a),'gl'));
  return rows.slice().sort((a,b)=>textOf(a).localeCompare(textOf(b),'gl'));
}

function renderPezas({ pezas, pertenceAoScope, pezasUL, scope, ritmo, pezasSort }){
  if (!pezasUL) return;
  let filtered = pezas.filter(p =>
    (!ritmo || p.ritmo === ritmo) &&
    pertenceAoScope(String(p.location), scope)
  );
  filtered = sortPezas(filtered, pezasSort || 'titulo_asc');
  renderList(pezasUL, filtered, (row) => `
    <li>
      <div>
        <div><strong>${escapeHtml(row.title || '')}</strong></div>
        <div class="tag">Ritmo: ${escapeHtml(row.ritmo || '')}</div>
        <div style="font-size:12px;color:var(--muted)">Localización: ${escapeHtml(String(row.location||''))}</div>
      </div>
      <div class="actions">
        <a href="templates/peza.html?id=${encodeURIComponent(row.id || '')}">Ver peza</a>
      </div>
    </li>
  `);
}

function renderCoplas({ coplas, pertenceAoScope, coplasUL, scope, q, etiqueta, coplasSort, onAdd }){
  if (!coplasUL) return;
  const qlc = (q || '').toLowerCase();
  let filtered = coplas.filter(c =>
    (!qlc || String(c.texto || '').toLowerCase().includes(qlc)) &&
    (!etiqueta || String(c.etiqueta||'') === etiqueta) &&
    pertenceAoScope(String(c.location), scope)
  );
  filtered = sortCoplas(filtered, coplasSort || 'alf_asc');

  renderList(coplasUL, filtered, (row) => `
    <li>
      <div>
        <div>${escapeHtml(String(row.texto || '')).replace(/\n/g,'<br>')}</div>
        <div style="font-size:12px;color:var(--muted)">Localización: ${escapeHtml(String(row.location||''))} ${row.etiqueta?`· <span class="tag">${escapeHtml(row.etiqueta)}</span>`:''}</div>
      </div>
      <div class="actions">
        <button class="tag" data-id="${escapeHtml(String(row.id||''))}">+ Engadir</button>
      </div>
    </li>
  `);

  coplasUL.onclick = (ev) => {
    const btn = ev.target.closest('button[data-id]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const item = filtered.find(x => String(x.id) === String(id));
    if (item && typeof onAdd === 'function') onAdd(item);
  };
}

/* ------------------- API ------------------- */
export function applyFiltersFromUI({ view, ritmo, q, etiqueta, pezasSort, coplasSort }){
  // devolvemos o paquete listo para filters:change
  return {
    view: view || 'mapa',
    scope: currentScope || '',
    ritmo: (ritmo||'').trim(),
    q: (q||'').trim(),
    etiqueta: (etiqueta||'').trim(),
    pezasSort: pezasSort || 'titulo_asc',
    coplasSort: coplasSort || 'alf_asc'
  };
}

export async function initBuscador({ pezasListId='pezas-list', coplasListId='coplas-list', cestaCountId='cesta-count', scopeChipId } = {}){
  const pezasUL  = document.getElementById(pezasListId);
  const coplasUL = document.getElementById(coplasListId);
  const cestaCount = document.getElementById(cestaCountId);

  // Autocomplete + scope chip
  attachAutocomplete({ inputId:'lugar', listId:'lugar-suxest', scopeChipId });
  showScopeChip(scopeChipId);

  // Datos
  const [mapeo, pezas, coplas] = await Promise.all([
    buildMapeoFromParroquias(),
    fetchJSON('assets/pezas.json'),
    fetchJSON('assets/coplas.json'),
  ]);
  const pertenceAoScope = pertenceAoScopeFactory(mapeo);

  // Cesta
  let cesta = getCesta();
  const updateCestaCount = () => { if (cestaCount) cestaCount.textContent = String(cesta.length); };
  updateCestaCount();

  // Render inicial
  renderPezas({ pezas, pertenceAoScope, pezasUL, scope: currentScope, ritmo:'', pezasSort:'titulo_asc' });
  renderCoplas({ coplas, pertenceAoScope, coplasUL, scope: currentScope, q:'', etiqueta:'', coplasSort:'alf_asc',
    onAdd: (item) => { cesta.push(item); setCesta(cesta); updateCestaCount(); }
  });

  // Filtros globais (contextuais)
  document.addEventListener('filters:change', (e) => {
    const { view='mapa', scope=currentScope, ritmo='', q='', etiqueta='', pezasSort='titulo_asc', coplasSort='alf_asc' } = e.detail||{};
    // manter currentScope sincronizado
    currentScope = scope || currentScope;
    showScopeChip(scopeChipId);

    if (view === 'pezas'){
      renderPezas({ pezas, pertenceAoScope, pezasUL, scope: currentScope, ritmo, pezasSort });
    } else if (view === 'coplas'){
      renderCoplas({ coplas, pertenceAoScope, coplasUL, scope: currentScope, q, etiqueta, coplasSort,
        onAdd: (item) => { cesta.push(item); setCesta(cesta); updateCestaCount(); }
      });
    }
    // no mapa non renderizamos aquí (mapa.js escoita filters:change para resaltar/zoom)
  });

  // Cambios de vista → refrescar listas coa configuración corrente
  document.addEventListener('ui:view-changed', (e) => {
    const view = e.detail?.view;
    if (view === 'pezas'){
      renderPezas({ pezas, pertenceAoScope, pezasUL, scope: currentScope, ritmo:'', pezasSort:'titulo_asc' });
    } else if (view === 'coplas'){
      renderCoplas({ coplas, pertenceAoScope, coplasUL, scope: currentScope, q:'', etiqueta:'', coplasSort:'alf_asc',
        onAdd: (item) => { cesta.push(item); setCesta(cesta); updateCestaCount(); }
      });
    }
  });

  // Botóns cesta
  document.getElementById('cesta-save')?.addEventListener('click', () => { setCesta(cesta); updateCestaCount(); alert('Cesta gardada.'); });
  document.getElementById('cesta-clear')?.addEventListener('click', () => { cesta=[]; setCesta(cesta); updateCestaCount(); });
  document.getElementById('cesta-pdf')?.addEventListener('click', () => { alert('PDF pendente (jsPDF).'); });
}