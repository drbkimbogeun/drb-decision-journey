@echo off
chcp 65001 >nul
pushd "%~dp0"

echo ============================================================
echo  Build deploy folder for Cloudflare Pages
echo ============================================================
echo.
echo  This copies ONLY the game files into "_deploy".
echo  Planning documents and DRB history files are NOT copied.
echo.

if exist "_deploy" rmdir /s /q "_deploy"
mkdir "_deploy"

copy /y "index.html"       "_deploy\" >nul
copy /y "facilitator.html" "_deploy\" >nul

xcopy /e /i /y /q "css"    "_deploy\css"    >nul
xcopy /e /i /y /q "js"     "_deploy\js"     >nul
xcopy /e /i /y /q "data"   "_deploy\data"   >nul

if exist "assets\img" (
  mkdir "_deploy\assets" 2>nul
  xcopy /e /i /y /q "assets\img" "_deploy\assets\img" >nul
)

rem Paperlogy font files must ship with the game so every PC looks the same
if exist "assets\fonts" (
  mkdir "_deploy\assets" 2>nul
  xcopy /e /i /y /q "assets\fonts" "_deploy\assets\fonts" >nul
  del /q "_deploy\assets\fonts\*.md" 2>nul
)

rem Background music (optional - the game runs fine without it)
if exist "assets\audio" (
  mkdir "_deploy\assets" 2>nul
  xcopy /e /i /y /q "assets\audio" "_deploy\assets\audio" >nul
  del /q "_deploy\assets\audio\*.md" 2>nul
)

echo. > "_deploy\.nojekyll"

echo ============================================================
echo  DONE.  Folder created:  _deploy
echo.
echo  Next step:
echo    1. Open  https://dash.cloudflare.com
echo    2. Workers ^& Pages  -  Create  -  Pages  -  Upload assets
echo    3. Drag the "_deploy" FOLDER into the upload area
echo    4. Deploy.  You get a URL like  your-project.pages.dev
echo.
echo  NOT copied (kept private):
echo    - planning documents (*.md in this folder)
echo    - DRB history materials
echo    - tools folder
echo ============================================================
echo.
pause
popd
