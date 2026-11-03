import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccountProvider } from "./account";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AccountProvider>
      <App />
    </AccountProvider>
  </StrictMode>,
);
