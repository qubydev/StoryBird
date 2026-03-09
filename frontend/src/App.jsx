import { Routes, Route } from "react-router-dom"
import StoryBoard from "./pages/StoryBoard"
import Render from "./pages/Render"
import DockMenu from "./components/dock-menu"
import { SettingsProvider } from "./context/SettingsContext"

function App() {
  return (
    <SettingsProvider>
      <Routes>
        <Route path="/" element={<StoryBoard />} />
        <Route path="/render" element={<Render />} />
      </Routes>
      <DockMenu />
    </SettingsProvider>
  )
}

export default App