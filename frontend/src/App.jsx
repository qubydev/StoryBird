import { Routes, Route } from "react-router-dom"
import StoryBoard from "./pages/StoryBoard"
import Render from "./pages/Render"

function App() {
  return (
    <Routes>
      <Route path="/" element={<StoryBoard />} />
      <Route path="/render" element={<Render />} />
    </Routes>
  )
}

export default App