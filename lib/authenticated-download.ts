type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function authenticatedDownload(endpoint: string, filename: string, apiFetch: ApiFetch) {
  const response = await apiFetch(endpoint, { method: 'GET', cache: 'no-store' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : `Download failed (HTTP ${response.status}).`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.replace(/[\\/\r\n]/g, '_');
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
