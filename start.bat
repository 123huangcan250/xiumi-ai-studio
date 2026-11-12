@echo off
rem For developers: run from source in production mode (requires Node.js and pnpm).
rem Team members should use the packaged "XIUMI AI Studio.exe" (see README).
cd /d %~dp0
if not exist node_modules call pnpm install
call pnpm build
echo XIUMI AI Studio: http://127.0.0.1:5174
start "" http://127.0.0.1:5174
call pnpm start
