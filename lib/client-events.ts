export function notifyClientDataChanged(clientId: number) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('client-data-changed', { detail: { clientId } }));
}
