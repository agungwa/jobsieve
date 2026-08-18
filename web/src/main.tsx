import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider, NavLink, Outlet, Link } from "react-router-dom";
import "./styles.css";
import JobsPage from "./pages/Jobs";
import JobDetailPage from "./pages/JobDetail";
import CvProfilePage from "./pages/CvProfile";
import MatchPage from "./pages/Match";
import ChatPage from "./pages/Chat";
import AdminPage from "./pages/admin/Admin";

const THEME_KEY = "jobsfound.theme";

/** Light/dark toggle. No data-theme attr = follow the OS preference. */
function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  });

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  function effective(): "light" | "dark" {
    if (theme) return theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  const dark = effective() === "dark";
  return (
    <button
      className="theme-toggle"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => {
        const next = dark ? "light" : "dark";
        localStorage.setItem(THEME_KEY, next);
        setTheme(next);
      }}
    >
      {dark ? "☀" : "☾"}
    </button>
  );
}

function Layout() {
  return (
    <div>
      <header className="header">
        <div className="header-inner">
          <Link to="/" className="brand">
            <img className="brand-mark" src="/favicon.svg" alt="Jobsieve logo" width={22} height={22} />
            Job<span className="brand-accent">sieve</span>
          </Link>
          <nav className="nav">
            <NavLink to="/" end>Jobs</NavLink>
            <NavLink to="/match">Matches</NavLink>
            <NavLink to="/chat">Chat</NavLink>
          </nav>
          <span className="spacer" />
          {/* No admin link on purpose — the console is reached by direct URL
              only and is protected by the API key gate. */}
          <ThemeToggle />
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <JobsPage /> },
      { path: "/jobs/:id", element: <JobDetailPage /> },
      { path: "/cv/:id", element: <CvProfilePage /> },
      { path: "/match", element: <MatchPage /> },
      { path: "/chat", element: <ChatPage /> },
      { path: "/admin/*", element: <AdminPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
