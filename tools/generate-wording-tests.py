"""Generate test-only cases from every source message site and catalog ID."""
import argparse,json,re
from pathlib import Path
from generate_catalog import source_calls,assign_ids
ROOT=Path(__file__).resolve().parents[1]
SPEC=re.compile(r'%(?:[-+ #0]*)(?P<width>\d+|\*)?(?:\.(?P<precision>\d+|\*))?(?P<length>hh|ll|[hljztL])?(?P<conversion>[diuoxXfFeEgGaAcspn%])')
def quote(s):return json.dumps(s,ensure_ascii=False)
def scalar_args(entry,variant=7):
    template=entry.get('template','');convs=entry.get('conversions',[])
    size=max([int(x)+1 for x in re.findall(r'\{(\d+)\}',template)]+[len(convs),len(entry.get('argument_types',[])),0])
    args=[]
    for i in range(size):
        conv=convs[i] if i<len(convs) else 's'
        vals=entry.get('argument_values',{}).get(str(i),{})
        if vals:kind,value='string',next(iter(vals))
        elif conv=='c':kind,value='signed',97
        elif conv in ['d','i','width','precision']:kind,value='signed',variant
        elif conv in ['u','x','X','o']:kind,value='unsigned',abs(variant)
        elif conv in 'fFeEgGaA':kind,value='float',float(variant)+.25
        else:kind,value='string','検証名'+str(i)
        args.append({'kind':kind,'value':value})
    return args

