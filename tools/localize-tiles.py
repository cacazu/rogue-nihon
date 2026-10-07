from pathlib import Path
import json
ROOT=Path(__file__).resolve().parent.parent
translations={
 'form.display_mode':('地図の表示','Map display'), 'view.tiles':('画像','Images'),
 'view.ascii':('文字','Characters'), 'form.zoom':('拡大率','Zoom'),
 'action.center':('自分の位置へ','Center on player'), 'action.fullscreen':('全画面','Fullscreen'),
 'error.tiles':('地図の画像を読み込めませんでした。ページを再読み込みしてください。','Map images could not load. Please reload the page.'),
 'error.fullscreen':('全画面表示を開けませんでした。','Fullscreen is unavailable.'),
}
for language,index in [('ja',0),('en',1)]:
 path=ROOT/f'locales/ui-web-{language}.json'
 data=json.loads(path.read_text(encoding='utf-8-sig'))
 data['messages'].update({key:values[index] for key,values in translations.items()})
 path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
manifest_path=ROOT/'web/assets/tiles/manifest.json'
manifest=json.loads(manifest_path.read_text(encoding='utf-8-sig'))
names={'terrain.unexplored':'暗闇','terrain.floor':'床','terrain.passage':'通路','terrain.door':'扉',
       'terrain.wall_horizontal':'横向きの壁','terrain.wall_vertical':'縦向きの壁','terrain.stairs':'下り階段',
       'terrain.trap':'罠','actor.player':'あなた','marker.magic':'魔力の反応',
       'item.gold':'金貨','item.potion':'薬','item.scroll':'巻物','item.food':'食料','item.weapon':'武器',
       'item.armor':'防具','item.ring':'指輪','item.stick':'杖','item.amulet':'イェンダーの魔除け',
       'effect.bolt_horizontal':'横向きの光線','effect.bolt_vertical':'縦向きの光線',
       'effect.bolt_slash':'右上がりの光線','effect.bolt_backslash':'右下がりの光線'}
entities=json.loads((ROOT/'locales/entities-ja.json').read_text(encoding='utf-8'))['entries']
for entry in manifest['entries']:
 ja=entities[entry['id']]['text'] if entry['id'].startswith('monster.') else names[entry['id']]
 entry['labels']={'ja':ja,'en':entry['meaning']}
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('49 graphical labels and 8 UI IDs localized in Japanese/English')
