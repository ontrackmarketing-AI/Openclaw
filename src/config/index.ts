import { z } from "zod";
import "dotenv/config";

const booleanString = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((val) => val === "true" || val === "1");

const portNumber = z
  .string()
  .default("3000")
  .transform((val) => parseInt(val, 10))
  .pipe(z.number().int().min(1).max(65535));

const envSchema = z.object({
  // App
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: portNumber,
  APP_SECRET: z.string().min(1).optional(),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // Qdrant
  QDRANT_URL: z.string().url(),
  QDRANT_SWRE_URL: z.string().url().optional(),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1).optional(),
  TELEGRAM_BRYSON_CHAT_ID: z.string().min(1).optional(),

  // Google
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().min(1).optional(),
  GOOGLE_DRIVE_WATCH_FOLDER_ID: z.string().min(1).optional(),

  // AI Providers
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),

  // iMessage
  IMESSAGE_BRIDGE_URL: z.string().url().optional(),
  IMESSAGE_BRIDGE_SECRET: z.string().min(1).optional(),

  // GoHighLevel
  GHL_API_KEY: z.string().min(1).optional(),
  GHL_LOCATION_ID: z.string().min(1).optional(),

  // n8n
  N8N_BASE_URL: z.string().url().optional(),
  N8N_API_KEY: z.string().min(1).optional(),

  // Tavily
  TAVILY_API_KEY: z.string().min(1).optional(),

  // Feature flags
  ENABLE_IMESSAGE: booleanString,
  ENABLE_GMAIL_SEND: booleanString,
  ENABLE_GHL_WRITE: booleanString,
});

function parseConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.format();
    const errors = Object.entries(formatted)
      .filter(([key]) => key !== "_errors")
      .map(([key, value]) => {
        const errorObj = value as { _errors?: string[] };
        return `  ${key}: ${errorObj._errors?.join(", ") ?? "invalid"}`;
      })
      .join("\n");

    throw new Error(`Environment validation failed:\n${errors}`);
  }

  return result.data;
}

function buildConfig(env: ReturnType<typeof parseConfig>) {
  const isProduction = env.NODE_ENV === "production";

  // In production, require critical secrets
  if (isProduction) {
    const required: Array<[string, unknown]> = [
      ["APP_SECRET", env.APP_SECRET],
      ["TELEGRAM_BOT_TOKEN", env.TELEGRAM_BOT_TOKEN],
      ["ANTHROPIC_API_KEY", env.ANTHROPIC_API_KEY],
    ];

    const missing = required
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new Error(
        `Missing required production environment variables: ${missing.join(", ")}`
      );
    }
  }

  return {
    app: {
      env: env.NODE_ENV,
      port: env.PORT,
      secret: env.APP_SECRET ?? "dev-secret-change-me",
      isProduction,
      isDevelopment: env.NODE_ENV === "development",
      isTest: env.NODE_ENV === "test",
    },

    database: {
      url: env.DATABASE_URL,
    },

    redis: {
      url: env.REDIS_URL,
    },

    qdrant: {
      url: env.QDRANT_URL,
      swreUrl: env.QDRANT_SWRE_URL,
    },

    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN,
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
      brysonChatId: env.TELEGRAM_BRYSON_CHAT_ID,
    },

    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
      refreshToken: env.GOOGLE_REFRESH_TOKEN,
      driveWatchFolderId: env.GOOGLE_DRIVE_WATCH_FOLDER_ID,
    },

    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY,
    },

    openai: {
      apiKey: env.OPENAI_API_KEY,
    },

    imessage: {
      bridgeUrl: env.IMESSAGE_BRIDGE_URL,
      bridgeSecret: env.IMESSAGE_BRIDGE_SECRET,
    },

    ghl: {
      apiKey: env.GHL_API_KEY,
      locationId: env.GHL_LOCATION_ID,
    },

    n8n: {
      baseUrl: env.N8N_BASE_URL,
      apiKey: env.N8N_API_KEY,
    },

    tavily: {
      apiKey: env.TAVILY_API_KEY,
    },

    features: {
      imessage: env.ENABLE_IMESSAGE,
      gmailSend: env.ENABLE_GMAIL_SEND,
      ghlWrite: env.ENABLE_GHL_WRITE,
    },
  } as const;
}

const env = parseConfig();
export const config = buildConfig(env);
export type Config = typeof config;
