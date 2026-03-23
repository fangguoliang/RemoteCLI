@echo off
setlocal

:: 检查 agent 进程是否在运行
tasklist /FI "WINDOWTITLE eq remoteCli Agent*" 2>NUL | find /I "node.exe" >NUL
if %ERRORLEVEL% equ 0 (
    :: Agent 正在运行，检查连接状态
    goto :check_connection
)

:: Agent 未运行，启动它
echo [%date% %time%] Agent not running, starting... >> D:\claudeworkspace\remoteCli\packages\agent\agent-monitor.log
start "" /min "D:\claudeworkspace\remoteCli\packages\agent\start-agent.bat"
goto :eof

:check_connection
:: 这里可以添加更复杂的连接检查逻辑
:: 目前简单假设如果进程在运行就是正常的
goto :eof