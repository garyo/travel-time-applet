#!/usr/bin/env bash

set -e

# Deploy front end page
bunx wrangler pages deploy public --project-name travel-time-applet
# Deploy back end worker
(cd travel-time-worker && bunx wrangler deploy)
