$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$root=Split-Path -Parent $PSScriptRoot;$dir=Join-Path $root 'web\assets\pixels'
$manifest=Get-Content -LiteralPath (Join-Path $dir 'manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
$bitmap=[System.Drawing.Bitmap]::new(1190,1134);$g=[System.Drawing.Graphics]::FromImage($bitmap)
$g.Clear([System.Drawing.Color]::FromArgb(20,27,31));$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor;$g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::Half
$font=[System.Drawing.Font]::new('Consolas',8.5);$brush=[System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(222,232,228))
try{
 for($i=0;$i -lt $manifest.entries.Count;$i++){
  $entry=$manifest.entries[$i];$source=[System.Drawing.Bitmap]::new((Join-Path $dir $entry.image));$image=$source
  if($entry.rotation){
   $image=[System.Drawing.Bitmap]::new(32,32,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
   $rad=$entry.rotation*[Math]::PI/180;$cos=[Math]::Cos($rad);$sin=[Math]::Sin($rad)
   for($y=0;$y -lt 32;$y++){for($x=0;$x -lt 32;$x++){
    $dx=$x+0.5-16;$dy=$y+0.5-16;$sx=[int][Math]::Floor($dx*$cos+$dy*$sin+16);$sy=[int][Math]::Floor(-$dx*$sin+$dy*$cos+16)
    if($sx -ge 0 -and $sx -lt 32 -and $sy -ge 0 -and $sy -lt 32){$image.SetPixel($x,$y,$source.GetPixel($sx,$sy))}
   }}
  }
  $left=($i%7)*170;$top=[int][Math]::Floor($i/7)*162
  $g.DrawImage($image,[System.Drawing.Rectangle]::new($left+8,$top+8,96,96))
  $g.DrawImage($image,[System.Drawing.Rectangle]::new($left+120,$top+64,32,32))
  $g.DrawString($entry.id.Replace('.','.'+"`n"),$font,$brush,$left+8,$top+112)
  if($image -ne $source){$image.Dispose()};$source.Dispose()
 }
 $bitmap.Save((Join-Path $dir 'contact-sheet.png'),[System.Drawing.Imaging.ImageFormat]::Png)
}finally{$brush.Dispose();$font.Dispose();$g.Dispose();$bitmap.Dispose()}
Write-Output 'Saved 49-ID pixel-art contact sheet: native32 and nearest-neighbor3x previews'
