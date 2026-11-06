@echo off
rem 재무팀 매출표 자동 반영 — Windows 작업 스케줄러가 30분마다 실행한다 (작업 이름: Plenty\SalesExcelSync)
rem 새 파일이 없으면 아무것도 하지 않는다. 결과: server\_out\sales-sync.log · 앱 매출·정산 화면 상단
cd /d "%~dp0.."
call npx tsx scripts\sync-sales-excel.ts >> "_out\sales-sync-run.log" 2>&1
