@echo off
rem Sales excel auto-sync (finance team's latest "(PLENTY)Sales" workbook -> event revenue).
rem Run every 30 min by Task Scheduler (\Plenty\SalesExcelSync) through sync-sales-excel.vbs (hidden window).
rem Does nothing when there is no new file. Results: server\_out\sales-sync.log and the top of the Revenue page.
rem Keep this file ASCII-only: cmd.exe reads batch files in the console code page (CP949), not UTF-8.
cd /d "%~dp0.."
echo ===== %date% %time% >> "_out\sales-sync-run.log"
call npx tsx scripts\sync-sales-excel.ts >> "_out\sales-sync-run.log" 2>&1
set RC=%errorlevel%
echo exit=%RC% >> "_out\sales-sync-run.log"
exit /b %RC%
