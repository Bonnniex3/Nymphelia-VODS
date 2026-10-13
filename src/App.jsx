import { Suspense } from "react";
import { createBrowserRouter, Outlet, RouterProvider, ScrollRestoration, useLocation, useNavigation } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import Backdrop from "./shell/Backdrop";
import CursorSparkles from "./fx/CursorSparkles";
import TopBar from "./shell/TopBar";
import Loading from "./shell/Loading";
import ErrorBoundary from "./shell/ErrorBoundary";
import Home from "./home/Home";
import ArchivePage from "./archive/ArchivePage";
import { loadNotFound, loadWatch } from "./routes";

// Holographic progress bar under the taskbar while a lazy route chunk loads.
function NavProgress() {
  const navigation = useNavigation();
  if (navigation.state !== "loading") return null;
  return (
    <div role="progressbar" aria-label="Loading" className="fixed inset-x-0 top-[var(--topbar-h)] z-50 h-0.5 overflow-hidden">
      <div className="h-full w-1/3 animate-boot holo-bg" />
    </div>
  );
}

function BootScreen() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Loading label="booting" />
    </div>
  );
}

function Layout() {
  const { pathname } = useLocation();
  return (
    <>
      <Backdrop />
      <NavProgress />
      <div className="relative z-10 flex min-h-dvh flex-col">
        <TopBar />
        <ErrorBoundary key={pathname}>
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </div>
      <CursorSparkles />
      <ScrollRestoration />
    </>
  );
}

// A data router is required for view transitions (`<Link viewTransition>`).
const router = createBrowserRouter([
  {
    element: <Layout />,
    HydrateFallback: BootScreen,
    children: [
      { path: "/", element: <Home /> },
      { path: "/vods", element: <ArchivePage /> },
      { path: "/vod/:slug", lazy: () => loadWatch().then((m) => ({ Component: m.default })) },
      { path: "*", lazy: () => loadNotFound().then((m) => ({ Component: m.default })) },
    ],
  },
]);

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Analytics />
    </>
  );
}
