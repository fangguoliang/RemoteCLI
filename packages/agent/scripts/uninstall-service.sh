#!/bin/bash

# remoteCli Agent Service Uninstallation Script
# Supports: Linux (systemd) and macOS (launchd)

set -e

echo "=== remoteCli Agent Service Uninstaller ==="
echo ""

# Detect OS and uninstall
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "Detected: Linux (systemd)"

    SERVICE_FILE="/etc/systemd/system/remotecli-agent.service"

    if [ -f "$SERVICE_FILE" ]; then
        echo "Stopping service..."
        sudo systemctl stop remotecli-agent || true

        echo "Disabling service..."
        sudo systemctl disable remotecli-agent || true

        echo "Removing service file..."
        sudo rm -f "$SERVICE_FILE"

        echo "Reloading systemd daemon..."
        sudo systemctl daemon-reload

        echo ""
        echo "Service uninstalled successfully!"
    else
        echo "Service not installed."
    fi

elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Detected: macOS (launchd)"

    PLIST_FILE="$HOME/Library/LaunchAgents/com.remotecli.agent.plist"

    if [ -f "$PLIST_FILE" ]; then
        echo "Unloading service..."
        launchctl unload "$PLIST_FILE" || true

        echo "Removing plist file..."
        rm -f "$PLIST_FILE"

        echo ""
        echo "Service uninstalled successfully!"
    else
        echo "Service not installed."
    fi
else
    echo "Error: Unsupported OS: $OSTYPE"
    echo "This script only supports Linux (systemd) and macOS (launchd)"
    exit 1
fi

echo ""
echo "Uninstallation complete!"