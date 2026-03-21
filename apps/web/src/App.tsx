import { BrowserRouter, Routes, Route } from "react-router-dom";
import { BoardPage } from "./routes/BoardPage";
import { SettingsPage } from "./routes/SettingsPage";
import { MachinesPage } from "./routes/MachinesPage";
import { AgentsPage } from "./routes/AgentsPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<BoardPage />} />
        <Route path="/machines" element={<MachinesPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
