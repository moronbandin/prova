// js/mapa.js
// Contrato: initMapa({ mapContainerId }), onFiltersChange({ scope })
// Resumen:
// - Carga capas (prov/com/con/par) y datos (pezas/coplas).
// - Agrega contadores por nivel (par, con, com, prov).
// - Dibuja badges con el número de ítems (>0) en cada unidade visible.
// - Reacciona a: cambiar capa, cambiar "que contar", explorar aquí, zoom a scope, highlight candidatos.

let map;
let currentLayerType = 'par'; // prov | com | con | par
let currentScope = '';        // p.e. "con:15043"
let geoLayers = {};           // { prov: L.GeoJSON, com:..., con:..., par:... }
let badgeLayer = null;        // L.LayerGroup para chapas
let highlightLayer = null;    // para contornos destacados (candidatos buscador)
let dataReady = false;

const defaultStyle   = { color:'#444', weight:0.6, fillColor:'#2a7b9b', fillOpacity:0.05 };
const hoverStyle     = { fillColor:'#66d9e8', fillOpacity:0.35, weight:0.7 };
const highlightStyle = { color:'#f8c102', weight:1.2, fillColor:'#f8c102', fillOpacity:0.25 };

// Contadores precalculados
const counts = {
  par: new Map(), // CODPARRO -> { pezas, coplas }
  con: new Map(), // CODCONC  -> { pezas, coplas }
  com: new Map(), // CODCOM   -> { pezas, coplas }
  prov:new Map()  // CODPROV  -> { pezas, coplas }
};

// Índices jerárquicos desde parroquias (para agregación)
const jerarquia = {
  par2con: new Map(), // par -> concello
  par2com: new Map(), // par -> comarca
  par2prov:new Map()  // par -> provincia
};

export async function initMapa({ mapContainerId = 'map' } = {}) {
  if (!window.L) return console.warn('Leaflet non cargado.');
  if (map) return;

  // Mapa base
  map = L.map(mapContainerId, { preferCanvas: true }).setView([42.88, -8.54], 8);
  const baseMaps = {
    'Plano':  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }),
    'Físico': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri' }),
    'Toner':  L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/toner-lite/{z}/{x}/{y}.png', { attribution: '&copy; Stamen' }),
  };
  baseMaps['Plano'].addTo(map);
  L.control.layers(baseMaps).addTo(map);

  badgeLayer = L.layerGroup().addTo(map);
  highlightLayer = L.layerGroup().addTo(map);

  // Cargar capas admin
  const [prov, com, con, par] = await Promise.all([
    fetch('assets/provincias.geojson').then(r=>r.json()),
    fetch('assets/comarcas.geojson').then(r=>r.json()),
    fetch('assets/concellos.geojson').then(r=>r.json()),
    loadParroquiasGeo() // Topo->Geo si hay; si no, GeoJSON
  ]);

  geoLayers.prov = L.geoJSON(prov, layerOpts('prov')).addTo(map);
  geoLayers.com  = L.geoJSON(com,  layerOpts('com'));
  geoLayers.con  = L.geoJSON(con,  layerOpts('con'));
  geoLayers.par  = L.geoJSON(par,  layerOpts('par'));

  // Por defecto mostramos parroquias
  setVisibleLayer('par');

  // Construir jerarquía desde parroquias (para agregaciones)
  buildJerarquiaFromParroquias(par);

  // Cargar datos de pezas/coplas y precalcular count por nivel
  await precalcCounts();

  // Dibujar badges iniciales
  drawBadges();

  // UI: select capa y count-type
  const layerSel = document.getElementById('map-layer');
  layerSel?.addEventListener('change', () => {
    setVisibleLayer(layerSel.value);
    drawBadges();
  });
  const countSel = document.getElementById('count-type');
  countSel?.addEventListener('change', drawBadges);

  // Reacciones externas
  // - zoom a un ámbito (desde autocompletado)
  document.addEventListener('map:zoom-to-scope', (e) => {
    const scope = e.detail?.scope;
    if (!scope) return;
    currentScope = scope;
    zoomToScope(scope);
    // resalta coincidencias según scope
    applyScopeHighlight(scope);
  });

  // - candidatos de autocompletado (resaltar múltiples)
  document.addEventListener('map:highlight-candidates', (e) => {
    const scopes = e.detail?.scopes || [];
    highlightCandidates(scopes);
  });

  dataReady = true;
}

