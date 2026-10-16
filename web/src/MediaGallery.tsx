import { mediaUrl } from './api';
import type { MediaReference } from './model';

/** Render authorized photo URLs with text-only captions/credits and native image loading. */
export function MediaGallery({ photos, fallback }: { photos: MediaReference[]; fallback: string }) {
  if (!photos.length) return null;
  return (
    <div className="turn-photos">
      {photos.map((photo) => (
        <figure key={photo.id}>
          <a href={mediaUrl(photo.id)} target="_blank" rel="noreferrer">
            <img src={mediaUrl(photo.id)} alt={photo.caption || fallback} loading="lazy" />
          </a>
          {photo.caption && <figcaption>{photo.caption}</figcaption>}
          {photo.credit && <small>{photo.credit}</small>}
        </figure>
      ))}
    </div>
  );
}
