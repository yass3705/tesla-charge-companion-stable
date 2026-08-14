/* Small presentation fixes layered after the August RC engine. */
(function(){
  'use strict';

  const COUNTRY_NAMES={AT:'Autriche',BE:'Belgique',BG:'Bulgarie',CH:'Suisse',CY:'Chypre',CZ:'Tchéquie',DE:'Allemagne',DK:'Danemark',EE:'Estonie',ES:'Espagne',FI:'Finlande',FR:'France',GB:'Royaume-Uni',GR:'Grèce',HR:'Croatie',HU:'Hongrie',IE:'Irlande',IS:'Islande',IT:'Italie',LI:'Liechtenstein',LT:'Lituanie',LU:'Luxembourg',LV:'Lettonie',MA:'Maroc',MC:'Monaco',NL:'Pays-Bas',NO:'Norvège',PL:'Pologne',PT:'Portugal',RO:'Roumanie',RS:'Serbie',SE:'Suède',SI:'Slovénie',SK:'Slovaquie',TR:'Turquie'};

  function refreshTeslaIntro(){
    const section=document.getElementById('stations');
    const card=section?.querySelector('.card');
    if(!card)return;
    const title=card.querySelector('b');
    const text=card.querySelector('.small');
    if(title)title.textContent='Base Tesla — données publiées automatiquement';
    if(text)text.innerHTML='Les Superchargeurs Tesla sont lus depuis <code>data/tesla_stations.json</code> et restent en lecture seule dans le Companion. Les corrections se font dans le Maintenance Center puis sont republiées dans la base.';
    const button=card.querySelector('button');
    if(button){button.textContent='Comment fonctionne la mise à jour';button.onclick=()=>{
      const box=document.getElementById('teslaSyncInfo');
      if(box)box.innerHTML='Maintenance Center → validation des exports Tesla → publication de <code>tesla_stations.json</code> → lecture automatique par Tesla Charge Companion. Aucune modification locale d’une fiche Tesla n’est nécessaire.';
    }}
  }

  function addEffectiveRateNote(){
    const compare=document.getElementById('compare');
    if(!compare||document.getElementById('augEffectiveRateNote'))return;
    const toggle=compare.querySelector('.result-view-toggle');
    if(!toggle)return;
    const note=document.createElement('div');
    note.id='augEffectiveRateNote';
    note.className='small box';
    note.innerHTML='<b>Lecture du coût effectif :</b> pour une borne facturée à la minute, la valeur en €/kWh affichée est un <b>équivalent propre à la session simulée</b> (durée, puissance et frais inclus), et non un tarif officiel au kWh.';
    toggle.insertAdjacentElement('afterend',note);
  }

  function expandCountryNames(){
    const info=document.getElementById('teslaBaseInfo');
    if(!info)return;
    let html=info.innerHTML;
    for(const [code,name] of Object.entries(COUNTRY_NAMES)){
      html=html.replace(new RegExp(`(^|[·>\\s])${code}(?=($|[·<\\s]))`,'g'),(m,prefix)=>`${prefix}${name}`);
    }
    info.innerHTML=html;
  }

  function addLowSocWarnings(){
    const margin=Number(document.getElementById('simSafetySoc')?.value||0);
    if(!(margin>0))return;
    document.querySelectorAll('.result-card .routeinfo').forEach(box=>{
      if(box.querySelector('.aug-low-soc'))return;
      const match=box.textContent.match(/arrivée\s+([0-9]+(?:[.,][0-9]+)?)\s*%/i);
      if(!match)return;
      const soc=Number(match[1].replace(',','.'));
      if(Number.isFinite(soc)&&soc<margin){
        const warning=document.createElement('div');warning.className='warn small aug-low-soc';warning.innerHTML=`<b>⚠ Arrivée sous la marge de sécurité réglée à ${margin.toFixed(0)} %.</b>`;box.appendChild(warning);
      }
    });
  }

  function refresh(){refreshTeslaIntro();addEffectiveRateNote();expandCountryNames();addLowSocWarnings()}
  refresh();
  const observer=new MutationObserver(()=>refresh());
  observer.observe(document.body,{childList:true,subtree:true});
})();
