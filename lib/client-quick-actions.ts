// Add, remove, or reorder entries here to change the Clients page Quick Actions.
export const CLIENT_QUICK_ACTIONS = [
  { label: '+ Add New Client', href: '/clients/new' },
  { label: '+ Assign Caregiver', href: '/schedule?action=assign-caregiver' },
  { label: 'View Visits / EVV', href: '/visits' },
  { label: 'Schedule a Visit', href: '/schedule' },
  { label: 'Review Timesheets', href: '/timesheets' },
] as const;
