import { stripe } from "@/server/billing";
import { env, features } from "@/server/env";
import { HttpError, json, route } from "@/server/http";
import { getSession } from "@/server/session";
import { getUser } from "@/server/users";

export const runtime = "nodejs";

/** Stripe customer portal (manage / cancel subscription). */
export const POST = route(async () => {
  if (!features.stripe()) throw new HttpError(503, "billing_unavailable");
  const session = await getSession();
  if (!session) throw new HttpError(401, "unauthorized");
  const user = await getUser(session.userId);
  if (!user?.stripe_customer_id) throw new HttpError(404, "no_customer");
  const portal = await stripe().billingPortal.sessions.create({ customer: user.stripe_customer_id, return_url: `${env().NEXT_PUBLIC_SITE_URL}/studio` });
  return json({ url: portal.url });
});
