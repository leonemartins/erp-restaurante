import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map(x => x.toString(16).padStart(2, "0")).join("");
const normalizePhone = (value: string) => {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  return digits;
};
const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
const secretKey = secretKeysRaw ? (JSON.parse(secretKeysRaw)["default"] as string) : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!secretKey) throw new Error("Chave administrativa do Supabase não configurada.");
const adminFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  if (headers.get("Authorization") === `Bearer ${secretKey}`) headers.delete("Authorization");
  return fetch(input, { ...init, headers });
};
const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: adminFetch },
});
const graphVersion = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") || "v27.0";
const templateName = Deno.env.get("WHATSAPP_QUOTE_TEMPLATE_NAME") || "gestorpro_cotacao_fornecedor";
const templateLanguage = Deno.env.get("WHATSAPP_QUOTE_TEMPLATE_LANGUAGE") || "pt_BR";
const publicAppUrl = Deno.env.get("PUBLIC_APP_URL") || "https://leonemartins.github.io/erp-restaurante/";

async function authorize(req: Request, companyId: string) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return { error: "Sessão administrativa necessária.", status: 401 };
  const { data: { user }, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !user) return { error: "Sessão inválida.", status: 401 };
  const [{ data: membership }, { data: company }] = await Promise.all([
    admin.from("company_memberships").select("role,status").eq("company_id", companyId).eq("user_id", user.id).maybeSingle(),
    admin.from("companies").select("owner_id").eq("id", companyId).maybeSingle(),
  ]);
  const allowed = company?.owner_id === user.id || (membership?.status === "active" && ["admin", "manager"].includes(membership.role));
  if (!allowed) return { error: "Sem permissão para acessar as cotações desta empresa.", status: 403 };
  return { user };
}

