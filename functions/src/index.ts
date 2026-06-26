import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

const BACKEND_TARGET = "http://168.231.78.113:4300";

/**
 * Proxies /api/* requests to the WhatsApp backend server.
 * This avoids Mixed Content errors when the app is served over HTTPS.
 */
export const apiProxy = onRequest(
  {
    cors: true,
    minInstances: 0,
    maxInstances: 10,
    concurrency: 40,
    invoker: "public",
  },
  async (req, res) => {
    // Build the target URL: strip /api from the path prefix if it exists
    // The backend at 168.231.78.113:4300 already has /api routes
    // We forward the full path including /api
    const targetPath = req.path; // e.g. /api/whatsapp/status/xyz
    const targetUrl = `${BACKEND_TARGET}${targetPath}`;

    logger.info(`Proxying ${req.method} ${req.path} → ${targetUrl}`);

    // Build fetch options
    const fetchOptions: RequestInit = {
      method: req.method,
      headers: {} as Record<string, string>,
    };

    // Forward specific headers from the original request
    const HEADERS_TO_FORWARD = [
      "content-type",
      "authorization",
      "x-user-id",
      "x-api-key",
      "accept",
    ];
    for (const h of HEADERS_TO_FORWARD) {
      const val = req.headers[h];
      if (val && typeof val === "string") {
        (fetchOptions.headers as Record<string, string>)[h] = val;
      }
    }

    // Forward body for POST/PUT/PATCH
    if (req.method !== "GET" && req.method !== "HEAD") {
      const body = req.rawBody;
      if (body && body.length > 0) {
        fetchOptions.body = body.toString();
      }
    }

    try {
      const backendRes = await fetch(targetUrl, fetchOptions);

      // Copy status and headers
      res.status(backendRes.status);

      // Copy response headers
      const RESPONSE_HEADERS = [
        "content-type",
        "content-length",
        "cache-control",
        "x-request-id",
      ];
      for (const h of RESPONSE_HEADERS) {
        const val = backendRes.headers.get(h);
        if (val) {
          res.set(h, val);
        }
      }

      // Send the response body
      const text = await backendRes.text();
      res.send(text);
    } catch (error: any) {
      logger.error(`Proxy error for ${req.path}:`, error?.message || error);
      res.status(502).json({
        error: "Backend unavailable",
        detail: error?.message || "Connection to WhatsApp backend failed",
      });
    }
  },
);
