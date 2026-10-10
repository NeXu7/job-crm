// Resume preview: the same HTML that goes into the PDF, in a real-size A4 iframe scaled to fit the column.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { A4_HEIGHT_PX, renderResumeHTML, type RenderOptions } from '../../shared/template';
import type { Resolved } from '../../shared/schema';

export function ResumeFrame({ resolved, highlight, onMeasure, maxScale = 1 }: {
  resolved: Resolved; highlight?: RenderOptions['highlight']; onMeasure?: (ratio: number) => void; maxScale?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.5);
  const [height, setHeight] = useState(A4_HEIGHT_PX);
  const [loaded, setLoaded] = useState(false);
  const html = renderResumeHTML(resolved, { highlight, fontBase: '' });
  const first = useRef(html);

  const measure = () => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    const h = doc.body.scrollHeight;
    setHeight(Math.max(A4_HEIGHT_PX, h));
    onMeasure?.(h / A4_HEIGHT_PX);
  };

  // Update only <body> so the preview doesn't flicker on every edit
  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!loaded || !doc?.body) return;
    const body = html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '';
    doc.body.innerHTML = body;
    requestAnimationFrame(measure);
  }, [html, loaded]);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(maxScale, (el.clientWidth - 28) / 794)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxScale]);

  const pages = Math.ceil(height / A4_HEIGHT_PX - 0.002);
  return (
    <div className="paper" ref={wrap}>
      <div className="paper-fit" style={{ width: 794 * scale, height: height * scale }}>
        <iframe
          ref={frame} title="Предпросмотр резюме" srcDoc={first.current} sandbox="allow-same-origin"
          style={{ height, transform: `scale(${scale})` }}
          onLoad={() => { setLoaded(true); measure(); frame.current?.contentDocument?.fonts?.ready.then(measure); }}
        />
        {Array.from({ length: pages - 1 }, (_, i) => (
          <div key={i} className="pb" style={{ top: (i + 1) * A4_HEIGHT_PX * scale }}><span>конец стр. {i + 1}</span></div>
        ))}
      </div>
    </div>
  );
}
