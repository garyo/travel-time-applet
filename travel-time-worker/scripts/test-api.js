#!/usr/bin/env bun

/**
 * API Test Suite for Travel Time Worker
 * Tests both local development and production endpoints
 */

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
const IS_LOCAL = WORKER_URL.includes('localhost');

let wranglerProcess = null;

// Function to find an available port
async function findAvailablePort(startPort = 8787, maxPort = 8800) {
  const net = require('net');

  for (let port = startPort; port <= maxPort; port++) {
    try {
      await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(port, () => {
          server.close(resolve);
        });
        server.on('error', reject);
      });
      return port;
    } catch (error) {
      // Port is busy, try next one
      continue;
    }
  }
  throw new Error(`No available ports between ${startPort} and ${maxPort}`);
}

async function startDevServer() {
  if (!IS_LOCAL) {
    return; // No need to start server for production testing
  }

  log('blue', '🚀 Starting local development server...');

  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');

    wranglerProcess = spawn('bunx', ['wrangler', 'dev'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd()
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

async function testEndpoint(fullUrl, params, expectedFields, testName) {
  const url = new URL(fullUrl);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  try {
    log('blue', `\n🧪 Testing: ${testName}`);
    log('blue', `   URL: ${url.toString()}`);

    const startTime = Date.now();
    const response = await fetch(url.toString());
    const endTime = Date.now();
    const responseTime = endTime - startTime;

    const data = await response.json();

    // Check if we got a response (either success or expected error)
    const isExpectedError = !response.ok && expectedFields.includes('error');
    const isSuccess = response.ok;

    if (isSuccess || isExpectedError) {
      const statusType = isSuccess ? 'SUCCESS' : 'ERROR (expected)';
      const color = isSuccess ? 'green' : 'yellow';
      log(color, `   ✅ ${statusType} (${response.status}) - ${responseTime}ms`);

      // Check for expected fields
      const missingFields = expectedFields.filter(field => !data.hasOwnProperty(field));
      if (missingFields.length > 0) {
        log('yellow', `   ⚠️  Missing expected fields: ${missingFields.join(', ')}`);
      } else {
        log('green', `   ✅ All expected fields present`);
      }

      // Log key data for success responses
      if (isSuccess) {
        if (data.walkingTime) {
          log('blue', `   🚶 Walking time: ${data.walkingTime.minutes} minutes`);
        }
        if (data.drivingTime) {
          log('blue', `   🚗 Driving time: ${Math.round(data.drivingTime.seconds / 60)} minutes`);
        }
        if (data.predictions && data.predictions.length > 0) {
          log('blue', `   🚇 Next train: ${new Date(data.predictions[0].departure).toLocaleTimeString()}`);
        }
        if (data.cached !== undefined) {
          log('blue', `   💾 Cached: ${data.cached}`);
        }
      }

      // Log error details for expected errors
      if (isExpectedError) {
        log('blue', `   📝 Error message: ${data.message || data.error}`);
      }

      return { success: true, responseTime, data };
    } else {
      log('red', `   ❌ UNEXPECTED FAILURE (${response.status}) - ${responseTime}ms`);
      log('red', `   Error: ${data.message || data.error || 'Unknown error'}`);
      return { success: false, responseTime, error: data };
    }
  } catch (error) {
    log('red', `   ❌ NETWORK ERROR: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  log('blue', '🚀 Starting Travel Time Worker API Tests');
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
    },

    // Rate limiting test (if testing locally)
    ...(WORKER_URL.includes('localhost') ? [{
      endpoint: '/mbta',
      params: {
        origin: '100 Main St Boston MA',
        destination: '200 Broadway Cambridge MA'
      },
      expectedFields: ['predictions', 'walkingTime', 'stationName', 'timestamp'],
      testName: 'MBTA - Cache test (should be faster)'
    }] : [])
  ];

  let passedTests = 0;
  let totalTests = testCases.length;
  const results = [];

  for (const testCase of testCases) {
    const result = await testEndpoint(
      `${WORKER_URL}${testCase.endpoint}`,
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
  log('blue', '\n📊 Test Summary');
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