// ============================================================
// notify-pending-subscription
//
// Fired by a Database Webhook (Database -> Webhooks in the Supabase
// dashboard) on INSERT into public.payments. submit_payment_claim()
// (supabase/migrations/010_client_plan_selection.sql) inserts the row
// with status = 'pending' directly for any paid-plan claim, so this
// only ever needs to react to INSERT - there's no separate
// insert-then-flip-to-pending step to also watch for.
//
// Deploy:
//   supabase functions deploy notify-pending-subscription
//
// Required secrets (supabase secrets set NAME=value):
//   SUPABASE_URL               - same project URL as supabase-config.js
//   SUPABASE_SERVICE_ROLE_KEY  - service role key (Project Settings -> API)
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
//   NOTIFY_EMAIL               - where the alert should go
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer/mod.ts";

Deno.serve(async (req) => {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  const record = body?.record;
  if (!record || record.status !== "pending") {
    // Not a fresh pending claim (e.g. a 'paid' free-trial row) - ignore.
    return new Response("skip");
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const [{ data: profile }, { data: plan }] = await Promise.all([
    supa.from("profiles").select("business_name,email").eq("id", record.profile_id).single(),
    record.plan_id
      ? supa.from("plans").select("name").eq("id", record.plan_id).single()
      : Promise.resolve({ data: null }),
  ]);

  const client = new SMTPClient({
    connection: {
      hostname: Deno.env.get("SMTP_HOST")!,
      port: Number(Deno.env.get("SMTP_PORT")),
      tls: true,
      auth: {
        username: Deno.env.get("SMTP_USER")!,
        password: Deno.env.get("SMTP_PASS")!,
      },
    },
  });

  const businessName = profile?.business_name ?? "A client";
  const planName = plan?.name ?? "a plan";

  try {
    await client.send({
      from: Deno.env.get("SMTP_USER")!,
      to: Deno.env.get("NOTIFY_EMAIL")!,
      subject: `New pending subscription — ${businessName}`,
      content:
        `${businessName} (${profile?.email ?? "no email on file"}) submitted a ` +
        `payment claim for ${planName}.\n\n` +
        `Amount: PHP ${record.amount}\n` +
        `Method: ${record.method}\n` +
        `Reference: ${record.reference ?? "(none)"}\n\n` +
        `Approve or reject it in admin.html.`,
    });
  } finally {
    await client.close();
  }

  return new Response("ok");
});
