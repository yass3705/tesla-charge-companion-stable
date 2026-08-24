// Tesla Charge Companion V8 RC4.8 — ancien correctif E55C désactivé.
// PARKING_TIME signifie « véhicule stationné sans recharger ». Le moteur TCC
// l'applique nativement via idlePerMinute, uniquement après la fin de charge.
// Ce fichier reste comme garde-fou de compatibilité mais n'enveloppe plus le calcul.
(function(){
  'use strict';
  const REVISION='rc48-e55c-idle-2';
  window.TCCV8E55CPricing={
    revision:REVISION,
    deprecated:true,
    parkingTimeSemantics:'parked_not_charging',
    installPricing(){return true;}
  };
})();
