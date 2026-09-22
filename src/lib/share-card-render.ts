import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { cardLeaksMoney, type ShareCardSpec } from './share-card';

export const CARD_W = 1080;
export const CARD_H = 1350;

/**
 * Draws a ShareCardSpec to a 1080x1350 PNG (ask 555a4c71, slice 2).
 *
 * REFUSES any spec that cardLeaksMoney flags, BEFORE a pixel is drawn: the guard lives in the
 * renderer and not only in the caller, so no future caller can put a balance on a shared image.
 */
export async function renderShareCard(
  spec: ShareCardSpec,
  doc: Document = document
): Promise<Blob> {
  if (cardLeaksMoney(spec)) {
    throw new Error('share card refused: it would carry a money figure');
  }

  const canvas = doc.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('canvas 2d unavailable');
  }

  // Wait for fonts to load (ignore errors)
  try {
    await doc.fonts?.ready;
  } catch {
    // A font that never settles must not block the share; the system fallback still draws.
  }

  // Background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 0, CARD_H);
  bgGrad.addColorStop(0, '#0f1420');
  bgGrad.addColorStop(1, '#1a2233');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Gold accent bar
  ctx.fillStyle = '#d4a93c';
  ctx.fillRect(96, 360, 120, 8);

  const fontFamily =
    "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

  // Eyebrow
  ctx.fillStyle = '#9aa4b8';
  ctx.font = `bold 44px ${fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.fillText(spec.eyebrow, 96, 420);

  // Headline: step down 8px at a time until it fits between the margins, never below 64px.
  const maxWidth = CARD_W - 192;
  let headlineSize = 120;
  ctx.fillStyle = '#f5f7fa';
  ctx.font = `bold ${headlineSize}px ${fontFamily}`;
  while (headlineSize > 64 && ctx.measureText(spec.headline).width > maxWidth) {
    headlineSize -= 8;
    ctx.font = `bold ${headlineSize}px ${fontFamily}`;
  }
  ctx.fillText(spec.headline, 96, 500);

  // Subline
  ctx.fillStyle = '#d4a93c';
  ctx.font = `600 56px ${fontFamily}`;
  ctx.fillText(spec.subline, 96, 680);

  // Footer
  ctx.fillStyle = '#7d879b';
  ctx.font = `36px ${fontFamily}`;
  ctx.fillText(spec.footer, 96, CARD_H - 96);

  // Convert canvas to PNG Blob
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('png encode failed'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

/**
 * Share the rendered card image.
 * Returns 'shared', 'downloaded' or 'cancelled'.
 */
export async function shareCardImage(
  blob: Blob,
  filename = 'forgenta-debt-free.png'
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  // Native platform handling
  if (Capacitor.isNativePlatform?.()) {
    // Convert Blob to base64 string
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip data:*;base64, prefix
        const base64 = result.replace(/^data:.*;base64,/, '');
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

    // Write to cache directory
    const writeResult = await Filesystem.writeFile({
      path: filename,
      data: base64Data,
      directory: Directory.Cache,
    });

    try {
      await Share.share({
        title: 'My debt-free date',
        url: writeResult.uri,
        dialogTitle: 'Share your debt-free date',
      });
      return 'shared';
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
      if (msg.includes('cancel')) {
        return 'cancelled';
      }
      throw e;
    }
  }

  // Web platform handling
  const file = new File([blob], filename, { type: 'image/png' });

  // Attempt native share API if available
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'My debt-free date',
      });
      return 'shared';
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return 'cancelled';
      }
      throw e;
    }
  }

  // Fallback download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a tick
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return 'downloaded';
}
