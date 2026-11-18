'use client';

import { createContext, useContext } from 'react';

const Revision = createContext(0);
export const ClientTabRevisionProvider = Revision.Provider;
export function useClientTabRevision() { return useContext(Revision); }

export { notifyClientDataChanged } from '@/lib/client-events';
