#!/usr/bin/env python3
from pathlib import Path
import sys

path=Path(sys.argv[1])
s=path.read_text(encoding='utf-8')
old="""  function etotemSections(value){
    const source=etotemNormTariff(value),marks=[];
    for(const match of source.matchAll(/(?:^|[\\n;])\\s*(AC|DC)\\s*(?=[:\\-–—]|\\d|\\s)/gi))marks.push({kind:match[1].toUpperCase(),index:match.index+(match[0].length-match[0].trimStart().length)});
    if(!marks.length){for(const match of source.matchAll(/\\b(AC|DC)\\b\\s*[:\\-–—]/gi))marks.push({kind:match[1].toUpperCase(),index:match.index});}
    marks.sort((a,b)=>a.index-b.index);const out={};
    for(let i=0;i<marks.length;i++){const mark=marks[i],end=marks[i+1]?.index??source.length;if(!out[mark.kind])out[mark.kind]=source.slice(mark.index,end).trim();}
    return {source,...out};
  }
"""
new="""  function etotemSections(value){
    const source=etotemNormTariff(value),marks=[];
    for(const match of source.matchAll(/\\b(AC|DC)\\b\\s*[:\\-–—]/gi))marks.push({kind:match[1].toUpperCase(),index:match.index});
    marks.sort((a,b)=>a.index-b.index);const out={};
    for(let i=0;i<marks.length;i++){const mark=marks[i],end=marks[i+1]?.index??source.length;if(!out[mark.kind])out[mark.kind]=source.slice(mark.index,end).trim();}
    return {source,...out};
  }
"""
if new in s:
    print('e-Totem AC/DC section parser already fixed')
elif old in s:
    path.write_text(s.replace(old,new,1),encoding='utf-8')
    print('e-Totem AC/DC section parser fixed')
else:
    raise SystemExit('Expected e-Totem section parser anchor not found')
