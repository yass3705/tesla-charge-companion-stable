// Tesla Charge Companion V8 — profils véhicule Tesla France (2020+).
// Les capacités utiles ne sont volontairement pas imposées : elles sont saisies par l'utilisateur.
(function(){
  'use strict';
  const years=(a,b)=>Array.from({length:b-a+1},(_,i)=>a+i);
  window.TCC_VEHICLE_CATALOG={
    schemaVersion:2,
    note:'Profils Companion : consommations et courbes de charge sont des valeurs de simulation modifiables. La capacité utile est saisie par l’utilisateur.',
    models:[
      {id:'S',label:'Model S',trims:[
        {id:'long-range',label:'Grande Autonomie / Long Range',years:years(2020,2026),referenceConsumption:19.0,cityConsumption:17.0,fastConsumption:18.0,motorwayConsumption:21.5,acMaxKw:11,dcMaxKw:250,curve:'dc250'},
        {id:'performance',label:'Performance',years:[2020],referenceConsumption:20.5,cityConsumption:18.5,fastConsumption:19.5,motorwayConsumption:23.0,acMaxKw:11,dcMaxKw:200,curve:'dc200'},
        {id:'plaid',label:'Plaid',years:years(2021,2026),referenceConsumption:20.0,cityConsumption:18.0,fastConsumption:19.0,motorwayConsumption:22.5,acMaxKw:11,dcMaxKw:250,curve:'dc250'}
      ]},
      {id:'3',label:'Model 3',trims:[
        {id:'sr-plus',label:'Standard Range Plus',years:[2020,2021],referenceConsumption:15.0,cityConsumption:12.5,fastConsumption:13.5,motorwayConsumption:17.5,acMaxKw:11,dcMaxKw:170,curve:'dc175'},
        {id:'rwd',label:'Propulsion',years:years(2022,2026),referenceConsumption:14.5,cityConsumption:12.0,fastConsumption:13.0,motorwayConsumption:17.0,acMaxKw:11,dcMaxKw:175,curve:'dc175'},
        {id:'lr-rwd',label:'Premium Grande Autonomie Propulsion',years:[2024,2025,2026],referenceConsumption:14.8,cityConsumption:12.2,fastConsumption:13.2,motorwayConsumption:17.3,acMaxKw:11,dcMaxKw:250,curve:'dc250'},
        {id:'lr-awd',label:'Grande Autonomie / Premium Grande Autonomie AWD',years:years(2020,2026),referenceConsumption:15.8,cityConsumption:13.0,fastConsumption:14.5,motorwayConsumption:18.3,acMaxKw:11,dcMaxKw:250,curve:'dc250'},
        {id:'performance',label:'Performance',years:years(2020,2026),referenceConsumption:17.3,cityConsumption:14.5,fastConsumption:16.0,motorwayConsumption:20.0,acMaxKw:11,dcMaxKw:250,curve:'dc250'}
      ]},
      {id:'X',label:'Model X',trims:[
        {id:'long-range',label:'Grande Autonomie / Long Range',years:years(2020,2026),referenceConsumption:21.5,cityConsumption:19.0,fastConsumption:20.5,motorwayConsumption:24.0,acMaxKw:11,dcMaxKw:250,curve:'dc250'},
        {id:'performance',label:'Performance',years:[2020],referenceConsumption:23.0,cityConsumption:20.5,fastConsumption:22.0,motorwayConsumption:25.5,acMaxKw:11,dcMaxKw:200,curve:'dc200'},
        {id:'plaid',label:'Plaid',years:years(2021,2026),referenceConsumption:22.5,cityConsumption:20.0,fastConsumption:21.5,motorwayConsumption:25.0,acMaxKw:11,dcMaxKw:250,curve:'dc250'}
      ]},
      {id:'Y',label:'Model Y',trims:[
        {id:'rwd',label:'Propulsion',years:[2022,2023,2024,2025,2026],referenceConsumption:15.5,cityConsumption:12.5,fastConsumption:14.0,motorwayConsumption:18.0,acMaxKw:11,dcMaxKw:175,curve:'dc175'},
        {id:'lr-standard-rwd',label:'Long Range RWD Standard (historique)',years:[2026],referenceConsumption:16.0,cityConsumption:12.5,fastConsumption:14.5,motorwayConsumption:18.5,acMaxKw:11,dcMaxKw:250,curve:'dc250',historical:true},
        {id:'lr-rwd',label:'Premium Grande Autonomie Propulsion',years:[2024,2025,2026],referenceConsumption:16.0,cityConsumption:12.0,fastConsumption:14.0,motorwayConsumption:18.0,acMaxKw:11,dcMaxKw:250,curve:'dc250'},
        {id:'lr-awd',label:'Grande Autonomie / Premium Grande Autonomie AWD',years:years(2020,2026),referenceConsumption:17.0,cityConsumption:13.5,fastConsumption:15.5,motorwayConsumption:19.5,acMaxKw:11,dcMaxKw:250,curve:'dc250'},
        {id:'performance',label:'Performance',years:[2021,2022,2023,2024,2025,2026],referenceConsumption:18.2,cityConsumption:14.5,fastConsumption:16.5,motorwayConsumption:21.0,acMaxKw:11,dcMaxKw:250,curve:'dc250'}
      ]},
      {id:'custom',label:'Autre / configuration personnalisée',trims:[
        {id:'custom',label:'Configuration personnalisée',years:years(2020,2026),referenceConsumption:16.0,cityConsumption:12.0,fastConsumption:14.0,motorwayConsumption:18.0,acMaxKw:22,dcMaxKw:350,curve:'dc250',custom:true}
      ]}
    ]
  };
})();
