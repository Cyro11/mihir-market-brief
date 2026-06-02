$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Url = "http://127.0.0.1:5173/"

function Test-PortOpen {
  param([int]$Port)
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $result = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $ok = $result.AsyncWaitHandle.WaitOne(500, $false)
    if ($ok) { $client.EndConnect($result) }
    $client.Close()
    return $ok
  } catch {
    return $false
  }
}

Set-Location -LiteralPath $ProjectDir

if (-not (Test-PortOpen -Port 5173)) {
  $quotedProjectDir = '"' + $ProjectDir + '"'
  Start-Process -WindowStyle Hidden -FilePath "cmd.exe" -ArgumentList "/c", "cd /d $quotedProjectDir && npm run dev -- --port 5173"
  Start-Sleep -Seconds 3
}

Start-Process $Url

