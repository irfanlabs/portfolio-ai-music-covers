import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "album-art";

function extension(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

export async function uploadGeneratedImage(
  db: SupabaseClient,
  ownerId: string,
  jobId: string,
  generationId: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const path = `${ownerId}/${jobId}/${generationId}.${extension(mimeType)}`;
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: mimeType,
    cacheControl: "31536000",
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return path;
}

export async function signedObjectUrl(
  db: SupabaseClient,
  path: string,
  expiresIn: number,
): Promise<string> {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(`Could not sign image: ${error?.message ?? "unknown"}`);
  }
  return data.signedUrl;
}

export async function deleteJobAssets(
  db: SupabaseClient,
  ownerId: string,
  jobId: string,
): Promise<void> {
  const prefix = `${ownerId}/${jobId}`;
  const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`Storage list failed: ${error.message}`);
  if (!data?.length) return;
  const paths = data.map((item) => `${prefix}/${item.name}`);
  const { error: removeError } = await db.storage.from(BUCKET).remove(paths);
  if (removeError) throw new Error(`Storage delete failed: ${removeError.message}`);
}