def generate(root=ROOT):
    catalogs={f:json.loads((root/'locales'/f).read_text(encoding='utf-8'))['messages'] for f in ['en.json','ja.json','ui-game-ja.json','runtime-ja.json','endings-ja.json']}
    calls=[c for p in sorted((root/'logic').glob('*.c')) for c in source_calls(p)]
    assign_ids(calls,catalogs['en.json'])
    rows=[];manifest=[]
    def direct(case,id,args,negative=False):
        manifest.append({'case':case,'id':id,'negative':negative})
        rows.append(f'    wording_direct({quote(case)}, {quote(id)}, {quote(json.dumps(args,ensure_ascii=False))});')
    for c in calls:
        for fmt in c['formats']:
            if not fmt:
                case=f'clear:{c["file"]}:{c["line"]}'
                manifest.append({'case':case,'id':'message.clear','negative':False,'site':[c['file'],c['line']]})
                rows.append(f'    wording_clear({quote(case)}, {quote(c["file"])}, {c["end_line"]});')
                continue
            id=c['ids'][fmt];entry=catalogs['ja.json'][id]
            variants=[-7,0,7] if any(s['conversion'] in 'diuoxXfFeEgGaA' for s in SPEC.finditer(fmt)) else [7]
            for n in variants:
                values=[];index=0
                for s in SPEC.finditer(fmt):
                    conv=s['conversion'];length=s['length'] or ''
                    if conv=='%':continue
                    for control in ['width','precision']:
                        if s[control]=='*':values.append('8' if control=='width' else '2');index+=1
                    role=entry.get('argument_roles',{}).get(str(index));finite=entry.get('argument_values',{}).get(str(index),{})
                    if conv=='s':
                        if finite:value=quote(next(iter(finite)))
                        elif role=='item':value='wording_item()'
                        elif role=='monster':value='wording_monster()'
                        elif role=='color':value='rainbow[2]'
                        else:value=quote('検証名'+str(index))
                    elif conv=='c':value="'a'"
                    elif conv in 'fFeEgGaA':value=f'({"long double" if length=="L" else "double"}){n}.25'
                    elif conv in 'di':value='('+{"l":"long","ll":"long long","j":"intmax_t","z":"ptrdiff_t","t":"ptrdiff_t"}.get(length,"int")+')'+str(n)
                    elif conv in 'uoxX':value='('+{"l":"unsigned long","ll":"unsigned long long","j":"uintmax_t","z":"size_t","t":"uintptr_t"}.get(length,"unsigned int")+')'+str(abs(n))
                    else:raise ValueError((id,conv))
                    values.append(value);index+=1
                case=f'site:{c["file"]}:{c["line"]}:{id}:{n}'
                manifest.append({'case':case,'id':id,'negative':False,'site':[c['file'],c['line']]})
                rows.append(f'    wording_delta = {n}; wording_site({quote(case)}, {quote(id)}, {quote(c["file"])}, {c["end_line"]}, {quote(fmt)}'+(' ,'+','.join(values) if values else '')+');')
    merged={}
    for family in ['ja.json','ui-game-ja.json','runtime-ja.json','endings-ja.json']:merged.update(catalogs[family])
    # Every ID reaches the actual compiled Rust renderer, including non-C UI IDs.
    for id,entry in merged.items():
        if id in ['message.clear','message.sequence','message.legacy']:continue
        values=scalar_args(entry)
        direct('id:'+id,id,values,id=='ui.untranslated')
        for index,finite in entry.get('argument_values',{}).items():
            for token in finite:
                alt=json.loads(json.dumps(values));alt[int(index)]={'kind':'string','value':token}
                direct(f'token:{id}:{index}:{token}',id,alt)
    # Actual semantic item names and all finite types/knownness/quantity/bonuses.
    for category,size in [('weapon',9),('armor',8),('potion',14),('scroll',18),('ring',14),('stick',14),('food',2)]:
        for which in range(size):
            for known in ([True,False] if category in ['potion','scroll','ring','stick'] else [True]):
                for count,n in [(1,-7),(1,0),(3,7)]:
                    item={'type':'item','category':category,'which':which if known else None,'count':count,'known':known,'identified':known,'hplus':n,'dplus':n,'enchantment':n,'protection':7,'charges':abs(n),'bonus':n,'equipped':'none','visible_fields':{'hplus':category=='weapon' and known,'dplus':category=='weapon' and known,'ac':category=='armor' and known,'charges':category=='stick' and known,'ring_bonus':category=='ring' and known and which in [0,1,7,8]},'appearance':{'kind':'scroll_title','text':'検証用の巻物'} if category=='scroll' else {'kind':'color' if category=='potion' else 'stone' if category=='ring' else 'metal','id':2},'subtype':'wand'}
                    direct(f'item:{category}:{which}:{known}:{count}:{n}','message.entity',[{'kind':'entity','value':item}])
    for index in range(26):direct(f'monster:{index}','message.entity',[{'kind':'entity','value':{'type':'monster','display':'name','index':index}}])
    for index in range(8):direct(f'trap:{index}','message.entity',[{'kind':'entity','value':{'type':'trap','index':index}}])
    # Dynamic C sites carry descriptors chosen by source APIs. Vararg helpers
    # retain their one argument; arbitrary MASTER debug text is a negative case.
    for c in calls:
        if c['formats']:continue
        case=f'dynamic:{c["file"]}:{c["line"]}:{c["expression"]}'
        if c['file']=='misc.c' and c['function']=='find_obj':
            expected='message.legacy';expr=quote('Non-object 1,2');negative=True
        elif c['argument_count']:
            expected='ui.text';expr=quote('%s')+','+quote('検証用の動的文字列');negative=False
        elif c['file']=='pack.c':expected='message.entity';expr='wording_term()';negative=False
        elif c['file']=='wizard.c':expected='message.entity';expr='wording_item()';negative=False
        elif c['file']=='command.c':expected='message.entity';expr='tr_name[2]';negative=False
        elif c['file']=='misc.c':expected='message.entity';expr='wording_direction()';negative=False
        elif c['file']=='potions.c':expected='message.entity';expr='wording_potion()';negative=False
        elif c['expression']=='m_names[i]':expected='message.entity';expr='m_names[1]';negative=False
        elif c['file']=='fight.c' and c['expression']=='s':expected='message.entity';expr='h_names[1]';negative=False
        else:expected='message.entity';expr='wording_monster()';negative=False
        manifest.append({'case':case,'id':expected,'negative':negative,'site':[c['file'],c['line']]})
        rows.append(f'    wording_site({quote(case)}, {quote(expected)}, {quote(c["file"])}, {c["end_line"]}, {expr});')
    direct('negative:missing-id','test.missing.translation',[],True)
    direct('negative:missing-argument','weapons.wield.wielding',[],True)
    direct('negative:unknown-entity','message.entity',[{'kind':'entity','value':{'type':'test_unknown'}}],True)
    direct('control:clear','message.clear',[])
    body='/* Generated test-only cases; regenerate with tools/generate-wording-tests.py. */\n'+ '\n'.join(rows)+'\n'
    (root/'tests/wording-cases.generated.inc').write_text(body,encoding='utf-8',newline='\n')
    (root/'tests/wording-cases.generated.json').write_text(json.dumps({'cases':manifest,'source_calls':len(calls),'catalog_ids':len(merged),'dynamic_sites':len([c for c in calls if not c['formats']])},ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'wording_cases':len(manifest),'source_calls':len(calls),'catalog_ids':len(merged)}))
if __name__=='__main__':generate()
