interface PoolSizeWarningProps {
  poolSize: number | null;
  warning: string | null;
  loading: boolean;
}

/** A warning, never a hard error, per the product spec — filters can
 * shrink the pool to almost nothing and the app should say so, not block. */
export function PoolSizeWarning({ poolSize, warning, loading }: PoolSizeWarningProps) {
  if (loading && poolSize === null) {
    return <p className="chrome text-[11px] text-platform-faint">Counting the pool…</p>;
  }
  if (poolSize === null) return null;

  return (
    <div className="flex flex-col gap-1 rounded border border-ground-line bg-ground-raised px-3 py-2">
      <p className="chrome text-[11px] text-platform">
        {poolSize} {poolSize === 1 ? "place" : "places"} in your pool
      </p>
      {warning ? <p className="chrome text-[10px] normal-case tracking-normal text-warn">{warning}</p> : null}
    </div>
  );
}
