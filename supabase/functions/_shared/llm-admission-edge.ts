// Draft integration; policy defaults deny. API-key presence never authorizes cost.
import { admittedMessage } from "./llm-admission.mjs";
import type { AnthropicMessageCreate } from "./llm-classifier.ts";

export type AdmissionState = {
  dispatched: boolean;
  denied: boolean;
  settlementAcknowledged: boolean;
};
export class LlmAdmissionError extends Error {
  constructor(public readonly state: AdmissionState) {
    super(state.denied ? "llm_admission_denied" : "llm_response_uncertain");
    this.name = "LlmAdmissionError";
  }
}
type Database = { url: string; serviceKey: string };
// Each invocation is a separate uncached HTTP request. Never forward caller
// headers, transaction preferences, or a caller-provided RPC implementation.
async function databaseRpc(database: Database, name: string, args: Record<string, unknown>) {
  const base = new URL(database.url);
  if (base.protocol !== "https:" || base.username || base.password || base.search
      || base.hash || (base.pathname !== "/" && base.pathname !== "") || !database.serviceKey
      || !["reserve_llm_v1", "confirm_llm_v1", "settle_llm_v1"].includes(name)) {
    throw new Error("Invalid admission database configuration");
  }
  const response = await fetch(`${base.origin}/rest/v1/rpc/${name}`, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000),
    headers: { "content-type": "application/json", "cache-control": "no-store",
      apikey: database.serviceKey, authorization: `Bearer ${database.serviceKey}` },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error("Admission database response unconfirmed");
  return await response.json();
}
// The sole Edge adapter. No SDK retry, fallback model, or admission retry.
// A reserve receipt alone is insufficient: fresh confirmation must see its debit.
export function admittedCreate(
  database: Database,
  apiKey: string,
  action: "proxy_blurb" | "proxy_classify" | "cuisine_backfill",
  onState?: (state: AdmissionState) => void,
): AnthropicMessageCreate {
  return async (request) => {
    const result = await admittedMessage({
      rpc: async (name: string, args: Record<string, unknown>) => {
        const data = await databaseRpc(database, name, args);
        if (name === "reserve_llm_v1" && data?.admitted === true) {
          // Await a second HTTP request; a rolled-back provisional receipt has
          // no row in this transaction and therefore cannot authorize dispatch.
          const confirmed = await databaseRpc(database, "confirm_llm_v1", {
            ...args, p_admitted_at_ms: data.admitted_at_ms,
            p_expires_at_ms: data.expires_at_ms, p_reserved_micros: data.reserved_micros,
          });
          if (confirmed !== true) throw new Error("Reservation commit unconfirmed");
        }
        return { data, error: null };
      },
      fetchImpl: fetch, apiKey, id: crypto.randomUUID(), action, request,
    });
    const state = {
      dispatched: result.status !== "denied",
      denied: result.status === "denied",
      settlementAcknowledged: result.settlementAcknowledged === true,
    };
    onState?.(state);
    if (result.status !== "response") throw new LlmAdmissionError(state);
    // Usage/identity were validated by the helper; validate parser-facing shape.
    if (!Array.isArray(result.message?.content)
        || result.message.content.some((c: unknown) => !c || typeof c !== "object"
          || typeof (c as { type?: unknown }).type !== "string"
          || ((c as { type: string }).type === "text"
            && typeof (c as { text?: unknown }).text !== "string"))) {
      throw new LlmAdmissionError({ ...state, denied: false });
    }
    // A lost settlement ACK never discards an otherwise valid paid result.
    return result.message;
  };
}
