@echo off
setlocal
cd /d "C:\Users\Danilo\Documents\dev\personal-app-backend"
call "C:\Program Files\nodejs\npm.cmd" run db:backup >> "backups\backup-task.log" 2>&1
call "C:\Program Files\nodejs\npm.cmd" run db:backup:healthcheck >> "backups\backup-task.log" 2>&1
