# Technical extraction of newly generated pixel art; never resizes the illustration set.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$references=@([System.Drawing.Bitmap].Assembly.Location,[System.Drawing.Rectangle].Assembly.Location,(Join-Path $PSHOME 'ref\System.Collections.dll'))
$packing=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'pack-tiles.ps1') -Raw -Encoding UTF8
$start=$packing.IndexOf('using System;');$end=$packing.IndexOf("'@",$start)
if($start -lt 0 -or $end -le $start){throw 'Missing reviewed alpha-component extractor'}
$components=$packing.Substring($start,$end-$start).Replace('RogueAtlasComponents','RoguePixelComponents')
Add-Type -ReferencedAssemblies $references -TypeDefinition $components
Add-Type -ReferencedAssemblies $references -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
public static class RoguePixelPalette {
 public static void Reduce(Bitmap image,int limit) {
  var histogram=new Dictionary<int,int>();
  for(int y=0;y<image.Height;y++)for(int x=0;x<image.Width;x++) {
   var c=image.GetPixel(x,y);if(c.A==0)continue;int key=c.ToArgb();histogram[key]=histogram.ContainsKey(key)?histogram[key]+1:1;
  }
  var all=new List<int[]>();foreach(var pair in histogram){var c=Color.FromArgb(pair.Key);all.Add(new int[]{c.R,c.G,c.B,pair.Value});}
  if(all.Count==0)throw new InvalidOperationException("Empty generated sprite");
  var boxes=new List<List<int[]>>{all};
  while(boxes.Count<limit) {
   int chosen=-1,channel=0;double score=-1;
   for(int i=0;i<boxes.Count;i++) {
    if(boxes[i].Count<2)continue;int population=0;var lo=new int[]{255,255,255};var hi=new int[3];
    foreach(var c in boxes[i]){population+=c[3];for(int k=0;k<3;k++){lo[k]=Math.Min(lo[k],c[k]);hi[k]=Math.Max(hi[k],c[k]);}}
    for(int k=0;k<3;k++){double candidate=(hi[k]-lo[k])*Math.Sqrt(population);if(candidate>score){score=candidate;chosen=i;channel=k;}}
   }
   if(chosen<0)break;
   var box=boxes[chosen];int axis=channel;box.Sort((a,b)=>a[axis].CompareTo(b[axis]));int total=0;foreach(var c in box)total+=c[3];
   int cumulative=0,split=1;for(int i=0;i<box.Count-1;i++){cumulative+=box[i][3];split=i+1;if(cumulative>=total/2)break;}
   boxes[chosen]=box.GetRange(0,split);boxes.Add(box.GetRange(split,box.Count-split));
  }
  var palette=new List<Color>();foreach(var box in boxes){int population=0;var sums=new int[3];foreach(var c in box){population+=c[3];for(int k=0;k<3;k++)sums[k]+=c[k]*c[3];}palette.Add(Color.FromArgb(255,sums[0]/population,sums[1]/population,sums[2]/population));}
  for(int y=0;y<image.Height;y++)for(int x=0;x<image.Width;x++) {
   var c=image.GetPixel(x,y);if(c.A==0)continue;int distance=int.MaxValue;Color nearest=palette[0];
   foreach(var p in palette){int r=c.R-p.R,g=c.G-p.G,b=c.B-p.B,d=r*r+g*g+b*b;if(d<distance){distance=d;nearest=p;}}
   image.SetPixel(x,y,nearest);
  }
 }
}
'@
$root=Split-Path -Parent $PSScriptRoot;$dir=Join-Path $root 'web\assets\pixels'
$manifest=Get-Content -LiteralPath (Join-Path $dir 'manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
$sources=@{};$rectangles=@{};$isolated=@{};$done=@{};$records=@()
try {
 foreach($sheet in $manifest.sheets.PSObject.Properties){
  $image=[System.Drawing.Bitmap]::new((Join-Path $dir ('source\'+$sheet.Name+'.png')))
  if($image.GetPixel(0,0).A -ge 32){throw ('Atlas lacks transparency: '+$sheet.Name)}
  $sources[$sheet.Name]=$image;$rectangles[$sheet.Name]=[RoguePixelComponents]::Bounds($image,$sheet.Value.columns,$sheet.Value.rows)
  $isolated[$sheet.Name]=@(0..($sheet.Value.columns*$sheet.Value.rows-1)|ForEach-Object {[RoguePixelComponents]::Isolate($image,$_)} )
 }
 foreach($entry in $manifest.entries){
  $key=$entry.sheet+':'+$entry.index
  if($done.ContainsKey($key)){continue}
  $image=$isolated[$entry.sheet][$entry.index];$box=$rectangles[$entry.sheet][$entry.index]
  if($box.IsEmpty){throw ('Missing generated pixel sprite: '+$entry.id)}
  $bitmap=[System.Drawing.Bitmap]::new(32,32,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $opaque=$entry.id -in @('terrain.unexplored','terrain.floor','terrain.passage')
  $horizontal=$entry.id -eq 'terrain.wall_horizontal';$vertical=$entry.id -eq 'terrain.wall_vertical'
  if($opaque){$w=32;$h=32;$left=0;$top=0}
  else {
   $scale=30.0/[Math]::Max($box.Width,$box.Height)
   if($horizontal){$scale=32.0/$box.Width};if($vertical){$scale=32.0/$box.Height}
   $w=[Math]::Min(32,[int][Math]::Round($box.Width*$scale));$h=[Math]::Min(32,[int][Math]::Round($box.Height*$scale))
   $left=[int][Math]::Floor((32-$w)/2);$top=[int][Math]::Floor((32-$h)/2)
  }
  for($y=0;$y -lt 32;$y++){for($x=0;$x -lt 32;$x++){
   if($opaque){$bitmap.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(255,8,13,15))}
   if($x -lt $left -or $x -ge $left+$w -or $y -lt $top -or $y -ge $top+$h){continue}
   $sx=$box.X+[int][Math]::Floor(($x-$left+0.5)*$box.Width/$w);$sy=$box.Y+[int][Math]::Floor(($y-$top+0.5)*$box.Height/$h)
   $color=$image.GetPixel($sx,$sy)
   if($color.A -ge 128){$bitmap.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(255,$color.R,$color.G,$color.B))}
  }}
  $limit=if($entry.id -eq 'terrain.unexplored'){1}else{16};[RoguePixelPalette]::Reduce($bitmap,$limit)
  if($entry.id -in @('terrain.floor','terrain.passage')){
   for($i=0;$i -lt 32;$i++){$bitmap.SetPixel(31,$i,$bitmap.GetPixel(0,$i));$bitmap.SetPixel($i,31,$bitmap.GetPixel($i,0))}
  }
  if($horizontal){for($y=0;$y -lt 32;$y++){
   $first=-1;$last=-1;for($x=0;$x -lt 32;$x++){if($bitmap.GetPixel($x,$y).A){if($first -lt 0){$first=$x};$last=$x}}
   if($first -ge 0){for($x=0;$x -lt $first;$x++){$bitmap.SetPixel($x,$y,$bitmap.GetPixel($first,$y))};for($x=$last+1;$x -lt 32;$x++){$bitmap.SetPixel($x,$y,$bitmap.GetPixel($last,$y))}}
   $bitmap.SetPixel(31,$y,$bitmap.GetPixel(0,$y))
  }}
  if($vertical){for($x=0;$x -lt 32;$x++){
   $first=-1;$last=-1;for($y=0;$y -lt 32;$y++){if($bitmap.GetPixel($x,$y).A){if($first -lt 0){$first=$y};$last=$y}}
   if($first -ge 0){for($y=0;$y -lt $first;$y++){$bitmap.SetPixel($x,$y,$bitmap.GetPixel($x,$first))};for($y=$last+1;$y -lt 32;$y++){$bitmap.SetPixel($x,$y,$bitmap.GetPixel($x,$last))}}
   $bitmap.SetPixel($x,31,$bitmap.GetPixel($x,0))
  }}
  $filename=$entry.image;$path=Join-Path $dir $filename;$bitmap.Save($path,[System.Drawing.Imaging.ImageFormat]::Png);$bitmap.Dispose();$done[$key]=$filename
  $records+=[ordered]@{id=$entry.id;file=$filename;source=$entry.sheet;crop=@($box.X,$box.Y,$box.Width,$box.Height);sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
 }
 $record=[ordered]@{tool='built-in image_gen';native_pixels=32;semantic_ids=49;unique_pngs=$records.Count;max_colors_per_sprite=16;alpha_values=@(0,255);packing='Newly generated pixel-art atlases; component isolation, nearest-neighbor native sampling, binary alpha, median-cut palette; periodic terrain edge alignment';images=$records}
 [IO.File]::WriteAllText((Join-Path $dir 'generation.json'),(($record|ConvertTo-Json -Depth 9).Replace("`r`n","`n")+"`n"),[Text.UTF8Encoding]::new($false))
 Write-Output ('Packed '+$records.Count+' newly generated, 32x32 pixel-art PNGs')
} finally{foreach($image in $sources.Values){$image.Dispose()};foreach($list in $isolated.Values){foreach($image in $list){$image.Dispose()}}}
