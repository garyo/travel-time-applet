# Travel Time Worker

A Cloudflare Worker that provides travel time calculations using MBTA and Google Maps APIs.

## Development

```bash
# Start development server
bun run dev

# Test HTML with local worker (URL rewriting)
bun run start-local        # Starts both worker and dev server
# Then open http://localhost:3000

# Or run separately:
bun run dev                # Start worker (localhost:8787)
bun run dev-server         # Start HTML dev server (localhost:3000)

# Run API tests
bun run test:api           # Local API testing
bun run test:api:prod      # Production API testing
```

## Testing Options

The project includes comprehensive API tests with multiple implementations:

- `bun run test:api:local` - Local testing using fetch (default, fast and reliable)
- `bun run test:api:local:fetch` - Local testing using fetch (same as default)
- `bun run test:api:local:curl` - Local testing using curl (alternative implementation)
- `bun run test:api:prod` - Production testing using fetch
- `bun run test:api:prod:curl` - Production testing using curl

All local test commands automatically:
- Start the development server
- Run comprehensive API tests
- Shut down the server when complete
- Handle cleanup on interruption

## Local HTML Testing

The development server (`bun run dev-server`) serves the HTML file with automatic URL rewriting:
- **Original**: `https://travel-time-worker.garyo.workers.dev/mbta`
- **Rewritten**: `http://localhost:8787/mbta`

This allows testing the frontend with the local worker without modifying the HTML source code.

### Usage:
1. **One command**: `bun run start-local` (starts both worker and HTML server)
2. **Manual**: Start `bun run dev` then `bun run dev-server` in separate terminals
3. **Open**: http://localhost:3000 in your browser
4. **Test**: The HTML will use your local worker automatically!

## Test Coverage

The test suite validates:
- ✅ Valid MBTA transit requests
- ✅ Valid driving directions requests
- ✅ Input validation and error handling
- ✅ Security (XSS prevention)
- ✅ Response time monitoring
- ✅ Expected error responses
- ✅ Cache functionality

## Deployment

```bash
# Deploy to Cloudflare Workers
bun run deploy
```

## Security Features

- Input validation and sanitization
- Rate limiting (60 requests/minute per IP)
- XSS and injection attack prevention
- Secure API key handling (server-side only)