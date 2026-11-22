(() => {
  'use strict';
  const BLUE = '#326c86', RED = '#bd4a37', MUTED = '#78827b', GOLD = '#cf9b3c';
  const MARGIN_STOPS = ['#bd4a37', '#f3f0e8', '#326c86'];
  const DEMO_STOPS = ['#f5e9ca', '#d3b66f', '#79907b', '#326c86', '#273e59'];
  const METRICS = {
    margin:{name:'Presidential margin (D − R)',unit:'pts',index:null},
    white:{name:'White, non-Hispanic',unit:'%',index:1},
    black:{name:'Black, non-Hispanic',unit:'%',index:2},
    hisp:{name:'Hispanic',unit:'%',index:3},
    asian:{name:'Asian, non-Hispanic',unit:'%',index:4},
    old:{name:'Age 65+',unit:'%',index:5},
    pop:{name:'Population',unit:'people',index:0}
  };
  const OFFICE = {president:'Presidential', senate:'U.S. Senate', governor:'Gubernatorial'};
  const mapViews = new Map();
  const mapCounties = new Map();
  const svgNS = 'http://www.w3.org/2000/svg';
  let activeCounty = null;
  let brushedCounties = new Set();
  let suppressMapClick = false;
  let suppressScatterClick = false;
  let mapBrushDragging = false;
  let exploreYear = 2024;
  let countyElectionYears=[];
  let mapMetric = 'margin';
  let scatterMetric = 'black';
  let resizeObserver;
  let yearTimer=null;
  const LINKED_CHARTS=['story-lean','story-senate','story-gov'];
  const linkedYearSets=new Map();
  const linkedBaseShapes=new Map();
  let pinnedStoryYear=null, hoveredStoryYear=null;
  let paintedStoryYear=null;
  let storyYearPaintToken=0;
  const noData='No election in this dataset for this year.';
  const tooltip = document.getElementById('county-tooltip');

  function applyPlotTheme(dark) {
    const color=dark?'#e5eee7':'#58645e';
    const grid=dark?'#40524b':'#ddd9ce';
    const hoverBg=dark?'#15201d':'#1d2a27';
    for (const id of ['story-tiles','story-lean','story-senate','story-gov']) {
      const el=document.getElementById(id);
      if (!el?.layout || !window.Plotly) continue;
      const changes={
        'font.color':color,
        'xaxis.tickfont.color':color,
        'xaxis.title.font.color':color,
        'yaxis.tickfont.color':color,
        'yaxis.title.font.color':color,
        'yaxis.gridcolor':grid,
        'hoverlabel.bgcolor':hoverBg,
        'hoverlabel.font.color':'#f6f1e8',
        'legend.font.color':color
      };
      if(el.layout.annotations?.length) {
        changes.annotations=el.layout.annotations.map(a=>({
          ...a,
          font:{...a.font,color:(a.font?.color==='#1e2927'||a.font?.color==='#58645e')?color:(a.font?.color||color)}
        }));
      }
      Plotly.relayout(el,changes).catch(()=>{});
    }
  }
  function setupThemeToggle() {
    const button=document.getElementById('theme-toggle');
    if(!button)return;
    let dark=false;
    try{dark=localStorage.getItem('ga-theme')==='dark';}catch(_){}
    const apply=()=>{
      document.body.classList.toggle('dark-mode',dark);
      button.textContent=dark?'☀ Light mode':'☾ Dark mode';
      button.setAttribute('aria-pressed',String(dark));
      document.documentElement.style.colorScheme=dark?'dark':'light';
      applyPlotTheme(dark);
    };
    button.addEventListener('click',()=>{
      dark=!dark;
      try{localStorage.setItem('ga-theme',dark?'dark':'light');}catch(_){}
      apply();
    });
    apply();
    // Plotly.react renders charts asynchronously after init; sync their colors once ready.
    for(const id of ['story-tiles','story-lean','story-senate','story-gov']) {
      const el=document.getElementById(id);
      if(el?.then)el.then(()=>applyPlotTheme(dark));
    }
  }
  function init() {
    if (!window.GA || !window.GEO || !window.Plotly) {
      document.getElementById('load-error').hidden = false;
      return;
    }
    const countyYears = Object.keys(GA.county).map(Number).sort((a,b)=>a-b);
    countyElectionYears=countyYears;
    if (!countyYears.length) { document.getElementById('load-error').hidden = false; return; }
    const features = GEO.features;
    features.forEach(f => mapCounties.set(String(f.id), `${f.properties.NAME} County`));
    const project = makeProjection(features);
    ['hero-map','story-map','explore-map'].forEach(id => createMap(id, features, project));
    renderHeroMap();
    setupNarrative();
    setupExplore(countyYears);
    renderStoryMap(1964, 'margin');
    renderExploreMap();
    renderStoryPlots();
    setupMilestones();
    setupLinkedYears();
    updateStoryFacts();
    renderExploreCharts();
    setupThemeToggle();
    bindResize();
    window.addEventListener('resize', resizeCharts, {passive:true});
  }

  function makeProjection(features) {
    const cos = Math.cos(33 * Math.PI / 180), points = [];
    function collect(coords) {
      if (typeof coords[0] === 'number') points.push([coords[0] * cos, -coords[1]]);
      else coords.forEach(collect);
    }
    features.forEach(f => collect(f.geometry.coordinates));
    const xs=points.map(p=>p[0]), ys=points.map(p=>p[1]);
    const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
    const scale=Math.min(510/(maxX-minX),418/(maxY-minY));
    const ox=14+(510-(maxX-minX)*scale)/2, oy=18+(418-(maxY-minY)*scale)/2;
    return ([lon,lat]) => [ox+(lon*cos-minX)*scale, oy+(-lat-minY)*scale];
  }
  function pathFor(geometry, project) {
    const polygons=geometry.type==='MultiPolygon'?geometry.coordinates:[geometry.coordinates];
    return polygons.flatMap(poly=>poly.map(ring=>ring.map((pt,i)=>{
      const [x,y]=project(pt); return `${i?'L':'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ')+' Z')).join(' ');
  }
  function svgEl(name, attrs={}) {
    const el=document.createElementNS(svgNS,name);
    Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,String(v)));
    return el;
  }
  function createMap(containerId, features, project) {
    const container=document.getElementById(containerId);
    if (!container) return;
    const svg=svgEl('svg',{viewBox:'0 0 540 455',preserveAspectRatio:'xMidYMid meet',role:'group','aria-label':'Georgia county map','focusable':'false'});
    const paths=new Map();
    const brushable=containerId==='explore-map';
    features.forEach(f=>{
      const id=String(f.id), county=mapCounties.get(id);
      const p=svgEl('path',{d:pathFor(f.geometry,project),class:'county','data-county':id,'fill-rule':'evenodd',tabindex:'0',role:'img','aria-label':county});
      p.addEventListener('pointerenter',ev=>{
        if(brushable&&mapBrushDragging) return;
        setHighlight(id);showCountyTip(containerId,id,ev);
      });
      p.addEventListener('pointermove',ev=>{
        if(brushable&&mapBrushDragging){hideTip();return;}
        showCountyTip(containerId,id,ev);
      });
      p.addEventListener('pointerleave',()=>{if(document.activeElement!==p){setHighlight(null);hideTip();}});
      p.addEventListener('focus',()=>{
        if(brushable&&mapBrushDragging) return;
        setHighlight(id);showCountyTip(containerId,id,null);
      });
      p.addEventListener('blur',()=>{setHighlight(null);hideTip();});
      p.addEventListener('keydown',ev=>{
        if(ev.key==='Escape'){p.blur();hideTip();if(brushable&&brushedCounties.size)clearBrush();}
        if(brushable&&(ev.key==='Enter'||ev.key===' ')){ev.preventDefault();toggleBrushedCounty(id);}
      });
      if(brushable) p.addEventListener('click',ev=>{
        if(suppressMapClick){ev.preventDefault();ev.stopPropagation();return;}
        toggleBrushedCounty(id);
      });
      svg.appendChild(p); paths.set(id,p);
    });
    container.replaceChildren(svg);
    const view={container,svg,paths,values:{},kind:'margin',year:2024,demographicYear:null};
    mapViews.set(containerId,view);
    if(brushable) enableMapBoxBrush(view);
  }
  function svgEventPoint(svg, ev){
    const pt=svg.createSVGPoint();
    pt.x=ev.clientX; pt.y=ev.clientY;
    const ctm=svg.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : {x:0,y:0};
  }
  // Select only counties whose full shape fits inside the box (bbox containment ⇒ geometry containment).
  function countiesEnclosedByBox(view, x0, y0, x1, y1){
    const left=Math.min(x0,x1), right=Math.max(x0,x1), top=Math.min(y0,y1), bottom=Math.max(y0,y1);
    const selected=[];
    view.paths.forEach((p,id)=>{
      const b=p.getBBox();
      if(b.x>=left && b.y>=top && b.x+b.width<=right && b.y+b.height<=bottom) selected.push(id);
    });
    return selected;
  }
  function enableMapBoxBrush(view){
    const svg=view.svg;
    svg.classList.add('map-brushable');
    const rubber=svgEl('rect',{class:'map-brush-rect',fill:'rgba(207,155,60,.22)',stroke:'#cf9b3c','stroke-width':'1.5','pointer-events':'none',visibility:'hidden'});
    svg.appendChild(rubber);
    let dragging=false, moved=false, start=null, pointerId=null;
    svg.addEventListener('pointerdown',ev=>{
      if(ev.button!==0) return;
      // Delay setPointerCapture until a real drag so county clicks still fire once.
      dragging=true; moved=false; start=svgEventPoint(svg,ev); pointerId=ev.pointerId;
      mapBrushDragging=true;
      hideTip();
      setHighlight(null);
    });
    svg.addEventListener('pointermove',ev=>{
      if(!dragging||!start) return;
      hideTip();
      const cur=svgEventPoint(svg,ev);
      if(!moved && Math.hypot(cur.x-start.x,cur.y-start.y)<5) return;
      if(!moved){
        moved=true;
        try{svg.setPointerCapture(pointerId??ev.pointerId);}catch(_){/* Capture optional. */}
      }
      const x=Math.min(start.x,cur.x), y=Math.min(start.y,cur.y);
      rubber.setAttribute('x',x); rubber.setAttribute('y',y);
      rubber.setAttribute('width',Math.abs(cur.x-start.x)); rubber.setAttribute('height',Math.abs(cur.y-start.y));
      rubber.setAttribute('visibility','visible');
      setHighlight(null);
    });
    const endDrag=ev=>{
      if(!dragging) return;
      dragging=false;
      mapBrushDragging=false;
      try{svg.releasePointerCapture(ev.pointerId);}catch(_){/* Capture optional. */}
      rubber.setAttribute('visibility','hidden');
      hideTip();
      setHighlight(null);
      if(!moved){
        // Plain click: path click listener toggles selection (no capture was taken).
        start=null; pointerId=null; moved=false;
        return;
      }
      suppressMapClick=true;
      window.setTimeout(()=>{suppressMapClick=false;},0);
      const cur=svgEventPoint(svg,ev);
      const ids=countiesEnclosedByBox(view,start.x,start.y,cur.x,cur.y);
      if(ev.shiftKey){
        ids.forEach(id=>brushedCounties.add(id));
        applyBrush();
      } else {
        setBrushedCounties(ids);
      }
      start=null; pointerId=null; moved=false;
    };
    svg.addEventListener('pointerup',endDrag);
    svg.addEventListener('pointercancel',endDrag);
  }
  function setHighlight(id, source='map') {
    activeCounty=id;
    mapViews.forEach(view=>view.paths.forEach((p,cid)=>p.classList.toggle('is-highlighted',id!==null&&cid===id)));
    const focus=document.getElementById('rail-focus');
    if(focus) focus.innerHTML=id?`<span class="focus-dot"></span><span>${escapeHTML(mapCounties.get(id)||'County')} selected · linked views highlighted.</span>`:'<span class="focus-dot"></span><span>Hover or focus a county to inspect its margin.</span>';
    // Persistent brush owns scatter selectedpoints; hover only previews when nothing is brushed.
    if(brushedCounties.size) return;
    const scatter=document.getElementById('county-scatter');
    if(!(source==='scatter'&&id!==null)&&scatter?.data?.[0]?.customdata){
      const index=id?scatter.data[0].customdata.findIndex(v=>String(v)===id):-1;
      try{Plotly.restyle(scatter,{selectedpoints:[index>=0?[index]:null]});}catch(_){/* Scatter may not have rendered yet. */}
    }
  }
  function toggleBrushedCounty(id){
    id=String(id);
    if(brushedCounties.has(id)) brushedCounties.delete(id);
    else brushedCounties.add(id);
    applyBrush();
    // Drop temporary hover/focus outlines so only gold selection strokes remain.
    setHighlight(null);
    hideTip();
    const path=mapViews.get('explore-map')?.paths.get(id);
    if(path&&document.activeElement===path) path.blur();
  }
  function setBrushedCounties(ids){
    brushedCounties=new Set((ids||[]).map(String).filter(Boolean));
    applyBrush();
  }
  function clearScatterSelectionUI(){
    const scatter=document.getElementById('county-scatter');
    if(!scatter?.layout) return;
    // Plotly stores the persistent box in layout.selections; clearing it also drops outline handles.
    try{Plotly.relayout(scatter,{selections:[]});}catch(_){/* Scatter may not have rendered yet. */}
    scatter.querySelectorAll('.select-outline,.outline-controllers').forEach(el=>el.remove());
  }
  function clearBrush(){
    brushedCounties.clear();
    clearScatterSelectionUI();
    applyBrush();
  }
  function applyBrush(){
    const brushing=brushedCounties.size>0;
    const explore=mapViews.get('explore-map');
    if(explore){
      explore.paths.forEach((p,cid)=>{
        p.classList.toggle('is-brushed',brushing&&brushedCounties.has(cid));
        p.classList.toggle('is-dimmed',brushing&&!brushedCounties.has(cid));
      });
    }
    const scatter=document.getElementById('county-scatter');
    if(scatter?.data?.[0]?.customdata){
      const ids=scatter.data[0].customdata.map(String);
      const indexes=brushing?ids.reduce((acc,id,i)=>{if(brushedCounties.has(id))acc.push(i);return acc;},[]):null;
      try{
        if(!brushing){
          clearScatterSelectionUI();
          Plotly.restyle(scatter,{selectedpoints:[null]});
        } else {
          Plotly.restyle(scatter,{selectedpoints:[indexes]});
        }
      }catch(_){/* Scatter may not have rendered yet. */}
    }
    const status=document.getElementById('brush-status');
    const clearBtn=document.getElementById('brush-clear');
    const toolbar=document.getElementById('brush-toolbar');
    if(toolbar) toolbar.classList.toggle('has-selection',brushing);
    if(status){
      if(!brushing) status.textContent='No counties selected. Drag a box on the map or scatterplot to select counties in both views. Click a county in either view to add or remove it. Hold Shift while boxing to add to the current selection.';
      else {
        const names=[...brushedCounties].slice(0,3).map(id=>mapCounties.get(id)||id);
        const extra=brushedCounties.size>3?` and ${brushedCounties.size-3} more`:'';
        status.textContent=`${brushedCounties.size} count${brushedCounties.size===1?'y':'ies'} selected${names.length?` (${names.join(', ')}${extra})`:''} — linked on both the map and the scatterplot.`;
      }
    }
    if(clearBtn) clearBtn.hidden=!brushing;
  }
  function escapeHTML(s){return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  function showCountyTip(viewId,id,ev) {
    if(viewId==='explore-map'&&mapBrushDragging){hideTip();return;}
    const view=mapViews.get(viewId), county=mapCounties.get(id)||'County';
    const year=view.year||exploreYear, record=GA.county[String(year)]?.[id];
    let text=county;
    if(view.kind==='swing') {
      const c0=GA.county['1960']?.[id],c1=GA.county['1964']?.[id];
      if(c0&&c1){const m0=margin(c0),m1=margin(c1),diff=m1-m0;text+=`\n1960: ${fmtSigned(m0)} pts · 1964: ${fmtSigned(m1)} pts\nChange in D−R margin: ${fmtSigned(diff)} pts`+(diff<0?' toward Republicans':' toward Democrats');}
    } else if(view.kind==='demo') {
      const arr=GA.demo[String(view.demographicYear)]?.[id],metric=METRICS[view.metric];
      if(arr&&metric)text+=`\n${view.demographicYear} ${metric.name}: ${metric.index===0?Math.round(arr[0]).toLocaleString():Number(arr[metric.index]).toFixed(1)+'%'}`;
      if(record)text+=`\n${year} presidential margin: ${fmtSigned(margin(record))} pts`;
    } else if(record) {
      text+=`\n${year} presidential margin: ${fmtSigned(margin(record))} points (D − R)\nDemocratic votes: ${record[0].toLocaleString()} · Republican votes: ${record[1].toLocaleString()}`;
      if(viewId==='story-map'&&GA.county['1960']?.[id]&&year===1964){const delta=margin(record)-margin(GA.county['1960'][id]);text+=`\nChange since 1960: ${fmtSigned(delta)} pts`;}
    }
    tooltip.textContent=text; tooltip.hidden=false;
    const rect=view.container.getBoundingClientRect();
    let x=ev?ev.clientX+12:rect.left+rect.width*.53, y=ev?ev.clientY+12:rect.top+rect.height*.35;
    const width=tooltip.offsetWidth||220,height=tooltip.offsetHeight||70;
    x=Math.max(8,Math.min(x,window.innerWidth-width-8));y=Math.max(8,Math.min(y,window.innerHeight-height-8));
    tooltip.style.left=`${x}px`;tooltip.style.top=`${y}px`;
  }
  function hideTip(){tooltip.hidden=true;}
  function margin(countyRecord){return 100*(countyRecord[0]-countyRecord[1])/countyRecord[2];}
  function fmtSigned(n){return `${n>0?'+':''}${n.toFixed(1)}`;}
  function colorMix(hexA,hexB,t) {
    t=Math.max(0,Math.min(1,t));
    const a=hexA.slice(1),b=hexB.slice(1);
    return '#'+[0,2,4].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
  }
  function interpolate(stops,t) {
    t=Math.max(0,Math.min(1,t));const f=t*(stops.length-1),i=Math.min(stops.length-2,Math.floor(f));
    return colorMix(stops[i],stops[i+1],f-i);
  }
  function marginColor(v,range=80){return v<0?colorMix(MARGIN_STOPS[0],MARGIN_STOPS[1],(v+range)/range):colorMix(MARGIN_STOPS[1],MARGIN_STOPS[2],v/range);}
  function renderHeroMap(){
    const view=mapViews.get('hero-map'),countyData=GA.county['1964']||{};
    if(!view)return;
    view.kind='margin';view.year=1964;view.svg.setAttribute('aria-label','Georgia county presidential margins, 1964');
    view.paths.forEach((p,id)=>{
      const value=countyData[id]?margin(countyData[id]):0;
      view.values[id]=value;p.setAttribute('fill',marginColor(value));
      p.setAttribute('aria-label',`${mapCounties.get(id)}. Presidential margin, 1964: ${fmtSigned(value)} points (Democratic minus Republican).`);
    });
    const race=GA.president.find(r=>r.year===1964);
    if(race){const share=100*race.R/(race.D+race.R);document.querySelector('.hero-art-bottom strong').textContent=`${share.toFixed(1)}%`;}
  }
  function renderStoryMap(year, mode='margin') {
    const yearLabel = document.getElementById("story-map-year");

    if (yearLabel) {
      yearLabel.textContent =
        mode === "swing" ? "1960–1964" : String(year);
    }
    const countyData=GA.county[String(year)]||{};
    const story=mapViews.get('story-map');
    const v=story;
    if(v){
      v.kind=mode;v.year=year;v.values={};v.svg.setAttribute('aria-label',mode==='swing'?'Georgia county changes in presidential margin, 1960 to 1964':`Georgia county presidential margin, ${year}`);
      v.paths.forEach((p,id)=>{
        const row=countyData[id];let value=row?margin(row):0;
        if(mode==='swing'){
          const old=GA.county['1960']?.[id],latest=GA.county['1964']?.[id];
          value=old&&latest?margin(latest)-margin(old):0;
        }
        v.values[id]=value;p.setAttribute('fill',marginColor(value));
        p.setAttribute('aria-label',`${mapCounties.get(id)}. ${mode==='swing'?'Change in presidential margin, 1960 to 1964':'Presidential margin, '+year}: ${fmtSigned(value)} points (Democratic minus Republican).`);
      });
    }
    if(mode==='swing'){
      document.getElementById('rail-title').textContent='A county-by-county swing';
      document.getElementById('rail-caption').textContent='Change in county presidential margin, 1960 → 1964. Negative values indicate movement toward Republicans; positive values toward Democrats.';
      document.getElementById('story-legend').innerHTML='<span>Toward Republican</span><i class="legend-gradient"></i><span>Toward Democratic</span>';
      document.querySelector('.visual-rail .map-scale').innerHTML='<span>−80 pts</span><span>Change in D − R margin</span><span>+80 pts</span>';
    } else {
      const titles={1960:'The Democratic baseline',1964:'The first break',1980:'The Senate follows',2000:'The governor race approaches',2024:'The latest presidential map'};
      document.getElementById('rail-title').textContent=titles[year]||'Presidential county margin';
      document.getElementById('rail-caption').textContent=`Presidential county margins, ${year}. Blue indicates a Democratic lead; red indicates a Republican lead.`+(year===1980?' This is presidential context—not county-level Senate results.':'');
      document.getElementById('story-legend').innerHTML='<span>Republican lead</span><i class="legend-gradient"></i><span>Democratic lead</span>';
      document.querySelector('.visual-rail .map-scale').innerHTML='<span>−80 pts</span><span>Margin (D − R)</span><span>+80 pts</span>';
    }
  }
  function renderExploreMap() {
    const view=mapViews.get('explore-map'); if(!view)return;
    const year=exploreYear, metric=mapMetric, metricInfo=METRICS[metric], row=GA.county[String(year)]||{};
    view.year=year;view.metric=metric;view.kind=metric==='margin'?'margin':'demo';view.values={};
    let demoYear=null, values=[];
    if(metric!=='margin'){
      const ys=Object.keys(GA.demo).map(Number);demoYear=ys.reduce((a,b)=>Math.abs(b-year)<Math.abs(a-year)?b:a);
      view.demographicYear=demoYear;
      values=Object.keys(GA.demo[String(demoYear)]||{}).map(id=>GA.demo[String(demoYear)][id][metricInfo.index]).filter(Number.isFinite);
    }
    view.svg.setAttribute('aria-label',`Georgia county map: ${metricInfo.name}, ${metric==='margin'?year:demoYear}`);
    let min=0,max=metric==='margin'?80:Math.max(...values);
    if(metric!=='margin'&&metric!=='pop') max=Math.max(5,Math.ceil(max/5)*5);
    if(metric==='pop')max=Math.ceil(max/100000)*100000;
    view.paths.forEach((p,id)=>{
      let v=0,fill;
      if(metric==='margin'){
        if(row[id])v=margin(row[id]);fill=marginColor(v);
      } else {
        const sample=GA.demo[String(demoYear)]?.[id];v=sample?sample[metricInfo.index]:0;
        fill=interpolate(DEMO_STOPS,max? v/max:0);
      }
      view.values[id]=v;p.setAttribute('fill',fill);
      p.setAttribute('aria-label',`${mapCounties.get(id)}. ${metricInfo.name}, ${metric==='margin'?year:demoYear}: ${metric==='margin'?fmtSigned(v)+' points':metric==='pop'?Math.round(v).toLocaleString():Number(v).toFixed(1)+' percent'}.`);
    });
    const title=metric==='margin'?`Presidential margin · ${year}`:`${metricInfo.name} · ${demoYear}`;
    document.getElementById('explore-map-title').textContent=title;
    document.getElementById('explore-map-caption').textContent=metric==='margin'?`Margin is calculated as Democratic votes minus Republican votes, divided by total votes, for ${year}. Drag a box to select counties fully inside it; click to add or remove one. Selection is linked with the scatterplot.`:`Nearest demographic snapshot: ${demoYear}${year<2000?' (earliest available)':''}. The map and election year refer to different datasets. Drag a box or click counties to link a selection with the scatterplot.`;
    document.getElementById('explore-low').textContent=metric==='margin'?'Republican lead':`Lower ${metricInfo.unit==='people'?'population':'share'}`;
    document.getElementById('explore-high').textContent=metric==='margin'?'Democratic lead':`Higher ${metricInfo.unit==='people'?'population':'share'}`;
    const grad=document.getElementById('explore-gradient');grad.style.background=metric==='margin'?'linear-gradient(90deg,#bd4a37,#f3f0e8,#326c86)':`linear-gradient(90deg,${DEMO_STOPS.join(',')})`;
  }

  function setupNarrative() {
    const steps=[...document.querySelectorAll('.story-step')];
    const names={baseline:'Baseline',shift:'The Shift',offices:'One Office at a Time',geography:'The Geography',close:'The Takeaway'};
    if('IntersectionObserver' in window){
      const observer=new IntersectionObserver(entries=>{
        entries.forEach(entry=>{
          if(!entry.isIntersecting)return;
          const el=entry.target;steps.forEach(s=>s.classList.toggle('is-active',s===el));
          const key=el.dataset.step,year=Number(el.dataset.year),mode=el.dataset.mode||'margin';
          document.getElementById('rail-index').textContent=String(steps.indexOf(el)+1).padStart(2,'0');
          document.getElementById('progress-label').textContent=names[key]||'The story';
          document.getElementById('progress-fill').style.width=`${(steps.indexOf(el)+1)/steps.length*100}%`;
          document.querySelectorAll('.chapter-nav a,.mobile-chapters a').forEach(a=>a.classList.toggle('is-current',a.dataset.nav===key));
          renderStoryMap(year,mode);
        });
      },{rootMargin:'-34% 0px -48% 0px',threshold:0});
      steps.forEach(step=>observer.observe(step));
    } else {
      window.addEventListener('scroll',()=>{const active=steps.find(s=>s.getBoundingClientRect().top>0)||steps.at(-1);if(active)renderStoryMap(Number(active.dataset.year),active.dataset.mode);},{passive:true});
    }
  }
  function updateStoryFacts(){
    const p60=GA.president.find(r=>r.year===1960),p64=GA.president.find(r=>r.year===1964);
    if(p60&&p64){
      const m60=p60.D-p60.R,m64=p64.D-p64.R;
      document.getElementById('baseline-margin').textContent=`${Math.abs(m60).toFixed(1)}`;
      document.getElementById('pres-swing').textContent=`${Math.abs(m64-m60).toFixed(1)}`;
      document.getElementById('goldwater-share').textContent=`${(100*p64.R/(p64.D+p64.R)).toFixed(1)}%`;
    }
  }
  function setupExplore(years) {
    const slider=document.getElementById('year-range');
    slider.max=String(years.length-1);slider.value=String(years.length-1);
    exploreYear=years.at(-1);document.getElementById('year-label').textContent=exploreYear;
    const syncYear=()=>{exploreYear=years[Number(slider.value)];document.getElementById('year-label').textContent=exploreYear;renderExploreMap();renderScatter();};
    slider.addEventListener('input',()=>{stopYearPlay();syncYear();});
    document.getElementById('year-prev').addEventListener('click',()=>{slider.value=String(Math.max(0,Number(slider.value)-1));slider.dispatchEvent(new Event('input'));});
    document.getElementById('year-next').addEventListener('click',()=>{slider.value=String(Math.min(years.length-1,Number(slider.value)+1));slider.dispatchEvent(new Event('input'));});
    document.getElementById('year-play').addEventListener('click',()=>{
      if(yearTimer){stopYearPlay();return;}
      if(Number(slider.value)>=years.length-1){slider.value='0';syncYear();}
      const button=document.getElementById('year-play');button.textContent='Pause';button.setAttribute('aria-label','Pause election-year playback');
      yearTimer=window.setInterval(()=>{
        const next=Number(slider.value)+1;
        if(next>=years.length){stopYearPlay();return;}
        slider.value=String(next);syncYear();
      },1300);
    });
    window.addEventListener('pagehide',stopYearPlay,{once:true});
    document.getElementById('map-metric').addEventListener('change',ev=>{mapMetric=ev.target.value;renderExploreMap();});
    document.getElementById('office-select').addEventListener('change',renderExploreCharts);
    document.getElementById('scatter-metric').addEventListener('change',ev=>{scatterMetric=ev.target.value;renderScatter();});
    document.getElementById('brush-clear')?.addEventListener('click',clearBrush);
  }
  function stopYearPlay(){
    if(yearTimer!==null){window.clearInterval(yearTimer);yearTimer=null;}
    const button=document.getElementById('year-play');
    if(button){button.textContent='Play';button.setAttribute('aria-label','Play through election years');}
  }
  function setExploreYear(year){
    if(!countyElectionYears.length)return;
    stopYearPlay();
    exploreYear=countyElectionYears.reduce((a,b)=>Math.abs(b-year)<Math.abs(a-year)?b:a);
    const slider=document.getElementById('year-range');
    slider.value=String(countyElectionYears.indexOf(exploreYear));
    document.getElementById('year-label').textContent=exploreYear;
    renderExploreMap();renderScatter();
  }
  const STORY_ROWS=[['president','President'],['class3','Senate: Class 3 seat'],['class2','Senate: Class 2 seat'],['governor','Governor']];
  const STORY_CATS={
    D:{name:'Democrat',color:BLUE},R:{name:'Republican',color:RED},O:{name:'Third party (Wallace)',color:'#b7791f'},
    unopposed:{name:'Democrat, no Republican nominee',color:'#90b4e0'},missing:{name:'Vote totals not in dataset',color:'#a0aec0'}
  };
  const STORY_OPTIONS={responsive:true,displayModeBar:false,scrollZoom:false};
  // Every Plotly chart owns a legend. Keep color semantics consistent and prevent
  // accidental hiding of a category when comparing figures across offices.
  const LEGEND_LIGHT={orientation:'h',x:0,y:-.29,xanchor:'left',yanchor:'top',
    font:{family:'DM Sans, Arial, sans-serif',size:12,color:'#35413c'},
    itemclick:false,itemdoubleclick:false};
  const LEGEND_DARK={orientation:'h',x:0,y:-.32,xanchor:'left',yanchor:'top',
    font:{family:'DM Sans, Arial, sans-serif',size:12,color:'#e2e9dd'},
    itemclick:false,itemdoubleclick:false};
  const PLOT_FONT=12;
  const formatMargin=m=>m===0?'even':(m>0?'D +':'R +')+Math.abs(m).toFixed(1);
  // One point/bar per seat decision. A runoff supersedes the preceding general election.
  function storyRaces(office){
    const all=[...(GA[office]||[]).map(r=>({...r,status:'contested'})),...((GA.extra||{})[office]||[])];
    const groups=new Map();
    for(const r of all){
      const year=/Runoff/.test(r.label)&&r.year%2?r.year-1:r.year;
      const seat=office!=='senate'?'office':(/Special/.test(r.label)||(year-1960)%6?'class3':'class2');
      const key=seat+'-'+year;
      if(!groups.has(key))groups.set(key,{seat,year,races:[]});
      groups.get(key).races.push(r);
    }
    const out=[...groups.values()].map(g=>{
      g.races.sort((a,b)=>Number(/Runoff/.test(a.label))-Number(/Runoff/.test(b.label)));
      const decider=g.decider=g.races[g.races.length-1];
      // Ellis Arnall ran in the Democratic primary; include his write-in share in the D side of the 1966 comparison.
      g.margin=decider.status==='contested'?+(decider.D+(decider.writein?.pct||0)-decider.R).toFixed(1):decider.status==='unopposed'?100:null;
      g.category=decider.status==='contested'?(decider.wparty==='O'?'O':g.margin>=0?'D':'R'):decider.status;
      g.party=decider.wparty||null;
      return g;
    }).sort((a,b)=>a.year-b.year);
    out.forEach(g=>{
      const same=out.filter(o=>o.year===g.year),index=same.indexOf(g);
      g.x=same.length>1?g.year+(index-(same.length-1)/2)*.9:g.year;
      g.width=same.length>1?.85:office==='senate'?1.6:2.6;
    });
    return out;
  }
  function describeRace(r){
    if(r.status==='unopposed')return `${r.label}: ${r.winner} (D), no Republican nominee`;
    if(r.status==='missing')return `${r.label}: ${(r.cands||[]).join(' vs. ')}; vote totals not in dataset`;
    let text=`${r.label}: ${r.dname} (D) ${r.D}% vs. ${r.rname} (R) ${r.R}%`;
    if(r.writein)text+=`<br>Write-in ${r.writein.name} (${r.writein.pct}%): included with the Democratic side because he ran in that party’s primary`;
    if(r.wparty==='O')text+=`<br>Winner: ${r.winner} (third party; ${(100-r.D-r.R).toFixed(1)}% other)`;
    else if(r.wparty==='D'&&r.R>r.D)text+=`<br>No candidate won a majority; the legislature chose ${r.winner}`;
    return text;
  }
  const describeGroup=g=>g.races.map(describeRace).join('<br>');
  const firstRepublican=races=>races.find(g=>g.party==='R');
  function storyXRange(){
    const years=STORY_ROWS.flatMap(([key])=>storyRaces(key==='class2'||key==='class3'?'senate':key).map(g=>g.year));
    return [Math.min(...years)-3,Math.max(...years)+3];
  }
  function bindYearSelection(plot){
    if(plot.dataset.yearBound) return;
    plot.on('plotly_click',ev=>{
      const point=ev.points?.[0], year=Number(point?.x);
      if(Number.isFinite(year)) setExploreYear(Math.round(year));
    });
    plot.dataset.yearBound='true';
  }
  function renderWinnerTiles(xRange){
    const rows=STORY_ROWS.map(([key,label])=>({key,label,races:key==='class2'||key==='class3'?storyRaces('senate').filter(g=>g.seat===key):storyRaces(key)}));
    const category=g=>g.decider.status==='unopposed'?'unopposed':g.party||'missing';
    const traces=Object.entries(STORY_CATS).map(([key,style])=>{
      const pts=rows.flatMap(row=>row.races.filter(g=>category(g)===key).map(g=>({row,g})));
      return {type:'scatter',mode:'markers',name:style.name,x:pts.map(p=>p.g.year),y:pts.map(p=>p.row.label),
        text:pts.map(p=>describeGroup(p.g)),hovertemplate:'%{text}<extra></extra>',
        marker:{symbol:'square',size:16,color:key==='missing'?'rgba(0,0,0,0)':style.color,line:{color:style.color,width:key==='missing'?2:0}}};
    }).filter(t=>t.x.length);
    const order=rows.map(r=>r.label).reverse(),shapes=[],annotations=[];
    rows.forEach(row=>{
      const first=firstRepublican(row.races),idx=order.indexOf(row.label);if(!first)return;
      shapes.push({type:'rect',xref:'x',yref:'y',x0:first.year-1.6,x1:xRange[1],y0:idx-.42,y1:idx+.42,fillcolor:'rgba(189,74,55,.09)',line:{width:0},layer:'below'});
      annotations.push({x:first.year,y:row.label,text:`<b>${first.year}</b>`,showarrow:false,yshift:16,font:{family:'DM Sans, Arial, sans-serif',color:RED,size:12}});
    });
    Plotly.react('story-tiles',traces,{margin:{l:window.innerWidth<600?156:210,r:22,t:22,b:126},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',
      font:{family:'DM Sans, Arial, sans-serif',color:'#59655f',size:PLOT_FONT},showlegend:true,legend:LEGEND_LIGHT,
      xaxis:{range:xRange,dtick:window.innerWidth<600?16:8,showgrid:false,title:'Election year',zeroline:false},
      yaxis:{type:'category',categoryorder:'array',categoryarray:order,showgrid:false,tickfont:{size:13,color:'#35413c'}},
      shapes,annotations,hoverlabel:{bgcolor:'#1d2a27',font:{color:'#f6f1e8'},align:'left'}},STORY_OPTIONS).then(bindYearSelection);
  }
  function firstWinBand(first,xRange,shapes,annotations){
    if(!first)return;
    shapes.push({type:'rect',xref:'x',yref:'paper',x0:first.x-first.width/2,x1:xRange[1],y0:0,y1:1,fillcolor:'rgba(189,74,55,.07)',line:{width:0},layer:'below'});
    annotations.push({x:first.x,y:1,xref:'x',yref:'paper',xanchor:'left',yanchor:'bottom',text:'<b>First Republican win →</b>',showarrow:false,font:{family:'DM Sans, Arial, sans-serif',size:12,color:RED}});
  }
  function storyCallout(x,y,n){
    return {x,y,text:n.text,showarrow:true,arrowhead:0,arrowwidth:1,arrowcolor:'#9a9e97',ax:n.ax||0,ay:n.ay||(y>=0?-36:36),font:{family:'DM Sans, Arial, sans-serif',size:11,color:n.color||'#1e2927'},bgcolor:'rgba(0,0,0,0)',bordercolor:'rgba(0,0,0,0)',borderwidth:0,borderpad:0};
  }
  function marginChart(div,office,notes,xRange){
    const races=storyRaces(office),first=firstRepublican(races);
    const traces=Object.entries(STORY_CATS).map(([key,style])=>{
      const group=races.filter(g=>g.category===key);
      if(key==='missing')return {type:'scatter',mode:'markers',name:style.name,x:group.map(g=>g.x),y:group.map(()=>0),text:group.map(describeGroup),hovertemplate:'%{text}<extra></extra>',marker:{symbol:'circle-open',size:11,color:style.color}};
      return {type:'bar',name:style.name,x:group.map(g=>g.x),y:group.map(g=>g.margin),width:group.map(g=>g.width),
        text:group.map(describeGroup),textposition:'none',customdata:group.map(g=>{const d=g.decider;if(d.writein)return `${formatMargin(g.margin)}; Democratic share including ${d.writein.name}: ${(d.D+d.writein.pct).toFixed(1)}%`;return g.category==='unopposed'?'No Republican nominee':formatMargin(g.margin);}),
        hovertemplate:'%{text}<br>Margin: %{customdata}<extra></extra>',
        marker:{color:style.color,line:{color:'#1e2927',width:group.map(g=>g===first?2:0)}}};
    }).filter(t=>t.x.length);
    const shapes=[],annotations=[];firstWinBand(first,xRange,shapes,annotations);
    notes.forEach(n=>{
      const race=races.find(g=>g.year===n.year&&(!n.seat||g.seat===n.seat));
      if(race)annotations.push(storyCallout(race.x,race.margin??0,n));
    });
    const valid=races.filter(g=>g.margin!==null).map(g=>g.margin);
    const ymax=races.some(g=>g.category==='unopposed')?118:Math.max(25,Math.max(...valid)+22);
    const ymin=Math.min(-30,Math.min(...valid)-24);
    const layout={margin:{l:75,r:18,t:38,b:130},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',
      font:{family:'DM Sans, Arial, sans-serif',color:'#58645e',size:PLOT_FONT},showlegend:true,legend:LEGEND_LIGHT,barmode:'overlay',bargap:0,
      xaxis:{range:xRange,dtick:window.innerWidth<600?16:8,showgrid:false,title:'Election year',zeroline:false},
      yaxis:{range:[ymin,ymax],title:'D − R margin (points)',zeroline:true,zerolinecolor:'#68736d',gridcolor:'#ddd9ce'},
      shapes,annotations,hoverlabel:{bgcolor:'#1d2a27',font:{color:'#f6f1e8'},align:'left'}};
    Plotly.react(div,traces,layout,STORY_OPTIONS).then(()=>registerLinkedPlot(div,races.map(g=>g.year),shapes));
  }
  function marginVsNation(xRange,notes=[]){
    const data=GA.president.filter(r=>r.natl!=null),lean=data.map(r=>+(r.D-r.R-r.natl).toFixed(1));
    const leanAt=year=>lean[data.findIndex(r=>r.year===year)];
    const first=firstRepublican(storyRaces('president'));
    const shapes=[],annotations=[];firstWinBand(first,xRange,shapes,annotations);
    notes.forEach(n=>{
      if(!n.years){annotations.push(storyCallout(n.year,leanAt(n.year),n));return;}
      const x=n.years.reduce((a,b)=>a+b,0)/n.years.length,y=Math.max(...n.years.map(leanAt))+n.above;
      annotations.push({...storyCallout(x,y,n),showarrow:false,yanchor:'bottom'});
      n.years.forEach(year=>annotations.push({x:year,y:leanAt(year),ax:x,ay:y,axref:'x',ayref:'y',text:'',showarrow:true,arrowhead:0,arrowwidth:1,arrowcolor:'#718096'}));
    });
    const leanTraces=[
      {name:'Georgia more Democratic than U.S.',color:BLUE,test:v=>v>=0},
      {name:'Georgia more Republican than U.S.',color:RED,test:v=>v<0}
    ].map(part=>{
      const subset=data.map((r,i)=>({r,v:lean[i]})).filter(o=>part.test(o.v));
      return {type:'bar',name:part.name,x:subset.map(o=>o.r.year),y:subset.map(o=>o.v),
        width:2.6,marker:{color:part.color},
        customdata:subset.map(o=>[formatMargin(+(o.r.D-o.r.R).toFixed(1)),formatMargin(o.r.natl)]),
        hovertemplate:'%{x}<br>Georgia: %{customdata[0]}<br>Nation: %{customdata[1]}<br>Georgia minus nation: %{y:+.1f} pts<extra></extra>'};
    });
    Plotly.react('story-lean',leanTraces,{margin:{l:78,r:18,t:38,b:116},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',
      font:{family:'DM Sans, Arial, sans-serif',color:'#58645e',size:PLOT_FONT},showlegend:true,legend:LEGEND_LIGHT,barmode:'overlay',
      xaxis:{range:xRange,dtick:window.innerWidth<600?16:8,showgrid:false,title:'Presidential election year'},
      yaxis:{range:[Math.min(...lean)-20,Math.max(...lean)+20],title:'GA margin − U.S. margin (points)',zeroline:true,zerolinecolor:'#68736d',gridcolor:'#ddd9ce'},
      shapes,annotations,hoverlabel:{bgcolor:'#1d2a27',font:{color:'#f6f1e8'}}},STORY_OPTIONS).then(()=>registerLinkedPlot('story-lean',data.map(r=>r.year),shapes));
  }
  function renderStoryPlots(){
    const range=storyXRange();
    renderWinnerTiles(range);
    marginVsNation(range,[
      {year:1964,text:'<b>1964 · early Republican break</b><br>Georgia shifts sharply relative to the U.S.',color:RED,ay:25,ax:-90},
      {years:[1976,1980],text:'1976–80 · Carter-era shift<br>back toward the Democrats',above:14},
      {year:2020,text:'2020 · Biden narrowly<br>carries Georgia',ay:-45,ax:-25}
    ]);
    marginChart('story-senate','senate',[
      {year:1956,text:'1950–66: no Republican<br>on the ballot',ay:-22,ax:20},
      {year:1980,text:'<b>1980: Mattingly (R)</b><br>ousts Talmadge',color:RED,ay:50},
      {year:1986,text:'Fowler (D)<br>wins it back',ay:-50},
      {year:1992,text:'Coverdell (R)<br>wins runoff',ay:28,ax:-32},
      {year:2002,text:'<b>2002: Chambliss (R)</b><br>beats Cleland',color:RED,ay:50,ax:-55},
      {year:2004,text:'<b>2004: both seats<br>Republican</b>',color:RED,ay:-65,ax:25},
      {year:2020,seat:'class2',text:'2021 runoffs: Ossoff<br>& Warnock win both',ay:-45,ax:-25}
    ],range);
    marginChart('story-gov','governor',[
      {year:1958,text:'1950–62: no Republican nominee',ay:-22,ax:-20},
      {year:1966,text:'Callaway (R) wins plurality;<br>legislature picks Maddox (D)',ay:65,ax:25},
      {year:1978,text:'Busbee +61',ay:-22},
      {year:1994,text:'1990s: margins shrink',ay:-45},
      {year:2002,text:'<b>2002: Perdue (R)</b><br>first GOP governor<br>since Reconstruction',color:RED,ay:40,ax:-60},
      {year:2018,text:'Kemp +1.4',ay:40}
    ],range);
  }
  // Cross-chart coordination: only draw a gold matching-year band on charts
  // that actually contain an election that year. A hovered preview never
  // replaces a pinned selection; leaving the chart restores the pinned year.
  function registerLinkedPlot(id,years,baseShapes){
    linkedYearSets.set(id,new Set(years));
    linkedBaseShapes.set(id,baseShapes.map(shape=>({...shape})));
    const plot=document.getElementById(id);
    if(!plot.dataset.storyYearLinked){
      plot.on('plotly_hover',ev=>{
        if(pinnedStoryYear!==null)return;
        const point=ev.points?.[0];
        if(point&&Number.isFinite(Number(point.x))) setLinkedPreview(Math.round(Number(point.x)));
      });
      plot.on('plotly_unhover',()=>{if(pinnedStoryYear===null) setLinkedPreview(null);});
      plot.on('plotly_click',ev=>{
        const point=ev.points?.[0];
        if(!point||!Number.isFinite(Number(point.x)))return;
        pinLinkedYear(Math.round(Number(point.x)));
      });
      plot.dataset.storyYearLinked='true';
    }
    paintLinkedYear();
  }
  function setupLinkedYears(){
    document.querySelectorAll('[data-compare-year]').forEach(btn=>btn.addEventListener('click',()=>{
      pinLinkedYear(Number(btn.dataset.compareYear));
    }));
    document.getElementById('linked-year-clear').addEventListener('click',()=>{
      pinnedStoryYear=null;
      hoveredStoryYear=null;
      paintLinkedYear();
    });
    paintLinkedYear();

  // Clear button for the floating toolbar
  document.getElementById('sticky-year-clear')
    .addEventListener('click', () => {
      pinnedStoryYear = null;
      hoveredStoryYear = null;
      paintLinkedYear();
    });

  // Show the floating toolbar only after the original
  // white comparison panel has scrolled out of view.
  const stickyBar = document.getElementById('sticky-year-bar');
  const originalPanel = document.querySelector('.linked-year-panel');
  const officeSection = document.querySelector('.office-figures');

  function updateStickyYearBar() {
    const header = document.querySelector('.site-header');
    const mobileNav = document.querySelector('.mobile-chapters');

    let headerBottom = header.getBoundingClientRect().bottom;

    if (mobileNav && getComputedStyle(mobileNav).display !== 'none') {
      headerBottom = Math.max(
        headerBottom,
        mobileNav.getBoundingClientRect().bottom
      );
    }

    const passedOriginal =
      originalPanel.getBoundingClientRect().bottom <= headerBottom;

    const withinCharts =
      officeSection.getBoundingClientRect().bottom >
      headerBottom + stickyBar.offsetHeight;

    stickyBar.hidden = !(passedOriginal && withinCharts);
  }

  window.addEventListener('scroll', updateStickyYearBar, {
    passive: true
  });

  window.addEventListener('resize', updateStickyYearBar);
  updateStickyYearBar();
  }
  function setLinkedPreview(year){
    if(pinnedStoryYear!==null)return;
    if(hoveredStoryYear===year)return;
    hoveredStoryYear=year;
    paintLinkedYear();
  }
  function pinLinkedYear(year){
    if(!Number.isFinite(year))return;
    pinnedStoryYear=(pinnedStoryYear===year)?null:year;
    hoveredStoryYear=null;
    if(pinnedStoryYear!==null)setExploreYear(pinnedStoryYear);
    paintLinkedYear();
  }
  function paintLinkedYear(){
    const year=pinnedStoryYear??hoveredStoryYear;
    ++storyYearPaintToken;
    LINKED_CHARTS.forEach(id=>{
      const plot=document.getElementById(id);
      const base=linkedBaseShapes.get(id);
      if(!plot?.layout||!base)return;

      // Every chart gets a reference line, even if that office had no election.
      // Only a chart with an actual race gets the shaded matching-year band.
      const hasElection=year!==null&&linkedYearSets.get(id)?.has(year);
      const shapes=[...base];
      if(year!==null){
        if(hasElection || (id === 'story-lean' && year === 2002)){
          shapes.push({type:'rect',xref:'x',yref:'paper',
            x0:year-1.8,x1:year+1.8,y0:0,y1:1,
            fillcolor:'rgba(207,155,60,.18)',
            line:{color:'#cf9b3c',width:1},layer:'below'});
        }
        shapes.push({type:'line',xref:'x',yref:'paper',
          x0:year,x1:year,y0:0,y1:1,
          line:{color:'#b07c1f',width:2,dash:'dot'},layer:'above'});
      }
      // Always apply the current state; no cross-chart skip based on
      // a previous chart's paint. Plotly manages relayout asynchronously.
      try{Plotly.relayout(plot,{shapes}).catch(()=>{});}
      catch(_){/* Plot may have been detached. */}
    });
    paintedStoryYear=year;
    updateLinkedSummary(year);
  }
  function updateLinkedSummary(year){
    const title=document.getElementById('linked-year-title');
    const status=document.getElementById('timeline-selection');
    const clear=document.getElementById('linked-year-clear');
    if(!title||!status)return;
    title.textContent=year===null?'Compare across offices':`Election year · ${year}`;
    const pinned=pinnedStoryYear!==null;
    status.textContent=year===null?'Hover a bar in any chart to preview that year. Click a bar or year button to pin it. Gold bands appear only where that office has an election.':pinned?`Pinned: ${year}. Matching races are highlighted in gold. Click another bar or year to change the selection; Clear to return to hover preview. The Explore county map has been set to its nearest presidential year.`:`Previewing ${year}. Gold bands mark matching races; click to pin this year.`;
    clear.hidden=!pinned;
    document.getElementById('sticky-year-clear').hidden = !pinned;
    document.querySelectorAll('[data-compare-year]').forEach(btn=>btn.setAttribute('aria-pressed',String(pinned&&Number(btn.dataset.compareYear)===year)));
    const setCard=(type,value,detail)=>{
      document.getElementById(`summary-${type}-value`).textContent=value;
      document.getElementById(`summary-${type}-detail`).textContent=detail;
    };
    if(year===null){
      setCard('president','—','Select a year to see the presidential lean and Georgia margin.');
      setCard('senate','—','Senate seats may be decided in different years.');
      setCard('governor','—','Governor elections follow their own cycle.');
      return;
    }
    const pres=GA.president.find(r=>r.year===year&&r.natl!=null);
    if(pres){
      const ga=pres.D-pres.R,lean=ga-pres.natl;
      setCard('president',`${fmtSigned(lean)} pts vs. U.S.`, `Georgia: ${formatMargin(ga)} · U.S.: ${formatMargin(pres.natl)}. Positive lean = more Democratic than the nation.${year===1968?' Wallace carried Georgia; the margin compares D and R candidates only.':''}`);
    }else setCard('president','No presidential race',noData);
    for(const [office,type] of [['senate','senate'],['governor','governor']]){
      const races=storyRaces(office).filter(g=>g.year===year);
      if(!races.length){setCard(type,'No recorded race',noData);continue;}
      const winner=g=>g.decider.winner||g.decider.rname||g.decider.dname||'Winner not specified';
      const names=races.map(g=>`${winner(g)} (${g.category==='unopposed'?'D, unopposed':g.party||'?'}), ${g.margin===null?'margin unavailable':g.category==='unopposed'?'no R nominee':formatMargin(g.margin)}`);
      setCard(type,races.length===1?`${races[0].party==='R'?'Republican':races[0].party==='D'?'Democratic':races[0].party==='O'?'Third party':'Recorded'} win${races.length===1?'':'s'}`:`${races.length} seat decisions`,names.join(' · '));
    }
  }

  // A short, self-contained animated sequence. Users can select any milestone;
  // autoplay is one pass on entering the section and is disabled for reduced motion.
  function setupMilestones(){
    const moments=[
      {year:1964,label:'THE FIRST BREAK · PRESIDENT',title:'Goldwater carries Georgia.',description:'Barry Goldwater wins Georgia’s presidential vote in 1964, breaking with the state’s usual Democratic presidential pattern. That result did not immediately change its Senate seats or governorship.'},
      {year:1980,label:'THE SENATE BREAKTHROUGH',title:'Mattingly wins a Senate seat.',description:'Mack Mattingly becomes Georgia’s first modern-era Republican U.S. senator in 1980. Democrats reclaim that seat in 1986, and the longer Republican hold develops later; Republicans control both seats by 2004.'},
      {year:2002,label:'THE GOVERNORSHIP',title:'Perdue wins the governor’s office.',description:'Sonny Perdue defeats Roy Barnes in 2002, becoming Georgia’s first Republican governor since Reconstruction. The executive branch changes hands decades after the first Republican presidential breakthrough.'}
    ];
    const root=document.getElementById('milestone-experience');
    if(!root)return;
    const buttons=[...root.querySelectorAll('[data-milestone]')];
    const replay=document.getElementById('milestone-replay');
    const compare=document.getElementById('milestone-compare');
    const status=document.getElementById('milestone-status');
    let index=0,timer=null,played=false;
    const reduceMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    function stop(){if(timer){window.clearInterval(timer);timer=null;}replay.textContent='▶ Replay timeline';replay.setAttribute('aria-label','Replay the three milestones');}
    function select(i){
      index=i;const m=moments[index];
      buttons.forEach((btn,j)=>{btn.classList.toggle('is-current',i===j);btn.classList.toggle('is-past',j<i);btn.setAttribute('aria-pressed',String(i===j));});
      document.getElementById('milestone-rail-fill').style.width=`${index*50}%`;
      document.getElementById('milestone-detail-year').textContent=m.year;
      document.getElementById('milestone-detail-label').textContent=m.label;
      document.getElementById('milestone-detail-title').textContent=m.title;
      document.getElementById('milestone-detail-description').textContent=m.description;
      status.textContent=`Stage ${i+1} of 3 · ${m.year} · ${['Presidency','U.S. Senate','Governor'][i]}`;
      compare.replaceChildren(document.createTextNode(`Compare ${m.year} in the linked charts `));
      const arrow=document.createElement('span');arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');compare.appendChild(arrow);
    }
    function play(){
      stop();played=true;select(0);
      if(reduceMotion)return;
      replay.textContent='Ⅱ Pause timeline';replay.setAttribute('aria-label','Pause timeline animation');
      timer=window.setInterval(()=>{if(index>=moments.length-1){stop();return;}select(index+1);if(index===moments.length-1)stop();},2100);
    }
    buttons.forEach((btn,i)=>btn.addEventListener('click',()=>{played=true;stop();select(i);}));
    replay.addEventListener('click',()=>{if(timer){stop();return;}play();});
    compare.addEventListener('click',()=>{
      // A milestone can link to the same year chosen in the three charts.
      pinnedStoryYear=null;
      pinLinkedYear(moments[index].year);
      document.getElementById('timeline-title').scrollIntoView({behavior:reduceMotion?'instant':'smooth',block:'start'});
    });
    select(0);
    if('IntersectionObserver' in window){
      const observer=new IntersectionObserver(entries=>{
        if(entries.some(e=>e.isIntersecting)&&!played){play();observer.disconnect();}
      },{threshold:.23});
      observer.observe(root);
    }
  }
  const NOTES={
    president:'Statewide: MIT Election Data + Science Lab (1976–2020), Wikipedia (1960–72), project-compiled results (1948–56, 2024). County results: Wikipedia (1960–2004), tonmcg/GitHub (2008–2024). Demographics: Census Bureau population estimates (2000, 2010, 2019). 1968: Wallace won Georgia and counts as “Other.”',
    governor:'Gubernatorial results from Wikipedia. Years with Democratic-primary-only or uncontested general elections (1962) are omitted.',
    senate:'Year labels: S = special election, R = runoff, SR = runoff of a special election. Senate results 2004–2021: MIT Election Data + Science Lab; other years: Wikipedia; 1972, the 1992 general, and the 2022 runoff: project-compiled results. Uncontested races are omitted. 2020S is a multi-candidate jungle race – D/R are party totals.'
  };
  function renderExploreCharts(){
    const office=document.getElementById('office-select').value,data=GA[office]||[];
    document.getElementById('office-chart-title').textContent=`${OFFICE[office]} vote share`;
    const short=l=>l.replace(' Special Runoff','SR').replace(' Special','S').replace(' Runoff','R');
    const x=data.map(r=>short(r.label));
    const share=[
      {x,y:data.map(r=>r.D),name:'Democratic',mode:'lines+markers',line:{color:BLUE,width:2},marker:{size:6},text:data.map(r=>r.dname),hovertemplate:'%{x} · %{text}: %{y}%<extra></extra>'},
      {x,y:data.map(r=>r.R),name:'Republican',mode:'lines+markers',line:{color:RED,width:2},marker:{size:6},text:data.map(r=>r.rname),hovertemplate:'%{x} · %{text}: %{y}%<extra></extra>'},
      {x,y:data.map(r=>r.O),name:'Other',mode:'lines+markers',line:{color:MUTED,width:1.5,dash:'dot'},marker:{size:5},hovertemplate:'%{x}: %{y}%<extra></extra>'}
    ];
    const xaxis={type:'category',gridcolor:'#43524c',tickangle:office==='senate'?0:-35};
    if(office==='senate'){
      // Keep every Senate race plotted and hoverable, but label only every third category.
      xaxis.tickmode='array';xaxis.tickvals=x.filter((_,i)=>i%3===0||i===x.length-1);
    }
    const common={paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',font:{family:'DM Sans, Arial, sans-serif',color:'#c9d0c8',size:PLOT_FONT},margin:{l:63,r:12,t:26,b:115},xaxis,showlegend:true,hoverlabel:{bgcolor:'#172320',font:{color:'#f6f1e8'}},legend:LEGEND_DARK};
    Plotly.react('office-share-chart',share,{...common,yaxis:{title:'% of vote',range:[0,100],gridcolor:'#43524c'}},{responsive:true,displayModeBar:false});
    const margins=data.map(r=>+(r.D-r.R).toFixed(1));
    const marginTraces=[
      {name:'D leads R',color:BLUE,test:m=>m>=0},
      {name:'R leads D',color:RED,test:m=>m<0}
    ].map(part=>{
      const subset=data.map((r,i)=>({r,label:x[i],m:margins[i]})).filter(o=>part.test(o.m));
      return {type:'bar',name:part.name,x:subset.map(o=>o.label),y:subset.map(o=>o.m),
        marker:{color:part.color},customdata:subset.map(o=>`${o.r.dname||'Democratic'} vs ${o.r.rname||'Republican'}`),
        hovertemplate:'%{x}: %{customdata}<br>D − R: %{y:+.1f} pts<extra></extra>'};
    });
    Plotly.react('office-margin-chart',marginTraces,{...common,barmode:'overlay',xaxis,
      yaxis:{title:'D − R (points)',zeroline:true,zerolinecolor:'#9da89e',gridcolor:'#43524c'}},{responsive:true,displayModeBar:false});
    document.getElementById('office-source').textContent=NOTES[office];
    renderScatter();
  }
  function renderScatter(){
    const y=exploreYear, county=GA.county[String(y)]||{},metric=METRICS[scatterMetric];
    const ys=Object.keys(GA.demo).map(Number),demoYear=ys.reduce((a,b)=>Math.abs(b-y)<Math.abs(a-y)?b:a);
    const demo=GA.demo[String(demoYear)]||{},ids=Object.keys(county).filter(id=>demo[id]);
    document.getElementById('scatter-snapshot').textContent=`Election: ${y} · nearest demographic snapshot: ${demoYear}`;
    const xs=ids.map(id=>demo[id][metric.index]),margins=ids.map(id=>margin(county[id]));
    const pop=metric.index===0;
    const selectedIdx=brushedCounties.size?ids.reduce((acc,id,i)=>{if(brushedCounties.has(id))acc.push(i);return acc;},[]):undefined;
    Plotly.react('county-scatter',[{type:'scatter',mode:'markers',x:xs,y:margins,text:ids.map(id=>mapCounties.get(id)),customdata:ids,
      selectedpoints:selectedIdx,
      marker:{size:9,color:margins,colorscale:[[0,RED],[0.5,'#f3f0e8'],[1,BLUE]],cmin:-80,cmax:80,
        showscale:true,colorbar:{title:{text:'D − R (pts)',side:'top',font:{size:12,color:'#e2e9dd'}},
          tickvals:[-80,0,80],ticktext:['R +80','0','D +80'],tickfont:{size:11,color:'#e2e9dd'},
          thickness:13,len:.77,x:1.02,xpad:2,outlinewidth:0},
        line:{color:'#d8ded6',width:.7},opacity:.87},
      selected:{marker:{size:14,opacity:1,line:{color:GOLD,width:2}}},unselected:{marker:{opacity:.2}},
      hovertemplate:'%{text}<br>'+metric.name+': %{x}<br>Presidential margin: %{y:+.1f} pts<extra></extra>'}],{
      margin:{l:75,r:90,t:34,b:76},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',font:{family:'DM Sans, Arial, sans-serif',color:'#c9d0c8',size:PLOT_FONT},showlegend:false,
      // clickmode event: point clicks toggle via plotly_click (no Plotly replace-selection / Ctrl required).
      dragmode:'select',selectdirection:'any',clickmode:'event',
      xaxis:{title:metric.name+(pop?' (log scale)':' (%)'),type:pop?'log':'linear',gridcolor:'#43524c',color:'#c9d0c8'},yaxis:{title:'Presidential margin (D − R, points)',zeroline:true,zerolinecolor:'#9da89e',gridcolor:'#43524c',color:'#c9d0c8'},hoverlabel:{bgcolor:'#172320',font:{color:'#f6f1e8'}}
    },{responsive:true,displayModeBar:false}).then(()=>{
      applyBrush();
      if(activeCounty&&!brushedCounties.size)setHighlight(activeCounty);
    });
    const plot=document.getElementById('county-scatter');
    if(!plot.dataset.linked){
      let scatterBoxSelecting=false;
      plot.on('plotly_hover',ev=>{const id=String(ev.points?.[0]?.customdata||'');if(id)setHighlight(id,'scatter');});
      plot.on('plotly_unhover',()=>setHighlight(null,'scatter'));
      plot.on('plotly_click',ev=>{
        if(suppressScatterClick) return;
        const id=String(ev.points?.[0]?.customdata||'');
        if(id) toggleBrushedCounty(id);
      });
      plot.on('plotly_selecting',()=>{scatterBoxSelecting=true;});
      plot.on('plotly_selected',ev=>{
        // Ignore click-driven selection events; only box/lasso drags replace or shift-add.
        if(!scatterBoxSelecting){applyBrush();return;}
        scatterBoxSelecting=false;
        suppressScatterClick=true;
        window.setTimeout(()=>{suppressScatterClick=false;},0);
        const pts=ev?.points||[];
        if(!pts.length){clearBrush();return;}
        const ids=pts.map(p=>String(p.customdata||'')).filter(Boolean);
        if(ev?.event?.shiftKey){
          ids.forEach(id=>brushedCounties.add(id));
          applyBrush();
        } else {
          setBrushedCounties(ids);
        }
      });
      plot.on('plotly_deselect',()=>{scatterBoxSelecting=false;clearBrush();});
      plot.dataset.linked='true';
    }
  }
  function bindResize(){
    if('ResizeObserver'in window){resizeObserver=new ResizeObserver(entries=>{for(const e of entries){const svg=e.target.querySelector('svg');if(svg)svg.setAttribute('data-size',`${Math.round(e.contentRect.width)}x${Math.round(e.contentRect.height)}`);}});mapViews.forEach(v=>resizeObserver.observe(v.container));}
  }
  function resizeCharts(){document.querySelectorAll('.js-plotly-plot').forEach(el=>{try{Plotly.Plots.resize(el);}catch(_){}});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
