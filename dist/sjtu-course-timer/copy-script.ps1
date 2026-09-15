$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'course-timer.user.js'
Set-Clipboard ([System.IO.File]::ReadAllText($scriptPath))
Write-Output '已复制完整脚本。请在已登录的自主选课页控制台粘贴执行；默认只读。'
