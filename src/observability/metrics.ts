import { Request, Response, NextFunction } from "express";
import client from "prom-client";
import { env } from "../config/env";

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duracao das requisicoes HTTP em segundos",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

function resolveRoute(request: Request) {
  if (request.route?.path) {
    return `${request.baseUrl || ""}${request.route.path}`;
  }
  return "unknown";
}

export function metricsMiddleware(request: Request, response: Response, next: NextFunction) {
  const end = httpRequestDuration.startTimer();
  response.on("finish", () => {
    end({
      method: request.method,
      route: resolveRoute(request),
      status_code: response.statusCode
    });
  });
  next();
}

export async function metricsHandler(request: Request, response: Response) {
  if (!env.METRICS_TOKEN) {
    response.status(503).json({ message: "Metrics not available." });
    return;
  }
  const authHeader = request.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (token !== env.METRICS_TOKEN) {
    response.status(401).json({ message: "Unauthorized" });
    return;
  }
  response.setHeader("Content-Type", register.contentType);
  response.end(await register.metrics());
}
