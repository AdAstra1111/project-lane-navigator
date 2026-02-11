import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

// STUB: Wire up Stripe secret key and webhook signing secret when ready
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeSignature = req.headers.get("stripe-signature");
    if (!stripeSignature) {
      return new Response(JSON.stringify({ error: "Missing stripe-signature header" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // TODO: Verify signature with Stripe webhook secret
    // const stripeWebhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

    const body = await req.text();
    const event = JSON.parse(body);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        const plan = session.metadata?.plan || "pro";
        if (userId) {
          await supabase
            .from("subscriptions")
            .update({
              plan,
              status: "active",
              stripe_customer_id: session.customer,
              stripe_subscription_id: session.subscription,
            })
            .eq("user_id", userId);
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const { data: existing } = await supabase
          .from("subscriptions")
          .select("id")
          .eq("stripe_subscription_id", sub.id)
          .maybeSingle();
        if (existing) {
          await supabase
            .from("subscriptions")
            .update({
              status: sub.status === "active" ? "active" : sub.status === "trialing" ? "trialing" : "past_due",
              cancel_at_period_end: sub.cancel_at_period_end,
              current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
              current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            })
            .eq("id", existing.id);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await supabase
          .from("subscriptions")
          .update({ plan: "free", status: "canceled", stripe_subscription_id: null })
          .eq("stripe_subscription_id", sub.id);
        break;
      }

      default:
        console.log("Unhandled event type:", event.type);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
