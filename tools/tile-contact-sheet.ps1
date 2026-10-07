$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$root=Split-Path -Parent $PSScriptRoot;$dir=Join-Path $root 'web\assets\tiles'
$manifest=Get-Content -LiteralPath (Join-Path $dir 'manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
$width=1190;$cellW=170;$cellH=162;$bitmap=[System.Drawing.Bitmap]::new($width,7*$cellH)
$g=[System.Drawing.Graphics]::FromImage($bitmap);$g.Clear([System.Drawing.Color]::FromArgb(20,27,31))
$font=[System.Drawing.Font]::new('Consolas',8.5);$brush=[System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(222,232,228))
try {
 for($i=0;$i -lt $manifest.entries.Count;$i++) {
  $entry=$manifest.entries[$i];$image=[System.Drawing.Bitmap]::new((Join-Path $dir $entry.image));$x=($i%7)*$cellW;$y=[Math]::Floor($i/7)*$cellH
  $state=$g.Save();$g.TranslateTransform($x+56,$y+56);$g.RotateTransform([single]$entry.rotation);$g.DrawImage($image,[System.Drawing.Rectangle]::new(-48,-48,96,96));$g.Restore($state)
  $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $state=$g.Save();$g.TranslateTransform($x+136,$y+80);$g.RotateTransform([single]$entry.rotation);$g.DrawImage($image,[System.Drawing.Rectangle]::new(-16,-16,32,32));$g.Restore($state);$g.DrawString($entry.id.Replace('.','.'+"`n"),$font,$brush,$x+8,$y+112)
  $image.Dispose()
 }
 $bitmap.Save((Join-Path $dir 'contact-sheet.png'),[System.Drawing.Imaging.ImageFormat]::Png)
} finally {$brush.Dispose();$font.Dispose();$g.Dispose();$bitmap.Dispose()}
Write-Output 'Saved 49-ID contact sheet (96px and 32px previews)'
