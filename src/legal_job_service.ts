import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { createInfraiQueue, InfraiError } from "./infrai_queue.js";
import { deadLetterReviewSchema, decideRedrive, legalJobSchema } from "./legal_jobs.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const infrai = createInfraiQueue(apiKey);

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Buffer | string>): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return JSON.parse(raw);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/legal-jobs") {
      const job = legalJobSchema.parse(await readJson(request));
      const requestId = request.headers["idempotency-key"]?.toString() ?? randomUUID();
      await infrai.queue.publish("legal-jobs", job, requestId);
      return send(response, 202, { accepted: true, requestId, kind: job.kind });
    }

    if (request.method === "GET" && request.url?.startsWith("/dead-letters/")) {
      const queue = decodeURIComponent(request.url.slice("/dead-letters/".length));
      return send(response, 200, await infrai.queue.dlq.list(queue));
    }

    if (request.method === "POST" && request.url === "/dead-letters/review") {
      const review = deadLetterReviewSchema.parse(await readJson(request));
      const decision = decideRedrive(review);
      if (decision.action === "redrive") {
        await infrai.queue.dlq.redrive(review.queue, review.messageId, `redrive:${review.messageId}`);
      }
      return send(response, 200, { messageId: review.messageId, ...decision });
    }

    return send(response, 404, { error: "route_not_found" });
  } catch (error) {
    if (error instanceof ZodError) return send(response, 400, { error: "invalid_request", issues: error.issues });
    if (error instanceof SyntaxError) return send(response, 400, { error: "invalid_json" });
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return send(response, status, { error: error.code, message: error.message });
    }
    console.error(error);
    return send(response, 500, { error: "internal_error" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Legal job service listening on http://localhost:${port}`));
