import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { NotifyProvider } from "./components/Notify";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <NotifyProvider>
        <App />
      </NotifyProvider>
    </BrowserRouter>
  </React.StrictMode>
);
