#!/usr/bin/env bun

/**
 * API Test Suite for Travel Time Worker (using curl)
 * Alternative test script that uses curl instead of fetch for better compatibility
 */

const { spawn } = require('child_process');

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
const IS_LOCAL = WORKER_URL.includes('localhost');

let wranglerProcess = null;

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function startDevServer() {
  if (!IS_LOCAL) {
    return; // No need to start server for production testing
  }

  log('blue', '🚀 Starting local development server...');

  return new Promise((resolve, reject) => {
    wranglerProcess = spawn('bunx', ['wrangler', 'dev'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: { ...process.env }
    });

    let serverReady = false;
    let startupTimeout;

    wranglerProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Ready on http://localhost:8787') && !serverReady) {
        serverReady = true;
        clearTimeout(startupTimeout);
        log('green', '✅ Development server is ready');
        resolve();
      }
    });

    wranglerProcess.stderr.on('data', (data) => {
      const output = data.toString();
      // Only log actual errors, not the usual tty warnings
      if (!output.includes('device not configured') && !output.includes('chpwd')) {
        console.error('Wrangler stderr:', output);
      }
    });

    wranglerProcess.on('exit', (code, signal) => {
      if (!serverReady && code !== 0) {
        reject(new Error(`Wrangler dev server exited with code ${code}`));
      }
    });

    wranglerProcess.on('error', (error) => {
      if (!serverReady) {
        reject(new Error(`Failed to start wrangler: ${error.message}`));
      }
    });

    // Timeout after 30 seconds
    startupTimeout = setTimeout(() => {
      if (!serverReady) {
        wranglerProcess.kill();
        reject(new Error('Timeout waiting for development server to start'));
      }
    }, 30000);
  });
}

async function stopDevServer() {
  if (wranglerProcess && !wranglerProcess.killed) {
    log('blue', '🛑 Shutting down development server...');

    return new Promise((resolve) => {
      wranglerProcess.on('exit', () => {
        log('green', '✅ Development server stopped');
        resolve();
      });

      // Try graceful shutdown first
      wranglerProcess.kill('SIGTERM');

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (!wranglerProcess.killed) {
          wranglerProcess.kill('SIGKILL');
          resolve();
        }
      }, 5000);
    });
  }
}

// Cleanup on process exit
process.on('exit', () => {
  if (wranglerProcess && !wranglerProcess.killed) {
    wranglerProcess.kill('SIGKILL');
  }
});

process.on('SIGINT', async () => {
  await stopDevServer();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await stopDevServer();
  process.exit(0);
});

async function curlRequest(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const curl = spawn('curl', [
      '-s', // silent
      '-w', '%{http_code}\n%{time_total}', // write status code and time
      '-m', Math.floor(timeout / 1000).toString(), // timeout in seconds
      url
    ]);

    let stdout = '';
    let stderr = '';

    curl.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    curl.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    curl.on('close', (code) => {
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      if (code === 0) {
        // Parse curl output - format is: JSON_RESPONSE + STATUS_CODE + \n + TIME_TOTAL
        const parts = stdout.trim().split('\n');
        const curlTime = parseFloat(parts[parts.length - 1]) * 1000; // convert to ms

        // The status code and JSON are on the same line, separated by the last 3 digits
        const responseWithStatus = parts[parts.length - 2] || parts[0];
        const statusCodeMatch = responseWithStatus.match(/(\d{3})$/);
        const statusCode = statusCodeMatch ? parseInt(statusCodeMatch[1]) : 0;

        // Remove the status code from the end to get the JSON body
        const body = statusCodeMatch ? responseWithStatus.slice(0, -3) : responseWithStatus;

        try {
          const data = JSON.parse(body);
          resolve({
            success: true,
            statusCode,
            data,
            responseTime: Math.round(curlTime || responseTime)
          });
        } catch (error) {
          resolve({
            success: false,
            statusCode,
            error: `Invalid JSON: ${body.substring(0, 200)}`,
            responseTime: Math.round(curlTime || responseTime)
          });
        }
      } else {
        reject({
          success: false,
          error: `Curl failed (code ${code}): ${stderr || 'Connection error'}`,
          responseTime
        });
      }
    });
  });
}

