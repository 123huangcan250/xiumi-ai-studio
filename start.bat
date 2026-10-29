@echo off
cd /d %~dp0
if not exist node_modules call pnpm install
if not exist dist call pnpm build
echo XIUMI AI Studio: http://127.0.0.1:5174
start "" http://127.0.0.1:5174
call pnpm start
