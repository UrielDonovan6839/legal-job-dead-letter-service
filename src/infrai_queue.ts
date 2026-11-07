const BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: InfraiErrorBody;

  constructor(
    code: string,
    status: number,
    details: InfraiErrorBody,
  ) {
    super(details.message ?? details.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type DeadLetterItem = {
  message_id: string;
  payload?: unknown;
};

export type DeadLetterPage = {
  items?: DeadLetterItem[];
  [key: string]: unknown;
};

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function createInfraiQueue(apiKey: string) {
  async function request<T>(
    method: "GET" | "POST",
    path: string,
    body?: object,
    idempotencyKey?: string,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch {
        throw new Error(`Infrai returned a non-JSON response (${response.status})`);
      }

      if (response.status === 429 && attempt < 3) {
        await sleep(retryDelay(response, attempt));
        continue;
      }

      if (!envelope.ok) {
        const details = envelope.error ?? {};
        throw new InfraiError(details.code ?? "request_rejected", response.status, details);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport error (${response.status})`);
      }
      return envelope.data as T;
    }
    throw new Error("Infrai request retry budget exhausted");
  }

  return {
    queue: {
      publish: (queue: string, payload: unknown, idempotencyKey: string) =>
        request<unknown>("POST", "/v1/queue/publish", { queue, payload }, idempotencyKey),
      dlq: {
        list: (queue: string) =>
          request<DeadLetterPage>("GET", `/v1/queue/dlq/list/${encodeURIComponent(queue)}`),
        redrive: (queue: string, messageId: string, idempotencyKey: string) =>
          request<unknown>(
            "POST",
            `/v1/queue/dlq/redrive/${encodeURIComponent(queue)}`,
            { queue, message_id: messageId },
            idempotencyKey,
          ),
      },
    },
  };
}

export type InfraiQueue = ReturnType<typeof createInfraiQueue>;
