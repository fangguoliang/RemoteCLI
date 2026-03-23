#!/bin/bash

# remoteCli Agent Service Installation Script
# Supports: Linux (systemd) and macOS (launchd)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
USER=$(whoami)
NODE_PATH=$(which node)

echo "=== remoteCli Agent Service Installer ==="
echo "Install directory: $INSTALL_DIR"
echo "User: $USER"
echo "Node path: $NODE_PATH"
echo ""

# Detect OS and install
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "Detected: Linux (systemd)"

    # Check if systemd is available
    if ! command -v systemctl &> /dev/null; then
        echo "Error: systemctl not found. systemd is required."
        exit 1
    fi

    SERVICE_FILE="/etc/systemd/system/remotecli-agent.service"

    # Create service file from template
    echo "Creating service file..."
    sed -e "s|%USER%|$USER|g" \
        -e "s|%INSTALL_DIR%|$INSTALL_DIR|g" \
        -e "s|%NODE_PATH%|$NODE_PATH|g" \
        "$INSTALL_DIR/templates/remotecli-agent.service" | sudo tee "$SERVICE_FILE" > /dev/null

    # Set permissions
    sudo chmod 644 "$SERVICE_FILE"

    # Reload systemd
    echo "Reloading systemd daemon..."
    sudo systemctl daemon-reload

    # Enable service
    echo "Enabling service..."
    sudo systemctl enable remotecli-agent

    # Start service
    echo "Starting service..."
    sudo systemctl start remotecli-agent

    # Show status
    echo ""
    echo "Service installed successfully!"
    echo ""
    sudo systemctl status remotecli-agent --no-pager

elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Detected: macOS (launchd)"

    PLIST_FILE="$HOME/Library/LaunchAgents/com.remotecli.agent.plist"

    # Create LaunchAgents directory if it doesn't exist
    mkdir -p "$HOME/Library/LaunchAgents"

    # Create plist file from template
    echo "Creating launchd plist..."
    sed -e "s|%INSTALL_DIR%|$INSTALL_DIR|g" \
        -e "s|%NODE_PATH%|$NODE_PATH|g" \
        "$INSTALL_DIR/templates/com.remotecli.agent.plist" > "$PLIST_FILE"

    # Load the service
    echo "Loading service..."
    launchctl load "$PLIST_FILE"

    echo ""
    echo "Service installed successfully!"
    echo ""
    echo "To check status: launchctl list | grep remotecli"
    echo "To view logs: tail -f /tmp/remotecli-agent.log"
else
    echo "Error: Unsupported OS: $OSTYPE"
    echo "This script only supports Linux (systemd) and macOS (launchd)"
    exit 1
fi

echo ""
echo "Installation complete!"