"""Record the complete perceived glyph vocabulary; never inspect game entities."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent.parent
entries = []
def add(ident, glyph, name, group, sheet, index, rotation=0):
    entries.append(dict(id=ident, glyph=glyph, meaning=name, group=group,
                        sheet=sheet, index=index, rotation=rotation))

terrain = [('unexplored',' ','Unexplored or unlit'),('floor','.','Room floor'),
           ('passage','#','Passage'),('door','+','Door'),
           ('wall_horizontal','-','Horizontal wall'),('wall_vertical','|','Vertical wall'),
           ('stairs','%','Stairs down'),('trap','^','Visible trap (all eight types)')]
for i,(ident,glyph,name) in enumerate(terrain):
    add('terrain.'+ident,glyph,name,'terrain','terrain-actors',i)
add('actor.player','@','Player adventurer','actor','terrain-actors',8)
add('marker.magic','$','Magic detection marker','marker','terrain-actors',9)
for ident,glyph,rotation in [('horizontal','-',0),('vertical','|',90),('slash','/',-45),('backslash','\\',45)]:
    add('effect.bolt_'+ident,glyph,'Visible bolt '+ident,'effect','terrain-actors',10,rotation)
items = [('gold','*','Gold coins'),('potion','!','Unidentified potion'),
         ('scroll','?','Unidentified scroll'),('food',':','Food'),
         ('weapon',')','Weapon / thrown weapon'),('armor',']','Armor'),
         ('ring','=','Ring'),('stick','/','Wand or staff'),('amulet',',','Amulet of Yendor')]
for i,(ident,glyph,name) in enumerate(items):
    add('item.'+ident,glyph,name,'item','items',i)
source=(ROOT/'logic/extern.c').read_text(encoding='utf-8')
block=source.split('struct monster monsters[26]',1)[1].split('#undef ___',1)[0]
monsters=re.findall(r'\{\s*"([^"]+)"',block)
assert len(monsters)==26
for i,name in enumerate(monsters):
    add('monster.'+name.replace(' ','_'),chr(65+i),name,'monster',f'monsters-{i//9+1}',i%9)
assert len(entries)==49 and len({x['id'] for x in entries})==49
manifest=dict(schema_version=1,style='simple fantasy, thick dark outlines, flat readable colors',
              asset_id_count=len(entries),source_release='RRP Rogue 5.4.4',
              tile_pixels=96,default_display_pixels=32,
              sheets={'terrain-actors':{'columns':4,'rows':3},'items':{'columns':3,'rows':3},
                      **{f'monsters-{i}':{'columns':3,'rows':3} for i in range(1,4)}},
              entries=entries,
              trap_subtypes=['trapdoor','arrow','sleeping gas','bear trap','teleport','poison dart','rust','mysterious'],
              visibility_policy='Only currently presented cells; no hidden subtype, disguise, FOV or RNG lookup',
              sources=['logic/rogue.h glyph and trap definitions','logic/extern.c monsters[26]',
                       'logic/rooms.c horiz/vert','logic/sticks.c bolt',
                       'logic/weapons.c do_motion','logic/misc.c rnd_thing','logic/potions.c MAGIC detection'])
out=ROOT/'web/assets/tiles'
out.mkdir(parents=True,exist_ok=True)
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
lines=['# Rogue image-tile inventory','',f'{len(entries)} semantic IDs; 46 unique raster tiles (square walls have horizontal/vertical stone patterns; four bolt orientations share one image).','',
       '| ID | Glyph | Meaning | Sheet / slot |','|---|---|---|---|']
for e in entries:
    glyph=e['glyph'].replace('|','&#124;') if e['glyph']!=' ' else 'space'
    lines.append(f"| {e['id']} | `{glyph}` | {e['meaning']} | {e['sheet']} / {e['index']} |")
lines+=['','Original map remains 80x24 cells. No animation assets are required: the existing C refresh sequence moves thrown items and beams. Graphical display must not enqueue keys or invoke RNG.',
        '', 'Hook: web/app.js redraw() / canvas#board. Read frame.map_cells and observational effect IDs; never read hidden places/objects/monsters.','',
        'Traps: trapdoor, arrow, sleep, bear, teleport, poison dart, rust, mysterious all retain the same visible trap image. Item subtypes retain their original category image until the text UI identifies them.']
(ROOT/'docs/TILE-INVENTORY.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps({'ids':len(entries),'raster_tiles':46,'manifest':str(out/'manifest.json'),'monster_names':monsters}))
