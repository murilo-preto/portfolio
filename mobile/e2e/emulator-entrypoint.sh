#!/bin/bash
# Starts the relay and the emulator, then keeps the container up for
# run-flows.sh, which run.sh executes inside it.
set -euo pipefail

# Inside the emulator, 10.0.2.2 is this container's loopback. The LAN build's
# default server is http://10.0.2.2:5000, so relay that port to Next.js.
socat TCP-LISTEN:5000,fork,reuseaddr "TCP:${NEXTJS_HOST}:5000" &

emulator -avd namu -no-window -no-audio -no-boot-anim -no-snapshot \
    -gpu swiftshader_indirect -memory 3072 > /e2e-output/emulator.log 2>&1 &

exec sleep infinity
