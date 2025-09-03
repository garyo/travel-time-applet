 // Copyright (c) 2024 Gary Oberbrunner
 // SPDX-License-Identifier: MIT

import {addresses, mbta} from './config.js';
import {redLineStations} from './stations.js';


async function getMBTAPredictions(mbta) {
  const url = `https://api-v3.mbta.com/predictions?filter[stop]=${mbta.stationId}&filter[route]=${mbta.routeId}&sort=arrival_time&page[limit]=6`;

  const response = await fetch(url, {
    headers: {
      'accept': 'application/vnd.api+json'
      // Add if you have an API key:
      // 'x-api-key': env.MBTA_API_KEY
    }
  });

  if (!response.ok) {
    throw new Error(`MBTA API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data.map(prediction => ({
    arrival: prediction.attributes.arrival_time,
    departure: prediction.attributes.departure_time,
    direction: prediction.attributes.direction_id, // 0 is southbound (Ashmont/Braintree), 1 is northbound (Alewife)
    status: prediction.attributes.status
  }));
}

// origin/dest should be e.g. {address: "123 any st"} (or lat/lon; see API docs)
async function getTravelTime(origin, destination, env, travelMode = "DRIVE") {
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

  // Fetch from Google API
  const googleResponse = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.GOOGLE_API_KEY,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters'
    },
    body: JSON.stringify(routeParams)
  });

  console.log('Google API response status:', googleResponse.status);

  if (!googleResponse.ok) {
    // Get error details from Google API
    const errorText = await googleResponse.text();
    console.error('Google API error:', errorText);
    throw new Error(`Google API error: ${googleResponse.status} - ${errorText}`);
  }

  const data = await googleResponse.json();

  if (!data.routes || !data.routes[0]) {
    console.error('Unexpected Google API response:', data);
    throw new Error('Invalid response from Google API');
  }

  return data.routes[0];        // should contain duration and distanceMeters
}



async function handleDriveTime(request, env) {
  const url = new URL(request.url);
  const originParam = url.searchParams.get('origin');
  const destinationParam = url.searchParams.get('destination');

  // Use custom addresses if provided, otherwise use defaults from config
  const origin = originParam ? { address: originParam } : addresses.origin;
  const destination = destinationParam ? { address: destinationParam } : addresses.destination;

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

  // Use custom station if provided, otherwise use default from config
  const mbtaConfig = stationParam ? 
    { stationId: stationParam, routeId: 'Red' } : 
    mbta;

  const mbtaTrains = await getMBTAPredictions(mbtaConfig);
  
  // Calculate walking time if destination provided
  let walkingTime = null;
  if (destinationParam && stationParam && redLineStations[stationParam]) {
    try {
      const station = redLineStations[stationParam];
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
        { address: destinationParam },
        env,
        "WALK"
      );
      
      if (route && route.duration) {
        const seconds = parseInt(route.duration.replace("s", ""), 10);
        walkingTime = {
          seconds: seconds,
          minutes: Math.ceil(seconds / 60),
          distance: route.distanceMeters
        };
      }
    } catch (error) {
      console.error('Failed to calculate walking time:', error);
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
    stationName: redLineStations[stationParam]?.name || 'Unknown',
    timestamp: Date.now(),
    cached: false
  }
}

export default {
  async fetch(request, env, _ /*ctx*/) {
    // Add CORS for all responses including errors
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    try {
      // Debug: Log environment variables (will appear in worker logs)
      console.log('Environment check:', {
        hasApiKey: !!env.GOOGLE_API_KEY,
        hasKvBinding: !!env.TRAVEL_TIME_CACHE,
        method: request.method,
        url: request.url
      });

      // Verify required environment variables
      if (!env.GOOGLE_API_KEY) {
        throw new Error('Google API key is not configured');
      }

      if (!env.TRAVEL_TIME_CACHE) {
        throw new Error('KV namespace is not bound to worker');
      }

      const url = new URL(request.url);
      let responseData;

      switch (url.pathname) {
      case '/driving':
        responseData = await handleDriveTime(request, env);
        break;
      case '/mbta':
        responseData = await handleMBTA(request, env);
        break;
      case '/all':  // returns both
        const [driveData, mbtaData] = await Promise.all([
          handleDriveTime(request, env),
          handleMBTA(request, env)
        ]);
        responseData = {
          driving: driveData,
          mbta: mbtaData,
          timestamp: Date.now()
        };
        break;

      default:
        return new Response(JSON.stringify({
          error: 'Not Found',
          availableEndpoints: ['/driving', '/mbta', '/all']
        }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }

      console.log(`Returning data for ${url.pathname}: ${JSON.stringify(responseData, null, 2)}`)
      return new Response(JSON.stringify(responseData), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } catch (error) {
      // Log the full error
      console.error('Worker error:', {
        message: error.message,
        stack: error.stack,
        cause: error.cause
      });

      // Return detailed error response
      return new Response(JSON.stringify({
        error: 'Failed to fetch travel time',
        details: error.message,
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  }
};
