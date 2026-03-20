import { BrowserRouter, Routes, Route } from "react-router-dom";
import { BoardPage } from "./routes/BoardPage";
import { SettingsPage } from "./routes/SettingsPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<BoardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
