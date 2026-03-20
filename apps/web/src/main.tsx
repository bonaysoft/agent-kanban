import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./globals.css";

const root = document.getElementById("root")!;

// Apply theme from localStorage or system preference
const stored = localStorage.getItem("theme");
if (stored === "dark" || (!stored && matchMedia("(prefers-color-scheme: dark)").matches)) {
  document.documentElement.classList.add("dark");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
