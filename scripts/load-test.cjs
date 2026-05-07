const autocannon = require("autocannon");

function run(target) {
  return new Promise((resolve, reject) => {
    autocannon(
      {
        url: target.url,
        connections: target.connections,
        duration: target.duration,
        headers: target.headers,
        pipelining: 1
      },
      (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(result);
      }
    );
  });
}

async function main() {
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  const metricsToken = process.env.METRICS_TOKEN;

  const targets = [
    {
      name: "health",
      url: `${baseUrl}/health`,
      connections: 50,
      duration: 20
    }
  ];

  if (metricsToken) {
    targets.push({
      name: "metrics",
      url: `${baseUrl}/metrics`,
      connections: 10,
      duration: 10,
      headers: { Authorization: `Bearer ${metricsToken}` }
    });
  } else {
    targets.push({
      name: "metrics",
      url: `${baseUrl}/metrics`,
      connections: 10,
      duration: 10
    });
  }

  for (const target of targets) {
    const result = await run(target);
    const errors = result.errors + result.timeouts;
    if (errors > 0) {
      throw new Error(`Load test failed on ${target.name}: ${errors} errors/timeouts`);
    }
    console.log(`Load test ${target.name} OK:`, {
      requests: result.requests.total,
      latency: result.latency,
      throughput: result.throughput
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
