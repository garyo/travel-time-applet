#!/usr/bin/env bash

# Copyright (c) 2024 Gary Oberbrunner
# SPDX-License-Identifier: MIT

set -e

# Deploy front end page
bunx wrangler pages deploy public --project-name travel-time-applet
# Deploy back end worker
(cd travel-time-worker && bunx wrangler deploy)
