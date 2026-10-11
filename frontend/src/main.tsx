import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/router';
import './index.css';
import { useSiteStore } from './store/siteStore';

// Dev-only hook used by scripts/qa-interactions.mjs to read state. Not included in production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __AEROHYDRO__: unknown }).__AEROHYDRO__ = { sites: () => useSiteStore.getState() };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
