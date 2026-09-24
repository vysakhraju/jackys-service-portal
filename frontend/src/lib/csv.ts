// Small RFC4180-ish CSV helpers (2026-09-24, Price List import/export). No existing CSV
// utility in this app to reuse - built minimal on purpose: quoted fields (commas/quotes/
// newlines inside a cell), CRLF or LF line endings, blank lines skipped. Not a full CSV
// spec implementation, but covers everything Excel/Google Sheets/LibreOffice produce for
// a simple flat table, which is all this app's import/export needs.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    // Skip fully-blank trailing/blank lines (a single empty cell with nothing else).
    if (!(row.length === 1 && row[0] === '')) {
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\r') {
      // handled by the following \n (or a lone \r, treated as a line end below)
      if (text[i + 1] !== '\n') {
        pushRow();
      }
    } else if (ch === '\n') {
      pushRow();
    } else {
      field += ch;
    }
  }

  // Final field/row if the file didn't end with a newline.
  if (field !== '' || row.length > 0) {
    pushRow();
  }

  return rows;
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map((cell) => csvEscape(String(cell))).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, csvText: string): void {
  // Leading BOM so Excel (the realistic target here) opens this as UTF-8 rather than
  // guessing the system codepage and mangling any non-ASCII Billing Channel name.
  const blob = new Blob(['﻿' + csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
