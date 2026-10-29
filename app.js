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
  let exploreYear = 2024;
  let countyElectionYears=[];
  let mapMetric = 'margin';
  let scatterMetric = 'black';
  let resizeObserver;
  let yearTimer=null;
  const tooltip = document.getElementById('county-tooltip');

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
    setupNarrative();
    setupExplore(countyYears);
    renderStoryMap(1964, 'margin');
    renderExploreMap();
    renderStoryPlots();
    updateStoryFacts();
    renderExploreCharts();
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
    features.forEach(f=>{
      const id=String(f.id), county=mapCounties.get(id);
      const p=svgEl('path',{d:pathFor(f.geometry,project),class:'county','data-county':id,'fill-rule':'evenodd',tabindex:'0',role:'img','aria-label':county});
      p.addEventListener('pointerenter',ev=>{setHighlight(id);showCountyTip(containerId,id,ev);});
      p.addEventListener('pointermove',ev=>showCountyTip(containerId,id,ev));
      p.addEventListener('pointerleave',()=>{if(document.activeElement!==p){setHighlight(null);hideTip();}});
      p.addEventListener('focus',()=>{setHighlight(id);showCountyTip(containerId,id,null);});
      p.addEventListener('blur',()=>{setHighlight(null);hideTip();});
      p.addEventListener('keydown',ev=>{if(ev.key==='Escape'){p.blur();hideTip();}});
      svg.appendChild(p); paths.set(id,p);
    });
    container.replaceChildren(svg);
    mapViews.set(containerId,{container,svg,paths,values:{},kind:'margin',year:2024,demographicYear:null});
  }
  function setHighlight(id, source='map') {
    activeCounty=id;
    mapViews.forEach(view=>view.paths.forEach((p,cid)=>p.classList.toggle('is-highlighted',id!==null&&cid===id)));
    const focus=document.getElementById('rail-focus');
    if(focus) focus.innerHTML=id?`<span class="focus-dot"></span><span>${escapeHTML(mapCounties.get(id)||'County')} selected · linked views highlighted.</span>`:'<span class="focus-dot"></span><span>Hover or focus a county to inspect its margin.</span>';
    const scatter=document.getElementById('county-scatter');
    if(!(source==='scatter'&&id!==null)&&scatter?.data?.[0]?.customdata){
      const index=id?scatter.data[0].customdata.findIndex(v=>String(v)===id):-1;
      try{Plotly.restyle(scatter,{selectedpoints:[index>=0?[index]:null]});}catch(_){/* Scatter may not have rendered yet. */}
    }
  }
  function escapeHTML(s){return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  function showCountyTip(viewId,id,ev) {
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
  function renderStoryMap(year, mode='margin') {
    const countyData=GA.county[String(year)]||{};
    const story=mapViews.get('story-map'), hero=mapViews.get('hero-map');
    [story,hero].forEach(v=>{
      if(!v)return;
      v.kind=mode;v.year=year;v.values={};v.svg.setAttribute('aria-label',mode==='swing'?'Georgia county changes in presidential margin, 1960 to 1964':`Georgia county presidential margin, ${year}`);
      v.paths.forEach((p,id)=>{
        const row=countyData[id];let value=row?margin(row):0;
        if(mode==='swing'){
          const old=GA.county['1960']?.[id],latest=GA.county['1964']?.[id];
          value=old&&latest?margin(latest)-margin(old):0;
        }
        v.values[id]=value;p.setAttribute('fill',marginColor(value,mode==='swing'?80:80));
        p.setAttribute('aria-label',`${mapCounties.get(id)}. ${mode==='swing'?'Change in presidential margin, 1960 to 1964':'Presidential margin, '+year}: ${fmtSigned(value)} points (Democratic minus Republican).`);
      });
    });
    const heroRec=GA.president.find(r=>r.year===1964);
    if(heroRec){const share=100*heroRec.R/(heroRec.D+heroRec.R);document.querySelector('.hero-art-bottom strong').textContent=`${share.toFixed(1)}%`;}
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
    document.getElementById('explore-map-caption').textContent=metric==='margin'?`Margin is calculated as Democratic votes minus Republican votes, divided by total votes, for ${year}. Hover or keyboard-focus a county for candidate totals.`:`Nearest demographic snapshot: ${demoYear}${year<2000?' (earliest available)':''}. The map and election year refer to different datasets.`;
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
    document.getElementById('timeline-selection').textContent=` Selected ${year}; county map set to ${exploreYear}.`;
  }
  const STORY_ROWS=[['president','President'],['class3','Senate: Class 3 seat'],['class2','Senate: Class 2 seat'],['governor','Governor']];
  const STORY_CATS={
    D:{name:'Democrat',color:BLUE},R:{name:'Republican',color:RED},O:{name:'Third party (Wallace)',color:'#b7791f'},
    unopposed:{name:'Democrat, no Republican nominee',color:'#90b4e0'},missing:{name:'Vote totals not in dataset',color:'#a0aec0'}
  };
  const STORY_OPTIONS={responsive:true,displayModeBar:false,scrollZoom:false};
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
    plot.on('plotly_click',ev=>{
      const point=ev.points?.[0], year=Number(point?.x);
      if(Number.isFinite(year))setExploreYear(Math.round(year));
    });
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
      annotations.push({x:first.year,y:row.label,text:`<b>${first.year}</b>`,showarrow:false,yshift:16,font:{family:'DM Sans, Arial, sans-serif',color:RED,size:10}});
    });
    Plotly.react('story-tiles',traces,{margin:{l:window.innerWidth<600?145:190,r:24,t:16,b:46},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',
      font:{family:'DM Sans, Arial, sans-serif',color:'#59655f',size:10},showlegend:false,
      xaxis:{range:xRange,dtick:window.innerWidth<600?16:8,showgrid:false,title:'Election year',zeroline:false},
      yaxis:{type:'category',categoryorder:'array',categoryarray:order,showgrid:false,tickfont:{size:11,color:'#35413c'}},
      shapes,annotations,hoverlabel:{bgcolor:'#1d2a27',font:{color:'#f6f1e8'},align:'left'}},STORY_OPTIONS).then(bindYearSelection);
  }
  function firstWinBand(first,xRange,shapes,annotations){
    if(!first)return;
    shapes.push({type:'rect',xref:'x',yref:'paper',x0:first.x-first.width/2,x1:xRange[1],y0:0,y1:1,fillcolor:'rgba(189,74,55,.07)',line:{width:0},layer:'below'});
    annotations.push({x:first.x,y:1,xref:'x',yref:'paper',xanchor:'left',yanchor:'bottom',text:'<b>First Republican win →</b>',showarrow:false,font:{family:'DM Sans, Arial, sans-serif',size:10,color:RED}});
  }
  function storyCallout(x,y,n){
    return {x,y,text:n.text,showarrow:true,arrowhead:0,arrowwidth:1,arrowcolor:'#9a9e97',ax:n.ax||0,ay:n.ay||(y>=0?-36:36),font:{family:'DM Sans, Arial, sans-serif',size:11,color:n.color||'#1e2927'},bgcolor:'rgba(0,0,0,0)',bordercolor:'rgba(0,0,0,0)',borderwidth:0,borderpad:0};
  }
  function marginChart(div,office,notes,xRange){
    const races=storyRaces(office),first=firstRepublican(races);
    const traces=Object.entries(STORY_CATS).map(([key,style])=>{
      const group=races.filter(g=>g.category===key);
      if(key==='missing')return {type:'scatter',mode:'markers',x:group.map(g=>g.x),y:group.map(()=>0),text:group.map(describeGroup),hovertemplate:'%{text}<extra></extra>',marker:{symbol:'circle-open',size:11,color:style.color}};
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
    const layout={margin:{l:63,r:18,t:28,b:54},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',
      font:{family:'DM Sans, Arial, sans-serif',color:'#58645e',size:10},showlegend:false,barmode:'overlay',bargap:0,
      xaxis:{range:xRange,dtick:window.innerWidth<600?16:8,showgrid:false,title:'Election year',zeroline:false},
      yaxis:{range:[ymin,ymax],title:'D − R margin (points)',zeroline:true,zerolinecolor:'#68736d',gridcolor:'#ddd9ce'},
      shapes,annotations,hoverlabel:{bgcolor:'#1d2a27',font:{color:'#f6f1e8'},align:'left'}};
    Plotly.react(div,traces,layout,STORY_OPTIONS).then(bindYearSelection);
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
    const trace={type:'bar',x:data.map(r=>r.year),y:lean,width:2.6,marker:{color:lean.map(v=>v>=0?BLUE:RED)},
      customdata:data.map(r=>[formatMargin(+(r.D-r.R).toFixed(1)),formatMargin(r.natl)]),
      hovertemplate:'%{x}<br>Georgia: %{customdata[0]}<br>Nation: %{customdata[1]}<br>Georgia minus nation: %{y:+.1f} pts<extra></extra>'};
    Plotly.react('story-lean',[trace],{margin:{l:64,r:18,t:28,b:52},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',
      font:{family:'DM Sans, Arial, sans-serif',color:'#58645e',size:10},showlegend:false,
      xaxis:{range:xRange,dtick:window.innerWidth<600?16:8,showgrid:false,title:'Presidential election year'},
      yaxis:{range:[Math.min(...lean)-20,Math.max(...lean)+20],title:'GA margin − U.S. margin (points)',zeroline:true,zerolinecolor:'#68736d',gridcolor:'#ddd9ce'},
      shapes,annotations,hoverlabel:{bgcolor:'#1d2a27',font:{color:'#f6f1e8'}}},STORY_OPTIONS).then(bindYearSelection);
  }
  function renderStoryPlots(){
    const range=storyXRange();
    renderWinnerTiles(range);
    marginChart('story-pres','president',[
      {year:1952,text:'Eisenhower wins nationally;<br>Georgia stays Democratic',ay:-30},
      {year:1960,text:'Kennedy +25',ay:-25,ax:12},
      {year:1964,text:'<b>1964: Goldwater +8</b><br>first Republican presidential<br>nominee to carry Georgia',color:RED,ax:-10,ay:60},
      {year:1968,text:'Wallace (3rd party) wins',ay:-40,ax:15},
      {year:1976,text:'Native Georgian Jimmy Carter',ay:-22},
      {year:1992,text:'Clinton',ay:-35},
      {year:2020,text:'Biden by 0.2',ay:-35}
    ],range);
    marginVsNation(range,[
      {year:1952,text:'~50 pts more Democratic<br>than the nation',ay:-30},
      {year:1964,text:'<b>1964: 31 pts more Republican</b><br>than the nation, a 56-pt shift',color:RED,ay:10,ax:-110},
      {years:[1976,1980],text:'1976 & 1980: Georgia temporarily swings<br>back left for Jimmy Carter',above:14},
      {year:2024,text:'2024: within 1 pt<br>of the nation',ay:-40,ax:-30}
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
    const common={paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',font:{family:'DM Sans, Arial, sans-serif',color:'#c9d0c8',size:10},margin:{l:52,r:12,t:18,b:50},xaxis,hoverlabel:{bgcolor:'#172320',font:{color:'#f6f1e8'}},legend:{orientation:'h',y:-.27,font:{size:10}}};
    Plotly.react('office-share-chart',share,{...common,yaxis:{title:'% of vote',range:[0,100],gridcolor:'#43524c'}},{responsive:true,displayModeBar:false});
    const margins=data.map(r=>+(r.D-r.R).toFixed(1));
    Plotly.react('office-margin-chart',[{type:'bar',x,y:margins,marker:{color:margins.map(m=>m>=0?BLUE:RED)},customdata:data.map(r=>`${r.dname||'Democratic'} vs ${r.rname||'Republican'}`),hovertemplate:'%{x}: %{customdata}<br>D − R: %{y:+.1f} pts<extra></extra>'}],{...common,margin:{l:52,r:12,t:16,b:54},showlegend:false,xaxis,yaxis:{title:'D − R (points)',zeroline:true,zerolinecolor:'#9da89e',gridcolor:'#43524c'}},{responsive:true,displayModeBar:false});
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
    Plotly.react('county-scatter',[{type:'scatter',mode:'markers',x:xs,y:margins,text:ids.map(id=>mapCounties.get(id)),customdata:ids,marker:{size:9,color:margins.map(m=>marginColor(m)),line:{color:'#d8ded6',width:.7},opacity:.87},selected:{marker:{size:14,opacity:1,line:{color:GOLD,width:2}}},unselected:{marker:{opacity:.22}},hovertemplate:'%{text}<br>'+metric.name+': %{x}<br>Presidential margin: %{y:+.1f} pts<extra></extra>'}],{
      margin:{l:62,r:20,t:20,b:55},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',font:{family:'DM Sans, Arial, sans-serif',color:'#c9d0c8',size:10},showlegend:false,
      xaxis:{title:metric.name+(pop?' (log scale)':' (%)'),type:pop?'log':'linear',gridcolor:'#43524c',color:'#c9d0c8'},yaxis:{title:'Presidential margin (D − R, points)',zeroline:true,zerolinecolor:'#9da89e',gridcolor:'#43524c',color:'#c9d0c8'},hoverlabel:{bgcolor:'#172320',font:{color:'#f6f1e8'}}
    },{responsive:true,displayModeBar:false}).then(()=>{if(activeCounty)setHighlight(activeCounty);});
    const plot=document.getElementById('county-scatter');
    if(!plot.dataset.linked){
      plot.on('plotly_hover',ev=>{const id=String(ev.points?.[0]?.customdata||'');if(id)setHighlight(id,'scatter');});
      plot.on('plotly_unhover',()=>setHighlight(null,'scatter'));plot.dataset.linked='true';
    }
  }
  function bindResize(){
    if('ResizeObserver'in window){resizeObserver=new ResizeObserver(entries=>{for(const e of entries){const svg=e.target.querySelector('svg');if(svg)svg.setAttribute('data-size',`${Math.round(e.contentRect.width)}x${Math.round(e.contentRect.height)}`);}});mapViews.forEach(v=>resizeObserver.observe(v.container));}
  }
  function resizeCharts(){document.querySelectorAll('.js-plotly-plot').forEach(el=>{try{Plotly.Plots.resize(el);}catch(_){}});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
