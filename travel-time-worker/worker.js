 // Copyright (c) 2024 Gary Oberbrunner
 // SPDX-License-Identifier: MIT

import {addresses, mbta} from './config.js';
import {redLineStations} from './stations.js';


async function getMBTAPredictions(mbta) {
  const url = `https://api-v3.mbta.com/predictions?filter[stop]=${mbta.stationId}&filter[route]=${mbta.routeId}&sort=arrival_time&page[limit]=6`;

  // Add timeout to MBTA API call
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    const response = await fetch(url, {
      headers: {
        'accept': 'application/vnd.api+json'
        // Add if you have an API key:
        // 'x-api-key': env.MBTA_API_KEY
      },
      signal: controller.signal
    });

    if (!response.ok) {
      let errorMessage;
      switch (response.status) {
        case 429:
          errorMessage = 'MBTA API rate limit exceeded';
          break;
        case 500:
        case 502:
        case 503:
          errorMessage = 'MBTA service temporarily unavailable';
          break;
        default:
          errorMessage = `MBTA API error (${response.status})`;
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Invalid response format from MBTA API');
    }

    return data.data.map(prediction => ({
      arrival: prediction.attributes.arrival_time,
      departure: prediction.attributes.departure_time,
      direction: prediction.attributes.direction_id, // 0 is southbound (Ashmont/Braintree), 1 is northbound (Alewife)
      status: prediction.attributes.status
    }));
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('MBTA API timeout - service is taking too long to respond');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Enhanced travel time function with better error handling
async function getTravelTime(origin, destination, env, travelMode = "DRIVE") {
  // Validate inputs
  if (!origin || !destination) {
    throw new Error('Origin and destination are required');
  }

  if (!['DRIVE', 'WALK'].includes(travelMode)) {
    throw new Error('Invalid travel mode');
  }

  if (!env.GOOGLE_API_KEY) {
    throw new Error('Google API key not configured');
  }
  // Route parameters
  const routeParams = {
    origin: origin,
    destination: destination,
    travelMode: travelMode,
    computeAlternativeRoutes: false,
    routeModifiers: {
      avoidTolls: false,
      avoidHighways: false,
      avoidFerries: false
    },
    languageCode: "en-US",
    units: "IMPERIAL"
  };

  // Only add routing preference for DRIVE mode
  if (travelMode === "DRIVE") {
    routeParams.routingPreference = "TRAFFIC_AWARE";
  }

  // Fetch from Google API with timeout and retry logic
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

  try {
    const googleResponse = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters'
      },
      body: JSON.stringify(routeParams),
      signal: controller.signal
    });

    console.log('Google API response status:', googleResponse.status);

    if (!googleResponse.ok) {
      let errorMessage;

      switch (googleResponse.status) {
        case 400:
          errorMessage = 'Invalid request parameters';
          break;
        case 403:
          errorMessage = 'API key invalid or quota exceeded';
          break;
        case 429:
          errorMessage = 'Rate limit exceeded';
          break;
        case 500:
        case 502:
        case 503:
          errorMessage = 'Google service temporarily unavailable';
          break;
        default:
          errorMessage = `Unexpected error (${googleResponse.status})`;
      }

      const errorText = await googleResponse.text().catch(() => 'No error details');
      console.error('Google API error:', errorText);
      throw new Error(`${errorMessage}: ${errorText}`);
    }

    const data = await googleResponse.json();

    if (!data.routes || !data.routes[0]) {
      console.error('Unexpected Google API response:', data);
      throw new Error('No routes found for the given addresses');
    }

    // Validate response data
    const route = data.routes[0];
    if (!route.duration || !route.distanceMeters) {
      throw new Error('Incomplete route data received from Google API');
    }

    return route;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout - Google API is taking too long to respond');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}



// Input validation and sanitization utilities
function validateAndSanitizeAddress(address) {
  if (!address || typeof address !== 'string') {
    throw new Error('Address must be a non-empty string');
  }

  // Basic length validation
  if (address.length < 5 || address.length > 200) {
    throw new Error('Address must be between 5 and 200 characters');
  }

  // Remove potentially dangerous characters
  const sanitized = address.trim().replace(/[<>"'&]/g, '');

  // Check for suspicious patterns
  const suspiciousPatterns = [
    /<script/i, /javascript:/i, /data:/i, /vbscript:/i,
    /onload/i, /onerror/i, /onclick/i, /alert\(/i, /eval\(/i,
    /\{\{/, /\$\{/, /\[\[/
  ];

  if (suspiciousPatterns.some(pattern => pattern.test(sanitized))) {
    throw new Error('Address contains invalid characters');
  }

  // Basic address format validation
  const hasNumbers = /\d/.test(sanitized);
  const hasLetters = /[a-zA-Z]/.test(sanitized);
  const hasCommaOrState = /(,|MA|Massachusetts|Boston|Cambridge)/i.test(sanitized);

  if (!hasNumbers || !hasLetters || !hasCommaOrState) {
    throw new Error('Address must include street number, street name, and city/state');
  }

  return sanitized;
}

function validateStationId(stationId) {
  const validStations = [
    'place-knncl', 'place-chmnl', 'place-pktrm', 'place-dwnxg',
    'place-sstat', 'place-harsq', 'place-portr', 'place-davis',
    'place-cntsq', 'place-asmnl', 'place-jfk', 'place-andrw', 'place-brdwy'
  ];

  if (!validStations.includes(stationId)) {
    throw new Error('Invalid MBTA station ID');
  }

  return stationId;
}

async function handleDriveTime(request, env) {
  const url = new URL(request.url);
  const originParam = url.searchParams.get('origin');
  const destinationParam = url.searchParams.get('destination');

  // Validate and sanitize addresses
  let origin, destination;

  try {
    if (originParam) {
      const sanitizedOrigin = validateAndSanitizeAddress(originParam);
      origin = { address: sanitizedOrigin };
    } else {
      origin = addresses.origin;
    }

    if (destinationParam) {
      const sanitizedDestination = validateAndSanitizeAddress(destinationParam);
      destination = { address: sanitizedDestination };
    } else {
      destination = addresses.destination;
    }
  } catch (error) {
    throw new Error(`Address validation failed: ${error.message}`);
  }

  // Generate cache key based on addresses
  const cacheKey = `drive-times-${JSON.stringify(origin)}-${JSON.stringify(destination)}`;

  // Check cache first
  const cachedData = await env.TRAVEL_TIME_CACHE.get(cacheKey, { type: 'json' });
  if (cachedData) {
    const age = Date.now() - cachedData.timestamp;
    if (age < 4 * 60 * 1000) {
      console.log('Returning cached drive times');
      return {
        ...cachedData,
        cached: true,
        cacheTTL: 4 * 60 - age / 1000,
      };
    }
  }

  const [route1, route2] = await Promise.all([
    getTravelTime(origin, destination, env),
    getTravelTime(destination, origin, env)]);

  const responseData = {
    to: {
      duration: route1.duration,
      distanceMeters: route1.distanceMeters,
    },
    from: {
      duration: route2.duration,
      distanceMeters: route2.distanceMeters,
    },
    timestamp: Date.now(),
    cached: false
  };

  // Cache with the specific cache key
  const { cached, ...dataToCache } = responseData;
  await env.TRAVEL_TIME_CACHE.put(cacheKey, JSON.stringify(dataToCache), {
    expirationTtl: 300 // 5 minutes in seconds
  });
  
  return responseData;
}

async function handleMBTA(request, env) {
  const url = new URL(request.url);
  const stationParam = url.searchParams.get('station');
  const destinationParam = url.searchParams.get('destination');

  // Validate and sanitize inputs
  let mbtaConfig;
  let validatedDestination = null;

  try {
    if (stationParam) {
      const validatedStation = validateStationId(stationParam);
      mbtaConfig = { stationId: validatedStation, routeId: 'Red' };
    } else {
      mbtaConfig = mbta;
    }

    if (destinationParam) {
      validatedDestination = validateAndSanitizeAddress(destinationParam);
    }
  } catch (error) {
    throw new Error(`Input validation failed: ${error.message}`);
  }

  const mbtaTrains = await getMBTAPredictions(mbtaConfig);
  
  // Calculate walking time if destination provided
  let walkingTime = null;
  if (validatedDestination && mbtaConfig.stationId && redLineStations[mbtaConfig.stationId]) {
    try {
      const station = redLineStations[mbtaConfig.stationId];
      const stationLocation = {
        location: {
          latLng: {
            latitude: station.lat,
            longitude: station.lng
          }
        }
      };

      const route = await getTravelTime(
        stationLocation,
        { address: validatedDestination },
        env,
        "WALK"
      );

      if (route && route.duration) {
        const seconds = parseInt(route.duration.replace("s", ""), 10);
        if (isNaN(seconds) || seconds < 0 || seconds > 7200) { // Max 2 hours
          console.warn('Invalid walking time received:', route.duration);
        } else {
          walkingTime = {
            seconds: seconds,
            minutes: Math.ceil(seconds / 60),
            distance: route.distanceMeters
          };
        }
      }
    } catch (error) {
      console.error('Failed to calculate walking time:', error);
      // Don't throw error - walking time is optional
    }
  }
  
  return {
    predictions: mbtaTrains.map(pred => ({
      arrival: pred.arrival,
      departure: pred.departure,
      direction: pred.direction === 0 ? "Southbound" : "Northbound",
      status: pred.status
    })),
    walkingTime: walkingTime,
    stationName: redLineStations[mbtaConfig.stationId]?.name || 'Unknown',
    timestamp: Date.now(),
    cached: false
  }
}

// Rate limiting utility
class RateLimiter {
  constructor(env) {
    this.kv = env.TRAVEL_TIME_CACHE;
  }

  async checkRateLimit(clientId, maxRequests = 60, windowMs = 60000) {
    const key = `ratelimit:${clientId}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      const data = await this.kv.get(key, { type: 'json' });
      const requests = data?.requests?.filter(time => time > windowStart) || [];

      if (requests.length >= maxRequests) {
        return false;
      }

      requests.push(now);
      await this.kv.put(key, JSON.stringify({ requests }), { expirationTtl: Math.ceil(windowMs / 1000) });
      return true;
    } catch (error) {
      console.error('Rate limiting error:', error);
      // If rate limiting fails, allow the request
      return true;
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Only allow GET requests
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({
        error: 'Method Not Allowed',
        message: 'Only GET requests are supported'
      }), {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    const startTime = Date.now();
    let responseData;
    let statusCode = 200;

    try {
      // Get client IP for rate limiting
      const clientIP = request.headers.get('CF-Connecting-IP') ||
                      request.headers.get('X-Forwarded-For') ||
                      'unknown';

      // Initialize rate limiter
      const rateLimiter = new RateLimiter(env);

      // Check rate limit (60 requests per minute)
      const isAllowed = await rateLimiter.checkRateLimit(clientIP, 60, 60000);
      if (!isAllowed) {
        throw new Error('Rate limit exceeded. Please wait before making more requests.');
      }

      // Verify required environment variables
      if (!env.GOOGLE_API_KEY) {
        throw new Error('Service configuration error - Google API key missing');
      }

      if (!env.TRAVEL_TIME_CACHE) {
        throw new Error('Service configuration error - cache unavailable');
      }

      const url = new URL(request.url);
      console.log(`Processing ${request.method} ${url.pathname} from ${clientIP}`);

      switch (url.pathname) {
      case '/driving':
        responseData = await handleDriveTime(request, env);
        break;
      case '/mbta':
        responseData = await handleMBTA(request, env);
        break;
      case '/all':
        // Use Promise.allSettled for better error handling
        const [driveResult, mbtaResult] = await Promise.allSettled([
          handleDriveTime(request, env),
          handleMBTA(request, env)
        ]);

        responseData = {
          driving: driveResult.status === 'fulfilled' ? driveResult.value : {
            error: driveResult.reason.message,
            timestamp: Date.now()
          },
          mbta: mbtaResult.status === 'fulfilled' ? mbtaResult.value : {
            error: mbtaResult.reason.message,
            timestamp: Date.now()
          },
          timestamp: Date.now()
        };
        break;

      case '/health':
        responseData = {
          status: 'healthy',
          timestamp: Date.now(),
          version: '1.0.0'
        };
        break;

      default:
        statusCode = 404;
        responseData = {
          error: 'Endpoint Not Found',
          message: `The endpoint ${url.pathname} does not exist`,
          availableEndpoints: ['/driving', '/mbta', '/all', '/health']
        };
      }

      const processingTime = Date.now() - startTime;
      console.log(`Request completed in ${processingTime}ms for ${url.pathname}`);

      return new Response(JSON.stringify(responseData), {
        status: statusCode,
        headers: {
          'Content-Type': 'application/json',
          'X-Processing-Time': processingTime.toString(),
          ...corsHeaders
        }
      });
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error('Worker error:', {
        message: error.message,
        stack: error.stack,
        processingTime,
        url: request.url
      });

      // Determine appropriate status code based on error
      let errorStatus = 500;
      if (error.message.includes('Rate limit')) errorStatus = 429;
      else if (error.message.includes('validation failed') || error.message.includes('Invalid')) errorStatus = 400;
      else if (error.message.includes('configuration error')) errorStatus = 503;

      return new Response(JSON.stringify({
        error: 'Service Error',
        message: error.message,
        timestamp: new Date().toISOString(),
        processingTime
      }), {
        status: errorStatus,
        headers: {
          'Content-Type': 'application/json',
          'X-Processing-Time': processingTime.toString(),
          ...corsHeaders
        }
      });
    }
  }
};
