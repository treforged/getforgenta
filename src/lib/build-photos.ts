import { supabase } from '@/integrations/supabase/client';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB = 5;
export const MAX_PHOTOS = 6;

// Reads the first 12 bytes and compares against known image magic numbers.
// Catches MIME-type spoofing (e.g. a .exe renamed to .jpg).
async function validateMagicBytes(file: File): Promise<boolean> {
  const buf = await file.slice(0, 12).arrayBuffer();
  const b = new Uint8Array(buf);
  const isJpeg = b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
  const isPng  = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47
              && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A;
  const isWebp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
              && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return isJpeg || isPng || isWebp;
}

// Forces the file through the browser's image decoder and re-exports as JPEG.
// Only raw pixel data survives — all EXIF, GPS, IPTC, XMP, ICC profiles, PNG
// text chunks, tracker URLs, and steganographic/polyglot payloads are destroyed.
async function sanitizeImageFile(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Image re-encode failed')),
        'image/jpeg',
        0.92,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image could not be decoded — file may be corrupt or unsafe'));
    };
    img.src = url;
  });
}

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

  // Reject files whose header bytes don't match a real image format
  const magicOk = await validateMagicBytes(file).catch(() => false);
  if (!magicOk) {
    return { error: 'File does not appear to be a valid image.' };
  }

  // Re-encode through canvas: strips all metadata, trackers, and embedded payloads
  let sanitized: Blob;
  try {
    sanitized = await sanitizeImageFile(file);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Image validation failed.' };
  }

  if (sanitized.size > MAX_SIZE_MB * 1024 * 1024) {
    return { error: `Image must be under ${MAX_SIZE_MB}MB.` };
  }

  // Always store as .jpg — canvas toBlob always produces JPEG
  const path = `${userId}/${buildId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('build-photos').upload(path, sanitized, {
    contentType: 'image/jpeg',
    cacheControl: '3600',
    upsert: false,
  });
  if (error) return { error: error.message };

  const { data } = supabase.storage.from('build-photos').getPublicUrl(path);
  return { url: data.publicUrl };
}

export function pathFromUrl(url: string): string {
  const marker = '/build-photos/';
  const idx = url.indexOf(marker);
  return idx >= 0 ? url.slice(idx + marker.length) : url;
}

export async function deleteBuildPhoto(url: string): Promise<void> {
  const path = pathFromUrl(url);
  await supabase.storage.from('build-photos').remove([path]);
}
