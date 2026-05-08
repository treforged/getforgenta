import React, { createContext, useContext, useState } from 'react';

type DemoContextType = {
  isDemo: boolean;
  setIsDemo: (v: boolean) => void;
};

const DemoContext = createContext<DemoContextType>({
  isDemo: false,
  setIsDemo: () => {},
});

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [isDemo, setIsDemo] = useState(false);
  return (
    <DemoContext.Provider value={{ isDemo, setIsDemo }}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo(): DemoContextType {
  return useContext(DemoContext);
}
