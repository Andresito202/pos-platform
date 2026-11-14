/** Bounded RFC-4180-style reader; does not evaluate formulas, files or XML. */
export function readCsvRecords(text: string, delimiter: "," | ";"): string[][] {
  if (text.length > 1_048_576 || new TextEncoder().encode(text).length > 1_048_576 || text.includes("\0")) throw new Error("CSV_SIZE_OR_CONTENT_REJECTED");
  const records: string[][] = []; let record: string[] = []; let field = ""; let quoted = false; let closed = false;
  const pushField = () => { if (field.length > 4096) throw new Error("CSV_FIELD_TOO_LONG"); record.push(field); field = ""; closed = false; };
  const pushRecord = () => { pushField(); if (record.some((value) => value !== "")) records.push(record); record = []; if (records.length > 1001) throw new Error("CSV_ROW_LIMIT_EXCEEDED"); };
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i]!;
    if (quoted) {
      if (character === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; closed = true; } }
      else field += character;
    } else if (character === delimiter) pushField();
    else if (character === "\n" || character === "\r") { if (character === "\r" && text[i + 1] === "\n") i += 1; pushRecord(); }
    else if (character === '"' && field === "" && !closed) quoted = true;
    else { if (closed || character === '"') throw new Error("CSV_QUOTING_INVALID"); field += character; }
  }
  if (quoted) throw new Error("CSV_QUOTING_INVALID");
  if (field !== "" || record.length > 0 || closed) pushRecord();
  return records;
}

