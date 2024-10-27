import {addresses, mbta} from './config.js';


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
async function getTravelTime(origin, destination, env) {
  // Route parameters
  const routeParams = {
    origin: origin,
    destination: destination,
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    computeAlternativeRoutes: false,
    routeModifiers: {
      avoidTolls: false,
      avoidHighways: false,
      avoidFerries: false
    },
    languageCode: "en-US",
    units: "IMPERIAL"
  };

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

  // Log Google API response status
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

export default {
  async fetch(request, env, ctx) {
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

      const route1 = await getTravelTime(addresses.origin, addresses.destination, env)
      const route2 = await getTravelTime(addresses.destination, addresses.origin, env)
      const mbtaTrains = await getMBTAPredictions(mbta)

      // Prepare response data
      const responseData = {
        driving: {
          to: {
            duration: route1.duration,
            distanceMeters: route1.distanceMeters,
          },
          from: {
            duration: route2.duration,
            distanceMeters: route2.distanceMeters,
          },
        },
        mbta: {
          predictions: mbtaTrains.map(pred => ({
            arrival: pred.arrival,
            direction: pred.direction === 0 ? "Southbound" : "Northbound",
            status: pred.status
          }))
        },
        timestamp: Date.now(),
        cached: false
      };
      // For debugging:
      // console.log(`Returning data: ${JSON.stringify(responseData, null, 2)}`)
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
