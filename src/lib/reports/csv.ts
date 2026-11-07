export function csvRecords(records: string[][]): string {
  return records.map(record => record.map(value => {
    const neutralized = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
    return `"${neutralized.replaceAll('"', '""')}"`;
  }).join(";")).join("\r\n");
}
