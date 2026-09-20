@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo GoldFlow Studio: запускаю локальный сервер...

where python >nul 2>nul
if %errorlevel%==0 (
  start "GoldFlow server" /min cmd /c "python -m http.server 8080"
) else (
  where py >nul 2>nul
  if %errorlevel%==0 (
    start "GoldFlow server" /min cmd /c "py -m http.server 8080"
  ) else (
    echo Python не найден. Установи его с python.org или открой index.html напрямую.
    pause
    exit /b
  )
)

timeout /t 2 /nobreak >nul
start "" "http://localhost:8080"
echo Сайт открыт: http://localhost:8080
echo (это окно можно закрыть вместе со свёрнутым окном сервера)
timeout /t 4 >nul
exit
