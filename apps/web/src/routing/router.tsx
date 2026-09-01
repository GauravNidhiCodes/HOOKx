/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

export type ConsoleRoute =
  | { readonly name: "exceptions"; readonly search: string }
  | { readonly name: "exception"; readonly id: string }
  | { readonly name: "payments"; readonly paymentId: string | null }
  | { readonly name: "events"; readonly webhookEventId: string | null }
  | { readonly name: "unknown"; readonly path: string };

export function parseRoute(pathname: string, search = ""): ConsoleRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/exceptions") {
    return { name: "exceptions", search };
  }
  const exception = /^\/exceptions\/([^/]+)$/.exec(path);
  if (exception?.[1] !== undefined) {
    return { name: "exception", id: decodeURIComponent(exception[1]) };
  }
  if (path === "/payments") {
    return { name: "payments", paymentId: null };
  }
  const payment = /^\/payments\/(.+)$/.exec(path);
  if (payment?.[1] !== undefined) {
    return { name: "payments", paymentId: decodeURIComponent(payment[1]) };
  }
  if (path === "/events") {
    return { name: "events", webhookEventId: null };
  }
  const event = /^\/events\/([^/]+)$/.exec(path);
  if (event?.[1] !== undefined) {
    return { name: "events", webhookEventId: decodeURIComponent(event[1]) };
  }
  return { name: "unknown", path };
}

type RouterValue = {
  readonly href: string;
  readonly route: ConsoleRoute;
  navigate(to: string): void;
};

const RouterContext = createContext<RouterValue | null>(null);

export function Router({
  children,
  initialHref,
}: {
  readonly children: ReactNode;
  readonly initialHref?: string;
}) {
  const [href, setHref] = useState(() => {
    if (initialHref !== undefined) {
      return initialHref;
    }
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const search = window.location.search;
    if (path === "/") {
      return "/exceptions";
    }
    return `${path}${search}`;
  });

  useEffect(() => {
    if (initialHref !== undefined) {
      return;
    }
    if (window.location.pathname === "/" || window.location.pathname === "") {
      window.history.replaceState(null, "", "/exceptions");
    }
    const onPop = () => {
      setHref(`${window.location.pathname}${window.location.search}`);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [initialHref]);

  const navigate = useCallback(
    (to: string) => {
      if (initialHref === undefined) {
        window.history.pushState(null, "", to);
      }
      setHref(to);
    },
    [initialHref],
  );

  const value = useMemo((): RouterValue => {
    const url = new URL(href, "http://hookx.local");
    return {
      href,
      route: parseRoute(url.pathname, url.search),
      navigate,
    };
  }, [href, navigate]);

  return (
    <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
  );
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (value === null) {
    throw new Error("HOOKX operator console: router is not provided");
  }
  return value;
}

export function Link({
  href,
  children,
  className,
}: {
  readonly href: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const { href: current, navigate } = useRouter();
  const active = current.split("?")[0] === href.split("?")[0];
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    navigate(href);
  }
  return (
    <a
      href={href}
      className={className}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {children}
    </a>
  );
}
