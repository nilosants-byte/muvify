@echo off
setlocal
cd /d "C:\Users\Danilo\Documents\dev\personal-app-backend"
call "C:\Program Files\nodejs\npm.cmd" run db:backup:schedule >> "backups\backup-schedule.log" 2>&1
