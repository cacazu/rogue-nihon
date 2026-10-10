# Technical raster extraction/packing of image_gen outputs, without redrawing art.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies @([System.Drawing.Bitmap].Assembly.Location,[System.Drawing.Rectangle].Assembly.Location,(Join-Path $PSHOME 'ref\System.Collections.dll')) -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class RogueAtlasComponents {
 static int[] owner;
 public static Rectangle[] Bounds(Bitmap source,int cols,int rows) {
  int w=source.Width,h=source.Height,n=w*h;
  var bounds=new Rectangle[cols*rows];
  var rect=new Rectangle(0,0,w,h);
  var bits=source.LockBits(rect,ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
  byte[] data=new byte[Math.Abs(bits.Stride)*h]; Marshal.Copy(bits.Scan0,data,0,data.Length); int stride=bits.Stride;source.UnlockBits(bits);
  owner=new int[n];Array.Fill(owner,-1);var seen=new bool[n];var queue=new int[n];var components=new List<Tuple<Rectangle,int,int,int[]>>();
  for(int i=0;i<n;i++) {
   if(seen[i] || data[(i/w)*stride+(i%w)*4+3]<32)continue;
   int head=0,tail=1,count=0,x0=w,y0=h,x1=0,y1=0;queue[0]=i;seen[i]=true;
   while(head<tail) {
    int p=queue[head++],x=p%w,y=p/w;count++;x0=Math.Min(x0,x);y0=Math.Min(y0,y);x1=Math.Max(x1,x);y1=Math.Max(y1,y);
    for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++) {
     int nx=x+dx,ny=y+dy;if(nx<0||nx>=w||ny<0||ny>=h)continue;int next=ny*w+nx;
     if(!seen[next]&&data[ny*stride+nx*4+3]>=32){seen[next]=true;queue[tail++]=next;}
    }
   }
   if(count<Math.Max(24,n/12000))continue;
   int column=Math.Min(cols-1,((x0+x1)*cols)/(2*w)),row=Math.Min(rows-1,((y0+y1)*rows)/(2*h));
   var box=Rectangle.FromLTRB(Math.Max(0,x0-2),Math.Max(0,y0-2),Math.Min(w,x1+3),Math.Min(h,y1+3));
   int slot=row*cols+column;var pixels=new int[tail];Array.Copy(queue,pixels,tail);components.Add(Tuple.Create(box,count,slot,pixels));
  }
  var largest=new int[cols*rows];
  foreach(var part in components)if(part.Item2>largest[part.Item3]){largest[part.Item3]=part.Item2;bounds[part.Item3]=part.Item1;}
  var primary=(Rectangle[])bounds.Clone();
  foreach(var part in components) {
   if(part.Item2==largest[part.Item3]){foreach(int p in part.Item4)owner[p]=part.Item3;continue;}
   int cx=part.Item1.X+part.Item1.Width/2,cy=part.Item1.Y+part.Item1.Height/2,best=-1;double distance=double.MaxValue;
   for(int slot=0;slot<primary.Length;slot++)if(!primary[slot].IsEmpty) {
    int dx=Math.Max(0,Math.Max(primary[slot].Left-cx,cx-primary[slot].Right));int dy=Math.Max(0,Math.Max(primary[slot].Top-cy,cy-primary[slot].Bottom));
    double d=dx*dx+dy*dy;if(d<distance){distance=d;best=slot;}
   }
   double limit=Math.Min(w/(double)cols,h/(double)rows)*0.10;
   if(best>=0 && distance<=limit*limit){bounds[best]=Rectangle.Union(bounds[best],part.Item1);foreach(int p in part.Item4)owner[p]=best;}
  }
  return bounds;
 }
 public static Bitmap Isolate(Bitmap source,int slot) {
  int w=source.Width,h=source.Height;var rect=new Rectangle(0,0,w,h);
  var src=source.LockBits(rect,ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
  byte[] input=new byte[Math.Abs(src.Stride)*h];Marshal.Copy(src.Scan0,input,0,input.Length);int stride=src.Stride;source.UnlockBits(src);
  var result=new Bitmap(w,h,PixelFormat.Format32bppArgb);var dst=result.LockBits(rect,ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb);
  byte[] output=new byte[Math.Abs(dst.Stride)*h];
  for(int p=0;p<owner.Length;p++)if(owner[p]==slot)Array.Copy(input,(p/w)*stride+(p%w)*4,output,(p/w)*dst.Stride+(p%w)*4,4);
  Marshal.Copy(output,0,dst.Scan0,output.Length);result.UnlockBits(dst);return result;
 }
}
'@
$root=Split-Path -Parent $PSScriptRoot
$dir=Join-Path $root 'web\assets\tiles'
$manifest=Get-Content -LiteralPath (Join-Path $dir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$sources=@{};$rectangles=@{};$isolated=@{};$done=@{};$records=@()
try {
 foreach($sheet in $manifest.sheets.PSObject.Properties) {
  $image=[System.Drawing.Bitmap]::new((Join-Path $dir ('source\'+$sheet.Name+'.png')))
  if($image.GetPixel(0,0).A -ne 0){throw ('Atlas lacks transparent alpha: '+$sheet.Name)}
  $sources[$sheet.Name]=$image
  $rectangles[$sheet.Name]=[RogueAtlasComponents]::Bounds($image,$sheet.Value.columns,$sheet.Value.rows)
  $isolated[$sheet.Name]=@(0..($sheet.Value.columns*$sheet.Value.rows-1)|ForEach-Object {[RogueAtlasComponents]::Isolate($image,$_)} )
 }
 foreach($entry in $manifest.entries) {
  if($entry.id -in @('terrain.wall_horizontal','terrain.wall_vertical')) {
   $entry|Add-Member -Force -NotePropertyName image -NotePropertyValue 'terrain.wall.png'
   if(-not $done.ContainsKey('shared-wall')) {
    $wallGeneration=Get-Content -LiteralPath (Join-Path $root 'web\assets\walls\generation.json') -Raw|ConvertFrom-Json
    $records+=@($wallGeneration.outputs|Where-Object {$_.set -eq 'tiles'})
    $done['shared-wall']='terrain.wall.png'
   }
   continue
  }
  $key=$entry.sheet+':'+$entry.index
  if($done.ContainsKey($key)){$entry|Add-Member -Force -NotePropertyName image -NotePropertyValue $done[$key];continue}
  $source=$isolated[$entry.sheet][$entry.index];$box=$rectangles[$entry.sheet][$entry.index]
  if($box.IsEmpty){throw ('Generated sprite missing: '+$entry.id)}
  $size=[int]$manifest.tile_pixels;$bitmap=[System.Drawing.Bitmap]::new($size,$size,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $opaque=$entry.id -in @('terrain.unexplored','terrain.floor','terrain.passage')
  if($opaque){$graphics.Clear([System.Drawing.Color]::FromArgb(8,13,15));$dest=[System.Drawing.Rectangle]::new(0,0,$size,$size)}
  else {$scale=($size-6)/[Math]::Max($box.Width,$box.Height);$w=[int][Math]::Round($box.Width*$scale);$h=[int][Math]::Round($box.Height*$scale);$dest=[System.Drawing.Rectangle]::new([int](($size-$w)/2),[int](($size-$h)/2),$w,$h)}
  $graphics.DrawImage($source,$dest,$box,[System.Drawing.GraphicsUnit]::Pixel)
  $filename=$entry.id+'.png';$path=Join-Path $dir $filename;$bitmap.Save($path,[System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose();$bitmap.Dispose();$done[$key]=$filename;$entry|Add-Member -Force -NotePropertyName image -NotePropertyValue $filename
  $records+=[ordered]@{id=$entry.id;file=$filename;source=$entry.sheet;crop=@($box.X,$box.Y,$box.Width,$box.Height);sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
 }
 $manifest|ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $dir 'manifest.json') -Encoding UTF8
 [ordered]@{tool='built-in image_gen';unique_pngs=$records.Count;semantic_ids=$manifest.entries.Count;technical_packing='Alpha component bounds preserve sprites across imperfect atlas grid margins; resize to 96px';images=$records}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $dir 'generation.json') -Encoding UTF8
 Write-Output ('Packed '+$records.Count+' PNGs for '+$manifest.entries.Count+' semantic IDs')
} finally {foreach($source in $sources.Values){$source.Dispose()};foreach($list in $isolated.Values){foreach($source in $list){$source.Dispose()}}}
