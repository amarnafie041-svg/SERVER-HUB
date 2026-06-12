[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
[Console]::InputEncoding=[System.Text.Encoding]::UTF8
$OutputEncoding=[System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "ELMODMEN - Server Hub"

$ESC = [char]27

Write-Host ""
Write-Host "$ESC[32m  ╔════════════════════════════════════════════════════════╗$ESC[0m"
Write-Host "$ESC[32m  ║$ESC[0m  $ESC[1m$ESC[33mELMODMEN HOST v6 — Server Hub Terminal$ESC[0m               $ESC[32m║$ESC[0m"
Write-Host "$ESC[32m  ╚════════════════════════════════════════════════════════╝$ESC[0m"
Write-Host ""

$function:prompt = {
    $u = "runner"
    $h = "serverhub"
    $p = $PWD.Path
    if ($p -eq $HOME) { $p = "~" }
    elseif ($p.Length -gt 40) { $p = "..." + $p.Substring($p.Length - 37) }
    Write-Host -NoNewline "$ESC[32m┌──($ESC[37m$u$ESC[90m㉿$ESC[37m$h$ESC[32m)-[$ESC[34m$p$ESC[32m]$ESC[0m"
    Write-Host ""
    Write-Host -NoNewline "$ESC[32m└─$ $ESC[0m"
    return " "
}

function ls { Get-ChildItem @args }
function ll { Get-ChildItem -Force @args }
function la { Get-ChildItem -Force @args }
function l { Get-ChildItem -Force @args }
function cat { param([string[]]$Paths); foreach($p in $Paths){ Get-Content $p -Raw } }
function head { param([int]$n=10,[string]$Path); Get-Content $Path -Head $n }
function tail { param([int]$n=10,[string]$Path); Get-Content $Path -Tail $n }
function touch { param([string]$Path); if(Test-Path $Path){ (Get-Item $Path).LastWriteTime=Get-Date } else { New-Item -Path $Path -ItemType File | Out-Null } }
function rm { param([string[]]$Paths); foreach($p in $Paths){ Remove-Item $p -Recurse -Force } }
function cp { param([string]$Src,[string]$Dst); Copy-Item $Src $Dst -Recurse -Force }
function mv { param([string]$Src,[string]$Dst); Move-Item $Src $Dst -Force }
function clear { Clear-Host }
function which { param([string]$Cmd); Get-Command $Cmd -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source }
function top { Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 Name,CPU,WorkingSet }
function df { Get-PSDrive -PSProvider FileSystem | Select-Object Name,@{N='Used';E={[math]::Round($_.Used/1GB,1)}},@{N='Free';E={[math]::Round($_.Free/1GB,1)}},@{N='Size';E={[math]::Round(($_.Used+$_.Free)/1GB,1)}} }
function du { param([string]$Path='.'); Get-ChildItem $Path -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum | ForEach-Object { '{0:N2} MB' -f ($_.Sum/1MB) } }
function env { Get-ChildItem Env: }
function grep { param([string]$Pattern,[string[]]$Path); if($Path){ Select-String -Pattern $Pattern -Path $Path } else { $input | Select-String -Pattern $Pattern } }
function find { param([string]$Path='.',[string]$Name='*'); Get-ChildItem -Path $Path -Recurse -Filter $Name -ErrorAction SilentlyContinue }
function wc { $input | Measure-Object -Line -Word -Character }
function date { Get-Date -Format 'yyyy-MM-dd HH:mm:ss' }
function uname { 'Windows_NT ' + [Environment]::OSVersion.Version.ToString() }
function history { Get-History }
function sudo { param([string[]]$Rest); $cmd=$Rest -join ' '; if($cmd){ try { Invoke-Expression $cmd } catch { Write-Host $_.Exception.Message -ForegroundColor Red } } }
function apt { param([string[]]$Rest); $cmd=$Rest -join ' '; Write-Host "[apt] Use winget instead:" -ForegroundColor Cyan; if($cmd -match 'install\s+(.+)'){ $pkg=$Matches[1]; winget install $pkg --accept-source-agreements --accept-package-agreements } elseif($cmd -match 'update'){ winget upgrade --all } elseif($cmd -match 'search\s+(.+)'){ winget search $Matches[1] } else { winget $Rest } }
