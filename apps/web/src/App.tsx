import { useMemo } from "react";
import { ApiProvider } from "./api/context";
import { createBrowserApi, type HookxApi } from "./api/client";
import { EventDetail } from "./pages/EventDetail";
import { EventsPage } from "./pages/EventsPage";
import { ExceptionDetail } from "./pages/ExceptionDetail";
import { ExceptionQueue } from "./pages/ExceptionQueue";
import { FailureLab } from "./pages/FailureLab";
import { IncidentDetail } from "./pages/IncidentDetail";
import { IncidentQueue } from "./pages/IncidentQueue";
import { Overview } from "./pages/Overview";
import { PaymentDetail } from "./pages/PaymentDetail";
import { PaymentsPage } from "./pages/PaymentsPage";
import { Router, useRouter } from "./routing/router";
import { Shell } from "./shell/Shell";

function Routes() {
  const { route } = useRouter();
  if (route.name === "overview") {
    return <Overview />;
  }
  if (route.name === "exceptions") {
    return <ExceptionQueue />;
  }
  if (route.name === "exception") {
    return <ExceptionDetail key={route.id} exceptionId={route.id} />;
  }
  if (route.name === "incidents") {
    return <IncidentQueue />;
  }
  if (route.name === "incident") {
    return <IncidentDetail key={route.id} incidentId={route.id} />;
  }
  if (route.name === "payments") {
    return <PaymentsPage key={route.search || "all"} />;
  }
  if (route.name === "payment") {
    return <PaymentDetail key={route.paymentId} paymentId={route.paymentId} />;
  }
  if (route.name === "events") {
    return <EventsPage key={route.search || "all"} />;
  }
  if (route.name === "event") {
    return <EventDetail key={route.webhookEventId} webhookEventId={route.webhookEventId} />;
  }
  if (route.name === "failure-lab") {
    return <FailureLab />;
  }
  return (
    <section className="empty">
      <h1 className="kicker">NOT FOUND</h1>
      <p>No operator page exists at this path.</p>
    </section>
  );
}

export function App({
  api,
  initialHref,
}: {
  readonly api?: HookxApi;
  readonly initialHref?: string;
}) {
  const fallback = useMemo(
    () => createBrowserApi(import.meta.env.VITE_HOOKX_API_BASE ?? ""),
    [],
  );
  const client = api ?? fallback;
  return (
    <ApiProvider client={client}>
      <Router initialHref={initialHref}>
        <Shell>
          <Routes />
        </Shell>
      </Router>
    </ApiProvider>
  );
}
