'use server';

import { revalidatePath } from 'next/cache';

export async function refreshClientsAfterSave() {
  revalidatePath('/clients');
}

export async function refreshClientRecords(clientId: number) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  revalidatePath('/');
  revalidatePath('/schedule');
}
