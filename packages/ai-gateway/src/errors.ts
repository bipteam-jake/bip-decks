// Typed error hierarchy for the AI gateway. Callers can `instanceof` to
// distinguish recoverable failures (rate limits, transient timeouts) from
// hard config errors (unknown provider, missing API key).
//
// Kept deliberately small in Chunk 2B — providers will start throwing the
// more specific subclasses as we add them in 2C / 2D.

export class GatewayError extends Error {
  /** Stable machine-readable code for log/metric grouping. */
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GatewayError';
    this.code = code;
  }
}

/** Thrown by the dispatcher when a task routes to a provider that has no
 *  adapter wired up yet (e.g. `IMAGE_GEN` before Chunk 2C lands OpenAI). */
export class NotImplementedProviderError extends GatewayError {
  readonly provider: string;
  constructor(provider: string) {
    super(
      'gateway/provider_not_implemented',
      `Provider "${provider}" is not implemented in this build of @bip/ai-gateway.`,
    );
    this.name = 'NotImplementedProviderError';
    this.provider = provider;
  }
}

/** Thrown by `routing.ts` when an env override names an unknown provider. */
export class InvalidRoutingOverrideError extends GatewayError {
  constructor(envVar: string, value: string, reason: string) {
    super(
      'gateway/invalid_routing_override',
      `Env override ${envVar}="${value}" is invalid: ${reason}`,
    );
    this.name = 'InvalidRoutingOverrideError';
  }
}
