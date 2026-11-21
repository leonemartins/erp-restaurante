# GestorPro — WhatsApp Business for supplier quotations

## What was deployed

- `whatsapp-quote`: authenticated sender, integration status, and quotation message inbox.
- `whatsapp-webhook`: Meta webhook verification, inbound messages, and delivery-status updates.
- `supplier-quote-portal`: accepts the separate hashed token used by WhatsApp; the email token remains independent.
- Supplier records now include `whatsapp_opt_in` and `whatsapp_opt_in_at`. The consent flag defaults to false.
- WhatsApp message history is stored in `supplier_quote_whatsapp_messages`, which is RLS-enabled and accessible only to the server-side service role.

## Required Meta setup

Use a dedicated number registered in WhatsApp Business Platform (Cloud API), not a personal WhatsApp session.

Create/choose a Meta app, add the WhatsApp product, connect the WhatsApp Business Account, register the dedicated GestorPro phone number, and generate a long-lived System User access token with the required `whatsapp_business_messaging` permission (and `whatsapp_business_management` for template management).

Create and get approval for this message template before sending outbound invitations:

- Name: `gestorpro_cotacao_fornecedor`
- Language: `pt_BR`
- Category: `UTILITY`
- Body:

  `Olá, {{1}}! O GestorPro solicita sua proposta para a cotação "{{2}}". Prazo para resposta: {{3}}. Para informar preços e condições, acesse o portal seguro: {{4}}. Se não deseja receber solicitações pelo WhatsApp, responda SAIR.`

Provide example values for all four placeholders when submitting the template for review. The template must be approved by Meta before outbound business-initiated messages can be sent.

## Supabase Edge Function secrets

In Supabase Dashboard → Edge Functions → Secrets, set these values. Never place them in `index.html`, GitHub, or browser code.

- `WHATSAPP_ACCESS_TOKEN`: long-lived System User access token.
- `WHATSAPP_PHONE_NUMBER_ID`: numeric Phone Number ID from WhatsApp Manager / Meta app.
- `WHATSAPP_APP_SECRET`: Meta app secret, used to validate webhook signatures.
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: a private random string chosen by the GestorPro administrator. Use the same value when verifying the webhook in Meta.
- `WHATSAPP_QUOTE_TEMPLATE_NAME`: optional; defaults to `gestorpro_cotacao_fornecedor`.
- `WHATSAPP_QUOTE_TEMPLATE_LANGUAGE`: optional; defaults to `pt_BR`.
- `WHATSAPP_GRAPH_API_VERSION`: optional; defaults to `v27.0`.

## Meta webhook configuration

Callback URL:

`https://rtkohwkhbfxcqyyivlav.supabase.co/functions/v1/whatsapp-webhook`

Verify token: the exact value configured as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.

Subscribe to the `messages` field for the WhatsApp Business Account webhook object. Complete the WABA app subscription so message and delivery-status events reach the callback.

## Supplier consent and phone numbers

For each supplier, save a phone number in international format (Brazil: `55 + DDD + number`) and mark **Autoriza receber cotações pelo WhatsApp** only after obtaining and recording the supplier's opt-in. The system blocks sending when consent is false or the number is invalid.

## Test checklist

1. Configure all four required secrets.
2. Confirm the Meta message template status is APPROVED.
3. Configure the Meta webhook and subscribe to `messages`.
4. In GestorPro, open Cadastros → Fornecedores, save the supplier's WhatsApp number, and mark consent only after authorization.
5. Open a quotation with a valid opening and deadline, then use **Enviar convites pelo WhatsApp**.
6. Confirm the supplier receives the template and can open the secure supplier portal.
7. Reply from the supplier's WhatsApp. The webhook records the inbound message and sends an automatic acknowledgement with the active portal link.
8. Confirm delivery/read status and inbound messages in the quotation's WhatsApp message history.

Email sending remains unchanged and continues to use the institutional Gmail connection.
