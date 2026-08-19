# Portable offline static file server (fallback when node/python are unavailable)
# Serves the folder containing this script at http://127.0.0.1:8788/
# ASCII-only content to avoid encoding issues on any Windows.

$ErrorActionPreference = 'SilentlyContinue'
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://127.0.0.1:8788/')
$listener.Start()
Write-Host "Serving $root at http://127.0.0.1:8788/  (Ctrl+C to stop)"

$types = @{
  '.html'='text/html; charset=utf-8'; '.js'='application/javascript; charset=utf-8'
  '.css'='text/css; charset=utf-8'; '.csv'='text/csv; charset=utf-8'
  '.json'='application/json; charset=utf-8'; '.png'='image/png'; '.jpg'='image/jpeg'
  '.jpeg'='image/jpeg'; '.gif'='image/gif'; '.svg'='image/svg+xml'; '.mp4'='video/mp4'
  '.ico'='image/x-icon'; '.woff'='font/woff'; '.woff2'='font/woff2'
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
  if ($rel -eq '') { $rel = 'index.html' }
  $file = Join-Path $root ($rel -replace '/', '\')
  try {
    if ((Test-Path $file -PathType Leaf) -and ($file.StartsWith($root))) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      if ($types.ContainsKey($ext)) { $ctx.Response.ContentType = $types[$ext] }
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
  } catch {}
  $ctx.Response.Close()
}
