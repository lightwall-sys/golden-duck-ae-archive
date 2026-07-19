(async()=>{
  const status=document.querySelector('#status');
  const root=document.querySelector('#archive');
  const search=document.querySelector('#search');
  const year=document.querySelector('#year');
  const download=document.querySelector('#download-archive');
  const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  try{
    const data=window.GoldenDuckAuthorsElectricArchive||await fetch('data/archive-latest.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Archive data unavailable');return r.json()});
    const posts=data.posts||[];
    if(download&&data.downloadUrl)download.href=data.downloadUrl;
    const years=[...new Set(posts.map(p=>p.year))].sort((a,b)=>b-a);
    year.innerHTML='<option value="all">All years</option>'+years.map(y=>`<option>${y}</option>`).join('');
    function render(){
      const q=search.value.trim().toLowerCase();
      const y=year.value;
      const filtered=posts.filter(p=>(y==='all'||String(p.year)===y)&&(!q||`${p.title} ${p.published}`.toLowerCase().includes(q)));
      const grouped=Object.groupBy?Object.groupBy(filtered,p=>p.year):filtered.reduce((a,p)=>((a[p.year]??=[]).push(p),a),{});
      root.innerHTML=Object.keys(grouped).sort((a,b)=>b-a).map(groupYear=>`<section><h2 class="year">${groupYear}</h2>${grouped[groupYear].map(p=>{
        const archiveLabel=p.preservationStatus==='full'?'Preserved copy':'Archive record';
        return `<article class="post"><time class="date">${new Date(p.published+'T12:00:00Z').toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'})}</time><div class="title">${escapeHtml(p.title)}</div><div class="links">${p.url?`<a href="${escapeHtml(p.url)}">Original</a>`:''}${p.archiveUrl?`<a href="${escapeHtml(p.archiveUrl)}">${archiveLabel}</a>`:''}</div></article>`;
      }).join('')}</section>`).join('')||'<p>No matching posts.</p>';
      const captured=Number(data.capturedPostCount||posts.length);
      const duplicates=Number(data.duplicateCount||0);
      const preserved=Number(data.fullCopyCount||posts.filter(p=>p.preservationStatus==='full').length);
      const details=[`${filtered.length} of ${posts.length} public posts shown`,`${captured} records captured`,`${preserved} full copies preserved`];
      if(duplicates)details.push(`${duplicates} probable duplicate${duplicates===1?'':'s'} hidden`);
      details.push(`Last verified ${data.generatedAt?new Date(data.generatedAt).toLocaleString('en-GB'):'not yet run'}`);
      status.textContent=details.join(' · ');
    }
    search.addEventListener('input',render);
    year.addEventListener('change',render);
    render();
  }catch(e){status.textContent=e.message;status.style.color='#ff8b75'}
})();
