'use server';

import { revalidatePath } from 'next/cache';

export async function refreshScheduleAfterSave() {
  revalidatePath('/schedule');
  // Assignments also affect client/caregiver summaries and employee detail stats.
  revalidatePath('/clients');
  revalidatePath('/caregivers');
  revalidatePath('/caregivers/[id]', 'page');
}
