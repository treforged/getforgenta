import { supabase } from '@/integrations/supabase/client';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB = 5;
export const MAX_PHOTOS = 6;

export async function uploadBuildPhoto(
  userId: string,
  buildId: string,
  file: File,
): Promise<{ url: string } | { error: string }> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { error: 'Only JPEG, PNG, and WebP images are allowed.' };
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return { error: `Image must be under ${MAX_SIZE_MB}MB.` };
  }

  const ext = file.type.split('/')[1];
  const path = `${userId}/${buildId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from('build-photos').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) return { error: error.message };

  const { data } = supabase.storage.from('build-photos').getPublicUrl(path);
  return { url: data.publicUrl };
}

export function pathFromUrl(url: string): string {
  // Extract storage path from public URL
  const marker = '/build-photos/';
  const idx = url.indexOf(marker);
  return idx >= 0 ? url.slice(idx + marker.length) : url;
}

export async function deleteBuildPhoto(url: string): Promise<void> {
  const path = pathFromUrl(url);
  await supabase.storage.from('build-photos').remove([path]);
}
