import { Routes, Route } from "react-router-dom"
import Transcript from "./pages/Transcript"
import StoryBoard from "./pages/StoryBoard"
import BottomDock from "./components/bottom-dock"

function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<StoryBoard />} />
        <Route path="/transcript" element={<Transcript />} />
      </Routes>
      <BottomDock />
    </>
  )
}

export default App
