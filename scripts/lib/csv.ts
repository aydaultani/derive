/**
 * Minimal RFC4180-ish CSV line parser — just enough for GTFS files (which
 * are simple comma-separated with occasional double-quoted fields
 * containing commas, e.g. routes.txt's route_desc). No dependency pulled
 * in for this since the format we need to handle is small and stable.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

/** Parses a full small CSV buffer (header + rows) into objects keyed by header. */
export function parseCsv(content: string): Record<string, string>[] {
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = fields[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Streaming line-by-line CSV reader for large files (stop_times.txt).
 * Calls `onRow` for each parsed row without holding the whole file as an
 * array of objects in memory at once.
 */
export function forEachCsvLine(content: string, onRow: (row: Record<string, string>, header: string[]) => void): void {
  let start = 0;
  let header: string[] | null = null;
  const len = content.length;
  for (let i = 0; i <= len; i++) {
    if (i === len || content[i] === "\n") {
      let end = i;
      if (end > start && content[end - 1] === "\r") end--;
      if (end > start) {
        const line = content.slice(start, end);
        if (header === null) {
          header = parseCsvLine(line);
        } else {
          const fields = parseCsvLine(line);
          const row: Record<string, string> = {};
          for (let j = 0; j < header.length; j++) {
            row[header[j]] = fields[j] ?? "";
          }
          onRow(row, header);
        }
      }
      start = i + 1;
    }
  }
}
