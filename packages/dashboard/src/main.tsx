import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { RealtimeProvider } from "@/lib/realtime-context";
import { NotifyProvider } from "@/components/Notify";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <RealtimeProvider>
        <NotifyProvider>
          <App />
        </NotifyProvider>
      </RealtimeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
