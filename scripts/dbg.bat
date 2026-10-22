@echo off
chcp 936 >nul
cd /d "%~dp0"
echo [1] exist server.url?
if exist "data\server.url" (echo yes) else (echo no)
set "ZHSURL="
for /f "usebackq delims=" %%u in ("data\server.url") do set "ZHSURL=%%u"
echo [2] ZHSURL=[%ZHSURL%]
netstat -ano | findstr /c:"127.0.0.1:8731" | findstr /i "LISTENING"
echo [3] errorlevel=%errorlevel%
