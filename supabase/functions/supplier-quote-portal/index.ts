import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS", "Content-Type":"application/json" };
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const secretKeysRaw=Deno.env.get("SUPABASE_SECRET_KEYS");
const secretKey=secretKeysRaw
 ? (JSON.parse(secretKeysRaw)["default"] as string)
 : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if(!secretKey) throw new Error("Chave administrativa do Supabase não configurada.");
const adminFetch: typeof fetch = (input, init) => {
 const headers=new Headers(init?.headers);
 const authorization=headers.get("Authorization");
 if(authorization===`Bearer ${secretKey}`) headers.delete("Authorization");
 return fetch(input,{...init,headers});
};
const admin=createClient(Deno.env.get("SUPABASE_URL")!,secretKey,{
 auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
 global:{fetch:adminFetch}
});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(req.method!=="POST") return json({error:"Método não permitido."},405);
 try {
  const body=await req.json(); const action=body.action;
  if(action==="send"){
   const auth=req.headers.get("Authorization")||"";
   const jwt=auth.replace(/^Bearer\s+/i,"");
   if(!jwt) return json({error:"Sessão administrativa necessária."},401);
   const {data:{user},error:ue}=await admin.auth.getUser(jwt);
   if(ue||!user) return json({error:"Sessão inválida."},401);
   const {data:quote,error:qe}=await admin.from("purchase_quotes").select("id,company_id,unit_id,title,status,opened_at,deadline").eq("id",body.quote_id).single();
   if(qe||!quote) return json({error:"Cotação não encontrada."},404);
   const [{data:membership},{data:company}]=await Promise.all([
    admin.from("company_memberships").select("role,status").eq("company_id",quote.company_id).eq("user_id",user.id).maybeSingle(),
    admin.from("companies").select("owner_id").eq("id",quote.company_id).maybeSingle()
   ]);
   const isOwner=company?.owner_id===user.id;
   const hasRole=membership?.status==="active"&&["admin","manager"].includes(membership.role);
   if(!isOwner&&!hasRole) return json({error:"Sem permissão para enviar esta cotação. Verifique o vínculo ativo e o perfil de acesso da unidade."},403);
   const now=Date.now(), start=new Date(quote.opened_at).getTime(), end=new Date(quote.deadline).getTime();
   if(!quote.opened_at||!quote.deadline||!Number.isFinite(start)||!Number.isFinite(end)||start>=end) return json({error:"Informe abertura e encerramento válidos."},400);
   if(now>=end) return json({error:"O prazo de encerramento já passou."},400);
   const {data:links,error:le}=await admin.from("supplier_quote_links").select("id,supplier_id,suppliers(name,email)").eq("quote_id",quote.id);
   if(le) return json({error:le.message},500);
   if(!links?.length) return json({error:"Inclua pelo menos um fornecedor."},400);
   const apiKey=Deno.env.get("RESEND_API_KEY");
   if(!apiKey) return json({error:"Falta configurar RESEND_API_KEY nos segredos da Edge Function para envio automático de e-mails."},503);
   const base=Deno.env.get("PUBLIC_APP_URL")||"https://leonemartins.github.io/erp-restaurante/";
   const results=[];
   for(const link of links){
    const email=link.suppliers?.email;
    if(!email){results.push({supplier:link.suppliers?.name||"Fornecedor",sent:false,error:"Fornecedor sem e-mail cadastrado."});continue}
    const token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
    const tokenHash=await sha(token);
    const {error:up}=await admin.from("supplier_quote_links").update({token_hash:tokenHash,supplier_email:email,expires_at:quote.deadline,sent_at:null,last_email_error:null,token_created_at:new Date().toISOString()}).eq("id",link.id);
    if(up){results.push({supplier:link.suppliers?.name,sent:false,error:up.message});continue}
    const url=base+"?supplier_quote="+token;
    const html=`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#1c2938"><h2>Solicitação de cotação — ${quote.title}</h2><p>Você foi convidado a informar seus preços para os produtos desta cotação.</p><p><b>Encerramento:</b> ${new Date(quote.deadline).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</p><p><a href="${url}" style="display:inline-block;background:#2878c7;color:white;padding:13px 20px;border-radius:8px;text-decoration:none">Preencher cotação</a></p><p>O link é individual e ficará disponível até o encerramento.</p></div>`;
    const mail=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify({from:Deno.env.get("QUOTE_FROM_EMAIL")||"GestorPro <onboarding@resend.dev>",to:[email],subject:"Cotação: "+quote.title,html})});
    const result=await mail.json().catch(()=>({}));
    if(!mail.ok){await admin.from("supplier_quote_links").update({last_email_error:result.message||"Falha no envio"}).eq("id",link.id);results.push({supplier:link.suppliers?.name,sent:false,error:result.message||"Falha no envio"});continue}
    await admin.from("supplier_quote_links").update({sent_at:new Date().toISOString(),last_email_error:null}).eq("id",link.id);
    results.push({supplier:link.suppliers?.name,sent:true});
   }
   return json({results,sent:results.filter(x=>x.sent).length,total:results.length});
  }
  const token=String(body.token||"");
  if(!/^[a-f0-9]{64}$/.test(token)) return json({error:"Link inválido."},400);
  const hash=await sha(token);
  const {data:link,error:linkErr}=await admin.from("supplier_quote_links").select("id,quote_id,supplier_id,expires_at,submitted_at,suppliers(name),purchase_quotes(id,title,status,opened_at,deadline)").or("token_hash.eq."+hash+",whatsapp_token_hash.eq."+hash).maybeSingle();
  if(linkErr||!link) return json({error:"Link inválido ou não encontrado."},404);
  const quote=link.purchase_quotes;
  if(!quote) return json({error:"Cotação não encontrada."},404);
  if(action==="view"){
   if(link.submitted_at) return json({error:"Esta proposta já foi enviada. Entre em contato com o comprador para correções."},409);
   if(Date.now()<new Date(quote.opened_at).getTime()) return json({error:"A cotação ainda não abriu."},403);
   if(Date.now()>=new Date(quote.deadline).getTime()||quote.status==="cancelled") return json({error:"O prazo desta cotação terminou."},403);
   const {data:items,error:ie}=await admin.from("purchase_quote_items").select("id,quantity,products(name,unit_measure)").eq("quote_id",quote.id);
   if(ie) return json({error:ie.message},500);
   const {data:existing}=await admin.from("supplier_quote_prices").select("quote_item_id,unit_price,brand,notes").eq("supplier_id",link.supplier_id).in("quote_item_id",(items||[]).map(x=>x.id));
   return json({title:quote.title,supplier:link.suppliers?.name,deadline:quote.deadline,items,existing:existing||[]});
  }
  if(action==="submit"){
   if(link.submitted_at) return json({error:"Esta proposta já foi enviada."},409);
   if(Date.now()<new Date(quote.opened_at).getTime()||Date.now()>=new Date(quote.deadline).getTime()||quote.status==="cancelled") return json({error:"Cotação fora do período de resposta."},403);
   const {data:items,error:ie}=await admin.from("purchase_quote_items").select("id").eq("quote_id",quote.id);
   if(ie) return json({error:ie.message},500);
   const allowed=new Set((items||[]).map(x=>x.id)); const submitted=Array.isArray(body.prices)?body.prices:[];
   if(!submitted.length||submitted.some((x:any)=>!allowed.has(x.quote_item_id)||!Number.isFinite(Number(x.unit_price))||Number(x.unit_price)<=0)) return json({error:"Informe preços válidos para os produtos da cotação."},400);
   if(new Set(submitted.map((x:any)=>x.quote_item_id)).size!==submitted.length) return json({error:"Produto duplicado na proposta."},400);
   const payload=submitted.map((x:any)=>({quote_item_id:x.quote_item_id,supplier_id:link.supplier_id,unit_price:Number(x.unit_price),brand:String(x.brand||"").slice(0,120)||null,notes:String(x.notes||"").slice(0,500)||null}));
   const {error:up}=await admin.from("supplier_quote_prices").upsert(payload,{onConflict:"quote_item_id,supplier_id"});
   if(up) return json({error:up.message},500);
   const {error:mark}=await admin.from("supplier_quote_links").update({submitted_at:new Date().toISOString()}).eq("id",link.id);
   if(mark) return json({error:mark.message},500);
   return json({ok:true,message:"Proposta enviada com sucesso. Obrigado!"});
  }
  return json({error:"Ação inválida."},400);
 } catch(e){return json({error:e instanceof Error?e.message:"Erro inesperado."},500)}
});