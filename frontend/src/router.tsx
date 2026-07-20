import { useEffect, useState } from "react";

export function useRoute(): [string, (p: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  const navigate = (p: string) => {
    if (p === window.location.pathname) return;
    window.history.pushState({}, "", p);
    setPath(p);
  };
  return [path, navigate];
}

export function Link({
  to,
  children,
  className,
  onNavigate,
}: {
  to: string;
  children: React.ReactNode;
  className?: string;
  onNavigate: (p: string) => void;
}) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        onNavigate(to);
      }}
    >
      {children}
    </a>
  );
}
