$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$IconDir = Join-Path $Root "icons"

New-Item -ItemType Directory -Force -Path $IconDir | Out-Null
Add-Type -AssemblyName System.Drawing

function New-VideoTheaterIcon {
  param([int]$Size)

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $rect = New-Object System.Drawing.RectangleF 0, 0, $Size, $Size
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect,
    ([System.Drawing.Color]::FromArgb(255, 23, 126, 137)),
    ([System.Drawing.Color]::FromArgb(255, 22, 32, 38)),
    45
  $graphics.FillRectangle($brush, $rect)

  $screenBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(230, 248, 250, 249))
  $screenRect = New-Object System.Drawing.RectangleF ($Size * 0.16), ($Size * 0.24), ($Size * 0.68), ($Size * 0.46)
  $graphics.FillRectangle($screenBrush, $screenRect)

  $triangle = New-Object System.Drawing.Drawing2D.GraphicsPath
  $triangle.AddPolygon(@(
    (New-Object System.Drawing.PointF ($Size * 0.43), ($Size * 0.35)),
    (New-Object System.Drawing.PointF ($Size * 0.43), ($Size * 0.60)),
    (New-Object System.Drawing.PointF ($Size * 0.63), ($Size * 0.475))
  ))
  $playBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 196, 137, 45))
  $graphics.FillPath($playBrush, $triangle)

  $standBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(230, 248, 250, 249))
  $graphics.FillRectangle($standBrush, ($Size * 0.45), ($Size * 0.70), ($Size * 0.10), ($Size * 0.10))
  $graphics.FillRectangle($standBrush, ($Size * 0.32), ($Size * 0.80), ($Size * 0.36), ($Size * 0.06))

  $path = Join-Path $IconDir "icon$Size.png"
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

  $graphics.Dispose()
  $bitmap.Dispose()
}

16, 32, 48, 128 | ForEach-Object { New-VideoTheaterIcon -Size $_ }
Write-Host "Generated icons in $IconDir"
