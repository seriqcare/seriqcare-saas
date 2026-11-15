'use server';

import { revalidatePath } from 'next/cache';

export async function refreshClientsAfterSave() {
  revalidatePath('/clients');
}
