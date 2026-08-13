import { Routes, Route } from "react-router-dom"
import StoryBoard from "./pages/StoryBoard"
import Render from "./pages/Render"
import Dashboard from "./pages/Dashboard"
import DockMenu from "./components/dock-menu"

function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/project/:projectId" element={<StoryBoard />} />
        <Route path="/render" element={<Render />} />
      </Routes>
      <DockMenu />
    </>
  )
}

export default App
