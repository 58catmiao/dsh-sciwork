@echo off
rem Sciwork Python launcher (Windows).
rem
rem ASCII-only on purpose: cmd.exe reads this file in the OEM codepage, so any
rem non-ASCII byte here can break parsing.
rem
rem Why this exists: `python` is often not on PATH on Windows and `python3` may be
rem the Microsoft Store placeholder, which always fails. Skill scripts are told to
rem invoke Python through this launcher so the same interpreter is used everywhere.
rem
rem Override the search by setting SCIWORK_PYTHON (full path to python.exe).
rem Library root: SCIWORK_LIBRARY, else %USERPROFILE%\Research, else this file's
rem repository root (..\..).

setlocal
set "PY="

if defined SCIWORK_PYTHON if exist "%SCIWORK_PYTHON%" set "PY=%SCIWORK_PYTHON%"

set "ROOT=%SCIWORK_LIBRARY%"
if not defined ROOT if exist "%USERPROFILE%\Research" set "ROOT=%USERPROFILE%\Research"
if not defined ROOT set "ROOT=%~dp0..\.."

if not defined PY call :try "%ROOT%\.venv\Scripts\python.exe"
if not defined PY call :try "%ROOT%\.research\.venv\Scripts\python.exe"
if not defined PY call :try "%USERPROFILE%\Research\.venv\Scripts\python.exe"

rem Last resort: whatever PATH provides. `where` prints nothing when absent.
if not defined PY for /f "delims=" %%I in ('where python 2^>nul') do if not defined PY set "PY=%%I"
if not defined PY for /f "delims=" %%I in ('where python3 2^>nul') do if not defined PY set "PY=%%I"

if not defined PY goto :notfound
"%PY%" %*
exit /b %ERRORLEVEL%

:try
if not defined PY if exist %1 set "PY=%~1"
exit /b 0

:notfound
echo [sciwork] no usable Python interpreter found. 1>&2
echo   set SCIWORK_PYTHON, or create a venv, for example: 1>&2
echo     python -m venv "%%USERPROFILE%%\Research\.venv" 1>&2
echo     "%%USERPROFILE%%\Research\.venv\Scripts\python.exe" -m pip install numpy openpyxl pyyaml mcp 1>&2
exit /b 127
