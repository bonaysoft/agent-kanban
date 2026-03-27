import { BarChart3, ChevronLeft, LayoutDashboard, Users } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

const navItems = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/users", label: "Users", icon: Users },
];

export function AdminLayout() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface-primary flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 fixed top-0 left-0 h-full flex flex-col" style={{ background: "#18181B", borderRight: "1px solid #27272A" }}>
        <div className="px-4 py-4 border-b" style={{ borderColor: "#27272A" }}>
          <button onClick={() => navigate("/")} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
            <ChevronLeft size={14} />
            Back to Board
          </button>
        </div>

        <div className="px-4 py-4 border-b" style={{ borderColor: "#27272A" }}>
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-[#22D3EE]" />
            <span className="text-sm font-semibold text-zinc-100 tracking-tight">Admin</span>
          </div>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors relative ${
                  isActive ? "text-[#22D3EE] bg-[#27272A]" : "text-zinc-400 hover:text-zinc-200 hover:bg-[#27272A]"
                }`
              }
              style={({ isActive }) =>
                isActive
                  ? {
                      borderLeft: "2px solid #22D3EE",
                      paddingLeft: "calc(0.75rem - 2px)",
                    }
                  : { borderLeft: "2px solid transparent", paddingLeft: "calc(0.75rem - 2px)" }
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 ml-56 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
