@echo off
chcp 936 >nul
title 智慧树自动听课 - 启动器（启动完会自动退出）
cd /d "%~dp0"
setlocal enabledelayedexpansion

echo.
echo   ==============================================
echo      智慧树自动听课 - 一键启动
echo   ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 没找到 Node.js。请先安装 Node 18 或更新版本：https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "data" mkdir "data"

netstat -ano | findstr /r /c:":8731 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  if exist "data\server.url" (
    set /p OLDURL=<"data\server.url"
    echo   检测到服务已在运行，直接打开界面。
    start "" "!OLDURL!"
    timeout /t 2 >nul
    exit /b 0
  )
  echo   [错误] 端口 8731 被别的程序占用了，请关掉它再运行。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   首次运行，正在安装依赖（约 30 秒，只需一次）...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo   [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

if not exist "server\public\index.html" (
  echo   正在构建界面 ...
  call npm run web:build
  if errorlevel 1 (
    echo   [错误] 界面构建失败。
    pause
    exit /b 1
  )
)

del /q "data\server.url" >nul 2>nul
echo   正在启动本地服务 ...
rem 服务跑在下面这个有标题的窗口里：别关它（关了服务就停），最小化即可，出问题能看到日志
start "智慧树自动听课 - 服务运行中（关掉这个窗口=停止服务）" /min cmd /k "node server\index.mjs"

set TRIES=0
:WAITURL
timeout /t 1 >nul
set /a TRIES+=1
if not exist "data\server.url" (
  if !TRIES! lss 15 goto WAITURL
)

if exist "data\server.url" (
  set /p URL=<"data\server.url"
  echo   已启动，正在打开界面：
  echo   !URL!
  start "" "!URL!"
  echo.
  echo   提示：浏览器里点「开始听课」，会弹出一个 Chrome 窗口 -
  echo         先在那里扫码登录，再点进你要听的课程视频页即可。
  echo.
  echo   任务栏里那个「服务运行中」的窗口别关（关了后台就停了），最小化即可。
  echo.
  echo   不小心把界面网页关了？双击本目录的「打开界面.bat」就能重新打开；
  echo   或者再双击一次 start.bat（它发现服务已在跑，会直接开界面）。
  timeout /t 8 >nul
  exit /b 0
)

echo.
echo   [错误] 服务没能启动。最后几行日志：
echo   ----------------------------------------------
if exist "data\runtime.log" (
  powershell -NoProfile -Command "Get-Content -LiteralPath 'data\runtime.log' -Tail 12" 2>nul
) else (
  if exist "data\server.log" powershell -NoProfile -Command "Get-Content -LiteralPath 'data\server.log' -Tail 12" 2>nul
)
echo   ----------------------------------------------
echo   常见原因：Node 版本太旧、端口被占用、没有安装 Chrome 浏览器。
echo.
pause
exit /b 1