async function sendText(to: string, text: string) {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "";
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: text } }),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const body = await req.json();
    const action = String(body.action || "");
    const quoteId = String(body.quote_id || "");
    const companyId = String(body.company_id || "");
    if (!["status", "send", "messages"].includes(action)) return json({ error: "Ação inválida." }, 400);
    if (!companyId && !quoteId) return json({ error: "Empresa ou cotação não informada." }, 400);

    let quote: any = null;
    if (quoteId) {
      const { data, error } = await admin.from("purchase_quotes").select("id,company_id,unit_id,title,status,opened_at,deadline").eq("id", quoteId).maybeSingle();
      if (error || !data) return json({ error: "Cotação não encontrada." }, 404);
      quote = data;
    }
    const targetCompanyId = quote?.company_id || companyId;
    const access = await authorize(req, targetCompanyId);
    if (access.error) return json({ error: access.error }, access.status);

    if (action === "status") {
      const configured = Boolean(Deno.env.get("WHATSAPP_ACCESS_TOKEN") && Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") && Deno.env.get("WHATSAPP_APP_SECRET") && Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN"));
      return json({ configured, template_name: templateName, template_language: templateLanguage, sender: configured ? "WhatsApp Business Cloud API" : null, requires_template_approval: true });
    }

    if (action === "messages") {
      if (!quote) return json({ error: "Cotação não informada." }, 400);
      const { data, error } = await admin.from("supplier_quote_whatsapp_messages").select("id,supplier_id,direction,phone,message_type,body,status,error,created_at,suppliers(name)").eq("quote_id", quote.id).order("created_at", { ascending: false }).limit(100);
      if (error) return json({ error: error.message }, 500);
      return json({ messages: data || [] });
    }

    const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "";
    const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
    if (!accessToken || !phoneId) return json({ error: "WhatsApp ainda não configurado. Cadastre WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID nos Secrets do Supabase." }, 409);
    if (!Deno.env.get("WHATSAPP_APP_SECRET") || !Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN")) return json({ error: "Falta configurar a validação segura do webhook do WhatsApp." }, 409);

    const now = Date.now(), start = new Date(quote.opened_at).getTime(), end = new Date(quote.deadline).getTime();
    if (!quote.opened_at || !quote.deadline || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) return json({ error: "Informe abertura e encerramento válidos." }, 400);
    if (now < start) return json({ error: "A cotação ainda não abriu." }, 400);
    if (now >= end || quote.status === "cancelled") return json({ error: "O prazo desta cotação terminou." }, 400);

    const { data: links, error: linkError } = await admin.from("supplier_quote_links")
      .select("id,supplier_id,suppliers(name,phone,whatsapp_opt_in)")
      .eq("quote_id", quote.id);
    if (linkError) return json({ error: linkError.message }, 500);
    if (!links?.length) return json({ error: "Inclua pelo menos um fornecedor." }, 400);

    const results = [];
    for (const link of links) {
      const supplier = link.suppliers;
      const phone = normalizePhone(supplier?.phone || "");
      if (!phone || phone.length < 12 || phone.length > 15) {
        results.push({ supplier: supplier?.name || "Fornecedor", sent: false, error: "Cadastre um telefone/WhatsApp válido com DDD e código do país." });
        continue;
      }
      if (supplier?.whatsapp_opt_in !== true) {
        results.push({ supplier: supplier?.name || "Fornecedor", sent: false, error: "Envio bloqueado: registre a autorização do fornecedor para receber mensagens pelo WhatsApp." });
        continue;
      }
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x => x.toString(16).padStart(2, "0")).join("");
      const tokenHash = await sha(token);
      const portalUrl = publicAppUrl + (publicAppUrl.includes("?") ? "&" : "?") + "supplier_quote=" + token;
      const deadlineText = new Date(quote.deadline).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const messageText = `Olá, ${supplier.name}! O GestorPro convida você a enviar sua proposta para a cotação "${quote.title}". Prazo: ${deadlineText}. Acesse o portal seguro: ${portalUrl}`;
      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLanguage },
          components: [{
            type: "body",
            parameters: [
              { type: "text", text: String(supplier.name || "Fornecedor").slice(0, 120) },
              { type: "text", text: String(quote.title).slice(0, 150) },
              { type: "text", text: deadlineText },
              { type: "text", text: portalUrl },
            ],
          }],
        },
      };
      const { error: tokenError } = await admin.from("supplier_quote_links").update({
        whatsapp_token_hash: tokenHash,
        whatsapp_sent_at: null,
        whatsapp_message_id: null,
        last_whatsapp_error: null,
      }).eq("id", link.id);
      if (tokenError) {
        results.push({ supplier: supplier?.name, sent: false, error: tokenError.message });
        continue;
      }
      const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const reason = data.error?.message || "Falha no envio pelo WhatsApp Business.";
        await admin.from("supplier_quote_links").update({ last_whatsapp_error: reason }).eq("id", link.id);
        await admin.from("supplier_quote_whatsapp_messages").insert({
          company_id: quote.company_id, quote_id: quote.id, supplier_id: link.supplier_id,
          direction: "outbound", phone, message_type: "template", body: messageText, status: "failed", error: reason,
          payload: { code: data.error?.code || null, type: data.error?.type || null },
        });
        results.push({ supplier: supplier?.name, sent: false, error: reason });
        continue;
      }
      const messageId = data.messages?.[0]?.id || null;
      await admin.from("supplier_quote_links").update({ whatsapp_sent_at: new Date().toISOString(), whatsapp_message_id: messageId, last_whatsapp_error: null }).eq("id", link.id);
      await admin.from("supplier_quote_whatsapp_messages").insert({
        company_id: quote.company_id, quote_id: quote.id, supplier_id: link.supplier_id,
        direction: "outbound", phone, message_type: "template", body: messageText, provider_message_id: messageId,
        status: "sent", payload: { template: templateName },
      });
      results.push({ supplier: supplier?.name, sent: true, message_id: messageId });
    }
    return json({ sent: results.filter(x => x.sent).length, total: results.length, results });
  } catch (error) {
    console.error("whatsapp-quote error", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado no WhatsApp." }, 500);
  }
});
