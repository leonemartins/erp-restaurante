import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
const secretKey = secretKeysRaw ? (JSON.parse(secretKeysRaw)["default"] as string) : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!secretKey) throw new Error("Chave administrativa do Supabase não configurada.");
const adminFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  // Supabase secret API keys are not JWTs: send them as apikey only, never as Bearer.
  if (headers.get("Authorization") === `Bearer ${secretKey}`) headers.delete("Authorization");
  return fetch(input, { ...init, headers });
};
const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: adminFetch },
});
const graphVersion = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") || "v27.0";
const normalizePhone = (value: string) => { let digits = String(value || "").replace(/\D/g, ""); if (digits.length === 10 || digits.length === 11) digits = "55" + digits; return digits; };
async function validSignature(raw: string, signature: string | null) {
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET") || "";
  if (!appSecret || !signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const expected = Array.from(signed).map(x => x.toString(16).padStart(2, "0")).join("");
  const received = signature.slice(7).toLowerCase();
  if (expected.length !== received.length) return false;
  let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}
async function sendReply(to: string, body: string) {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "";
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneId}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body } }),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}
Deno.serve(async (req) => {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") && challenge) return new Response(challenge, { status: 200 });
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const raw = await req.text();
    if (!await validSignature(raw, req.headers.get("X-Hub-Signature-256"))) return new Response("Invalid signature", { status: 401 });
    const event = JSON.parse(raw);
    for (const entry of event.entry || []) for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const status of value.statuses || []) {
        await admin.from("supplier_quote_whatsapp_messages").update({ status: status.status || "unknown", updated_at: new Date().toISOString(), payload: { recipient_id: status.recipient_id || null, conversation: status.conversation || null, pricing: status.pricing || null } }).eq("provider_message_id", status.id);
      }
      for (const message of value.messages || []) {
        const from = normalizePhone(message.from || "");
        const messageId = message.id || null;
        const body = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || (message.type === "document" ? "[Documento recebido]" : `[Mensagem ${message.type || "desconhecida"}]`);
        const { data: suppliers } = await admin.from("suppliers").select("id,company_id,name,phone").not("phone", "is", null).limit(2000);
        const supplier = (suppliers || []).find((s: any) => normalizePhone(s.phone) === from);
        if (!supplier) continue;
        const { data: links } = await admin.from("supplier_quote_links").select("id,quote_id,supplier_id,whatsapp_sent_at,purchase_quotes(id,title,deadline,status,company_id)").eq("supplier_id", supplier.id).not("whatsapp_token_hash", "is", null).not("whatsapp_sent_at", "is", null).order("whatsapp_sent_at", { ascending: false }).limit(10);
        const active = (links || []).find((l: any) => l.purchase_quotes && l.purchase_quotes.status !== "cancelled" && new Date(l.purchase_quotes.deadline).getTime() > Date.now());
        await admin.from("supplier_quote_whatsapp_messages").upsert({
          company_id: supplier.company_id, quote_id: active?.quote_id || null, supplier_id: supplier.id,
          direction: "inbound", phone: from, message_type: message.type || "text", body: String(body).slice(0, 4000),
          provider_message_id: messageId, status: "received", payload: { timestamp: message.timestamp || null },
        }, { onConflict: "provider_message_id" });
        let reply = "Olá! Recebemos sua mensagem pelo WhatsApp do GestorPro. Nossa equipe de compras retornará em breve.";
        if (active) {
          const { data: lastInvite } = await admin.from("supplier_quote_whatsapp_messages").select("body").eq("quote_id", active.quote_id).eq("supplier_id", supplier.id).eq("direction", "outbound").eq("message_type", "template").order("created_at", { ascending: false }).limit(1).maybeSingle();
          const match = String(lastInvite?.body || "").match(/https?:\/\/[^\s]+supplier_quote=[a-f0-9]{64}/);
          if (match) reply = `Olá, ${supplier.name}! Recebemos sua mensagem sobre a cotação "${active.purchase_quotes.title}". Para informar preços e condições, utilize o portal seguro: ${match[0]}. Se precisar de ajuda adicional, responda por aqui.`;
        }
        const sent = await sendReply(from, reply);
        if (sent.ok) {
          await admin.from("supplier_quote_whatsapp_messages").insert({
            company_id: supplier.company_id, quote_id: active?.quote_id || null, supplier_id: supplier.id,
            direction: "outbound", phone: from, message_type: "text", body: reply,
            provider_message_id: sent.data.messages?.[0]?.id || null, status: "sent",
          });
        } else {
          console.error("WhatsApp auto-reply failed", sent.data?.error?.message || "unknown");
        }
      }
    }
    return new Response("EVENT_RECEIVED", { status: 200 });
  } catch (error) {
    console.error("whatsapp-webhook error", error);
    return json({ error: "Falha ao processar webhook." }, 500);
  }
});
