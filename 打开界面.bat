@echo off
chcp 936 >nul
title 智慧树自动听课 - 打开界面
cd /d "%~dp0"

if not exist "data\server.url" goto NOSERVICE
set "ZHSURL="
for /f "usebackq delims=" %%u in ("data\server.url") do set "ZHSURL=%%u"
if "%ZHSURL%"=="" goto NOSERVICE

netstat -ano | findstr /c:"127.0.0.1:8731" | findstr /i "LISTENING" >nul
if errorlevel 1 goto NOSERVICE

echo   正在打开界面：
echo   %ZHSURL%
start "" "%ZHSURL%"
timeout /t 2 >nul
exit /b 0

:NOSERVICE
echo.
echo   ==============================================
echo      服务没有在运行，请先双击 start.bat 启动
echo   ==============================================
echo.
echo   界面只是个网页，后台服务（标题写着「服务运行中」
echo   的那个最小化窗口）必须还在跑着。
echo.
pause
exit /b 1
