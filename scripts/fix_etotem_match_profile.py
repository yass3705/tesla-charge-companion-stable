#!/usr/bin/env python3
from pathlib import Path
import sys

HELPERS = r'''  function etotemMatchProfile(value){
    const source=norm(value);if(!source)return '';
    if(/(?:^|\s)e\s*fast(?:\s|$)/.test(source)||source.includes('efast'))return 'fast';
    if(/(?:^|\s)e\s*smart(?:\s|$)/.test(source)||source.includes('esmart'))return 'smart';
    return '';
  }
  function etotemTechnicalGroupsFromStation(station){
    const raw=(station?.chargingConfigurations||[]).map(config=>({kind:text(config?.kind).toUpperCase(),power:Number(config?.powerKw||0)})).filter(group=>(group.kind==='AC'||group.kind==='DC')&&group.power>0);
    if(raw.length)return raw;
    const kind=text(station?.kind).toUpperCase(),power=Number(station?.powerKw||0);
    return (kind==='AC'||kind==='DC')&&power>0?[{kind,power}]:[];
  }
  function etotemTechnicalMatch(record,station){
    const source=etotemPdcGroups(record).map(group=>({kind:group.kind,power:Number(group.power||0)})).filter(group=>group.power>0);
    const target=etotemTechnicalGroupsFromStation(station);
    if(!source.length||!target.length)return {tier:0,powerDelta:Number.POSITIVE_INFINITY};
    const sameKind=[];
    for(const a of source)for(const b of target)if(a.kind===b.kind)sameKind.push(Math.abs(a.power-b.power));
    if(!sameKind.length)return {tier:-1,powerDelta:Number.POSITIVE_INFINITY};
    const powerDelta=Math.min(...sameKind),reference=Math.max(1,...source.map(group=>group.power));
    const close=powerDelta<=Math.max(3,reference*.2);
    return {tier:close?2:1,powerDelta};
  }
  function etotemVariantMatch(record,station){
    const a=etotemMatchProfile(record?.name||record?.api?.sNomStation||record?.api?.sNomReseau),b=etotemMatchProfile(station?.name);
    if(!a||!b)return 0;
    return a===b?1:-1;
  }
'''

OLD_HELPER = r'''  function etotemNameScore(record,station){
    const a=norm(record?.name),b=norm(station?.name);if(!a||!b)return 0;const words=[...new Set(a.split(' ').filter(w=>w.length>=4&&!['totem','borne','station','recharge'].includes(w)))];return words.filter(w=>b.includes(w)).length;
  }
'''

OLD_MATCH = r'''        const operatorLike=isEtotemOperator(station),nameScore=etotemNameScore(record,station);if(!operatorLike&&distance>.02&&nameScore<2)continue;
        candidates.push({index,station,distance,operatorLike,nameScore});
      }
      candidates.sort((a,b)=>(Number(b.operatorLike)-Number(a.operatorLike))||(b.nameScore-a.nameScore)||(a.distance-b.distance));
      if(candidates.length){const best=candidates[0];if(best.operatorLike||best.nameScore>=2||best.distance<=.012){assignments.set(record.stationId,[best.station]);consumed.add(best.index);}}
'''

NEW_MATCH = r'''        const operatorLike=isEtotemOperator(station),nameScore=etotemNameScore(record,station),variantMatch=etotemVariantMatch(record,station),technical=etotemTechnicalMatch(record,station);if(!operatorLike&&distance>.02&&nameScore<2)continue;
        candidates.push({index,station,distance,operatorLike,nameScore,variantMatch,technicalTier:technical.tier,powerDelta:technical.powerDelta});
      }
      candidates.sort((a,b)=>(b.variantMatch-a.variantMatch)||(b.technicalTier-a.technicalTier)||(Number(b.operatorLike)-Number(a.operatorLike))||(b.nameScore-a.nameScore)||(a.powerDelta-b.powerDelta)||(a.distance-b.distance));
      if(candidates.length){const best=candidates[0];if(best.variantMatch>=0&&best.technicalTier>=0&&(best.operatorLike||best.nameScore>=2||best.distance<=.012)){assignments.set(record.stationId,[best.station]);consumed.add(best.index);}}
'''


def main():
    if len(sys.argv)!=2:
        raise SystemExit('usage: fix_etotem_match_profile.py <assets/france-catalog-v8.js>')
    path=Path(sys.argv[1])
    text=path.read_text(encoding='utf-8')

    if 'function etotemMatchProfile(' not in text:
        if OLD_HELPER not in text:
            raise SystemExit('missing e-Totem name-score anchor')
        text=text.replace(OLD_HELPER,OLD_HELPER+HELPERS,1)

    if 'technicalTier:technical.tier' not in text:
        if OLD_MATCH not in text:
            raise SystemExit('missing e-Totem matching anchor')
        text=text.replace(OLD_MATCH,NEW_MATCH,1)

    path.write_text(text,encoding='utf-8')
    print('e-Totem technical/variant matching guard applied')


if __name__=='__main__':
    main()
