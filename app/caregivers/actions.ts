'use server';

import { revalidatePath } from 'next/cache';

export async function refreshCaregiversAfterSave() {
  revalidatePath('/caregivers');
}
