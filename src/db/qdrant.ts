import { QdrantClient } from "@qdrant/js-client-rest";
import { config } from "../config/index.js";

const VECTOR_SIZE = 1536; // text-embedding-3-small dimension

export const COLLECTIONS = [
  "bryson_notes",
  "bryson_emails",
  "bryson_research",
  "bryson_projects",
] as const;

export type CollectionName = (typeof COLLECTIONS)[number];

/** OpenClaw's primary Qdrant instance. */
export const qdrant = new QdrantClient({
  url: config.qdrant.url,
  apiKey: config.qdrant.apiKey,
});

/** SWRE's Qdrant instance (read-only access). */
export const qdrantSwre = new QdrantClient({
  url: config.qdrantSwre.url,
  apiKey: config.qdrantSwre.apiKey,
});

/**
 * Initialize all required collections if they don't already exist.
 * Safe to call multiple times (idempotent).
 */
export async function initCollections(): Promise<void> {
  const existing = await qdrant.getCollections();
  const existingNames = new Set(existing.collections.map((c) => c.name));

  for (const name of COLLECTIONS) {
    if (existingNames.has(name)) {
      console.log(`[qdrant] Collection "${name}" already exists`);
      continue;
    }

    await qdrant.createCollection(name, {
      vectors: {
        size: VECTOR_SIZE,
        distance: "Cosine",
      },
    });

    console.log(`[qdrant] Created collection "${name}"`);
  }
}

/**
 * Health check for the primary Qdrant instance.
 */
export async function healthCheck(): Promise<boolean> {
  try {
    await qdrant.getCollections();
    return true;
  } catch {
    return false;
  }
}
