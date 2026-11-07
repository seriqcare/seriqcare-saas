'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type QuerySearchInputProps = {
  param?: string;
  placeholder: string;
  resetKeys?: string[];
};

export function QuerySearchInput({
  param = 'search',
  placeholder,
  resetKeys = ['page'],
}: QuerySearchInputProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramsString = searchParams.toString();
  const currentValue = searchParams.get(param) ?? '';
  const [value, setValue] = useState(currentValue);

  useEffect(() => {
    setValue(currentValue);
  }, [currentValue]);

  useEffect(() => {
    if (value === currentValue) {
      return;
    }

    const timer = window.setTimeout(() => {
      const nextParams = new URLSearchParams(paramsString);
      const trimmed = value.trim();

      if (trimmed) {
        nextParams.set(param, trimmed);
      } else {
        nextParams.delete(param);
      }

      for (const key of resetKeys) {
        nextParams.delete(key);
      }

      const query = nextParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [currentValue, param, paramsString, pathname, resetKeys, router, value]);

  return (
    <input
      className="search"
      placeholder={placeholder}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      style={{ cursor: 'text', color: 'var(--text)' }}
    />
  );
}