// Capas: estilo, eventos y popups
function layerOpts(type){
  return {
    style: defaultStyle,
    onEachFeature: (feature, layer) => {
      const p = feature.properties || {};
      layer.on('mouseover', () => layer.setStyle(hoverStyle));
      layer.on('mouseout',  () => layer.setStyle(defaultStyle));
      layer.on('click',     () => openInfoCard(type, p, layer));
    }
  };
}

function setVisibleLayer(type){
  currentLayerType = type;
  Object.entries(geoLayers).forEach(([k,layer]) => {
    if (!layer) return;
    if (map.hasLayer(layer)) map.removeLayer(layer);
  });
  if (geoLayers[type]) geoLayers[type].addTo(map);
  clearHighlight();
}

// Popup/tarjeta informativa por tipo + “Explorar aquí” / “Ver pezas…”
function openInfoCard(type, props, layer){
  const cmdExplore = `<button class="btn-explore" data-type="${type}" style="margin-right:8px">Explorar aquí</button>`;
  const cmdPezas   = `<button class="btn-pezas" data-type="${type}">Ver pezas deste ámbito</button>`;

  const html = (() => {
    if (type === 'prov') {
      return `
        <div><strong>Provincia:</strong> ${safe(props.PROVINCIA)}</div>
        ${cmdExplore} ${cmdPezas}
      `;
    }
    if (type === 'com') {
      // necesita mostrar provincia
      return `
        <div><strong>Comarca:</strong> ${safe(props.COMARCA)}</div>
        <div><span class="muted">Provincia:</span> ${safe(props.PROVINCIA || '?')}</div>
        ${cmdExplore} ${cmdPezas}
      `;
    }
    if (type === 'con') {
      // mostrar comarca e provincia
      return `
        <div><strong>Concello:</strong> ${safe(props.CONCELLO)}</div>
        <div><span class="muted">Comarca:</span> ${safe(props.COMARCA || '?')}</div>
        <div><span class="muted">Provincia:</span> ${safe(props.PROVINCIA || '?')}</div>
        ${cmdExplore} ${cmdPezas}
      `;
    }
    // parroquia: mostrar concello, comarca, provincia
    return `
      <div><strong>Parroquia:</strong> ${safe(props.PARROQUIA)}</div>
      <div><span class="muted">Concello:</span> ${safe(props.CONCELLO || '?')}</div>
      <div><span class="muted">Comarca:</span> ${safe(props.COMARCA || '?')}</div>
      <div><span class="muted">Provincia:</span> ${safe(props.PROVINCIA || '?')}</div>
      ${cmdPezas}
    `;
  })();

  const popup = L.popup({ closeButton: true, autoPan: true })
    .setLatLng(getCenterOfLayer(layer))
    .setContent(html)
    .openOn(map);

  // delegación de eventos
  setTimeout(() => {
    const el = popup.getElement();
    el?.querySelector('.btn-explore')?.addEventListener('click', () => {
      // bajar un nivel salvo parroquia
      if (type === 'prov') setVisibleLayer('com');
      else if (type === 'com') setVisibleLayer('con');
      else if (type === 'con') setVisibleLayer('par');
      drawBadges();
      // zoom al ámbito seleccionado (para que se vean subdivisiones)
      const scope = makeScope(type, props);
      if (scope) {
        currentScope = scope;
        zoomToScope(scope);
        applyScopeHighlight(scope);
      }
      map.closePopup();
    });
    el?.querySelector('.btn-pezas')?.addEventListener('click', () => {
      const scope = makeScope(type, props);
      if (scope) {
        currentScope = scope;
        document.dispatchEvent(new CustomEvent('filters:change', { detail: { scope, view:'pezas' }}));
        document.dispatchEvent(new CustomEvent('ui:switch-view', { detail: { view:'pezas' }}));
      }
      map.closePopup();
    });
  }, 0);
}

function makeScope(type, p){
  if (type === 'prov') return `prov:${p.CODPROV}`;
  if (type === 'com')  return `com:${p.CODCOM}`;
  if (type === 'con')  return `con:${p.CODCONC}`;
  if (type === 'par')  return `par:${p.CODPARRO}`;
  return '';
}

