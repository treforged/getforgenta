import { useRef, useState } from 'react';
import { Plus, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { uploadBuildPhoto, deleteBuildPhoto, MAX_PHOTOS } from '@/lib/build-photos';

interface Props {
  buildId: string;
  userId: string;
  photos: string[];
  onPhotosChange: (photos: string[]) => void;
}

export default function BuildPhotoUploader({ buildId, userId, photos, onPhotosChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // reset so same file can be re-selected
    e.target.value = '';

    if (photos.length >= MAX_PHOTOS) {
      toast.error(`Maximum ${MAX_PHOTOS} photos allowed.`);
      return;
    }

    setUploading(true);
    const result = await uploadBuildPhoto(userId, buildId, file);
    setUploading(false);

    if ('error' in result) {
      toast.error(result.error);
      return;
    }

    onPhotosChange([...photos, result.url]);
    toast.success('Photo added');
  }

  async function handleDelete(url: string) {
    onPhotosChange(photos.filter(p => p !== url));
    await deleteBuildPhoto(url);
    toast.success('Photo removed');
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">
        Build Photos ({photos.length}/{MAX_PHOTOS})
      </div>
      <div className="grid grid-cols-3 gap-2">
        {photos.map(url => (
          <div key={url} className="relative aspect-square group">
            <img
              src={url}
              alt="Build photo"
              className="w-full h-full object-cover rounded border border-border"
              loading="lazy"
            />
            <button
              onClick={() => handleDelete(url)}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
              title="Remove photo"
            >
              <X size={10} className="text-white" />
            </button>
          </div>
        ))}

        {photos.length < MAX_PHOTOS && (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="aspect-square flex flex-col items-center justify-center gap-1 rounded border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-40"
          >
            {uploading
              ? <Loader2 size={16} className="animate-spin" />
              : <Plus size={16} />
            }
            <span className="text-[10px] font-mono uppercase">{uploading ? 'Uploading…' : 'Add Photo'}</span>
          </button>
        )}
      </div>

      <p className="text-[10px] font-mono text-muted-foreground">
        JPEG, PNG, WebP · max 5MB each · no NSFW content
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
