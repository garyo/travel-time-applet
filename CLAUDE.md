# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

This is a full-stack travel time calculator consisting of:

### Frontend (Vanilla HTML/JS)
- **Location**: `public/index.html` - Single-page application
- **API Integration**: Calls Cloudflare Worker endpoints via fetch
- **Production URL**: `https://travel-time-worker.garyo.workers.dev`

### Backend (Cloudflare Worker)
- **Main Code**: `travel-time-worker/worker.js` - Serverless request handler
- **Configuration**: `travel-time-worker/config.js` - Address mappings and MBTA route configs
- **Station Data**: `travel-time-worker/stations.js` - Red Line station definitions
- **Deployment Config**: `travel-time-worker/wrangler.toml` - Cloudflare Workers configuration

### Key Architectural Patterns

**API Endpoints**:
- `/mbta` - Returns MBTA predictions + walking time to nearest station
- `/driving` - Returns Google Maps driving directions
- `/all` - Combines both APIs using Promise.allSettled

**Caching Strategy**:
- **KV Storage**: `TRAVEL_TIME_CACHE` namespace for API response caching
- **TTL**: 4 minutes (240 seconds) configured in wrangler.toml
- **Cache Keys**: Hashed combination of endpoint + origin + destination

**Rate Limiting**:
- 60 requests/minute per IP address
- Enforced via KV storage with IP-based keys

**Input Validation**:
- Address format validation requiring street number, name, and city/state
- XSS prevention with pattern matching against `<script>`, `javascript:`, etc.

## Common Development Commands

### Quick Start
```bash
bun install                    # Install all dependencies
bun run start-local           # Start worker (8787) + HTML dev server (3000)
```

### Development
```bash
bun run dev                   # Start Cloudflare Worker dev server only
bun run dev-server           # Start HTML dev server with URL rewriting
```

### Testing
```bash
bun run test:api             # Self-contained API tests (starts/stops dev server)
bun run test:api:prod        # Test against production deployment
bun run test:api:local:curl  # Alternative curl-based local tests
```

### Deployment
```bash
bun run deploy              # Deploy worker to Cloudflare
```

## Workspace Structure

This is a Bun workspace with:
- **Root package.json**: Orchestration commands that delegate to worker
- **Worker package.json**: Actual implementation scripts and dependencies

All commands can be run from root directory and will execute in the appropriate workspace.

## Testing Architecture

### Self-Contained Test Scripts
- **`scripts/test-api.js`**: Fetch-based tests (default)
- **`scripts/test-api-curl.js`**: cURL-based tests (alternative)

Both scripts automatically:
1. Start local development server
2. Run comprehensive test suite (7 test cases)
3. Validate success responses, expected errors, and security
4. Stop server and cleanup

### Test Coverage
- Valid API requests (MBTA transit, driving directions)
- Input validation (missing fields, vague addresses)
- Security (XSS attempt handling)
- Performance monitoring and caching verification

## Local HTML Development

The `dev-server.js` script serves the HTML file with automatic URL rewriting:
- **Original**: `https://travel-time-worker.garyo.workers.dev/*`
- **Rewritten**: `http://localhost:8787/*`

This enables testing the complete frontend against local worker without modifying HTML source.

## Environment Setup

Required file: `travel-time-worker/.dev.vars`
```
GOOGLE_API_KEY=your_api_key_here
```

The worker integrates with:
- **MBTA API**: Public API for transit predictions
- **Google Maps APIs**: Directions API and Distance Matrix API
- **Cloudflare KV**: For caching and rate limiting

## Security Implementation

Input validation in worker.js checks for:
- Required address components (street number, name, city/state)
- Malicious patterns: `<script>`, `javascript:`, `data:`, `vbscript:`
- Rate limiting via IP address tracking in KV storage

All API keys are server-side only and never exposed to client code.