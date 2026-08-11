export interface MapViewProps {
  lat: number;
  lon: number;
  label?: string;
  className?: string;
}

/** Half-width of the embed's bbox, in degrees — tight enough to read as "this block". */
const SPAN = 0.006;

/**
 * OSM's `/export/embed.html` is a full Leaflet map (pan/zoom, no API key).
 * The `filter` inverts it to a dark basemap so it doesn't blow out the
 * platform-dark card next to it — the standard trick for theming an iframe
 * you don't control the styling of.
 */
export function MapView({ lat, lon, label, className }: MapViewProps) {
  const bbox = [lon - SPAN, lat - SPAN, lon + SPAN, lat + SPAN].join(",");
  const embedSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&marker=${lat}%2C${lon}&layer=mapnik`;
  const fullHref = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;

  return (
    <div className={className}>
      <div
        className="overflow-hidden border border-ground-line"
        style={{ filter: "invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9)" }}
      >
        <iframe
          title={label ? `Map: ${label}` : "Map"}
          src={embedSrc}
          className="h-48 w-full"
          style={{ border: 0 }}
          loading="lazy"
        />
      </div>
      <a
        href={fullHref}
        target="_blank"
        rel="noreferrer"
        className="chrome mt-2 block text-center text-[11px] text-platform-dim underline decoration-platform-faint underline-offset-2 hover:text-platform"
      >
        Open in Maps &rarr;
      </a>
    </div>
  );
}
