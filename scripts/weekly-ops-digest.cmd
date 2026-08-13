@echo off
rem KanseiLINK 週次Opsダイジェスト（タスクスケジューラから起動）
cd /d "C:\Users\HP\KanseiLINK\kansei-link-mcp"
"C:\Program Files\nodejs\node.exe" "scripts\weekly-ops-digest.mjs" >> "reports\ops-digest.log" 2>&1
