# Travel Time Applet

A full-stack travel time calculator that provides MBTA transit times and driving directions between locations in the Boston area.

## Features

- 🚇 **MBTA Transit Times**: Real-time predictions for subway/bus routes
- 🚗 **Driving Directions**: Google Maps driving time and distance
- 🚶 **Walking Times**: Walking time to nearest transit stations
- ⚡ **Caching**: Intelligent caching for improved performance
- 🔒 **Security**: Input validation, rate limiting, XSS prevention
- 📱 **Responsive**: Clean, mobile-friendly interface

## Quick Start

```bash
# Install dependencies
bun install

# Start local development (worker + HTML server)
bun run start-local

# Open http://localhost:3000 in your browser
```

## Development

### Commands

```bash
# Backend development
bun run dev                # Start Cloudflare Worker dev server (port 8787)

# Frontend + Backend development
bun run start-local        # Start both worker and HTML dev server
                          # Worker: localhost:8787, HTML: localhost:3000

# Testing
bun run test:api           # Test APIs against local worker
bun run test:api:prod      # Test APIs against production

# Deployment
bun run deploy            # Deploy worker to Cloudflare
```

### Development Workflow

1. **Local Development**:
   ```bash
   bun run start-local     # Starts everything
   ```
   - Worker runs on `localhost:8787`
   - HTML dev server on `localhost:3000` (with automatic API URL rewriting)
   - Make changes to `travel-time-worker/worker.js`
   - Refresh browser to see changes

2. **API Testing**:
   ```bash
   bun run test:api        # Comprehensive API test suite
   ```

3. **Deploy**:
   ```bash
   bun run deploy         # Ship to production
   ```

## Project Structure

```
travel-time-applet/
├── package.json              # Root package with workspace management
├── README.md                 # This file
├── public/
│   └── index.html           # Frontend HTML application
└── travel-time-worker/      # Cloudflare Worker backend
    ├── package.json         # Worker-specific dependencies
    ├── worker.js           # Main worker code
    ├── wrangler.toml       # Cloudflare configuration
    ├── scripts/            # Development and testing scripts
    └── README.md           # Worker-specific documentation
```

## Architecture

- **Frontend**: Static HTML with vanilla JavaScript
- **Backend**: Cloudflare Worker (serverless)
- **APIs**: MBTA API, Google Maps API
- **Deployment**: Cloudflare Workers platform
- **Local Development**: Wrangler dev server + custom HTML proxy

## API Endpoints

- `GET /mbta?origin={address}&destination={address}` - MBTA transit times
- `GET /driving?origin={address}&destination={address}` - Driving directions

## Testing

Comprehensive test suite with:
- ✅ Valid API requests (MBTA & driving)
- ✅ Input validation and error handling
- ✅ Security (XSS prevention, rate limiting)
- ✅ Performance monitoring
- ✅ Cache functionality

```bash
# Run all API tests
bun run test:api

# Test specific implementations
bun run test:api:local:fetch  # Fetch-based tests
bun run test:api:local:curl   # cURL-based tests
bun run test:api:prod         # Production tests
```

## Configuration

### Required Environment Variables

Create `travel-time-worker/.dev.vars`:
```bash
GOOGLE_API_KEY=your_google_maps_api_key_here
```

### Google Maps API Setup

1. Get API key from [Google Cloud Console](https://console.cloud.google.com/)
2. Enable these APIs:
   - Maps JavaScript API
   - Directions API
   - Distance Matrix API
3. Set up billing (required for production usage)

## Security Features

- **Input Validation**: Address format validation with security patterns
- **Rate Limiting**: 60 requests/minute per IP
- **XSS Prevention**: Input sanitization and content security
- **API Key Protection**: Server-side only, never exposed to client
- **CORS**: Configured for secure cross-origin requests

## Performance

- **Intelligent Caching**: 4-minute TTL for API responses
- **Request Deduplication**: Prevents duplicate concurrent requests
- **Cloudflare Edge**: Global CDN with minimal latency
- **Lightweight**: Vanilla JS frontend, no framework overhead

## License

MIT - see [LICENSE](LICENSE) file for details.