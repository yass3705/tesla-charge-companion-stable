#!/usr/bin/env python3
"""Deploy scoped V9 UI distinction: no source price vs computation ambiguity.

Tarif indisponible: no usable source tariff exists.
Tarif incalculable: a source offer exists but cannot resolve uniquely or lacks
needed session context, including contradictory Electroverse EVSE tariffs.
Never substitute a numeric total for a genuinely contradictory tariff.
"""
from __future__ import annotations
import argparse,pathlib

REPLACEMENTS=(
  (
"""  // A lane is evaluated independently. Distinct tariffs for a single EVSE/power
""",
"""  function sourcePriceIsPresent(item,station){
    const offered=(station?.offers||[]).find(x=>
      text(x?.id||x?.offerId)===text(item?.offerId));
    if(offered?.metadata?.tariffAmbiguous===true)return true;
    const price=offered?.pricing||item?.result?.matchedRule;
    if(!price)return false;
    if(Array.isArray(price.rules))return price.rules.length>0;
    return Boolean(price.type&&price.type!=='unavailable');
  }
  function tariffFailureLabel(evaluation,station){
    const candidates=[evaluation?.best,...(evaluation?.alternatives||[]),...(evaluation?.incomplete||[])]
      .filter(Boolean);
    const unresolved=candidates.filter(item=>item.comparable===false||num(item.total)==null);
    if(unresolved.some(item=>{
      const reason=text(item?.result?.reason||item?.incompletePricingReason).toLowerCase();
      return /ambig|conflict|contradict|multiple.*tariff|power_curve|power_minute|no_matching_time_rule|unresolved_tariff|requires_|unsupported|missing_session|unknown_conditional/.test(reason)
        ||sourcePriceIsPresent(item,station);
    }))return'Tarif incalculable';
    return'Tarif indisponible';
  }
  // A lane is evaluated independently. Distinct tariffs for a single EVSE/power
"""
  ),
  (
"""    if(amount==null)return'Tarif non disponible';""",
"""    if(amount==null)return'Tarif indisponible';"""
  ),
  (
"""      return item?'<div class="v9-tesla-price"><strong>Tesla</strong> · '+esc(displayAmount(item,fxRates))+'</div>':'<div class="v9-tesla-price">Tarif non disponible</div>';""",
"""      return item?'<div class="v9-tesla-price"><strong>Tesla</strong> · '+esc(displayAmount(item,fxRates))+'</div>':'<div class="v9-tesla-price">'+esc(tariffFailureLabel(evaluation,station))+'</div>';"""
  ),
  (
"""      const amount=state.status==='ambiguous'?'Tarif ambigu à vérifier auprès de l’opérateur'
        :state.status==='unresolved'?'Tarif à vérifier auprès de l’opérateur'
        :state.status==='priced'?displayAmount(displayItem,fxRates):'Tarif non disponible';""",
"""      const amount=state.status==='ambiguous'?'Tarif incalculable'
        :state.status==='unresolved'?tariffFailureLabel({incomplete:state.offers},station)
        :state.status==='priced'?displayAmount(displayItem,fxRates):'Tarif indisponible';"""
  ),
  (
"""      '<h3>4. Lire les prix</h3><p>Chaque puissance présente toujours Direct (ou l’abonnement sélectionné), Electra et Electroverse, dans cet ordre. « Prix non disponible » signifie qu’aucun prix comparable et validé n’est disponible dans cette catégorie. Le tarif le plus bas est mis en évidence.</p>'+""",
"""      '<h3>4. Lire les prix</h3><p>Chaque puissance présente Direct, Electra et Electroverse séparément. « Tarif indisponible » : aucun tarif source exploitable. « Tarif incalculable » : tarif présent mais ambigu, contradictoire ou incomplet pour la simulation. Aucun montant n’est inventé.</p>'+"""
  ),
)
def patch(s):
    if '  function tariffFailureLabel(evaluation,station)' in s:
        if 'Tarif ambigu à vérifier auprès de l’opérateur' in s:
            raise ValueError('Partial patch detected')
        return s
    for before,after in REPLACEMENTS:
        if s.count(before)!=1:
            raise ValueError(f'V9 bridge incompatibility: expected exactly 1 instance, found {s.count(before)}: {before[:95]}')
        s=s.replace(before,after,1)
    return s
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--bridge',type=pathlib.Path,required=True)
    args=ap.parse_args()
    original=args.bridge.read_text(encoding='utf8')
    result=patch(original)
    args.bridge.write_text(result,encoding='utf8')
    assert result.count('Tarif incalculable')>=3
    assert 'Tarif ambigu à vérifier auprès de l’opérateur' not in result
    print('TCC_V9_INCALCULABLE_LABELS_PATCHED bridge='+str(args.bridge))
if __name__=='__main__':main()
