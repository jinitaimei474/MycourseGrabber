$ErrorActionPreference = 'Stop'
$crawlerDir = $PSScriptRoot
$meta = @'
// ==UserScript==
// @name 水源帖子导出
// @namespace local.shuiyuan.crawler
// @version 1.0.0
// @description 按主题、用户和北京时间范围导出发帖内容及时间
// @match https://shuiyuan.sjtu.edu.cn/*
// @grant none
// @run-at document-idle
// ==/UserScript==

'@
$bundle = $meta + "`n" + [IO.File]::ReadAllText((Join-Path $crawlerDir 'core.js')) + "`n" + [IO.File]::ReadAllText((Join-Path $crawlerDir 'panel.js'))
[IO.File]::WriteAllText((Join-Path $crawlerDir 'shuiyuan-crawler.user.js'), $bundle)
$archive = Join-Path (Split-Path $crawlerDir -Parent) 'dist/shuiyuan-crawler.zip'
Compress-Archive -LiteralPath (Join-Path $crawlerDir 'core.js'), (Join-Path $crawlerDir 'panel.js'), (Join-Path $crawlerDir 'manifest.json'), (Join-Path $crawlerDir 'README.md'), (Join-Path $crawlerDir 'SOURCE-ANALYSIS.md'), (Join-Path $crawlerDir 'shuiyuan-crawler.user.js') -DestinationPath $archive -Force
Write-Output $archive
