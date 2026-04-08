'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

export type TimeFilter = '1H' | '24H' | '7D' | '30D';

const HOURS_MAP: Record<TimeFilter, number> = {
  '1H': 1,
  '24H': 24,
  '7D': 168,
  '30D': 720,
};

interface FilterContextValue {
  timeFilter: TimeFilter;
  setTimeFilter: (f: TimeFilter) => void;
  getFilterParams: () => string;
}

const FilterContext = createContext<FilterContextValue>({
  timeFilter: '24H',
  setTimeFilter: () => {},
  getFilterParams: () => '?hours=24',
});

export function FilterProvider({ children }: { children: ReactNode }) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('24H');

  const getFilterParams = () => `?hours=${HOURS_MAP[timeFilter]}`;

  return (
    <FilterContext.Provider value={{ timeFilter, setTimeFilter, getFilterParams }}>
      {children}
    </FilterContext.Provider>
  );
}

export function useFilter() {
  return useContext(FilterContext);
}