async function testEndpoint(endpoint, params, expectedFields, testName) {
  const url = new URL(endpoint, WORKER_URL);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  try {
    log('blue', `\\n🧪 Testing: ${testName}`);
    log('blue', `   URL: ${url.toString()}`);

    const result = await curlRequest(url.toString());

    // Check if we got a response (either success or expected error)
    const isExpectedError = result.success && result.statusCode >= 400 && expectedFields.includes('error');
    const isSuccess = result.success && result.statusCode >= 200 && result.statusCode < 300;

    if (isSuccess || isExpectedError) {
      const statusType = isSuccess ? 'SUCCESS' : 'ERROR (expected)';
      const color = isSuccess ? 'green' : 'yellow';
      log(color, `   ✅ ${statusType} (${result.statusCode}) - ${result.responseTime}ms`);

      // Check for expected fields
      const missingFields = expectedFields.filter(field => !result.data.hasOwnProperty(field));
      if (missingFields.length > 0) {
        log('yellow', `   ⚠️  Missing expected fields: ${missingFields.join(', ')}`);
      } else {
        log('green', `   ✅ All expected fields present`);
      }

      // Log key data for success responses
      if (isSuccess) {
        if (result.data.walkingTime) {
          log('blue', `   🚶 Walking time: ${result.data.walkingTime.minutes} minutes`);
        }
        if (result.data.drivingTime) {
          log('blue', `   🚗 Driving time: ${Math.round(result.data.drivingTime.seconds / 60)} minutes`);
        }
        if (result.data.predictions && result.data.predictions.length > 0) {
          log('blue', `   🚇 Next train: ${new Date(result.data.predictions[0].departure).toLocaleTimeString()}`);
        }
        if (result.data.cached !== undefined) {
          log('blue', `   💾 Cached: ${result.data.cached}`);
        }
      }

      // Log error details for expected errors
      if (isExpectedError) {
        log('blue', `   📝 Error message: ${result.data.message || result.data.error}`);
      }

      return { success: true, responseTime: result.responseTime, data: result.data };
    } else {
      log('red', `   ❌ UNEXPECTED FAILURE (${result.statusCode || 'Unknown'}) - ${result.responseTime}ms`);
      log('red', `   Error: ${result.data?.message || result.data?.error || result.error || 'Unknown error'}`);
      return { success: false, responseTime: result.responseTime, error: result.data || result.error };
    }
  } catch (error) {
    log('red', `   ❌ NETWORK ERROR: ${error.error || error.message}`);
    return { success: false, error: error.error || error.message };
  }
}

async function runTests() {
  log('blue', '🚀 Starting Travel Time Worker API Tests (curl version)');
  log('blue', `   Target: ${WORKER_URL}`);

  // Start development server if testing locally
  try {
    await startDevServer();
  } catch (error) {
    log('red', `❌ Failed to start development server: ${error.message}`);
    process.exit(1);
  }

  const testCases = [
    // Valid MBTA requests
    {
      endpoint: '/mbta',
      params: {
        origin: '100 Main St Boston MA',
        destination: '200 Broadway Cambridge MA'
      },
      expectedFields: ['predictions', 'walkingTime', 'stationName', 'timestamp'],
      testName: 'MBTA - Valid Boston to Cambridge'
    },
    {
      endpoint: '/mbta',
      params: {
        origin: '1 Beacon St Boston MA',
        destination: '77 Massachusetts Ave Cambridge MA'
      },
      expectedFields: ['predictions', 'walkingTime', 'stationName', 'timestamp'],
      testName: 'MBTA - Valid downtown Boston to MIT'
    },

    // Valid Driving requests
    {
      endpoint: '/driving',
      params: {
        origin: '100 Main St Boston MA',
        destination: '200 Broadway Cambridge MA'
      },
      expectedFields: ['drivingTime', 'distance', 'timestamp'],
      testName: 'Driving - Valid Boston to Cambridge'
    },

    // Invalid requests (should return errors)
    {
      endpoint: '/mbta',
      params: {
        origin: 'Boston',
        destination: 'Cambridge'
      },
      expectedFields: ['error', 'message'],
      testName: 'MBTA - Invalid addresses (too vague)'
    },
    {
      endpoint: '/driving',
      params: {
        origin: '',
        destination: '200 Broadway Cambridge MA'
      },
      expectedFields: ['error', 'message'],
      testName: 'Driving - Missing origin'
    },
    {
      endpoint: '/mbta',
      params: {
        origin: '<script>alert("xss")</script>',
        destination: '200 Broadway Cambridge MA'
      },
      expectedFields: ['error', 'message'],
      testName: 'MBTA - XSS attempt (should be blocked)'
    }
  ];

  let passedTests = 0;
  let totalTests = testCases.length;
  const results = [];

  for (const testCase of testCases) {
    const result = await testEndpoint(
      testCase.endpoint,
      testCase.params,
      testCase.expectedFields,
      testCase.testName
    );

    results.push({
      ...testCase,
      ...result
    });

    if (result.success) {
      passedTests++;
    }

    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Summary
  log('blue', '\\n📊 Test Summary');
  log('blue', '================');
  log(passedTests === totalTests ? 'green' : 'yellow',
      `Passed: ${passedTests}/${totalTests} tests`);

  if (passedTests < totalTests) {
    log('red', `Failed: ${totalTests - passedTests} tests`);
  }

  // Performance summary
  const responseTimes = results.filter(r => r.responseTime).map(r => r.responseTime);
  if (responseTimes.length > 0) {
    const avgResponseTime = Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length);
    const maxResponseTime = Math.max(...responseTimes);
    log('blue', `Average response time: ${avgResponseTime}ms`);
    log('blue', `Max response time: ${maxResponseTime}ms`);
  }

  // Stop development server if we started it
  try {
    await stopDevServer();
  } catch (error) {
    log('yellow', `⚠️  Warning: Failed to stop development server: ${error.message}`);
  }

  process.exit(passedTests === totalTests ? 0 : 1);
}

// Run tests
runTests().catch(async (error) => {
  log('red', `Fatal error: ${error.message}`);
  // Ensure server is stopped even on fatal error
  try {
    await stopDevServer();
  } catch (stopError) {
    // Ignore stop errors on fatal error
  }
  process.exit(1);
});