'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type QueryTab = {
  label: string;
  value: string;
  dotColor?: string;
};

type QueryTabsProps = {
  param: string;
  tabs: QueryTab[];
  resetKeys?: string[];
};

export function QueryTabs({ param, tabs, resetKeys = ['page'] }: QueryTabsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get(param) ?? '';

  function setTab(value: string) {
    const nextParams = new URLSearchParams(searchParams.toString());

    if (value) {
      nextParams.set(param, value);
    } else {
      nextParams.delete(param);
    }

    for (const key of resetKeys) {
      nextParams.delete(key);
    }

    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="status-tabs">
      {tabs.map((tab) => {
        const active = tab.value === '' ? !current : current === tab.value;
        return (
          <div
            key={tab.label}
            className={`status-tab${active ? ' active' : ''}`}
            style={{ cursor: 'pointer' }}
            onClick={() => setTab(tab.value)}
          >
            {tab.dotColor && (
              <span
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: tab.dotColor,
                  marginRight: 5,
                }}
              />
            )}
            {tab.label}
          </div>
        );
      })}
    </div>
  );
}