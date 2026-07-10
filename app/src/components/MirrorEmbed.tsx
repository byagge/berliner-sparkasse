import { useEffect, useMemo, useState } from 'react';
import { HOME_PATH, MIRROR_ORIGIN } from '../config/mirror';
import './MirrorEmbed.css';

interface MirrorEmbedProps {
  path?: string;
  className?: string;
}

export function MirrorEmbed({ path = HOME_PATH, className }: MirrorEmbedProps) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const src = useMemo(() => {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${MIRROR_ORIGIN}${p}`;
  }, [path]);

  useEffect(() => {
    setReady(false);
    setFailed(false);
    const t = window.setTimeout(() => {
      if (!ready) setFailed(true);
    }, 30000);
    return () => window.clearTimeout(t);
  }, [src, ready]);

  return (
    <div className={['mirror-embed', className, ready && 'mirror-embed--ready'].filter(Boolean).join(' ')}>
      {!ready && (
        <div className="mirror-embed__overlay">
          <div className="mirror-embed__spinner" />
          <span>
            {failed
              ? 'Mirror nicht erreichbar — starten Sie: npm run mirror'
              : 'Berliner Sparkasse wird geladen…'}
          </span>
          {failed && (
            <p className="mirror-embed__hint">
              Im Projektroot: <code>npm install</code> → <code>npm run mirror</code>
            </p>
          )}
        </div>
      )}
      <iframe
        key={src}
        title="Berliner Sparkasse Mirror"
        className="mirror-embed__frame"
        src={src}
        onLoad={() => setReady(true)}
      />
    </div>
  );
}