// --------- Badges (recuentos) ---------
function drawBadges(){
  if (!badgeLayer) return;
  badgeLayer.clearLayers();
  const countType = document.getElementById('count-type')?.value || 'pezas';

  const layer = geoLayers[currentLayerType];
  if (!layer) return;

  layer.eachLayer((featLayer) => {
    const p = featLayer.feature?.properties || {};
    const key = (currentLayerType === 'prov') ? String(p.CODPROV)
              : (currentLayerType === 'com')  ? String(p.CODCOM)
              : (currentLayerType === 'con')  ? String(p.CODCONC)
              :                                  String(p.CODPARRO);

    const c = (counts[currentLayerType].get(key)) || { pezas:0, coplas:0 };
    const n = (countType === 'pezas') ? c.pezas
            : (countType === 'coplas') ? c.coplas
            : (c.pezas + c.coplas);

    if (n > 0) {
      const center = getCenterOfLayer(featLayer);
      const icon = L.divIcon({
        className: 'count-badge',
        html: `<span class="bubble" title="${n}">${n}</span>`,
        iconSize: [1,1], // el tamaño lo da el contenido
        iconAnchor: [0,0]
      });
      L.marker(center, { icon }).addTo(badgeLayer);
    }
  });
}

// --------- Datos: precálculo de contadores ---------
async function precalcCounts(){
  // cargamos pezas/coplas
  const [pezas, coplas] = await Promise.all([
    fetch('assets/pezas.json').then(r=>r.json()).catch(()=>[]),
    fetch('assets/coplas.json').then(r=>r.json()).catch(()=>[])
  ]);

  // Normalizar location a string
  for (const p of pezas)  p.location = String(p.location||'');
  for (const c of coplas) c.location = String(c.location||'');

  // 1) Recuento por parroquia (si la peza/copla trae parroquia o concello)
  // - Si location coincide con CODPARRO, suma en par
  // - Si trae CODCONC, reparte a través de una parroquia-cualquiera de ese concello (agregación jerárquica)
  const byPar = counts.par; // Map<String,{pezas,coplas}>
  const byCon = counts.con;
  const byCom = counts.com;
  const byProv= counts.prov;

  function addToMaps(loc, delta){
    // loc puede ser parroquia (preferente) o concello
    let parCode = loc;
    if (!jerarquia.par2con.has(loc)) {
      // ¿es concello? coger una parroquia representativa
      const representativePar = anyParroquiaOfConcello(loc);
      if (representativePar) parCode = representativePar;
      else return; // no sabemos mapear
    }
    // sumar a parroquia
    const conCode  = jerarquia.par2con.get(parCode);
    const comCode  = jerarquia.par2com.get(parCode);
    const provCode = jerarquia.par2prov.get(parCode);

    inc(byPar,  parCode,  delta);
    inc(byCon,  conCode,  delta);
    inc(byCom,  comCode,  delta);
    inc(byProv, provCode, delta);
  }

  // pezas
  for (const p of pezas) addToMaps(p.location, { pezas:1, coplas:0 });
  // coplas
  for (const c of coplas) addToMaps(c.location, { pezas:0, coplas:1 });
}

function inc(map, key, delta){
  if (!key) return;
  const cur = map.get(String(key)) || { pezas:0, coplas:0 };
  map.set(String(key), { pezas: cur.pezas + (delta.pezas||0), coplas: cur.coplas + (delta.coplas||0) });
}

// --------- Jerarquía desde parroquias ---------
function buildJerarquiaFromParroquias(parGeo){
  jerarquia.par2con.clear();
  jerarquia.par2com.clear();
  jerarquia.par2prov.clear();

  // También construiremos un índice concello -> un conjunto de parroquias
  _con2pars.clear();

  for (const f of (parGeo.features||[])) {
    const p = f.properties || {};
    const par  = String(p.CODPARRO);
    const con  = String(p.CODCONC);
    const com  = String(p.CODCOM);
    const prov = String(p.CODPROV);

    jerarquia.par2con.set(par, con);
    jerarquia.par2com.set(par, com);
    jerarquia.par2prov.set(par, prov);

    if (!_con2pars.has(con)) _con2pars.set(con, new Set());
    _con2pars.get(con).add(par);
  }
}
const _con2pars = new Map(); // concello -> Set<parroquias>
function anyParroquiaOfConcello(concelloCode){
  const s = _con2pars.get(String(concelloCode));
  if (!s || s.size === 0) return null;
  // devolver cualquiera (primera)
  for (const par of s) return par;
  return null;
}

