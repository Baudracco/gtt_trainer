import { useEffect, useRef, useState } from 'react';
import type { Viewer } from '@photo-sphere-viewer/core';
import type { StreetPhoto as Photo } from './virtual';
import type { Translate } from './i18n';

/** Render genuine 360 imagery with a local open-source viewer; plane photos retain their projection. */
export function StreetPhoto({
  photo,
  bearing,
  onLoading,
  t,
}: {
  photo: Photo;
  bearing: number;
  onLoading: (loading: boolean) => void;
  t: Translate;
}) {
  const node = useRef<HTMLDivElement>(null),
    viewer = useRef<Viewer | null>(null);
  const latest = useRef({ photo, bearing });
  latest.current = { photo, bearing };
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!photo.panorama) {
      setFailed(false);
      onLoading(true);
      return;
    }
    let alive = true;
    void Promise.all([
      import('@photo-sphere-viewer/core'),
      import('@photo-sphere-viewer/core/index.css'),
    ])
      .then(([{ Viewer }]) => {
        if (!alive || !node.current) return;
        const instance = new Viewer({
          container: node.current,
          navbar: ['zoom', 'move', 'fullscreen'],
          defaultZoomLvl: 35,
        });
        viewer.current = instance;
        const current = latest.current;
        onLoading(true);
        setFailed(false);
        void instance
          .setPanorama(current.photo.url, {
            position: {
              yaw: ((current.bearing - (current.photo.heading ?? 0)) * Math.PI) / 180,
              pitch: 0,
            },
            transition: false,
          })
          .then(() => {
            if (alive) onLoading(false);
          })
          .catch(() => {
            if (alive) {
              setFailed(true);
              onLoading(false);
            }
          });
      })
      .catch(() => {
        if (alive) {
          setFailed(true);
          onLoading(false);
        }
      });
    return () => {
      alive = false;
      viewer.current?.destroy();
      viewer.current = null;
    };
  }, [photo.panorama, onLoading]);
  useEffect(() => {
    setFailed(false);
    if (!photo.panorama) {
      onLoading(true);
      return;
    }
    const instance = viewer.current;
    if (!instance) return;
    let alive = true;
    onLoading(true);
    void instance
      .setPanorama(photo.url, {
        position: { yaw: ((bearing - (photo.heading ?? 0)) * Math.PI) / 180, pitch: 0 },
        transition: false,
      })
      .then(() => {
        if (alive) onLoading(false);
      })
      .catch(() => {
        if (alive) {
          setFailed(true);
          onLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [photo.id, photo.url, photo.panorama, onLoading]);
  return (
    <div className="street-photo">
      {photo.panorama ? (
        <div className="panorama-surface" ref={node} aria-label={t('panorama')} />
      ) : (
        <img
          src={photo.url}
          alt={t('streetImage')}
          onLoad={() => onLoading(false)}
          onError={() => {
            setFailed(true);
            onLoading(false);
          }}
        />
      )}
      {failed && (
        <p className="image-error" role="status">
          {t('streetImageError')}
        </p>
      )}
    </div>
  );
}
