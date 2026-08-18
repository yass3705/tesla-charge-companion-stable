// Tesla Charge Companion V8 — profils véhicule Tesla France (2019–2026).
// Données modèle/batterie issues des tableaux BlogTesla fournis pour la V8.
// La capacité indiquée par ces tableaux est la capacité TOTALE du pack : elle n'est jamais
// utilisée comme capacité utile de simulation. La capacité utile reste une saisie utilisateur.
(function(){
  'use strict';
  const years=(a,b)=>Array.from({length:b-a+1},(_,i)=>a+i);
  const p=(o)=>({
    acMaxKw:11,
    acMaxSource:'companion-assumption',
    source:'BlogTesla',
    ...o,
    cityConsumption:o.cityConsumption??Number((o.referenceConsumption*0.86).toFixed(1)),
    fastConsumption:o.fastConsumption??Number((o.referenceConsumption*0.95).toFixed(1)),
    motorwayConsumption:o.motorwayConsumption??Number((o.referenceConsumption*1.24).toFixed(1))
  });
  window.TCC_VEHICLE_CATALOG={
    schemaVersion:3,
    note:'Capacités totales, références batterie, chimies, consommations WLTP et puissances DC : tableaux BlogTesla fournis par l’utilisateur. La capacité utile reste saisie manuellement. Les profils ville/voie rapide/autoroute et certaines limites non publiées restent des hypothèses Companion.',
    models:[
      {id:'S',label:'Model S',trims:[
        p({id:'long-range',label:'Model S · 19″ · b1',years:[2022,2023,2024],batteryRef:'b1',batteryMaker:'Panasonic',chemistry:'NMC',batteryTotalKwh:100,wheels:'19″',referenceConsumption:13.1,dcMaxKw:250,curve:'dc250'}),
        p({id:'long-range-21',label:'Model S · 21″ · b1',years:[2022,2023,2024],batteryRef:'b1',batteryMaker:'Panasonic',chemistry:'NMC',batteryTotalKwh:100,wheels:'21″',referenceConsumption:15.0,dcMaxKw:250,curve:'dc250'}),
        p({id:'plaid',label:'Plaid · 19″ · b1',years:[2022,2023,2024],batteryRef:'b1',batteryMaker:'Panasonic',chemistry:'NMC',batteryTotalKwh:100,wheels:'19″',referenceConsumption:13.7,dcMaxKw:250,curve:'dc250'}),
        p({id:'plaid-21',label:'Plaid · 21″ · b1',years:[2022,2023,2024],batteryRef:'b1',batteryMaker:'Panasonic',chemistry:'NMC',batteryTotalKwh:100,wheels:'21″',referenceConsumption:15.8,dcMaxKw:250,curve:'dc250'})
      ]},
      {id:'3',label:'Model 3',trims:[
        p({id:'sr-plus-panasonic-2019-20',label:'SR+ · Panasonic E1R/E1CR',years:[2019,2020],batteryRef:'E1R / E1CR',batteryMaker:'Panasonic',chemistry:'NMC',batteryTotalKwh:52.4,referenceConsumption:13.6,dcMaxKw:170,curve:'dc175'}),
        p({id:'sr-plus-catl-2020-21',label:'SR+ · CATL E6R',years:[2020,2021],batteryRef:'E6R',batteryMaker:'CATL',chemistry:'LFP',batteryTotalKwh:55.1,referenceConsumption:14.2,dcMaxKw:170,curve:'dc175'}),
        p({id:'sr-plus-panasonic-2021',label:'SR+ · Panasonic E1LR',years:[2021],batteryRef:'E1LR',batteryMaker:'Panasonic',chemistry:'NMC',batteryTotalKwh:55.4,referenceConsumption:13.0,dcMaxKw:170,curve:'dc175'}),
        p({id:'sr-plus-catl-2021',label:'SR+ · CATL E6R/E6CR',years:[2021],batteryRef:'E6R / E6CR',batteryMaker:'CATL',chemistry:'LFP',batteryTotalKwh:55.1,referenceConsumption:14.2,dcMaxKw:170,curve:'dc175'}),
        p({id:'rwd',label:'Propulsion · CATL E6LR',years:[2021,2022,2023],batteryRef:'E6LR',batteryMaker:'CATL',chemistry:'LFP',batteryTotalKwh:60,referenceConsumption:14.4,dcMaxKw:170,curve:'dc175'}),
        p({id:'highland-rwd-h6lr',label:'Highland Propulsion · H6LR',years:[2023,2024],batteryRef:'H6LR',batteryMaker:'CATL',chemistry:'LFP',batteryTotalKwh:60,referenceConsumption:13.2,dcMaxKw:170,curve:'dc175'}),
        p({id:'highland-lr-rwd-18',label:'Highland Propulsion Grande Autonomie · 18″ · H5LD',years:[2024],batteryRef:'H5LD',batteryMaker:'LG Chem',chemistry:'NMC',batteryTotalKwh:78.8,wheels:'18″',referenceConsumption:12.5,dcMaxKw:250,curve:'dc250'}),
        p({id:'highland-lr-rwd-19',label:'Highland Propulsion Grande Autonomie · 19″ · H5LD',years:[2024],batteryRef:'H5LD',batteryMaker:'LG Chem',chemistry:'NMC',batteryTotalKwh:78.8,wheels:'19″',referenceConsumption:13.6,dcMaxKw:250,curve:'dc250'}),
        p({id:'highland-lr-awd',label:'Highland Long Range · H5LD',years:[2023,2024],batteryRef:'H5LD',batteryMaker:'LG Chem',chemistry:'NMC',batteryTotalKwh:78.8,referenceConsumption:14.7,dcMaxKw:250,curve:'dc250'}),
        p({id:'highland-performance',label:'Highland Performance · H5LD',years:[2024],batteryRef:'H5LD',batteryMaker:'LG Chem',chemistry:'NMC',batteryTotalKwh:78.8,wheels:'20″',referenceConsumption:16.7,dcMaxKw:250,curve:'dc250'}),
        p({id:'highland-rwd-2025',label:'Highland Propulsion · H6MR',years:[2025],batteryRef:'H6MR',batteryMaker:'CATL',chemistry:'LFP',batteryTotalKwh:62.5,wheels:'19″',referenceConsumption:13.8,dcMaxKw:180,curve:'dc175'}),
        p({id:'rwd-2026',label:'Standard Propulsion · CATL 6M · H6MR',years:[2026],batteryRef:'H6MR',batteryMaker:'CATL 6M',chemistry:'LFP',batteryTotalKwh:64,wheels:'18″',referenceConsumption:13.8,dcMaxKw:175,curve:'dc175'}),
        p({id:'lr-rwd',label:'Premium Grande Autonomie Propulsion · 18″ · LG 5M · H5MR',years:[2026],batteryRef:'H5MR',batteryMaker:'LG 5M',chemistry:'NMC',batteryTotalKwh:84,wheels:'18″',referenceConsumption:12.6,dcMaxKw:250,curve:'dc250'}),
        p({id:'lr-rwd-19-2026',label:'Premium Grande Autonomie Propulsion · 19″ · LG 5M · H5MR',years:[2026],batteryRef:'H5MR',batteryMaker:'LG 5M',chemistry:'NMC',batteryTotalKwh:84,wheels:'19″',referenceConsumption:13.6,dcMaxKw:250,curve:'dc250'}),
        p({id:'lr-awd',label:'Premium Grande Autonomie Intégrale · LG 5M · H5MD',years:[2026],batteryRef:'H5MD',batteryMaker:'LG 5M',chemistry:'NMC',batteryTotalKwh:84,wheels:'18″ / 19″',referenceConsumption:14.3,dcMaxKw:250,curve:'dc250'}),
        p({id:'performance',label:'Performance Grande Autonomie Intégrale · LG 5M · H5MD',years:[2026],batteryRef:'H5MD',batteryMaker:'LG 5M',chemistry:'NMC',batteryTotalKwh:84,wheels:'20″',referenceConsumption:16.5,dcMaxKw:250,curve:'dc250'})
      ]},
      {id:'X',label:'Model X',trims:[
        p({id:'long-range',label:'Model X · 20″ · b1',years:[2022,2023,2024],batteryRef:'b1',batteryMaker:'Panasonic',chemistry:'NMC',batteryTotalKwh:100,wheels:'20″',referenceConsumption:15.2,dcMaxKw:250,curve:'dc250'}),
        p({id:'long-range-22',label:'Model X · 22″ · b1',years:[2022,2023,2024],batteryRef:'b1',batteryMaker:'Panasonic',chemistry:'NMC',batteryTotalKwh:100,wheels:'22″',referenceConsumption:16.5,dcMaxKw:250,curve:'dc250'}),
        p({id:'plaid',label:'Plaid · 20″ · b1',years:[2022,2023,2024],batteryRef:'b1',batteryMaker:'Panasonic',chemistry:'NMC',batteryTotalKwh:100,wheels:'20″',referenceConsumption:16.2,dcMaxKw:250,curve:'dc250'}),
        p({id:'plaid-22',label:'Plaid · 22″ · b1',years:[2022,2023,2024],batteryRef:'b1',batteryMaker:'Panasonic',chemistry:'NMC',batteryTotalKwh:100,wheels:'22″',referenceConsumption:17.5,dcMaxKw:250,curve:'dc250'})
      ]},
      {id:'Y',label:'Model Y',trims:[
        p({id:'rwd-2022-24-catl',label:'Propulsion · CATL · Y6LR',years:[2022,2023,2024],batteryRef:'Y6LR',batteryMaker:'CATL',chemistry:'LFP',batteryTotalKwh:60,referenceConsumption:16.4,dcMaxKw:170,curve:'dc175'}),
        p({id:'rwd-2022-24-byd',label:'Propulsion · BYD · Y7CR',years:[2022,2023,2024],batteryRef:'Y7CR',batteryMaker:'BYD',chemistry:'LFP',batteryTotalKwh:60,referenceConsumption:16.4,dcMaxKw:170,curve:'dc175'}),
        p({id:'lr-awd-2021',label:'Long Range · LG · Y5CD',years:[2021],batteryRef:'Y5CD',batteryMaker:'LG Chem',chemistry:'NMC',batteryTotalKwh:75,referenceConsumption:17.2,dcMaxKw:250,curve:'dc250'}),
        p({id:'lr-awd-2022-24',label:'Long Range · LG · Y5LD',years:[2022,2023,2024],batteryRef:'Y5LD',batteryMaker:'LG Chem',chemistry:'NMC',batteryTotalKwh:78.8,referenceConsumption:17.2,dcMaxKw:250,curve:'dc250'}),
        p({id:'lr-rwd-2024',label:'Long Range Propulsion · LG · Y5LR',years:[2024],batteryRef:'Y5LR',batteryMaker:'LG Chem',chemistry:'NMC',batteryTotalKwh:78.8,wheels:'19″',referenceConsumption:16.3,dcMaxKw:250,curve:'dc250'}),
        p({id:'performance-2022-24',label:'Performance · LG · Y5LD',years:[2022,2023,2024],batteryRef:'Y5LD',batteryMaker:'LG Chem',chemistry:'NMC',batteryTotalKwh:78.8,referenceConsumption:18.1,dcMaxKw:250,curve:'dc250'}),
        p({id:'rwd-2025',label:'Nouveau Model Y Propulsion · CATL · YS6MR',years:[2025],batteryRef:'YS6MR',batteryMaker:'CATL',chemistry:'LFP',batteryTotalKwh:62.5,wheels:'19″ / 20″',referenceConsumption:13.9,dcMaxKw:180,curve:'dc175'}),
        p({id:'lr-rwd-2025',label:'Nouveau Model Y Propulsion Grande Autonomie · LG · YS5LR',years:[2025],batteryRef:'YS5LR',batteryMaker:'LG Chem',chemistry:'NMC',batteryTotalKwh:78.8,wheels:'19″',referenceConsumption:14.2,dcMaxKw:250,curve:'dc250'}),
        p({id:'lr-awd-2025',label:'Nouveau Model Y Dual Motor Grande Autonomie · LG · YS5LD',years:[2025],batteryRef:'YS5LD',batteryMaker:'LG Chem',chemistry:'NMC',batteryTotalKwh:78.8,wheels:'19″ / 20″',referenceConsumption:15.3,dcMaxKw:250,curve:'dc250'}),
        p({id:'rwd',label:'Standard Propulsion · CATL 6M · YB6MR',years:[2026],batteryRef:'YB6MR',batteryMaker:'CATL 6M',chemistry:'LFP',batteryTotalKwh:64,wheels:'18″',referenceConsumption:13.8,dcMaxKw:175,curve:'dc175'}),
        p({id:'lr-standard-rwd',label:'Standard Grande Autonomie Propulsion · Tesla 8L 4680 · 18″ · YB8LR',years:[2026],batteryRef:'YB8LR',batteryMaker:'Tesla 8L 4680',chemistry:'NMC',batteryTotalKwh:76,wheels:'18″',referenceConsumption:12.7,dcMaxKw:250,curve:'dc250'}),
        p({id:'lr-standard-rwd-19',label:'Standard Grande Autonomie Propulsion · Tesla 8L 4680 · 19″ · YB8LR',years:[2026],batteryRef:'YB8LR',batteryMaker:'Tesla 8L 4680',chemistry:'NMC',batteryTotalKwh:76,wheels:'19″',referenceConsumption:13.6,dcMaxKw:250,curve:'dc250'}),
        p({id:'lr-rwd',label:'Premium Grande Autonomie Propulsion · LG 5M · 20″ · YS5MR',years:[2026],batteryRef:'YS5MR',batteryMaker:'LG 5M',chemistry:'NMC',batteryTotalKwh:84,wheels:'20″',referenceConsumption:14.2,dcMaxKw:250,curve:'dc250'}),
        p({id:'lr-rwd-lg5m-19',label:'Premium Grande Autonomie Propulsion · LG 5M · 19″ · YS5MR',years:[2026],batteryRef:'YS5MR',batteryMaker:'LG 5M',chemistry:'NMC',batteryTotalKwh:84,wheels:'19″',referenceConsumption:14.2,consumptionSourceKnown:false,dcMaxKw:250,curve:'dc250'}),
        p({id:'lr-rwd-4680-20',label:'Premium Grande Autonomie Propulsion · Tesla 8L 4680 · 20″ · YS8LR',years:[2026],batteryRef:'YS8LR',batteryMaker:'Tesla 8L 4680',chemistry:'NMC',batteryTotalKwh:76,wheels:'20″',referenceConsumption:14.0,dcMaxKw:250,dcMaxSource:'companion-assumption',curve:'dc250'}),
        p({id:'lr-awd',label:'Premium Grande Autonomie Intégrale · LG 5M · YS5MD',years:[2026],batteryRef:'YS5MD',batteryMaker:'LG 5M',chemistry:'NMC',batteryTotalKwh:84,wheels:'19″ / 20″',referenceConsumption:15.9,dcMaxKw:250,curve:'dc250'}),
        p({id:'performance',label:'Performance Grande Autonomie Intégrale · LG 5M · YS5MD',years:[2026],batteryRef:'YS5MD',batteryMaker:'LG 5M',chemistry:'NMC',batteryTotalKwh:84,wheels:'21″',referenceConsumption:16.2,dcMaxKw:250,curve:'dc250'})
      ]},
      {id:'YL',label:'Model Y L',trims:[
        p({id:'lr-awd',label:'Premium Grande Autonomie Intégrale · 6 places · LG 5N · YL5ND',years:[2026],batteryRef:'YL5ND',batteryMaker:'LG 5N',chemistry:'NMC',batteryTotalKwh:88,wheels:'19″',referenceConsumption:14.6,dcMaxKw:250,curve:'dc250'})
      ]},
      {id:'custom',label:'Autre / configuration personnalisée',trims:[
        p({id:'custom',label:'Configuration personnalisée',years:years(2019,2026),batteryRef:null,batteryMaker:null,chemistry:null,batteryTotalKwh:null,referenceConsumption:16.0,cityConsumption:12.0,fastConsumption:14.0,motorwayConsumption:18.0,acMaxKw:22,dcMaxKw:350,curve:'dc250',custom:true,source:'manual'})
      ]}
    ]
  };
})();
