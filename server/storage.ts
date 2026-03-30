// Storage helpers using Supabase Storage

import { createClient } from "@supabase/supabase-js";

function getSupabaseStorageClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase Storage credentials missing: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(url, key);
}

const BUCKET_NAME = "aaf-storage";

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

/**
 * Upload a file to Supabase Storage.
 * Returns the public URL for the uploaded file.
 */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const supabase = getSupabaseStorageClient();
  const key = normalizeKey(relKey);

  const fileData = typeof data === "string" ? new TextEncoder().encode(data) : data;

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(key, fileData, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data: urlData } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(key);

  return { key, url: urlData.publicUrl };
}

/**
 * Get a public URL for a file in Supabase Storage.
 */
export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const supabase = getSupabaseStorageClient();
  const key = normalizeKey(relKey);

  const { data: urlData } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(key);

  return { key, url: urlData.publicUrl };
}
