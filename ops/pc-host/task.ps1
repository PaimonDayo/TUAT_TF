param([Parameter(Mandatory=$true)][string]$NodePath,[Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference='Stop'
$taskMutex=[Threading.Mutex]::new($false,'Global\TUAT-PC-Host')
$taskHeld=$false
try{
  try{$taskHeld=$taskMutex.WaitOne(0)}catch[Threading.AbandonedMutexException]{$taskHeld=$true}
  if(!$taskHeld){throw 'Another PC host wrapper is running'}
  $env:TUAT_PC_APP_MUTEX_HELD='1'
  & $NodePath (Join-Path $PSScriptRoot 'run.mjs') $ConfigPath --execute
  exit $LASTEXITCODE
}finally{if($taskHeld){$taskMutex.ReleaseMutex()};$taskMutex.Dispose()}
