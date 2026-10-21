/** Saves text as a file (through the browser's downloads). */
export function downloadText(text: string, name: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "swapdeck-backup-2026-10-21.json" */
export function backupFileName(date = new Date()): string {
  return `swapdeck-backup-${date.toISOString().slice(0, 10)}.json`;
}
