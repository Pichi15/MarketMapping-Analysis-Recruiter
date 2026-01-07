#!/bin/bash
# Stop any currently running server
kill $(lsof -t -i:3000) || true

# Navigate to the script's directory
cd "$(dirname "$0")"

# Install dependencies
npm install

# Start the server
npm start
