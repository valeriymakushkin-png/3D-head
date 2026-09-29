import "server-only";
import { z } from "zod";

/**
 * Server configuration, validated once. Every integration degrades
 * gracefully when unconfigured (local dev without Supabase/Stripe still runs
 * the full on-device product); nothing silently pretends to work.
 */
/** Vercel exposes the deployment's own domain, so a zero-config deploy still builds correct absolute links. */
function defaultSiteUrl(): string {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return host ? `https://${host}` : "http://localhost:3000";
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_SITE_URL: z.string().url().default(defaultSiteUrl()),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),

  SESSION_SECRET: z.string().min(32).optional(),

  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]{30,}$/).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_STARS_PRO: z.coerce.number().int().positive().default(600),
  TELEGRAM_STARS_BARBER: z.coerce.number().int().positive().default(2450),
  TELEGRAM_STARS_CLINIC: z.coerce.number().int().positive().default(9950),

  ANTHROPIC_API_KEY: z.string().optional(),
  STYLIST_MODEL: z.string().default("claude-opus-5-5"),
  STYLIST_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  OPENAI_API_KEY: z.string().optional(),
  /** Failover model for the stylist when Anthropic is unavailable (both vars required). */
  OPENAI_FALLBACK_MODEL: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_BARBER: z.string().optional(),
  STRIPE_PRICE_CLINIC: z.string().optional(),

  RECON_WEBHOOK_SECRET: z.string().min(32).optional(),
  /** Optional low-latency kick for the GPU dispatcher (Modal `trigger` endpoint). */
  RECON_TRIGGER_URL: z.string().url().optional(),
  RECON_TRIGGER_TOKEN: z.string().min(16).optional(),
  CRON_SECRET: z.string().min(16).optional(),

  FREE_TRANSFORMATIONS: z.coerce.number().int().min(0).default(3),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid server environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    // With a database, sessions guard real accounts: fail closed on every
    // call until SESSION_SECRET is configured (validate before caching).
    // Without one (demo deploy) there is nothing to protect, and sessions use
    // a random per-instance key (see session.ts).
    const hasBackend = !!(parsed.data.NEXT_PUBLIC_SUPABASE_URL && parsed.data.SUPABASE_SERVICE_ROLE_KEY);
    if (parsed.data.NODE_ENV === "production" && hasBackend && !parsed.data.SESSION_SECRET) {
      throw new Error("SESSION_SECRET is required in production when Supabase is configured");
    }
    cached = parsed.data;
  }
  return cached;
}

export const features = {
  backend: () => !!(env().NEXT_PUBLIC_SUPABASE_URL && env().SUPABASE_SERVICE_ROLE_KEY),
  telegram: () => !!env().TELEGRAM_BOT_TOKEN,
  stripe: () => !!(env().STRIPE_SECRET_KEY && env().STRIPE_PRICE_PRO),
  ai: () => !!(env().ANTHROPIC_API_KEY || env().OPENAI_API_KEY),
};
