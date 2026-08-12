@echo off
chcp 65001 >nul
pushd "%~dp0"

where python >/dev/null 2>nul
if %errorlevel%==0 goto SERVE

where py >/dev/null 2>nul
if %errorlevel%==0 goto SERVEPY

echo Python not found - opening the file directly.
echo If images or data fail to load, install Python or use a local server.
start "" "index.html"
goto END

:SERVE
echo ============================================================
echo  DRB Management Simulation - local server
echo  URL  : http://localhost:8765/index.html
echo  Host : http://localhost:8765/facilitator.html
echo.
echo  Keep this window open while the training runs.
echo  Close this window to stop the server.
echo ============================================================
start "" "http://localhost:8765/index.html"
python -m http.server 8765
goto END

:SERVEPY
echo Starting local server at http://localhost:8765
start "" "http://localhost:8765/index.html"
py -m http.server 8765

:END
popd
