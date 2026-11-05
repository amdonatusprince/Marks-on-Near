import { useMemo } from "react";
import { useLocation, useNavigate, useRevalidator } from "react-router";

export function useRouter() {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  return useMemo(
    () => ({
      push: (to: string) => navigate(to),
      replace: (to: string) => navigate(to, { replace: true }),
      refresh: () => void revalidator.revalidate(),
    }),
    [navigate, revalidator],
  );
}

export function usePathname() {
  return useLocation().pathname;
}
