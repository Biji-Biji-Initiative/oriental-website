"use client";

import { type ComponentProps, createContext, type ReactNode, type RefObject, useContext, useRef } from "react";

type PortalContainerRef = RefObject<HTMLDivElement | null>;

const PortalContainerContext = createContext<PortalContainerRef | undefined>(undefined);

type PortalBoundaryProps = Omit<ComponentProps<"div">, "children" | "ref"> & {
  children: ReactNode;
};

/** Keeps floating UI inside a themed or otherwise scoped DOM subtree. */
function PortalBoundary({ children, ...props }: PortalBoundaryProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  return (
    <PortalContainerContext.Provider value={containerRef}>
      <div ref={containerRef} {...props}>
        {children}
      </div>
    </PortalContainerContext.Provider>
  );
}

function usePortalContainer() {
  return useContext(PortalContainerContext);
}

export { PortalBoundary, usePortalContainer };