// --------- Scope / highlight / zoom ---------
export function onFiltersChange({ scope }){
  if (!scope) { clearHighlight(); return; }
  currentScope = scope;
  applyScopeHighlight(scope);
}

function applyScopeHighlight(scope){
  clearHighlight();
  const [tipo, code] = String(scope).split(':'); // prov|com|con|par
  const layer = geoLayers[layerTypeForScope(tipo)];
  if (!layer) return;

  const bounds = [];
  layer.eachLayer((l) => {
    const p = l.feature?.properties || {};
    const hit = (tipo==='prov' && String(p.CODPROV)===code) ||
                (tipo==='com'  && String(p.CODCOM) ===code) ||
                (tipo==='con'  && String(p.CODCONC)===code) ||
                (tipo==='par'  && String(p.CODPARRO)===code);
    if (hit){
      bounds.push(l.getBounds ? l.getBounds() : null);
      // delinear
      const geom = l.toGeoJSON();
      L.geoJSON(geom, { style: highlightStyle }).addTo(highlightLayer);
    }
  });
  if (bounds.length){
    const g = bounds.filter(Boolean).reduce((acc,b)=> acc?acc.extend(b):b);
    if (g) map.fitBounds(g.pad(0.2));
  }
}

function highlightCandidates(scopes){
  clearHighlight();
  const outlines = [];

  for (const scope of scopes){
    const [tipo, code] = String(scope).split(':');
    const layer = geoLayers[layerTypeForScope(tipo)];
    if (!layer) continue;

    layer.eachLayer((l) => {
      const p = l.feature?.properties || {};
      const hit = (tipo==='prov' && String(p.CODPROV)===code) ||
                  (tipo==='com'  && String(p.CODCOM) ===code) ||
                  (tipo==='con'  && String(p.CODCONC)===code) ||
                  (tipo==='par'  && String(p.CODPARRO)===code);
      if (hit){
        outlines.push(l.getBounds ? l.getBounds() : null);
        const geom = l.toGeoJSON();
        L.geoJSON(geom, { style: highlightStyle }).addTo(highlightLayer);
      }
    });
  }

  if (outlines.length){
    const g = outlines.filter(Boolean).reduce((acc,b)=> acc?acc.extend(b):b);
    if (g) map.fitBounds(g.pad(0.2));
  }
}

function clearHighlight(){
  highlightLayer?.clearLayers();
}

function zoomToScope(scope){
  const [tipo, code] = String(scope).split(':');
  // Cambiar a la capa adecuada para que el usuario vea lo que está enfocando
  setVisibleLayer(layerTypeForScope(tipo));

  const layer = geoLayers[layerTypeForScope(tipo)];
  if (!layer) return;

  let bbox = null;
  layer.eachLayer((l) => {
    const p = l.feature?.properties || {};
    const hit = (tipo==='prov' && String(p.CODPROV)===code) ||
                (tipo==='com'  && String(p.CODCOM) ===code) ||
                (tipo==='con'  && String(p.CODCONC)===code) ||
                (tipo==='par'  && String(p.CODPARRO)===code);
    if (hit && l.getBounds){
      bbox = bbox ? bbox.extend(l.getBounds()) : l.getBounds();
    }
  });
  if (bbox) map.fitBounds(bbox.pad(0.2));
  drawBadges(); // asegurar que hay chapas en la vista actual
}

function layerTypeForScope(tipo){
  if (tipo === 'prov') return 'prov';
  if (tipo === 'com')  return 'com';
  if (tipo === 'con')  return 'con';
  return 'par';
}

// --------- Helpers ---------
async function loadParroquiasGeo(){
  try {
    const topo = await fetch('assets/parroquias.topo.json').then(r=>r.json());
    const name = (topo.objects && Object.keys(topo.objects)[0]) || 'parroquias';
    return window.topojson ? window.topojson.feature(topo, topo.objects[name]) : topo; // si no hay topojson, devolvemos tal cual (no ideal)
  } catch {
    return fetch('assets/parroquias.geojson').then(r=>r.json());
  }
}

function getCenterOfLayer(layer){
  if (layer.getBounds) return layer.getBounds().getCenter();
  const gj = layer.toGeoJSON();
  // fallback muy básico
  if (gj.geometry && gj.geometry.type === 'Point'){
    return L.latLng(gj.geometry.coordinates[1], gj.geometry.coordinates[0]);
  }
  return map.getCenter();
}

function safe(v){ return (v==null?'':String(v)).replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s])); }